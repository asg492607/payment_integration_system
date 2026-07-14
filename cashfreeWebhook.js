/**
 * ASG Payment Gateway — Cashfree Webhook Handler
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives webhook events directly from Cashfree.
 * Highly recommended for large merchants for instant, guaranteed verification
 * bypassing the need for SMS/Email scraping.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('./database');
const verificationEngine = require('./verificationEngine');

// Receive webhook payload
router.post('/:enterpriseId', async (req, res) => {
  const eId = req.params.enterpriseId;
  const signature = req.headers['x-webhook-signature'];
  const payloadStr = req.rawBody || JSON.stringify(req.body);

  if (!eId || !signature) {
    return res.status(400).json({ error: 'Missing enterprise ID or signature' });
  }

  try {
    const enterprise = await db.get(`enterprise_users/${eId}`);
    if (!enterprise || !enterprise.cashfree_webhook_secret) {
      return res.status(404).json({ error: 'Enterprise not found or Cashfree webhook not configured' });
    }

    // Verify signature
    // Cashfree signature verification typically uses raw body and base64 digest.
    // Ensure the body parser uses raw body if there are issues, but for now we'll use stringify.
    const expectedSignature = crypto
      .createHmac('sha256', enterprise.cashfree_webhook_secret)
      .update(req.body.rawBody || payloadStr) // Use rawBody if available, else stringify
      .digest('base64');

    if (expectedSignature !== signature) {
      // Allow passing if signature check is temporarily disabled, but log warning
      console.warn('[CashfreeWebhook] Invalid webhook signature detected for', eId);
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const eventType = req.body.type;
    
    // We only care about successful payments
    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK') {
      const data = req.body.data;
      if (!data || !data.payment || !data.order) {
        return res.status(400).json({ error: 'Malformed payload' });
      }

      const amountInINR = data.payment.payment_amount;
      const orderId = data.order.order_id;
      const upiRef = data.payment.bank_reference || data.payment.cf_payment_id || 'CASHFREE_' + Date.now();

      let targetOrderId = orderId;

      // If Cashfree order_id doesn't match our format, try to find a matching order by exact amount
      if (!targetOrderId || !targetOrderId.startsWith('ORD-')) {
        const ordersData = await db.query('orders', 'enterprise_id', eId);
        const matching = ordersData.filter(o =>
          o.status === 'pending' &&
          Math.abs(parseFloat(o.amount) - amountInINR) < 0.009 &&
          new Date(o.expires_at) > new Date()
        ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (matching.length > 0) {
          targetOrderId = matching[0].id;
        } else {
          return res.status(404).json({ error: 'No matching pending order found' });
        }
      }

      // Proceed to verify
      const result = await verificationEngine.verifyPayment({
        orderId: targetOrderId,
        upiRef: upiRef,
        amount: amountInINR,
        source: 'cashfree_webhook',
        rawText: `Cashfree Event: ${eventType} | CF_ID: ${data.payment.cf_payment_id || ''}`,
        enterpriseId: eId,
      });

      if (result.success) {
        return res.json({ success: true, message: 'Payment verified via Cashfree' });
      } else {
        return res.status(400).json({ success: false, error: result.message });
      }
    }

    res.json({ success: true, message: 'Event ignored' });

  } catch (err) {
    console.error('[CashfreeWebhook] Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router };
