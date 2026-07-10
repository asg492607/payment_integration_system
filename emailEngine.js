/**
 * PayForge — Email Alert Fallback Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Polls a merchant's dedicated Gmail/Outlook inbox for bank transaction emails
 * and feeds them into the verification engine — exactly like the Android app does
 * via SMS, but using email as a FALLBACK when the phone is offline.
 *
 * Banks that send transaction emails (India):
 *   HDFC:  alerts@hdfcbank.net
 *   SBI:   alerts@sbi.co.in  (or sbicustomercare@sbi.co.in)
 *   ICICI: credit_alerts@icicibank.com
 *   Axis:  alerts@axisbank.com
 *   Kotak: alerts@kotak.com
 *
 * Setup for each enterprise merchant:
 *   1. Create a dedicated Gmail account (e.g., payments@gmail.com)
 *   2. Register that email with the bank for transaction alerts
 *   3. Enable IMAP in Gmail settings
 *   4. Create a Google "App Password" (16-char, since 2FA is on)
 *   5. Save credentials in dashboard → Email Fallback section
 *
 * Dependencies:
 *   npm install imapflow mailparser
 */

require('dotenv').config();
const db = require('./database');
let verifyPayment;
let parseSmsAlert;

// Known bank email senders in India
const BANK_SENDERS = [
  'alerts@hdfcbank.net',
  'hdfcbank.net',
  'alerts@sbi.co.in',
  'sbicustomercare@sbi.co.in',
  'sbi.co.in',
  'credit_alerts@icicibank.com',
  'icicibank.com',
  'alerts@axisbank.com',
  'axisbank.com',
  'alerts@kotak.com',
  'kotak.com',
  'noreply@yesbank.in',
  'alerts@indusind.com',
  'alerts@pnb.co.in',
  'alerts@bankofbaroda.com',
];

function init(verEng) {
  verifyPayment = verEng.verifyPayment;
  parseSmsAlert = verEng.parseSmsAlert;
  console.log('[EmailEngine] ✅ Email fallback engine ready');
}

/**
 * Check if an email is from a known Indian bank.
 */
function isBankEmail(fromAddress) {
  if (!fromAddress) return false;
  const lower = fromAddress.toLowerCase();
  return BANK_SENDERS.some(s => lower.includes(s));
}

/**
 * Poll one enterprise merchant's email inbox for unread bank emails.
 * Called by the cron scheduler every 2 minutes.
 */
async function pollEmailForEnterprise(enterprise) {
  if (!enterprise.email_imap_user || !enterprise.email_imap_pass) return;

  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = require('imapflow'));
    ({ simpleParser } = require('mailparser'));
  } catch (e) {
    console.warn('[EmailEngine] imapflow or mailparser not installed. Run: npm install imapflow mailparser');
    return;
  }

  const client = new ImapFlow({
    host: enterprise.email_imap_host || 'imap.gmail.com',
    port: enterprise.email_imap_port || 993,
    secure: true,
    auth: {
      user: enterprise.email_imap_user,
      pass: enterprise.email_imap_pass,
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Only get UNSEEN messages to avoid processing duplicates
      const messages = [];
      for await (const msg of client.fetch({ seen: false, since: new Date(Date.now() - 10 * 60000) }, { source: true, envelope: true })) {
        messages.push(msg);
      }

      for (const msg of messages) {
        try {
          const parsed = await simpleParser(msg.source);
          const from = parsed.from?.value?.[0]?.address || '';

          if (!isBankEmail(from)) continue;

          // Use both the HTML-stripped text and plain text for parsing
          const emailText = parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '';
          const alert = parseSmsAlert(emailText);

          if (!alert.amount) {
            console.log(`[EmailEngine] Could not parse amount from email: ${parsed.subject}`);
            // Mark as seen anyway so we don't retry
            await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
            continue;
          }

          // Find a matching pending order
          const ordersData = await db.query('orders', 'enterprise_id', enterprise.id);
          const matchingOrders = ordersData.filter(o =>
            o.status === 'pending' &&
            Math.abs(parseFloat(o.amount) - parseFloat(alert.amount)) < 0.009 &&
            new Date(o.expires_at) > new Date()
          );

          if (!matchingOrders.length) {
            console.log(`[EmailEngine] No matching order for ₹${alert.amount} (enterprise: ${enterprise.id})`);
            await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
            continue;
          }

          matchingOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          const result = await verifyPayment({
            orderId: matchingOrders[0].id,
            upiRef: alert.ref,
            amount: alert.amount,
            source: 'email_fallback',
            rawText: emailText.slice(0, 500),
            enterpriseId: enterprise.id,
          });

          if (result.success) {
            console.log(`[EmailEngine] ✅ Payment verified via email: ${matchingOrders[0].id}`);
          } else {
            console.log(`[EmailEngine] ⚠️  Verification failed: ${result.message}`);
          }

          // Mark email as seen so we don't process it again
          await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
        } catch (msgErr) {
          console.warn('[EmailEngine] Error processing message:', msgErr.message);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.warn(`[EmailEngine] IMAP error for ${enterprise.email_imap_user}:`, err.message);
  }
}

/**
 * Poll ALL enterprises that have email fallback configured.
 * Called by cron every 2 minutes.
 */
async function pollAllEnterprises() {
  try {
    const enterprises = await db.find('enterprise_users', e => !!e.email_imap_user && !!e.email_imap_pass);
    if (!enterprises.length) return;
    console.log(`[EmailEngine] Polling ${enterprises.length} enterprise inbox(es)...`);
    await Promise.allSettled(enterprises.map(e => pollEmailForEnterprise(e)));
  } catch (err) {
    console.warn('[EmailEngine] Poll error:', err.message);
  }
}

module.exports = { init, pollEmailForEnterprise, pollAllEnterprises };
