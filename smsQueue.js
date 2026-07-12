/**
 * ASG Payment Gateway — SMS Queue + Retry System for Firebase RTDB
 */
require('dotenv').config();
const https = require('https');
const http  = require('http');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

let verifyPayment;
let parseSmsAlert;

function init(database, verEng) {
  verifyPayment  = verEng.verifyPayment;
  parseSmsAlert  = verEng.parseSmsAlert;
  console.log('[Queue] ✅ SMS retry queue ready');
}

/**
 * Add an SMS to the retry queue.
 */
async function enqueue(id, enterpriseId, rawText, sender) {
  const qId = id || uuidv4();
  await db.put(`sms_queue/${qId}`, {
    id: qId, enterprise_id: enterpriseId || 'global', raw_text: rawText, sender: sender || '',
    received_at: new Date().toISOString(), attempts: 0, status: 'pending', result: ''
  });
}

/**
 * Add an SMS directly
 */
async function addSmsToQueue(item) {
  await enqueue(uuidv4(), item.enterprise_id, item.rawText, item.sender);
}

/**
 * Process all pending SMS in the queue.
 * Called every 30 seconds by cron.
 */
async function processQueue() {
  const allSms = await db.getAll('sms_queue');
  const pending = allSms.filter(s => s.status === 'pending' && s.attempts < 5)
                        .sort((a,b) => new Date(a.received_at) - new Date(b.received_at))
                        .slice(0, 20);

  if (!pending.length) return;
  console.log(`[Queue] Processing ${pending.length} queued SMS...`);

  for (const item of pending) {
    try {
      const parsed = parseSmsAlert(item.raw_text);
      const amount = parsed.amount;
      const ref = parsed.ref || null;

      if (!amount) {
        await db.patch(`sms_queue/${item.id}`, { status: 'failed', result: 'Could not parse amount' });
        continue;
      }

      const eId = item.enterprise_id;
      const ordersData = await db.query('orders', 'enterprise_id', eId);
      const orders = ordersData.filter(o => 
        o.status === 'pending' && 
        Math.abs(parseFloat(o.amount) - parseFloat(amount)) < 0.009 && 
        new Date(o.expires_at) > new Date()
      );
      orders.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

      if (!orders.length) {
        const attempts = item.attempts + 1;
        await db.patch(`sms_queue/${item.id}`, {
          attempts, last_attempt: new Date().toISOString(),
          status: attempts >= 4 ? 'expired' : 'pending',
          result: `No pending order for Rs.${amount}`
        });
        continue;
      }

      const result = await verifyPayment({
        orderId:      orders[0].id,
        upiRef:       ref,
        amount,
        source:       'sms_queue',
        rawText:      item.raw_text,
        enterpriseId: eId,
      });

      await db.patch(`sms_queue/${item.id}`, {
        status: result.success ? 'processed' : 'failed',
        result: result.message,
        attempts: item.attempts + 1,
        last_attempt: new Date().toISOString()
      });

      if (result.success) {
        console.log(`[Queue] ✅ Processed SMS → Order verified: ${orders[0].id}`);
      }

    } catch (err) {
      console.error('[Queue] Error processing SMS:', err.message);
      await db.patch(`sms_queue/${item.id}`, { attempts: item.attempts + 1, last_attempt: new Date().toISOString() });
    }
  }
}

function startKeepAlive(serverUrl) {
  if (!serverUrl || process.env.NODE_ENV !== 'production') return;
  const url = `${serverUrl}/api/health`;
  const ping = () => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, () => {});
    req.on('error', () => {});
    req.setTimeout(10000, () => req.destroy());
  };
  ping();
  setInterval(ping, 4 * 60 * 1000);
}

module.exports = { init, enqueue, processQueue, startKeepAlive, addSmsToQueue };
