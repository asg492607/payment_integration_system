/**
 * Admin Panel & Enterprise Routing - Firebase RTDB
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const db = require('./database');
const { v4: uuidv4 } = require('uuid');

function setDb() {} // No longer needed



router.use(requireAuth);

router.get('/transactions', async (req, res) => {
  try {
    const transactions = await db.query('transactions', 'enterprise_id', req.enterpriseUserId);
    const orders = await db.query('orders', 'enterprise_id', req.enterpriseUserId);
    const users = await db.query('users', 'enterprise_id', req.enterpriseUserId);

    const merged = transactions.map(t => {
      const order = orders.find(o => o.id === t.order_id);
      const user = users.find(u => u.id === order?.user_id);
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
    const orders = await db.query('orders', 'enterprise_id', req.enterpriseUserId);

    const customersWithLtv = users.map(u => {
      const userOrders = orders.filter(o => o.user_id === u.id && o.status === 'paid');
      const ltv = userOrders.reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);
      return {
        ...u,
        ltv,
        is_vip: ltv > 5000 // Define VIP threshold
      };
    });

    const sorted = customersWithLtv.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
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
// ── GET /analytics ─────────────────────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const eId = req.enterpriseUserId;
    const allOrders = await db.query('orders', 'enterprise_id', eId);
    
    // 1. 7-Day Revenue Trend
    const trend = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      trend[dateStr] = 0;
    }
    
    // 2. Top Products
    const productCounts = {};
    
    allOrders.forEach(o => {
      if (o.status === 'paid') {
        // Trend
        const oDateStr = o.created_at.split('T')[0];
        if (trend[oDateStr] !== undefined) {
          trend[oDateStr] += parseFloat(o.amount || 0);
        }
        
        // Products
        if (o.cartItems && Array.isArray(o.cartItems)) {
          o.cartItems.forEach(item => {
            if (!productCounts[item.name]) {
              productCounts[item.name] = { name: item.name, revenue: 0, sold: 0 };
            }
            productCounts[item.name].sold += item.qty;
            productCounts[item.name].revenue += (item.qty * parseFloat(item.price || 0));
          });
        }
      }
    });
    
    const labels = Object.keys(trend).map(d => d.slice(5)); // MM-DD
    const data = Object.values(trend);
    
    const topProducts = Object.values(productCounts)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5); // top 5
      
    res.json({ success: true, trend: { labels, data }, topProducts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
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

// ── Smart POS Routes ────────────────────────────────────────────────────────
router.post('/pos/push', async (req, res) => {
  try {
    const { pushPosState } = require('./firebase');
    const { amount, orderId, upiLink, cartItems } = req.body;
    
    await pushPosState(req.enterpriseUserId, {
      amount, orderId, upiLink, cartItems: cartItems || [], timestamp: Date.now(), status: 'waiting'
    });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to push POS state' });
  }
});

router.post('/pos/clear', async (req, res) => {
  try {
    const { pushPosState } = require('./firebase');
    await pushPosState(req.enterpriseUserId, { status: 'idle', timestamp: Date.now() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear POS state' });
  }
});

// ── Catalog Routes ────────────────────────────────────────────────────────────
router.get('/catalog', async (req, res) => {
  try {
    const products = await db.query('products', 'enterprise_id', req.enterpriseUserId);
    res.json({ products: products || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

router.post('/catalog', async (req, res) => {
  try {
    const { id, name, price, type } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
    
    let productId = id;
    if (!productId) {
      const { v4: uuidv4 } = require('uuid');
      productId = 'PROD-' + uuidv4().split('-')[0].toUpperCase();
    }
    
    const product = {
      id: productId,
      enterprise_id: req.enterpriseUserId,
      name: name.trim(),
      price: parseFloat(price).toFixed(2),
      type: type || 'item' // item or service
    };
    
    await db.put(`products/${productId}`, product);
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save product' });
  }
});

router.delete('/catalog/:id', async (req, res) => {
  try {
    await db.remove(`products/${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = { router, setDb };
