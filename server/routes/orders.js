/**
 * Orders API Router — Enterprise Multi-tenant
 * POST /api/orders/create   — Create a UPI order
 * GET  /api/orders/:id      — Poll order status
 * POST /api/orders/sms      — SMS webhook for auto-verification
 */
require('dotenv').config();
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();

const { PLANS, generateOrderId, buildUpiLinkForEnterprise, signOrderId } = require('../engine/upiEngine');
const { verifyPayment, parseSmsAlert } = require('../engine/verificationEngine');
const { v4: uuidv4 } = require('uuid');
const smsQueue = require('../lib/smsQueue');

let db;
function setDb(database) { db = database; }

function normalizePhone(v) { return String(v || '').replace(/\D/g, '').slice(-10); }
function formatAmount(a)   { return Number(a).toFixed(2); }

/** Reserve a paise-unique amount for today within this enterprise */
function reserveAmount(baseAmount, eId) {
  for (let paise = 1; paise <= 99; paise++) {
    const amount = Number((baseAmount + paise / 100).toFixed(2));
    const existing = db.prepare(`
      SELECT id FROM orders
      WHERE enterprise_id = ? AND amount = ? AND status = 'pending'
        AND date(created_at) = date('now')
      LIMIT 1
    `).get(eId, amount);
    if (!existing) return amount;
  }
  return null; // all 99 paise slots taken today
}

