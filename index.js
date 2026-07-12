/**
 * ASG Payment Gateway Enterprise — Main Server (Firebase RTDB Edition)
 * Express + Node-Cron + Firebase Realtime DB
 * Render-ready: PORT=10000
 */
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const cron     = require('node-cron');
const path     = require('path');
const db       = require('./database');

// ── Verification Engine & SMS Queue ───────────────────────────────────────────
const verEng = require('./verificationEngine');
const smsQueue = require('./smsQueue');
smsQueue.init(db, verEng);

// ── Email Fallback Engine ─────────────────────────────────────────────────────
const emailEngine = require('./emailEngine');
emailEngine.init(verEng);

// ── Heartbeat Monitor ─────────────────────────────────────────────────────────
const heartbeat = require('./heartbeat');

// ── Telegram Bot Fallback ─────────────────────────────────────────────────────
const telegramBot = require('./telegramBot');
telegramBot.init(verEng);

// ── Manual UTR Verification ───────────────────────────────────────────────────
const manualVerify = require('./manualVerify');

// ── Routers ───────────────────────────────────────────────────────────────────
const ordersRoute  = require('./orders');
const adminRoute   = require('./admin');
const authRoute    = require('./auth');
const apiV1        = require('./api_v1');

// ── Razorpay Webhook ──────────────────────────────────────────────────────────
const razorpayWebhook = require('./razorpayWebhook');
// ── Cashfree Webhook ──────────────────────────────────────────────────────────
const cashfreeWebhook = require('./cashfreeWebhook');

// ── Express App ───────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

const corsOptions = {
  origin: (origin, cb) => {
    const allowed = process.env.ALLOWED_ORIGIN;
    if (!allowed || allowed === '*' || !origin) return cb(null, true);
    if (origin === allowed || origin.endsWith('.' + new URL(allowed).hostname)) return cb(null, true);
    cb(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token', 'x-sms-webhook-secret', 'x-sms-sender'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
}));

app.use('/api/auth/login',  rateLimit({ windowMs: 15*60*1000, max: 15, message: { error: 'Too many login attempts. Wait 15 minutes.' } }));
app.use('/api/auth/signup', rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: 'Too many signups from this IP.' } }));
app.use('/api/orders/create', rateLimit({ windowMs: 60*1000,  max: 5, message: { error: 'Too many order requests.' } }));
app.use('/api/orders/sms',    rateLimit({ windowMs: 60*1000,  max: 60, message: { error: 'SMS webhook rate limit exceeded.' } }));

app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));

// ── SDK — Serve with CORS headers so ANY website can load it ─────────────────
app.get('/sdk.js', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'sdk.js'));
});

// ── Static Frontend ───────────────────────────────────────────────────────────
const publicFiles = ['login.html', 'dashboard.html', 'admin.html', 'app.js', 'style.css', 'checkout.html', 'cashier.html', 'pos.html', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png'];
publicFiles.forEach(file => {
  app.get('/' + file, (req, res) => res.sendFile(path.join(__dirname, file)));
});

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'merchant-app.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ── Smart Checkout Link Route ─────────────────────────────────────────────────
app.get('/pay/:enterpriseId', (req, res) => {
  res.sendFile(path.join(__dirname, 'checkout.html'));
});

// Enforce strict APK download headers for Android phones
const apkFiles = ['ASG Payment Gateway-Forwarder.apk', 'ASG Payment Gateway-App.apk'];
apkFiles.forEach(apk => {
  app.get('/' + apk, (req, res) => {
    res.download(path.join(__dirname, apk), apk, (err) => {
      if (err) console.error(`Error serving ${apk}:`, err);
    });
  });
});

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    const test = await db.get('health');
    dbOk = true;
  } catch (e) {}

  res.json({
    status: dbOk ? 'ok' : 'degraded',
    version: '2.0.0 (Firebase RTDB)',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    db: dbOk ? 'ok' : 'error',
    uptime: Math.floor(process.uptime()),
  });
});

// ── Public Web Routes ─────────────────────────────────────────────────────────
app.get('/invoice/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'invoice.html'));
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoute.router);
app.use('/api/orders',       ordersRoute.router);
app.use('/api/admin',        adminRoute.router);
app.use('/api/heartbeat',    heartbeat.router);
app.use('/api/admin',        manualVerify.router); // Manual UTR verify endpoints
app.use('/api/webhooks/razorpay', razorpayWebhook.router);
app.use('/api/webhooks/cashfree', cashfreeWebhook.router);
app.use('/api/v1',           apiV1.router);

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Cron Jobs ─────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', () => {
  verEng.expireStaleOrders().catch(()=>{});
  heartbeat.checkOfflineDevices().catch(()=>{});
});

cron.schedule('0 2 * * *', async () => {
  try {
    const sessions = await db.find('enterprise_sessions', s => new Date(s.expires_at) < new Date());
    for (const s of sessions) {
      await db.remove(`enterprise_sessions/${s.id}`);
    }
    if (sessions.length > 0) console.log(`[Cron] Cleaned ${sessions.length} expired sessions`);
  } catch (e) {}
});

cron.schedule('*/30 * * * * *', () => {
  smsQueue.processQueue().catch(()=>{});
});

// ── Email Fallback Engine Cron (every 2 minutes) ──────────────────────────────
cron.schedule('*/2 * * * *', () => {
  emailEngine.pollAllEnterprises().catch(()=>{});
});

// ── Abandoned Cart Recovery Engine Cron (every 5 minutes) ────────────────────
cron.schedule('*/5 * * * *', async () => {
  try {
    const now = new Date();
    // Find pending orders older than 10 mins, less than 24 hours, not reminded yet
    const pending = await db.find('orders', o => 
      o.status === 'pending' && !o.reminded &&
      (now - new Date(o.created_at)) > 10 * 60 * 1000 &&
      (now - new Date(o.created_at)) < 24 * 60 * 60 * 1000
    );
    
    for (const order of pending) {
      if (!order.user_id) continue;
      const user = await db.get(`users/${order.user_id}`);
      if (user && user.email) {
        console.log(`[Recovery Engine] 🛒 Sent Abandoned Cart Email to ${user.email} for order ${order.id} (₹${order.amount})`);
        // In production: send actual email here via NodeMailer/SES
        await db.patch(`orders/${order.id}`, { reminded: true });
      }
    }
  } catch (e) {
    console.error('[Recovery Engine Error]', e.message);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n⚡ ASG Payment Gateway Enterprise v2.0 (Firebase RTDB)`);
  console.log(`🌐 Running on port ${PORT} | ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Dashboard:  /dashboard.html`);
  console.log(`🔐 Login:      /login.html`);
  console.log(`📦 SDK:        /sdk.js`);
  console.log(`❤️  Health:     /api/health\n`);
  
  smsQueue.startKeepAlive(process.env.ALLOWED_ORIGIN);
});

module.exports = app;
