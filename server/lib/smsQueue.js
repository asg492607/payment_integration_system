/**
 * PayForge — SMS Queue + Retry System
 * ────────────────────────────────────
 * Problem: Render free tier sleeps after 15min inactivity.
 * If the Android SMS Forwarder fires a webhook while the server
 * is cold-starting (~30s), the HTTP request times out and the
 * payment is LOST.
 *
 * Solution:
 *  1. Keep server awake with a self-ping every 4 minutes
 *  2. Store failed/pending SMS in a queue table
 *  3. Retry queue every 30 seconds via cron
 *  4. Idempotent — same SMS processed max once (UTR check)
 */
require('dotenv').config();
const https = require('https');
const http  = require('http');

let db;
let verifyPayment;
let parseSmsAlert;

function init(database, verEng) {
  db          = database;
  verifyPayment  = verEng.verifyPayment;
  parseSmsAlert  = verEng.parseSmsAlert;

  // Create queue table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS sms_queue (
      id            TEXT PRIMARY KEY,
      enterprise_id TEXT NOT NULL DEFAULT 'global',
      raw_text      TEXT NOT NULL,
      sender        TEXT,
      received_at   TEXT DEFAULT (datetime('now')),
      attempts      INTEGER DEFAULT 0,
      last_attempt  TEXT,
      status        TEXT DEFAULT 'pending',
      result        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sms_queue_status ON sms_queue(status, attempts);
  `);

  console.log('[Queue] ✅ SMS retry queue ready');
}

/**
 * Add an SMS to the retry queue.
 */
function enqueue(id, enterpriseId, rawText, sender) {
  db.prepare(`
    INSERT OR IGNORE INTO sms_queue (id, enterprise_id, raw_text, sender)
    VALUES (?, ?, ?, ?)
  `).run(id, enterpriseId || 'global', rawText, sender || '');
}

/**
 * Process all pending SMS in the queue.
 * Called every 30 seconds by cron.
 */
function processQueue() {
  const pending = db.prepare(`
    SELECT * FROM sms_queue
    WHERE status = 'pending' AND attempts < 5
    ORDER BY received_at ASC
    LIMIT 20
  `).all();

  if (!pending.length) return;
  console.log(`[Queue] Processing ${pending.length} queued SMS...`);

  for (const item of pending) {
    try {
      const parsed = parseSmsAlert(item.raw_text);
      const { amount, ref } = parsed;

      if (!amount || !ref) {
        db.prepare(`UPDATE sms_queue SET status='failed', result=? WHERE id=?`)
          .run('Could not parse amount or ref', item.id);
        continue;
      }

      // Find matching pending order for this enterprise
      const eId = item.enterprise_id;
      const candidates = db.prepare(`
        SELECT id FROM orders
        WHERE enterprise_id = ? AND status = 'pending' AND amount = ?
          AND datetime(expires_at) > datetime('now')
        ORDER BY created_at DESC LIMIT 1
      `).all(eId, amount);

      if (!candidates.length) {
        db.prepare(`
          UPDATE sms_queue SET attempts = attempts+1, last_attempt=datetime('now'),
          status = CASE WHEN attempts >= 4 THEN 'expired' ELSE 'pending' END,
          result = ? WHERE id=?
        `).run(`No pending order for Rs.${amount}`, item.id);
        continue;
      }

      const result = verifyPayment({
        orderId:      candidates[0].id,
        upiRef:       ref,
        amount,
        source:       'sms_queue',
        rawText:      item.raw_text,
        enterpriseId: eId,
      });

      db.prepare(`
        UPDATE sms_queue SET status=?, result=?, attempts=attempts+1, last_attempt=datetime('now')
        WHERE id=?
      `).run(result.success ? 'processed' : 'failed', result.message, item.id);

      if (result.success) {
        console.log(`[Queue] ✅ Processed SMS → Order verified: ${candidates[0].id}`);
      }

    } catch (err) {
      console.error('[Queue] Error processing SMS:', err.message);
      db.prepare(`UPDATE sms_queue SET attempts=attempts+1, last_attempt=datetime('now') WHERE id=?`)
        .run(item.id);
    }
  }
}

/**
 * Self-ping to keep Render free tier awake.
 * Pings /api/health every 4 minutes.
 * This prevents the 30s cold-start that causes webhook timeouts.
 */
function startKeepAlive(serverUrl) {
  if (!serverUrl || process.env.NODE_ENV !== 'production') {
    console.log('[KeepAlive] Skipped (not production or no URL set)');
    return;
  }

  const url = `${serverUrl}/api/health`;
  console.log(`[KeepAlive] 🏓 Pinging ${url} every 4 minutes`);

  const ping = () => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      // Success — server is awake
    });
    req.on('error', (err) => {
      console.warn('[KeepAlive] Ping failed (non-fatal):', err.message);
    });
    req.setTimeout(10000, () => req.destroy());
  };

  // Ping immediately, then every 4 minutes
  ping();
  setInterval(ping, 4 * 60 * 1000);
}

/**
 * Get queue stats (for dashboard).
 */
function getQueueStats() {
  return {
    pending:   db.prepare(`SELECT COUNT(*) as c FROM sms_queue WHERE status='pending'`).get().c,
    processed: db.prepare(`SELECT COUNT(*) as c FROM sms_queue WHERE status='processed'`).get().c,
    failed:    db.prepare(`SELECT COUNT(*) as c FROM sms_queue WHERE status='failed'`).get().c,
  };
}

module.exports = { init, enqueue, processQueue, startKeepAlive, getQueueStats };
