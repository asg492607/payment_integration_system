/**
 * Admin API Router — Enterprise Scoped
 * Supports: enterprise session token (Bearer) or legacy x-admin-token header
 */
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

let db;
function setDb(database) { db = database; }

// ── Auth middleware ───────────────────────────────────────────────────────────
router.use((req, res, next) => {
  // 1. Global admin token
  const adminToken = req.headers['x-admin-token'];
  if (adminToken && adminToken === (process.env.ADMIN_TOKEN || 'dev_admin_token')) {
    req.isGlobalAdmin  = true;
    req.enterpriseFilter = null; // sees all data
    return next();
  }

  // 2. Enterprise session Bearer token
  const authHeader = req.headers['authorization'] || '';
  const sessionToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (sessionToken) {
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const session = db.prepare(`
      SELECT s.user_id, eu.is_active
      FROM enterprise_sessions s
      JOIN enterprise_users eu ON s.user_id = eu.id
      WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')
    `).get(tokenHash);

    if (session?.is_active) {
      req.isGlobalAdmin    = false;
      req.enterpriseFilter = session.user_id;
      return next();
    }
  }

  return res.status(401).json({ error: 'Unauthorized' });
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const eId = req.enterpriseFilter;
  const eWhere = eId ? eId : null;

  const q = (sql, global_sql) => eWhere
    ? db.prepare(sql).get(eWhere)
    : db.prepare(global_sql || sql.replace('WHERE enterprise_id = ?', '')).get();

  const totalOrders   = (eWhere ? db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id=?`).get(eWhere) : db.prepare(`SELECT COUNT(*) as c FROM orders`).get()).c;
  const paidOrders    = (eWhere ? db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id=? AND status='paid'`).get(eWhere) : db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status='paid'`).get()).c;
  const pendingOrders = (eWhere ? db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id=? AND status='pending'`).get(eWhere) : db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status='pending'`).get()).c;
  const expiredOrders = (eWhere ? db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id=? AND status='expired'`).get(eWhere) : db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status='expired'`).get()).c;
  const activeUsers   = (eWhere ? db.prepare(`SELECT COUNT(*) as c FROM users WHERE enterprise_id=? AND is_active=1`).get(eWhere) : db.prepare(`SELECT COUNT(*) as c FROM users WHERE is_active=1`).get()).c;
  const totalRevenue  = (eWhere ? db.prepare(`SELECT SUM(amount) as s FROM orders WHERE enterprise_id=? AND status='paid'`).get(eWhere) : db.prepare(`SELECT SUM(amount) as s FROM orders WHERE status='paid'`).get()).s || 0;

  // Revenue last 7 days
  const revenueByDay = eWhere
    ? db.prepare(`SELECT date(created_at) as day, SUM(amount) as total FROM orders WHERE enterprise_id=? AND status='paid' AND created_at>=datetime('now','-7 days') GROUP BY day ORDER BY day ASC`).all(eWhere)
    : db.prepare(`SELECT date(created_at) as day, SUM(amount) as total FROM orders WHERE status='paid' AND created_at>=datetime('now','-7 days') GROUP BY day ORDER BY day ASC`).all();

  res.json({ totalOrders, paidOrders, pendingOrders, expiredOrders, activeUsers, totalRevenue, revenueByDay });
});

// ── GET /api/admin/transactions ───────────────────────────────────────────────
router.get('/transactions', (req, res) => {
  const eId   = req.enterpriseFilter;
  const limit = Math.min(parseInt(req.query.limit || '100'), 500);

  const txns = eId
    ? db.prepare(`SELECT t.*,o.amount as order_amount,o.plan,u.email,u.name FROM transactions t JOIN orders o ON t.order_id=o.id JOIN users u ON o.user_id=u.id WHERE t.enterprise_id=? ORDER BY t.created_at DESC LIMIT ?`).all(eId, limit)
    : db.prepare(`SELECT t.*,o.amount as order_amount,o.plan,u.email,u.name FROM transactions t JOIN orders o ON t.order_id=o.id JOIN users u ON o.user_id=u.id ORDER BY t.created_at DESC LIMIT ?`).all(limit);

  res.json(txns);
});

// ── GET /api/admin/audit ──────────────────────────────────────────────────────
router.get('/audit', (req, res) => {
  const eId   = req.enterpriseFilter;
  const limit = Math.min(parseInt(req.query.limit || '200'), 1000);

  const logs = eId
    ? db.prepare(`SELECT * FROM audit_log WHERE enterprise_id=? ORDER BY created_at DESC LIMIT ?`).all(eId, limit)
    : db.prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`).all(limit);

  res.json(logs);
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const eId = req.enterpriseFilter;
  const users = eId
    ? db.prepare(`SELECT id,email,name,is_active,plan,activated_at,created_at FROM users WHERE enterprise_id=? ORDER BY created_at DESC`).all(eId)
    : db.prepare(`SELECT id,email,name,is_active,plan,activated_at,created_at FROM users ORDER BY created_at DESC`).all();
  res.json(users);
});

// ── GET /api/admin/orders ─────────────────────────────────────────────────────
router.get('/orders', (req, res) => {
  const eId    = req.enterpriseFilter;
  const status = req.query.status;
  const limit  = Math.min(parseInt(req.query.limit || '100'), 500);
  const params = [];
  let where    = '';

  if (eId)    { where += (where ? ' AND ' : 'WHERE ') + `o.enterprise_id=?`; params.push(eId); }
  if (status) { where += (where ? ' AND ' : 'WHERE ') + `o.status=?`;        params.push(status); }
  params.push(limit);

  const orders = db.prepare(`
    SELECT o.*, u.email, u.name
    FROM orders o JOIN users u ON o.user_id=u.id
    ${where}
    ORDER BY o.created_at DESC LIMIT ?
  `).all(...params);

  res.json(orders);
});

module.exports = { router, setDb };
