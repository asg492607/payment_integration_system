/**
 * PayForge Enterprise — Main Server
 * Express + SQLite + Cron + Firebase real-time
 * Render-ready: PORT=10000, DB=/data/payments.db
 */
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const cron     = require('node-cron');
const path     = require('path');

// ── DB Init ───────────────────────────────────────────────────────────────────
const db = require('./db/init');

// ── Verification Engine ───────────────────────────────────────────────────────
const verEng = require('./engine/verificationEngine');
verEng.setDb(db);

// ── SMS Queue & Retry ─────────────────────────────────────────────────────────
const smsQueue = require('./lib/smsQueue');
smsQueue.init(db, verEng);

// ── Routers ───────────────────────────────────────────────────────────────────
const ordersRoute = require('./routes/orders');
const adminRoute  = require('./routes/admin');
const authRoute   = require('./routes/auth');

ordersRoute.setDb(db);
adminRoute.setDb(db);
authRoute.setDb(db);

// ── Express App ───────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Required for Render/reverse-proxy correct IP

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // Let users embed the SDK anywhere
  crossOriginEmbedderPolicy: false,
}));

// CORS — Open for SDK embeds (the SDK itself is public JS)
// Restrict in production by setting ALLOWED_ORIGIN env var
const corsOptions = {
  origin: (origin, cb) => {
    const allowed = process.env.ALLOWED_ORIGIN;
    // Allow all if not set (dev mode or open SaaS)
    if (!allowed || allowed === '*' || !origin) return cb(null, true);
    // Allow the configured origin AND any subdomain
    if (origin === allowed || origin.endsWith('.' + new URL(allowed).hostname)) {
      return cb(null, true);
    }
    // Always allow same-origin
    cb(null, true); // Permissive for SDK — users embed from their own domains
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization',
    'x-admin-token', 'x-sms-webhook-secret', 'x-sms-sender',
  ],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight for SDK cross-origin calls

// ── Rate Limiting ─────────────────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
}));

app.use('/api/auth/login',  rateLimit({ windowMs: 15*60*1000, max: 15, message: { error: 'Too many login attempts. Wait 15 minutes.' } }));
app.use('/api/auth/signup', rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: 'Too many signups from this IP.' } }));
app.use('/api/orders/create', rateLimit({ windowMs: 60*1000,  max: 30, message: { error: 'Too many order requests.' } }));
app.use('/api/orders/sms',    rateLimit({ windowMs: 60*1000,  max: 60, message: { error: 'SMS webhook rate limit exceeded.' } }));

app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));

// ── SDK — Serve with CORS headers so ANY website can load it ─────────────────
app.get('/sdk.js', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5-min cache
  res.sendFile(path.join(__dirname, '../public/sdk.js'));
});

// ── Static Frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag: true,
}));

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const dbOk = (() => {
    try { db.prepare('SELECT 1').get(); return true; } catch (e) { return false; }
  })();

  res.json({
    status: dbOk ? 'ok' : 'degraded',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    db: dbOk ? 'ok' : 'error',
    uptime: Math.floor(process.uptime()),
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoute.router);
app.use('/api/orders', ordersRoute.router);
app.use('/api/admin',  adminRoute.router);

// ── SPA fallback (serve dashboard/login/admin from public/) ───────────────────
app.get('*', (req, res) => {
  // Only serve HTML for non-file requests
  if (req.path.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Cron Jobs ─────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', () => {
  verEng.expireStaleOrders();
});

// Clean expired sessions every night at 2AM
cron.schedule('0 2 * * *', () => {
  const r = db.prepare(`DELETE FROM enterprise_sessions WHERE datetime(expires_at) < datetime('now')`).run();
  if (r.changes) console.log(`[Cron] Cleaned ${r.changes} expired sessions`);
});

// Process SMS retry queue every 30 seconds
cron.schedule('*/30 * * * * *', () => {
  smsQueue.processQueue();
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n⚡ PayForge Enterprise v2.0`);
  console.log(`🌐 Running on port ${PORT} | ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Dashboard:  /dashboard.html`);
  console.log(`🔐 Login:      /login.html`);
  console.log(`🛡️  Admin:      /admin.html`);
  console.log(`📦 SDK:        /sdk.js`);
  console.log(`❤️  Health:     /api/health\n`);
  
  // Start Keep-Alive (set ALLOWED_ORIGIN to your render URL)
  smsQueue.startKeepAlive(process.env.ALLOWED_ORIGIN);
});

module.exports = app;
