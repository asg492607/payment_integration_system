/**
 * Enterprise Auth Router - Firebase Realtime DB Version
 */
require('dotenv').config();
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// ── Crypto helpers ────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(test));
}

function generateToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Session middleware ────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim() || req.cookies?.session_token;

    if (!token) return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });

    const tokenHash = hashToken(token);
    const session = await db.findOne('enterprise_sessions', s => s.token_hash === tokenHash);

    if (!session || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Session expired or invalid', code: 'SESSION_INVALID' });
    }

    const eu = await db.get(`enterprise_users/${session.user_id}`);
    if (!eu) return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    if (!eu.is_active) return res.status(403).json({ error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' });

    req.enterpriseUser = { ...session, eid: eu.id, email: eu.email, name: eu.name, company: eu.company, setup_complete: eu.setup_complete, upi_vpa: eu.upi_vpa, upi_payee_name: eu.upi_payee_name, plan: eu.plan };
    req.enterpriseUserId = session.user_id;
    next();
  } catch (err) {
    console.error('[Auth] requireAuth error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { email, name, company, password } = req.body;

    if (!email || !name || !password) return res.status(400).json({ error: 'email, name, and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

    const existing = await db.findOne('enterprise_users', u => u.email === email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const id = uuidv4();
    const passwordHash = hashPassword(password);
    const defaultHmacSecret = crypto.randomBytes(32).toString('hex');
    const defaultWebhookSecret = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    const newUser = {
      id, email: email.toLowerCase(), name, company: company || null,
      password_hash: passwordHash, hmac_secret: defaultHmacSecret, sms_webhook_secret: defaultWebhookSecret,
      is_verified: 0, is_active: 1, plan: 'starter', setup_complete: 0, created_at: now, updated_at: now
    };

    await db.put(`enterprise_users/${id}`, newUser);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db.put(`enterprise_sessions/${sessionId}`, {
      id: sessionId, user_id: id, token_hash: tokenHash, expires_at: expiresAt, ip_address: req.ip || '', user_agent: req.headers['user-agent'] || '', created_at: now
    });

    res.status(201).json({
      success: true, token, expiresAt,
      user: { id, email: newUser.email, name, company: newUser.company, setup_complete: 0, upi_vpa: null, plan: 'starter', created_at: now },
    });
  } catch (err) {
    console.error('[Auth] Signup error:', err.message || err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const user = await db.findOne('enterprise_users', u => u.email === email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.is_active) return res.status(403).json({ error: 'Account is suspended. Contact support.' });

    let passwordValid = false;
    try { passwordValid = verifyPassword(password, user.password_hash); } catch (e) { }
    if (!passwordValid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = generateToken();
    const tokenHash = hashToken(token);
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await db.put(`enterprise_sessions/${sessionId}`, {
      id: sessionId, user_id: user.id, token_hash: tokenHash, expires_at: expiresAt, ip_address: req.ip || '', user_agent: req.headers['user-agent'] || '', created_at: now
    });

    res.json({
      success: true, token, expiresAt,
      user: { id: user.id, email: user.email, name: user.name, company: user.company, setup_complete: user.setup_complete, upi_vpa: user.upi_vpa, plan: user.plan, created_at: user.created_at },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      const tokenHash = hashToken(token);
      const session = await db.findOne('enterprise_sessions', s => s.token_hash === tokenHash);
      if (session) await db.remove(`enterprise_sessions/${session.id}`);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.get(`enterprise_users/${req.enterpriseUserId}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const orders = await db.find('orders', o => o.enterprise_id === req.enterpriseUserId);
    const endUsers = await db.find('users', u => u.enterprise_id === req.enterpriseUserId);
    
    let totalRevenue = 0, paidOrders = 0, pendingOrders = 0, activeUsers = 0;
    orders.forEach(o => {
      if (o.status === 'paid') { paidOrders++; totalRevenue += parseFloat(o.amount || 0); }
      if (o.status === 'pending') pendingOrders++;
    });
    endUsers.forEach(u => { if (u.is_active) activeUsers++; });

    const stats = { totalOrders: orders.length, paidOrders, pendingOrders, activeUsers, totalRevenue };
    delete user.password_hash;
    res.json({ user, stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// ── PUT /api/auth/setup ───────────────────────────────────────────────────────
router.put('/setup', requireAuth, async (req, res) => {
  try {
    const { upi_vpa, upi_payee_name, trusted_sms_sender, company } = req.body;
    if (!upi_vpa) return res.status(400).json({ error: 'UPI VPA (UPI ID) is required' });
    if (!/^[\w.\-+]+@[\w]+$/.test(upi_vpa.trim())) return res.status(400).json({ error: 'Invalid UPI ID format' });

    const updates = {
      upi_vpa: upi_vpa.trim(), setup_complete: 1, updated_at: new Date().toISOString()
    };
    if (upi_payee_name !== undefined) updates.upi_payee_name = upi_payee_name.trim();
    if (trusted_sms_sender !== undefined) updates.trusted_sms_sender = trusted_sms_sender.trim();
    if (company !== undefined) updates.company = company.trim();

    await db.patch(`enterprise_users/${req.enterpriseUserId}`, updates);
    const user = await db.get(`enterprise_users/${req.enterpriseUserId}`);
    delete user.password_hash;
    
    res.json({ success: true, user });
  } catch (err) {
    console.error('[Auth] Setup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/auth/setup ────────────────────────────────────────────────────────
router.get('/setup', requireAuth, async (req, res) => {
  try {
    const user = await db.get(`enterprise_users/${req.enterpriseUserId}`);
    if (!user) return res.status(404).json({ error: 'User not found' });
    delete user.password_hash;
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

function setDb() {} // No longer needed
module.exports = { router, setDb, requireAuth, hashToken };
