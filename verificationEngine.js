/**
 * Verification Engine - Firebase RTDB
 */
require('dotenv').config();
const crypto = require('crypto');
const db = require('./database');
const { emitPaymentEvent, updateEnterpriseStats } = require('./firebase');

function setDb() {} // No longer needed

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

async function verifyPayment(signal) {
  const { orderId, upiRef, amount, source = 'unknown', rawText = '', enterpriseId } = signal;
  const eId = enterpriseId || 'global';
  const numericAmount = (amount === null || amount === undefined) ? null : Number(amount);

  const order = await db.get(`orders/${orderId}`);
  if (!order) return { success: false, code: 'ORDER_NOT_FOUND', message: 'Order not found.' };
  if (order.status === 'paid') return { success: false, code: 'ALREADY_PAID', message: 'Order already fulfilled.' };
  if (order.status === 'expired') return { success: false, code: 'ORDER_EXPIRED', message: 'Order has expired.' };

  if (new Date(order.expires_at) < new Date()) {
    await db.patch(`orders/${orderId}`, { status: 'expired' });
    return { success: false, code: 'ORDER_EXPIRED', message: 'Order expired.' };
  }

  if (!upiRef) return { success: false, code: 'UPI_REF_REQUIRED', message: 'No UPI reference found in SMS.' };
  if (numericAmount !== null && !Number.isFinite(numericAmount)) return { success: false, code: 'INVALID_AMOUNT' };
  
  if (numericAmount !== null && Math.abs(numericAmount - order.amount) > 0.009) {
    return { success: false, code: 'AMOUNT_MISMATCH', message: `Amount mismatch: expected ₹${order.amount}, got ₹${numericAmount}.` };
  }

  const used = await db.get(`used_refs/${upiRef}`);
  if (used) return { success: false, code: 'REPLAY_ATTACK', message: 'This UPI reference was already used.' };

  const txnId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.put(`transactions/${txnId}`, {
    id: txnId, enterprise_id: eId, order_id: orderId, upi_ref: upiRef,
    amount_verified: numericAmount ?? order.amount, signal_source: source,
    raw_signal: rawText.slice(0, 500), status: 'verified', verified_at: now, created_at: now
  });

  await db.put(`used_refs/${upiRef}`, { upi_ref: upiRef, order_id: orderId, used_at: now });
  await db.patch(`orders/${orderId}`, { status: 'paid' });
  await db.patch(`users/${order.user_id}`, { is_active: 1, plan: order.plan, activated_at: now });

  const user = await db.get(`users/${order.user_id}`);
  
  await db.put(`audit_log/${Date.now()}`, {
    id: Date.now(), enterprise_id: eId, event_type: 'PAYMENT_VERIFIED',
    order_id: orderId, user_id: order.user_id,
    payload: JSON.stringify({ txnId, upiRef, amount: numericAmount, source }), created_at: now
  });

  if (eId !== 'global') {
    try {
      const orders = await db.find('orders', o => o.enterprise_id === eId);
      const users = await db.find('users', u => u.enterprise_id === eId);
      let totalRev = 0, paid = 0, pending = 0, active = 0;
      
      orders.forEach(o => {
        if (o.status === 'paid') { paid++; totalRev += parseFloat(o.amount || 0); }
        if (o.status === 'pending') pending++;
      });
      users.forEach(u => { if (u.is_active) active++; });

      emitPaymentEvent({
        enterpriseId: eId, type: 'PAYMENT_VERIFIED', orderId, amount: numericAmount ?? order.amount,
        plan: order.plan, userEmail: user?.email, txnId, upiRef
      }).catch(()=>{});

      updateEnterpriseStats({
        enterpriseId: eId, totalRevenue: totalRev, paidOrders: paid, pendingOrders: pending, activeUsers: active
      }).catch(()=>{});
    } catch(e) {}
  }

  return { success: true, code: 'VERIFIED', message: 'Payment verified. Service activated!', userId: order.user_id, txnId };
}

async function expireStaleOrders() {
  const pendingOrders = await db.find('orders', o => o.status === 'pending' && new Date(o.expires_at) < new Date());
  for (const o of pendingOrders) {
    await db.patch(`orders/${o.id}`, { status: 'expired' });
  }
  if (pendingOrders.length > 0) console.log(`[Cron] ⌛ Expired ${pendingOrders.length} order(s)`);
}

async function pollPendingOrders() {
  return await db.find('orders', o => o.status === 'pending');
}

module.exports = { setDb, verifyPayment, parseSmsAlert, expireStaleOrders, pollPendingOrders };
