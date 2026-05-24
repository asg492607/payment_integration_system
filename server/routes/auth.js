/**
 * Enterprise Auth Router
 * POST /api/auth/signup   — Register enterprise account
 * POST /api/auth/login    — Login → JWT session
 * POST /api/auth/logout   — Invalidate session
 * GET  /api/auth/me       — Get profile
 * PUT  /api/auth/setup    — Configure UPI ID + settings
 * GET  /api/auth/setup    — Get current UPI setup
 */
require('dotenv').config();
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

let db;
function setDb(database) { db = database; }

// ── Crypto helpers ────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
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
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    || req.cookies?.session_token;

  if (!token) return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });

  const tokenHash = hashToken(token);
  const session = db.prepare(`
    SELECT s.*, eu.id as eid, eu.email, eu.name, eu.company, eu.is_active,
           eu.setup_complete, eu.upi_vpa, eu.upi_payee_name, eu.plan
    FROM enterprise_sessions s
    JOIN enterprise_users eu ON s.user_id = eu.id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')
  `).get(tokenHash);

  if (!session) return res.status(401).json({ error: 'Session expired or invalid', code: 'SESSION_INVALID' });
  if (!session.is_active) return res.status(403).json({ error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' });

  req.enterpriseUser = session;
  req.enterpriseUserId = session.user_id;
  next();
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
router.post('/signup', (req, res) => {
  try {
    const { email, name, company, password } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'email, name, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const existing = db.prepare(`SELECT id FROM enterprise_users WHERE email = ?`).get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const id = uuidv4();
    const passwordHash = hashPassword(password);
    const defaultHmacSecret = crypto.randomBytes(32).toString('hex');
    const defaultWebhookSecret = crypto.randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO enterprise_users (id, email, name, company, password_hash, hmac_secret, sms_webhook_secret)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email.toLowerCase(), name, company || null, passwordHash, defaultHmacSecret, defaultWebhookSecret);

    // Auto-login after signup
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    db.prepare(`
      INSERT INTO enterprise_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, id, tokenHash, expiresAt, req.ip, req.headers['user-agent'] || '');

    const user = db.prepare(`
      SELECT id, email, name, company, setup_complete, upi_vpa, plan, created_at
      FROM enterprise_users WHERE id = ?
    `).get(id);

    res.status(201).json({
      success: true,
      token,
      expiresAt,
      user,
    });
  } catch (err) {
    console.error('[Auth] Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const user = db.prepare(`SELECT * FROM enterprise_users WHERE email = ?`).get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.is_active) return res.status(403).json({ error: 'Account is suspended. Contact support.' });

    let passwordValid = false;
    try {
      passwordValid = verifyPassword(password, user.password_hash);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!passwordValid) return res.status(401).json({ error: 'Invalid email or password' });

    // Create session
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO enterprise_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, user.id, tokenHash, expiresAt, req.ip, req.headers['user-agent'] || '');

    res.json({
      success: true,
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        company: user.company,
        setup_complete: user.setup_complete,
        upi_vpa: user.upi_vpa,
        plan: user.plan,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    const tokenHash = hashToken(token);
    db.prepare(`DELETE FROM enterprise_sessions WHERE token_hash = ?`).run(tokenHash);
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT id, email, name, company, setup_complete, upi_vpa, upi_payee_name,
           sms_webhook_secret, trusted_sms_sender, plan, is_verified, created_at
    FROM enterprise_users WHERE id = ?
  `).get(req.enterpriseUserId);

  if (!user) return res.status(404).json({ error: 'User not found' });

  // Stats for this enterprise
  const stats = {
    totalOrders: db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id = ?`).get(req.enterpriseUserId)?.c || 0,
    paidOrders: db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id = ? AND status = 'paid'`).get(req.enterpriseUserId)?.c || 0,
    pendingOrders: db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id = ? AND status = 'pending'`).get(req.enterpriseUserId)?.c || 0,
    activeUsers: db.prepare(`SELECT COUNT(*) as c FROM users WHERE enterprise_id = ? AND is_active = 1`).get(req.enterpriseUserId)?.c || 0,
    totalRevenue: db.prepare(`SELECT SUM(amount) as s FROM orders WHERE enterprise_id = ? AND status = 'paid'`).get(req.enterpriseUserId)?.s || 0,
  };

  res.json({ user, stats });
});

// ── PUT /api/auth/setup ───────────────────────────────────────────────────────
router.put('/setup', requireAuth, (req, res) => {
  try {
    const { upi_vpa, upi_payee_name, trusted_sms_sender, company } = req.body;

    if (!upi_vpa) return res.status(400).json({ error: 'UPI VPA (UPI ID) is required' });

    // Validate UPI VPA format
    const upiRegex = /^[\w.\-+]+@[\w]+$/;
    if (!upiRegex.test(upi_vpa.trim())) {
      return res.status(400).json({ error: 'Invalid UPI ID format. Use format: name@bank (e.g. business@ybl)' });
    }

    db.prepare(`
      UPDATE enterprise_users
      SET upi_vpa = ?, upi_payee_name = ?, trusted_sms_sender = ?,
          company = COALESCE(?, company),
          setup_complete = 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      upi_vpa.trim(),
      upi_payee_name?.trim() || null,
      trusted_sms_sender?.trim() || null,
      company?.trim() || null,
      req.enterpriseUserId
    );

    const updated = db.prepare(`
      SELECT id, email, name, company, setup_complete, upi_vpa, upi_payee_name,
             trusted_sms_sender, sms_webhook_secret, plan
      FROM enterprise_users WHERE id = ?
    `).get(req.enterpriseUserId);

    res.json({ success: true, user: updated });
  } catch (err) {
    console.error('[Auth] Setup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/auth/setup ────────────────────────────────────────────────────────
router.get('/setup', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT id, email, name, company, setup_complete, upi_vpa, upi_payee_name,
           sms_webhook_secret, trusted_sms_sender, hmac_secret, plan, created_at
    FROM enterprise_users WHERE id = ?
  `).get(req.enterpriseUserId);

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// ── PUT /api/auth/password ────────────────────────────────────────────────────
router.put('/password', requireAuth, (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = db.prepare(`SELECT * FROM enterprise_users WHERE id = ?`).get(req.enterpriseUserId);
    if (!verifyPassword(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = hashPassword(new_password);
    db.prepare(`UPDATE enterprise_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(newHash, req.enterpriseUserId);

    // Invalidate all other sessions
    const authHeader = req.headers['authorization'] || '';
    const currentToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const currentHash = hashToken(currentToken);
    db.prepare(`DELETE FROM enterprise_sessions WHERE user_id = ? AND token_hash != ?`)
      .run(req.enterpriseUserId, currentHash);

    res.json({ success: true, message: 'Password updated. Other sessions invalidated.' });
  } catch (err) {
    console.error('[Auth] Password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, setDb, requireAuth, hashToken };
