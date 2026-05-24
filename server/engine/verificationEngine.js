/**
 * Verification Engine — Enterprise Multi-Tenant + Firebase Real-time
 *
 * Signal pipeline:
 *  1. Trusted SMS parser — regex extracts amount + UTR from bank alerts
 *  2. Verify: amount match, expiry, replay attack check
 *  3. Promote order: pending → paid, activate user
 *  4. Emit Firebase real-time event for instant dashboard updates
 */
require('dotenv').config();
const crypto = require('crypto');

let db;
function setDb(database) { db = database; }

let firebase;
function getFirebase() {
  if (!firebase) {
    try { firebase = require('../lib/firebase'); } catch (e) { /* no-op */ }
  }
  return firebase;
}

// ── SMS / Bank Alert Regex ────────────────────────────────────────────────────
const SMS_PATTERNS = [
  /(?:credited|received|paid|added).*?(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)/i,
  /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*).*?(?:credited|received|paid|added)/i,
  /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)/i,
];
const REF_PATTERNS = [
  /(?:upi\s*)?(?:ref(?:erence)?|txn|transaction|utr|id)(?:\s*no\.?)?[\s#:;]*([A-Z0-9]{10,20})/i,
  /\b(\d{12})\b/,
  /UPI\/(\w+)/i,
];
const ORDER_PATTERNS = [/\b(ORD-[A-Z0-9]+-[A-Z0-9]+)\b/i];

function parseSmsAlert(text) {
  let amount = null, ref = null, orderId = null;

  for (const p of SMS_PATTERNS) {
    const m = text.match(p);
    if (m) { amount = parseFloat(m[1].replace(/,/g, '')); break; }
  }
  for (const p of ORDER_PATTERNS) {
    const m = text.match(p);
    if (m) { orderId = m[1].toUpperCase(); break; }
  }
  for (const p of REF_PATTERNS) {
    const m = text.match(p);
    if (m) { ref = m[1].toUpperCase(); break; }
  }

  return { amount, ref, orderId };
}

/**
 * Core: verify a payment signal against a pending order.
 * @param {{ orderId, upiRef, amount, source, rawText, enterpriseId }} signal
 * @returns {{ success, code, message, userId?, txnId? }}
 */
function verifyPayment(signal) {
  const { orderId, upiRef, amount, source = 'unknown', rawText = '', enterpriseId } = signal;
  // Always use 'global' sentinel, never null
  const eId = enterpriseId || 'global';
  const numericAmount = (amount === null || amount === undefined) ? null : Number(amount);

  // 1. Find order
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  if (!order)                    return { success: false, code: 'ORDER_NOT_FOUND',  message: 'Order not found.' };
  if (order.status === 'paid')   return { success: false, code: 'ALREADY_PAID',     message: 'Order already fulfilled.' };
  if (order.status === 'expired') return { success: false, code: 'ORDER_EXPIRED',   message: 'Order has expired.' };

  // 2. Expiry check
  if (new Date(order.expires_at) < new Date()) {
    db.prepare(`UPDATE orders SET status='expired' WHERE id=?`).run(orderId);
    return { success: false, code: 'ORDER_EXPIRED', message: 'Order expired. Create a new one.' };
  }

  if (!upiRef) return { success: false, code: 'UPI_REF_REQUIRED', message: 'No UPI reference found in SMS.' };
  if (numericAmount !== null && !Number.isFinite(numericAmount)) {
    return { success: false, code: 'INVALID_AMOUNT', message: 'Invalid amount.' };
  }

  // 3. Amount match (strict — paise-level uniqueness)
  if (numericAmount !== null && Math.abs(numericAmount - order.amount) > 0.009) {
    return { success: false, code: 'AMOUNT_MISMATCH', message: `Amount mismatch: expected ₹${order.amount}, got ₹${numericAmount}.` };
  }

  // 4. Replay attack prevention
  const used = db.prepare(`SELECT upi_ref FROM used_refs WHERE upi_ref=?`).get(upiRef);
  if (used) return { success: false, code: 'REPLAY_ATTACK', message: 'This UPI reference was already used.' };

  // 5. Log transaction
  const txnId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO transactions (id, enterprise_id, order_id, upi_ref, amount_verified, signal_source, raw_signal, status, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', datetime('now'))
  `).run(txnId, eId, orderId, upiRef, numericAmount ?? order.amount, source, rawText.slice(0, 500));

  // 6. Mark ref as used
  db.prepare(`INSERT OR IGNORE INTO used_refs (upi_ref, order_id) VALUES (?,?)`).run(upiRef, orderId);

  // 7. Promote order to paid
  db.prepare(`UPDATE orders SET status='paid' WHERE id=?`).run(orderId);

  // 8. Activate user service
  db.prepare(`UPDATE users SET is_active=1, plan=?, activated_at=datetime('now') WHERE id=?`).run(order.plan, order.user_id);

  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(order.user_id);

  // 9. Audit log
  db.prepare(`
    INSERT INTO audit_log (enterprise_id, event_type, order_id, user_id, payload)
    VALUES (?, 'PAYMENT_VERIFIED', ?, ?, ?)
  `).run(eId, orderId, order.user_id, JSON.stringify({ txnId, upiRef, amount: numericAmount, source }));

  // 10. Firebase real-time event (non-blocking, best-effort)
  const fb = getFirebase();
  if (fb && eId !== 'global') {
    Promise.all([
      fb.emitPaymentEvent({
        enterpriseId: eId,
        type: 'PAYMENT_VERIFIED',
        orderId,
        amount: numericAmount ?? order.amount,
        plan: order.plan,
        userEmail: user?.email,
        txnId,
        upiRef,
      }),
      fb.updateEnterpriseStats({
        enterpriseId: eId,
        totalRevenue:  db.prepare(`SELECT SUM(amount) as s FROM orders WHERE enterprise_id=? AND status='paid'`).get(eId)?.s || 0,
        paidOrders:    db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id=? AND status='paid'`).get(eId)?.c || 0,
        pendingOrders: db.prepare(`SELECT COUNT(*) as c FROM orders WHERE enterprise_id=? AND status='pending'`).get(eId)?.c || 0,
        activeUsers:   db.prepare(`SELECT COUNT(*) as c FROM users WHERE enterprise_id=? AND is_active=1`).get(eId)?.c || 0,
      }),
    ]).catch(err => console.warn('[Firebase] emit error (non-fatal):', err.message));
  }

  return { success: true, code: 'VERIFIED', message: 'Payment verified. Service activated!', userId: order.user_id, txnId };
}

/** Expire stale pending orders — called every minute by cron */
function expireStaleOrders() {
  const result = db.prepare(`
    UPDATE orders SET status='expired'
    WHERE status='pending' AND datetime(expires_at) < datetime('now')
  `).run();
  if (result.changes > 0) console.log(`[Cron] ⌛ Expired ${result.changes} order(s)`);
}

function pollPendingOrders() {
  return db.prepare(`SELECT * FROM orders WHERE status='pending'`).all();
}

module.exports = { setDb, verifyPayment, parseSmsAlert, expireStaleOrders, pollPendingOrders };
