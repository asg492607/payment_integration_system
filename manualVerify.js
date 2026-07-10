/**
 * PayForge — Manual UTR Verification API
 * ─────────────────────────────────────────────────────────────────────────────
 * Merchants can manually verify a payment directly from the dashboard
 * by entering the UTR (UPI Reference Number) they see in their bank app.
 *
 * This is the ULTIMATE fallback — works even when:
 *   - Android phone is dead
 *   - Email fallback not configured
 *   - Telegram bot not set up
 *
 * The merchant simply:
 *   1. Opens their bank app or net banking
 *   2. Sees the credit: "₹499.01 from Customer — UPI Ref: 412345678901"
 *   3. Opens PayForge Dashboard → Orders → Click "Verify by UTR"
 *   4. Types 412345678901 → clicks Verify
 *   5. Payment is instantly verified
 *
 * API Endpoints:
 *   POST /api/admin/verify-utr        — Verify by UTR + order ID
 *   POST /api/admin/verify-amount     — Verify by amount (find matching order)
 *   POST /api/admin/mark-paid/:id     — Force mark an order as paid (last resort)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('./database');
const { requireAuth } = require('./auth');
const verificationEngine = require('./verificationEngine');

router.use(requireAuth);

// ── POST /api/admin/verify-utr ────────────────────────────────────────────────
// Merchant provides: orderId + UTR number
// Server verifies the UTR hasn't been used and marks order paid
router.post('/verify-utr', async (req, res) => {
  try {
    const { order_id, utr } = req.body;
    const eId = req.enterpriseUserId;

    if (!order_id || !utr) {
      return res.status(400).json({ error: 'order_id and utr are required' });
    }

    const cleanUtr = String(utr).trim().toUpperCase().slice(0, 30);

    // Verify the order belongs to THIS merchant
    const order = await db.get(`orders/${order_id}`);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.enterprise_id !== eId) return res.status(403).json({ error: 'Order does not belong to your account' });

    const result = await verificationEngine.verifyPayment({
      orderId: order_id,
      upiRef: cleanUtr,
      amount: null, // Merchant confirmed — skip amount re-check
      source: 'manual_utr_dashboard',
      rawText: `Manual UTR entry by merchant: ${cleanUtr}`,
      enterpriseId: eId,
    });

    if (result.success) {
      res.json({ success: true, message: 'Payment verified successfully!', txnId: result.txnId });
    } else {
      res.status(400).json({ success: false, error: result.message, code: result.code });
    }
  } catch (err) {
    console.error('[ManualVerify] verify-utr error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/admin/verify-amount ─────────────────────────────────────────────
// Merchant provides: amount + UTR (they see ₹499.01 in bank app but don't know order ID)
// Server finds the matching pending order and verifies it
router.post('/verify-amount', async (req, res) => {
  try {
    const { amount, utr } = req.body;
    const eId = req.enterpriseUserId;

    if (!amount || !utr) {
      return res.status(400).json({ error: 'amount and utr are required' });
    }

    const numAmount = parseFloat(amount);
    if (!isFinite(numAmount)) return res.status(400).json({ error: 'Invalid amount' });

    const cleanUtr = String(utr).trim().toUpperCase().slice(0, 30);

    // Find matching pending order
    const orders = await db.query('orders', 'enterprise_id', eId);
    const matching = orders.filter(o =>
      o.status === 'pending' &&
      Math.abs(parseFloat(o.amount) - numAmount) < 0.009
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!matching.length) {
      return res.status(404).json({ error: `No pending order found for ₹${numAmount}` });
    }

    const result = await verificationEngine.verifyPayment({
      orderId: matching[0].id,
      upiRef: cleanUtr,
      amount: numAmount,
      source: 'manual_amount_dashboard',
      rawText: `Manual verification: ₹${numAmount} UTR ${cleanUtr}`,
      enterpriseId: eId,
    });

    if (result.success) {
      res.json({ success: true, message: `Order ${matching[0].id} verified!`, orderId: matching[0].id, txnId: result.txnId });
    } else {
      res.status(400).json({ success: false, error: result.message, code: result.code });
    }
  } catch (err) {
    console.error('[ManualVerify] verify-amount error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/admin/mark-paid/:id ─────────────────────────────────────────────
// LAST RESORT: Merchant force-marks an order as paid.
// Creates a transaction record with source = 'admin_force_paid'.
// Use only when you have confirmed the payment in your bank app/statement.
router.post('/mark-paid/:id', async (req, res) => {
  try {
    const orderId = req.params.id;
    const eId = req.enterpriseUserId;
    const { reason, utr } = req.body;

    const order = await db.get(`orders/${orderId}`);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.enterprise_id !== eId) return res.status(403).json({ error: 'Unauthorized' });
    if (order.status === 'paid') return res.status(400).json({ error: 'Order already paid' });

    const now = new Date().toISOString();
    const txnId = crypto.randomUUID();
    const fakeRef = utr || `ADMIN-FORCE-${Date.now()}`;

    await db.put(`transactions/${txnId}`, {
      id: txnId, enterprise_id: eId, order_id: orderId,
      upi_ref: fakeRef,
      amount_verified: order.amount,
      signal_source: 'admin_force_paid',
      raw_signal: reason || 'Force marked as paid by merchant admin',
      status: 'verified', verified_at: now, created_at: now
    });

    await db.patch(`orders/${orderId}`, { status: 'paid' });
    await db.patch(`users/${order.user_id}`, { is_active: 1, plan: order.plan, activated_at: now });

    // Release amount lock
    const amtKey = order.amount.toString().replace('.', '_');
    await db.remove(`active_amounts/${eId}_${amtKey}`).catch(() => {});

    await db.put(`audit_log/${Date.now()}`, {
      id: Date.now(), enterprise_id: eId, event_type: 'ADMIN_FORCE_PAID',
      order_id: orderId, user_id: order.user_id,
      payload: JSON.stringify({ reason, utr: fakeRef }),
      created_at: now
    });

    res.json({ success: true, message: 'Order marked as paid.', txnId, orderId });
  } catch (err) {
    console.error('[ManualVerify] mark-paid error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router };
