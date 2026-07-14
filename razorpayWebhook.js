/**
 * ASG Payment Gateway — Razorpay Webhook Handler
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives webhook events directly from Razorpay.
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
  const signature = req.headers['x-razorpay-signature'];
  const payloadStr = req.rawBody || JSON.stringify(req.body);

  if (!eId || !signature) {
    return res.status(400).json({ error: 'Missing enterprise ID or signature' });
  }

  try {
    const enterprise = await db.get(`enterprise_users/${eId}`);
    if (!enterprise || !enterprise.razorpay_webhook_secret) {
      return res.status(404).json({ error: 'Enterprise not found or Razorpay webhook not configured' });
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', enterprise.razorpay_webhook_secret)
      .update(payloadStr)
      .digest('hex');

    if (expectedSignature !== signature) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const event = req.body.event;
    
    // We only care about successful payments
    if (event === 'payment.captured' || event === 'order.paid') {
      let amountInPaise;
      let orderId;
      let upiRef;

      if (event === 'payment.captured') {
        const entity = req.body.payload.payment.entity;
        amountInPaise = entity.amount;
        orderId = entity.notes?.order_id;
        // Sometimes UPI ref is in acquirer_data.bank_transaction_id or upi_transaction_id
        upiRef = entity.acquirer_data?.bank_transaction_id || entity.acquirer_data?.upi_transaction_id || entity.id;
      } else {
        const entity = req.body.payload.order.entity;
        amountInPaise = entity.amount_paid;
        orderId = entity.notes?.order_id || entity.receipt;
        upiRef = req.body.payload.payment?.entity?.acquirer_data?.bank_transaction_id || req.body.payload.payment?.entity?.id || entity.id;
      }

      // Convert paise to INR
      const amountInINR = amountInPaise / 100;

      let targetOrderId = orderId;

      // If Razorpay note doesn't have order_id, try to find a matching order by exact amount
      if (!targetOrderId) {
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
        source: 'razorpay_webhook',
        rawText: `Razorpay Event: ${event} | ID: ${req.body.payload.payment?.entity?.id || ''}`,
        enterpriseId: eId,
      });

      if (result.success) {
        return res.json({ success: true, message: 'Payment verified via Razorpay' });
      } else {
        return res.status(400).json({ success: false, error: result.message });
      }
    }

    res.json({ success: true, message: 'Event ignored' });

  } catch (err) {
    console.error('[RazorpayWebhook] Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router };
