/**
 * Admin Panel & Enterprise Routing - Firebase RTDB
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const db = require('./database');
const { v4: uuidv4 } = require('uuid');

function setDb() {} // No longer needed

router.get('/dump-orders', async (req, res) => {
  try {
    const orders = await db.getAll('orders');
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dump-sms', async (req, res) => {
  try {
    const queue = await db.getAll('sms_queue');
    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dump-ent', async (req, res) => {
  try {
    const ent = await db.getAll('enterprise_users');
    res.json(ent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(requireAuth);

router.get('/transactions', async (req, res) => {
  try {
    const transactions = await db.query('transactions', 'enterprise_id', req.enterpriseUserId);
    const orders = await db.query('orders', 'enterprise_id', req.enterpriseUserId);
    const users = await db.query('users', 'enterprise_id', req.enterpriseUserId);

    const merged = transactions.map(t => {
      const order = orders.find(o => o.id === t.order_id);
      const user = user.find(u => u.id === order?.user_id);
      return {
        id: t.id, upi_ref: t.upi_ref, amount_verified: t.amount_verified,
        status: t.status, verified_at: t.verified_at,
        order_id: t.order_id, user_email: user?.email, plan: order?.plan
      };
    }).sort((a,b) => new Date(b.verified_at) - new Date(a.verified_at));

    res.json(merged);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const ordersData = await db.query('orders', 'enterprise_id', req.enterpriseUserId);
    const orders = ordersData.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    const usersData = await db.query('users', 'enterprise_id', req.enterpriseUserId);
    const users = usersData.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    
    const merged = orders.map(o => {
      const user = users.find(u => u.id === o.user_id);
      return {
        id: o.id, amount: o.amount, plan: o.plan, status: o.status,
        expires_at: o.expires_at, created_at: o.created_at,
        user_email: user?.email, user_name: user?.name
      };
    }).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(merged);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/customers', async (req, res) => {
  try {
    const users = await db.find('users', u => u.enterprise_id === req.enterpriseUserId);
    const sorted = users.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(sorted);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/sms_queue', async (req, res) => {
  try {
    const queue = await db.find('sms_queue', s => s.enterprise_id === req.enterpriseUserId);
    res.json(queue);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/plans', async (req, res) => {
  try {
    const plans = await db.find('enterprise_plans', p => p.enterprise_id === req.enterpriseUserId);
    res.json(plans.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/plans', async (req, res) => {
  try {
    const { plan_code, label, amount, duration } = req.body;
    if (!plan_code || !label || !amount) return res.status(400).json({ error: 'Missing fields' });

    const existing = await db.findOne('enterprise_plans', p => p.enterprise_id === req.enterpriseUserId && p.plan_code === plan_code);
    if (existing) return res.status(409).json({ error: 'Plan code already exists' });

    const id = uuidv4();
    const plan = {
      id, enterprise_id: req.enterpriseUserId, plan_code, label, amount: parseFloat(amount),
      duration: duration || '30 Days', created_at: new Date().toISOString()
    };
    await db.put(`enterprise_plans/${id}`, plan);
    res.status(201).json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.delete('/plans/:id', async (req, res) => {
  try {
    const plan = await db.get(`enterprise_plans/${req.params.id}`);
    if (!plan || plan.enterprise_id !== req.enterpriseUserId) return res.status(403).json({ error: 'Unauthorized' });
    await db.remove(`enterprise_plans/${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.delete('/orders/pending', async (req, res) => {
  try {
    const ordersData = await db.query('orders', 'enterprise_id', req.enterpriseUserId);
    const orders = ordersData.filter(o => o.status === 'pending' || o.status === 'expired');
    let count = 0;
    for (const o of orders) {
      await db.remove(`orders/${o.id}`);
      count++;
    }
    res.json({ success: true, deleted: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear orders' });
  }
});

router.post('/orders/test', async (req, res) => {
  try {
    const eId = req.enterpriseUserId;
    const { v4: uuidv4 } = require('uuid');
    const orderId = 'TEST-' + uuidv4().split('-')[0].toUpperCase();
    const amount = '99.0' + Math.floor(Math.random() * 9 + 1); // e.g. 99.01 - 99.09
    const order = {
      id: orderId, enterprise_id: eId, plan: 'test', amount: amount, status: 'pending',
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 15 * 60000).toISOString()
    };
    await db.put(`orders/${orderId}`, order);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create test order' });
  }
});



module.exports = { router, setDb };