// ── POST /api/orders/create ──────────────────────────────────────────────────
router.post('/create', async (req, res) => {
  try {
    const { email, name, phone, plan = 'pro', enterprise_id } = req.body;

    if (!email || !name) return res.status(400).json({ error: 'email and name are required' });
    if (!PLANS[plan])    return res.status(400).json({ error: `Invalid plan. Choose: ${Object.keys(PLANS).join(', ')}` });

    // Use 'global' as sentinel for no-enterprise (public demo mode)
    const eId = enterprise_id || 'global';
    const planMeta = PLANS[plan];

    // Resolve enterprise UPI config
    let upiVpa, upiPayeeName, hmacSecret;
    if (eId !== 'global') {
      const ent = db.prepare(`SELECT upi_vpa, upi_payee_name, hmac_secret, setup_complete FROM enterprise_users WHERE id = ? AND is_active = 1`).get(eId);
      if (!ent) return res.status(404).json({ error: 'Enterprise account not found' });
      if (!ent.setup_complete || !ent.upi_vpa) {
        return res.status(422).json({ error: 'UPI not configured yet. Complete setup in dashboard first.' });
      }
      upiVpa      = ent.upi_vpa;
      upiPayeeName= ent.upi_payee_name;
      hmacSecret  = ent.hmac_secret;
    } else {
      upiVpa       = process.env.UPI_VPA || 'demo@upi';
      upiPayeeName = process.env.UPI_PAYEE_NAME || 'PayForge Demo';
      hmacSecret   = process.env.HMAC_SECRET || 'dev_secret';
    }

    // Upsert customer user (email + enterprise_id is unique)
    const userId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, enterprise_id, email, name, phone)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email, enterprise_id) DO UPDATE SET name = excluded.name, phone = excluded.phone
    `).run(userId, eId, email, name, phone || null);

    const user = db.prepare(`SELECT * FROM users WHERE email = ? AND enterprise_id = ?`).get(email, eId);

    // Reserve paise-unique amount
    const payableAmount = reserveAmount(planMeta.amount, eId);
    if (!payableAmount) {
      return res.status(409).json({ error: 'Daily payment slots full for this plan. Try again tomorrow.' });
    }

    const orderId      = generateOrderId();
    const expiryMins   = parseInt(process.env.ORDER_EXPIRY_MINUTES || '15');
    const expiresAt    = new Date(Date.now() + expiryMins * 60 * 1000).toISOString();
    const signature    = signOrderId(orderId, hmacSecret);
    const paymentNote  = `${planMeta.label} - ${orderId}`;
    const upiLink      = buildUpiLinkForEnterprise({ orderId, amount: formatAmount(payableAmount), note: paymentNote, vpa: upiVpa, payeeName: upiPayeeName });

    db.prepare(`
      INSERT INTO orders (id, enterprise_id, user_id, amount, plan, upi_link, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(orderId, eId, user.id, payableAmount, plan, upiLink, expiresAt);

    db.prepare(`
      INSERT INTO audit_log (enterprise_id, event_type, order_id, user_id, payload, ip_address)
      VALUES (?, 'ORDER_CREATED', ?, ?, ?, ?)
    `).run(eId, orderId, user.id, JSON.stringify({ plan, baseAmount: planMeta.amount, payableAmount }), req.ip);

    res.json({
      success: true,
      orderId,
      signature,
      amount: payableAmount,
      baseAmount: planMeta.amount,
      plan: planMeta.label,
      upiLink,
      paymentNote,
      upiVpa,
      expiresAt,
      expiresInMinutes: expiryMins,
    });
  } catch (err) {
    console.error('[Orders] Create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/orders/:id ──────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const order = db.prepare(`SELECT id, amount, plan, status, expires_at, created_at FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const txn  = db.prepare(`SELECT * FROM transactions WHERE order_id = ? AND status = 'verified'`).get(req.params.id);
  const user = order.status === 'paid'
    ? db.prepare(`SELECT id, email, name, is_active, plan, activated_at FROM users WHERE id = (SELECT user_id FROM orders WHERE id = ?)`).get(req.params.id)
    : null;

  res.json({ order, transaction: txn || null, user });
});

// ── POST /api/orders/sms ─────────────────────────────────────────────────────
router.post('/sms', (req, res) => {
  const { orderId, rawText, sender, secret, enterprise_id } = req.body;
  const eId = enterprise_id || 'global';

  // Resolve enterprise config
  let expectedSecret, trustedSender;
  if (eId !== 'global') {
    const ent = db.prepare(`SELECT sms_webhook_secret, trusted_sms_sender FROM enterprise_users WHERE id = ?`).get(eId);
    if (!ent) return res.status(404).json({ error: 'Enterprise not found' });
    expectedSecret = ent.sms_webhook_secret;
    trustedSender  = normalizePhone(ent.trusted_sms_sender);
  } else {
    expectedSecret = process.env.SMS_WEBHOOK_SECRET || '';
    trustedSender  = normalizePhone(process.env.TRUSTED_SMS_SENDER || '');
  }

  // Auth: webhook secret OR admin token
  const suppliedSecret     = secret || req.headers['x-sms-webhook-secret'];
  const suppliedAdminToken = req.headers['x-admin-token'];
  const adminToken         = process.env.ADMIN_TOKEN || 'dev_admin_token';

  if (suppliedSecret !== expectedSecret && suppliedAdminToken !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized: invalid webhook secret' });
  }

  // Validate sender
  const cleanSender = normalizePhone(sender || req.headers['x-sms-sender']);
  if (!trustedSender) return res.status(500).json({ error: 'Trusted SMS sender not configured' });
  if (cleanSender !== trustedSender) {
    return res.status(403).json({ error: 'Unauthorized SMS sender', hint: `Expected sender ending in ...${trustedSender.slice(-4)}` });
  }

  if (!rawText) return res.status(400).json({ error: 'rawText is required' });

  // Add to background retry queue (Render safe)
  smsQueue.enqueue(uuidv4(), eId, `[SENDER:${sender || 'unknown'}] ${rawText}`, sender);

  // Must be a credit alert
  if (!/credited|received|added|deposited/i.test(rawText)) {
    return res.status(422).json({ error: 'Not a bank credit alert' });
  }

  const parsed = parseSmsAlert(rawText);
  const { amount, ref } = parsed;
  const targetOrderId   = orderId || parsed.orderId;

  if (!amount) return res.status(422).json({ error: 'Could not parse amount from SMS', parsed });
  if (!ref)    return res.status(422).json({ error: 'Could not parse UPI reference from SMS', parsed });

  // Match pending order
  let matchingOrder;
  if (targetOrderId) {
    matchingOrder = db.prepare(`
      SELECT id FROM orders
      WHERE id = ? AND enterprise_id = ? AND status = 'pending' AND amount = ?
    `).get(targetOrderId, eId, amount);
  } else {
    const candidates = db.prepare(`
      SELECT id FROM orders
      WHERE enterprise_id = ? AND status = 'pending' AND amount = ?
      ORDER BY created_at DESC LIMIT 2
    `).all(eId, amount);

    if (candidates.length > 1) {
      return res.status(409).json({ error: `Multiple pending orders for ₹${amount}. Provide Order ID.`, parsed });
    }
    matchingOrder = candidates[0];
  }

  if (!matchingOrder) {
    return res.status(404).json({ error: `No pending order found for ₹${amount}`, parsed });
  }

  const result = verifyPayment({
    orderId: matchingOrder.id,
    upiRef: ref,
    amount,
    source: 'sms_verified',
    rawText: `[SENDER:${sender || 'unknown'}] ${rawText}`,
    enterpriseId: eId,
  });

  res.status(result.success ? 200 : 400).json({ ...result, parsed, matchedOrderId: matchingOrder.id });
});

module.exports = { router, setDb };
