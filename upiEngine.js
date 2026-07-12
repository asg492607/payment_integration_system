/**
 * UPI Engine — Order ID + UPI Link generation
 * Supports per-enterprise UPI VPA and payee names
 */
require('dotenv').config();
const crypto = require('crypto');


/**
 * Generate a short, readable, URL-safe Order ID.
 * Format: ORD-{6 char time}-{4 char random}
 * Example: ORD-M3K2A1-AB12
 */
function generateOrderId() {
  const ts = Date.now().toString(36).toUpperCase().slice(-6).padStart(6, '0');
  const rnd = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ORD-${ts}-${rnd}`;
}

/**
 * Build a UPI deep link that opens any UPI app on Android/iOS.
 * @param {{ orderId, amount, note, vpa, payeeName }} params
 */
function buildUpiLinkForEnterprise({ orderId, amount, note, vpa, payeeName }) {
  const pa = encodeURIComponent(vpa     || process.env.UPI_VPA      || 'demo@upi');
  const pn = encodeURIComponent(payeeName || process.env.UPI_PAYEE_NAME || 'ASG Payment Gateway');
  const am = encodeURIComponent(String(amount));
  const tn = encodeURIComponent(note || `ASG Payment Gateway - ${orderId}`);
  const mc = '0000';
  const cu = 'INR';
  const tr = encodeURIComponent(orderId);

  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&tn=${tn}&mc=${mc}&cu=${cu}&tr=${tr}`;
}

/**
 * HMAC-sign an order ID so it can be verified by the webhook caller.
 */
function signOrderId(orderId, secret) {
  const key = secret || process.env.HMAC_SECRET || 'insecure_dev_secret';
  return crypto.createHmac('sha256', key).update(orderId).digest('hex').slice(0, 32);
}

/**
 * Verify a signed order ID from the webhook caller.
 */
function verifyOrderSignature(orderId, signature, secret) {
  const expected = signOrderId(orderId, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.slice(0, 32)));
  } catch {
    return false;
  }
}

module.exports = {
  generateOrderId,
  buildUpiLinkForEnterprise,
  signOrderId,
  verifyOrderSignature,
};

