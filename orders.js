/**
 * Orders & Payments Router - Firebase RTDB
 */
require('dotenv').config();
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const upiEngine = require('./upiEngine');
const verificationEngine = require('./verificationEngine');
const smsQueue = require('./smsQueue');

function setDb() {} // No longer needed

// ── GET /api/orders/plans/:enterpriseId ───────────────────────────────────────
router.get('/plans/:enterpriseId', async (req, res) => {
  try {
    const eId = req.params.enterpriseId;
    const allPlans = await db.find('enterprise_plans', p => p.enterprise_id === eId);
    
    if (allPlans.length === 0) {
      // Fallback
      return res.json([{ plan_code: 'starter', label: 'Starter', amount: 199, duration: '30 Days' }]);
    }
    res.json(allPlans);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

router.get('/debug-queue', async (req, res) => {
  try {
    const queue = await db.getAll('sms_queue');
    res.json(queue);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Ensures unique fractional amount
 */
async function reserveAmount(baseAmount, enterpriseId) {
  const min = Math.floor(baseAmount);
  
  for (let paise = 1; paise <= 99; paise++) {
    const amt = parseFloat((min + (paise / 100)).toFixed(2));
    const resKey = `active_amounts/${enterpriseId}_${amt.toString().replace('.','_')}`;
    const existing = await db.get(resKey);
    
    if (!existing || new Date(existing.expires_at) < new Date()) {
      await db.put(resKey, {
        amount: amt,
        expires_at: new Date(Date.now() + 16 * 60000).toISOString()
      });
      return amt;
    }
  }
  throw new Error('Too many concurrent payments for this price. Please try again in 15 minutes.');
}

// ── POST /api/orders/create ───────────────────────────────────────────────────
router.post('/create', async (req, res) => {
  try {
    const { name, email, phone, plan, enterprise_id } = req.body;
    const eId = enterprise_id || 'global';

    if (!name || !email || !plan) return res.status(400).json({ error: 'Missing required fields' });

    let enterprise = null;
    if (eId !== 'global') {
      enterprise = await db.get(`enterprise_users/${eId}`);
      if (!enterprise) return res.status(404).json({ error: 'Enterprise account not found' });
      if (!enterprise.setup_complete) return res.status(400).json({ error: 'Enterprise UPI not configured' });
    }

    const allPlans = await db.find('enterprise_plans', p => p.enterprise_id === eId);
    let planMeta = allPlans.find(p => p.plan_code === plan);
    if (!planMeta) {
      if (plan === 'pro') planMeta = { label: 'Pro', amount: 499 };
      else return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const payableAmount = await reserveAmount(planMeta.amount, eId);
    let user = await db.findOne('users', u => u.email === email.toLowerCase() && u.enterprise_id === eId);
    
    if (!user) {
      user = {
        id: uuidv4(), enterprise_id: eId, email: email.toLowerCase(), name, phone: phone || null,
        is_active: 0, plan: 'free', created_at: new Date().toISOString()
      };
      await db.put(`users/${user.id}`, user);
    }

    const orderId = upiEngine.generateOrderId();
    const expiryMins = 15;
    const expiresAt = new Date(Date.now() + expiryMins * 60000).toISOString();
    
    let upiVpa = null, paymentNote = orderId;
    if (enterprise) {
      upiVpa = enterprise.upi_vpa;
      paymentNote = `${enterprise.company || 'Enterprise'} - ${orderId}`;
    }

    const upiLink = upiEngine.buildUpiLinkForEnterprise({
      orderId,
      amount: payableAmount,
      note: paymentNote,
      vpa: upiVpa,
      payeeName: enterprise?.upi_payee_name
    });
    const secret = enterprise ? enterprise.hmac_secret : process.env.HMAC_SECRET;
    const signature = upiEngine.signOrderId(orderId, secret);

    const order = {
      id: orderId, enterprise_id: eId, user_id: user.id, amount: payableAmount,
      currency: 'INR', plan, upi_link: upiLink, status: 'pending', expires_at: expiresAt, created_at: new Date().toISOString()
    };
    await db.put(`orders/${orderId}`, order);

    res.json({
      success: true, orderId, signature, amount: payableAmount, baseAmount: planMeta.amount,
      plan: planMeta.label, upiLink, paymentNote, upiVpa, expiresAt, expiresInMinutes: expiryMins
    });
  } catch (err) {
    console.error('[Orders] Create error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── GET /api/orders/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const order = await db.get(`orders/${req.params.id}`);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const txn = await db.findOne('transactions', t => t.order_id === req.params.id && t.status === 'verified');
    
    let safeUser = null;
    if (order.status === 'paid') {
      const u = await db.get(`users/${order.user_id}`);
      if (u) safeUser = { is_active: u.is_active, plan: u.plan, name: u.name };
    }

    res.json({ order, transaction: txn || null, user: safeUser });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/orders/sms ─────────────────────────────────────────────────────
router.post('/sms', express.json({ type: ['application/json', 'text/plain'] }), async (req, res) => {
  try {
    let body = req.body;
    
    // DEBUG: Save raw payload for diagnostic
    try {
      await db.put(`sms_queue/DEBUG_${Date.now()}`, { 
        id: `DEBUG_${Date.now()}`, 
        body: body || 'empty', 
        headers: req.headers,
        status: 'debug'
      });
    } catch(e){}

    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
    }

    const rawText = body.rawText || body.text || body.message || body.content || '';
    const sender = body.sender || body.address || body.title || body.from || '';
    const secretHeader = req.headers['x-sms-webhook-secret'] || body.secret || req.query.secret || '';
    const eId = body.enterprise_id || req.query.enterprise_id || req.query.eid || 'global';

    if (!rawText) return res.status(400).json({ error: 'Missing rawText/message' });

    let webhookSecret = process.env.SMS_WEBHOOK_SECRET;
    let trustedSender = process.env.TRUSTED_SMS_SENDER;

    if (eId !== 'global') {
      const enterprise = await db.get(`enterprise_users/${eId}`);
      if (!enterprise) return res.status(404).json({ error: 'Enterprise not found' });
      webhookSecret = enterprise.sms_webhook_secret;
      trustedSender = enterprise.trusted_sms_sender;
    }

    if (secretHeader !== webhookSecret) {
      return res.status(401).json({ error: 'Unauthorized: Invalid secret' });
    }
    if (trustedSender && !sender.includes(trustedSender)) {
      return res.status(403).json({ error: `Untrusted sender: ${sender}` });
    }

    const { emitSmsEvent } = require('./firebase');
    const parsed = verificationEngine.parseSmsAlert(rawText);
    emitSmsEvent({ enterpriseId: eId, rawText, sender, parsed }).catch(() => {});

    smsQueue.addSmsToQueue({ rawText, sender, enterprise_id: eId, source: 'app_webhook' });

    res.json({ success: true, message: 'SMS received and queued for processing.' });
  } catch (err) {
    console.error('[SMS Webhook] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
module.exports = { router, setDb };
