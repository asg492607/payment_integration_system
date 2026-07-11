/**
 * Firebase Realtime Database Integration
 * Pushes payment events to Firebase so the enterprise dashboard
 * gets real-time updates without polling.
 *
 * Uses the Firebase REST API — no extra SDK needed on the server.
 * All events are scoped per enterprise user.
 */
require('dotenv').config();

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://payment-2e43c-default-rtdb.firebaseio.com';
const FIREBASE_SECRET  = process.env.FIREBASE_DB_SECRET || ''; // optional server-side auth

/**
 * Write or push a value to a Firebase Realtime Database path via REST.
 * @param {string} path  - e.g. "events/enterprise_abc123"
 * @param {object} data  - JSON payload
 * @param {string} method - 'PUT' | 'POST' (POST = push auto-ID)
 */
async function firebasePut(path, data, method = 'POST') {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json${FIREBASE_SECRET ? `?auth=${FIREBASE_SECRET}` : ''}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, _ts: Date.now() }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('[Firebase] Write failed:', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.warn('[Firebase] REST error (non-fatal):', err.message);
    return false;
  }
}

/**
 * Emit a payment event to Firebase.
 * Dashboard clients listening at events/{enterpriseId} will receive it instantly.
 */
async function emitPaymentEvent({ enterpriseId, type, orderId, amount, plan, userEmail, txnId, upiRef }) {
  const path = `events/${enterpriseId || 'global'}`;
  return firebasePut(path, { type, orderId, amount, plan, userEmail, txnId, upiRef });
}

/**
 * Emit a raw SMS received event (before verification).
 */
async function emitSmsEvent({ enterpriseId, rawText, sender, parsed }) {
  const path = `sms_events/${enterpriseId || 'global'}`;
  return firebasePut(path, {
    type: 'SMS_RECEIVED',
    sender,
    rawText: rawText?.slice(0, 300),
    parsed,
  });
}

/**
 * Update enterprise stats in Firebase (for live stat cards).
 */
async function updateEnterpriseStats({ enterpriseId, totalRevenue, paidOrders, pendingOrders, activeUsers }) {
  const path = `stats/${enterpriseId}`;
  return firebasePut(path, { totalRevenue, paidOrders, pendingOrders, activeUsers }, 'PUT');
}

/**
 * Push POS State to Firebase
 */
async function pushPosState(enterpriseId, stateData) {
  const path = `pos_state/${enterpriseId}`;
  return firebasePut(path, stateData, 'PUT');
}

module.exports = { emitPaymentEvent, emitSmsEvent, updateEnterpriseStats, firebasePut, pushPosState };
