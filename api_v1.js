/**
 * Developer API v1
 * Programmatic access for merchants using api_key
 */
const express = require('express');
const router = express.Router();
const db = require('./database');
const upiEngine = require('./upiEngine');
const { reserveAmount } = require('./orders');

// API Key Middleware
async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'x-api-key header is missing' });
  
  const user = (await db.query('enterprise_users', 'api_key', apiKey))[0] || null;
  if (!user) return res.status(401).json({ error: 'Invalid API Key' });
  if (!user.is_active) return res.status(403).json({ error: 'Account suspended' });
  
  req.enterpriseUser = user;
  next();
}

// ── POST /api/v1/payments/create ──────────────────────────────────────────────
router.post('/payments/create', requireApiKey, async (req, res) => {
  try {
    const enterprise = req.enterpriseUser;
    const { amount, currency, reference_id, customer_email, customer_name, return_url } = req.body;
    
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    
    const payableAmount = await reserveAmount(parseFloat(amount), enterprise.id);
    const orderId = upiEngine.generateOrderId();
    const expiryMins = 15;
    const expiresAt = new Date(Date.now() + expiryMins * 60000).toISOString();
    
    // Use the custom branding checkout link
    const checkoutLink = `${req.protocol}://${req.get('host')}/pay/${enterprise.id}?order_id=${orderId}&amount=${payableAmount}`;
    
    // Also build direct UPI intent string if developers want to render their own QR
    const upiLink = upiEngine.buildUpiLinkForEnterprise({
      orderId,
      amount: payableAmount,
      note: `${enterprise.company || 'ASG Payment Gateway'} - ${orderId}`,
      vpa: enterprise.upi_vpa,
      payeeName: enterprise.upi_payee_name
    });
    
    // We create an anonymous user object for tracking, similar to smart links
    const { v4: uuidv4 } = require('uuid');
    const tempUserId = uuidv4();
    await db.put(`users/${tempUserId}`, {
      id: tempUserId, enterprise_id: enterprise.id, email: customer_email || 'api@customer',
      name: customer_name || 'API Customer', created_at: new Date().toISOString()
    });

    const order = {
      id: orderId,
      enterprise_id: enterprise.id,
      user_id: tempUserId,
      amount: payableAmount,
      currency: currency || 'INR',
      plan: 'api_payment',
      reference_id: reference_id || null, // Merchant's internal ID
      return_url: return_url || null,
      upi_link: upiLink,
      status: 'pending',
      expires_at: expiresAt,
      created_at: new Date().toISOString()
    };
    
    await db.put(`orders/${orderId}`, order);

    res.json({
      success: true,
      id: orderId,
      amount: payableAmount,
      checkout_url: checkoutLink,
      upi_intent_string: upiLink,
      expires_at: expiresAt
    });

  } catch (err) {
    console.error('[API v1] Create Payment Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router };
