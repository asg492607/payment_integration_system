/**
 * ASG Payment Gateway — Telegram Bot Fallback Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Merchants forward their bank credit SMS to a Telegram bot.
 * The bot parses the SMS and triggers payment verification — completely
 * independent of the Android ASG Payment Gateway app.
 *
 * This is the FASTEST fallback: merchant just copies the bank SMS and
 * sends it to the Telegram bot. Verified in < 2 seconds.
 *
 * Setup (one-time, per platform):
 *   1. Message @BotFather on Telegram → /newbot → get TOKEN
 *   2. Set TELEGRAM_BOT_TOKEN in your .env
 *   3. Each merchant gets a unique /start code linking their Telegram to their Enterprise
 *
 * Usage by merchant:
 *   - Phone receives bank SMS: "Rs.499.01 credited... UPI Ref 412345678901"
 *   - Merchant copies SMS text, sends to the ASG Payment Gateway bot on Telegram
 *   - Bot verifies payment and replies: "✅ Payment Verified! Order XYZ activated."
 *
 * Commands:
 *   /start <enterprise_id>   — Link Telegram chat to an enterprise account
 *   /status                  — Check how many pending orders exist
 *   /verify <UTR>            — Manually verify a payment by UTR number
 *
 * npm install node-telegram-bot-api
 */

require('dotenv').config();
const db = require('./database');
let verifyPayment;
let parseSmsAlert;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

function init(verEng) {
  verifyPayment = verEng.verifyPayment;
  parseSmsAlert = verEng.parseSmsAlert;

  if (!TELEGRAM_TOKEN) {
    console.log('[TelegramBot] TELEGRAM_BOT_TOKEN not set. Telegram fallback disabled.');
    return;
  }

  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    setupHandlers();
    console.log('[TelegramBot] ✅ Telegram bot started and polling');
  } catch (e) {
    console.warn('[TelegramBot] Failed to start:', e.message);
  }
}

function setupHandlers() {
  if (!bot) return;

  // ── /start <enterprise_id> [webhook_secret] — Link chat to enterprise ──
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const parts = (match[1] || '').trim().split(/\s+/);
    const eId = parts[0];
    const secret = parts[1];

    if (!eId) {
      return bot.sendMessage(chatId,
        `👋 *Welcome to ASG Payment Gateway Payment Bot!*\n\n` +
        `To link this chat to your merchant account securely, use:\n` +
        `/start YOUR_ENTERPRISE_ID YOUR_WEBHOOK_SECRET\n\n` +
        `Find your Enterprise ID and Webhook Secret in your Dashboard → Settings / Integration tab.`,
        { parse_mode: 'Markdown' }
      );
    }

    try {
      const enterprise = await db.get(`enterprise_users/${eId}`);
      if (!enterprise) {
        return bot.sendMessage(chatId, '❌ Enterprise ID not found. Please check your Dashboard.');
      }

      // Verify webhook secret / API key for security
      if (enterprise.sms_webhook_secret && secret !== enterprise.sms_webhook_secret && secret !== enterprise.api_key) {
        return bot.sendMessage(chatId, '❌ Unauthorized: Invalid Webhook Secret / Key.\nUsage: `/start YOUR_ENTERPRISE_ID YOUR_SECRET`', { parse_mode: 'Markdown' });
      }

      // Save the telegram chat_id → enterprise mapping
      await db.put(`telegram_links/${chatId}`, {
        chat_id: String(chatId),
        enterprise_id: eId,
        enterprise_name: enterprise.company || enterprise.name,
        linked_at: new Date().toISOString(),
      });

      bot.sendMessage(chatId,
        `✅ *Linked to ${enterprise.company || enterprise.name}!*\n\n` +
        `Now just *forward or paste any bank credit SMS* here and I'll verify the payment automatically.\n\n` +
        `*Commands:*\n` +
        `/status — View pending orders\n` +
        `/verify <ORDER_ID> <UTR> — Manually verify an order by ID and UTR`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error linking account. Please try again.');
    }
  });

  // ── /pay <amount> — Generate a Smart Link ─────────────────────────────────
  bot.onText(/\/pay (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const amountStr = match[1].trim();
    
    const link = await db.get(`telegram_links/${chatId}`);
    if (!link) return bot.sendMessage(chatId, '❗ Please link your account first: /start YOUR_ENTERPRISE_ID');

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ Invalid amount. Usage: `/pay 500`', { parse_mode: 'Markdown' });
    }

    try {
      const user = await db.get(`enterprise_users/${link.enterprise_id}`);
      const { v4: uuidv4 } = require('uuid');
      const orderId = 'T-' + uuidv4().split('-')[0].toUpperCase();
      const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
      const checkoutLink = `https://payforge.com/pay/${user.id}?order_id=${orderId}&amount=${amount.toFixed(2)}`;
      
      // Just a placeholder since upiEngine is not required here yet, let's require it at the top or use simple string
      const upiEngine = require('./upiEngine');
      const upiLink = upiEngine.buildUpiLinkForEnterprise({
        orderId,
        amount: amount.toFixed(2),
        note: `${user.company || 'ASG Payment Gateway'} - ${orderId}`,
        vpa: user.upi_vpa,
        payeeName: user.upi_payee_name
      });

      const order = {
        id: orderId, enterprise_id: user.id, user_id: 'telegram_bot', amount: amount.toFixed(2),
        currency: 'INR', plan: 'telegram_link', upi_link: upiLink, status: 'pending',
        expires_at: expiresAt, created_at: new Date().toISOString()
      };
      
      await db.put(`orders/${orderId}`, order);

      bot.sendMessage(chatId, 
        `🔗 *Payment Link Generated!*\n\n` +
        `💰 Amount: ₹${amount.toFixed(2)}\n\n` +
        `Forward this link to your customer:\n${checkoutLink}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error generating link.');
    }
  });

  // ── /status — Show pending orders ─────────────────────────────────────────
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const link = await db.get(`telegram_links/${chatId}`);
    if (!link) return bot.sendMessage(chatId, '❗ Please link your account first: /start YOUR_ENTERPRISE_ID');

    try {
      const orders = await db.query('orders', 'enterprise_id', link.enterprise_id);
      const pending = orders.filter(o => o.status === 'pending' && new Date(o.expires_at) > new Date());
      const paid = orders.filter(o => o.status === 'paid').length;

      bot.sendMessage(chatId,
        `📊 *Status for ${link.enterprise_name}*\n\n` +
        `⏳ Pending Orders: *${pending.length}*\n` +
        `✅ Paid Orders: *${paid}*\n\n` +
        `${pending.length > 0 ? pending.slice(0, 5).map(o =>
          `• \`${o.id}\` — ₹${o.amount} — expires ${new Date(o.expires_at).toLocaleTimeString('en-IN')}`
        ).join('\n') : 'No pending orders right now.'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      bot.sendMessage(chatId, '❌ Error fetching orders.');
    }
  });

  // ── /verify [order_id] <UTR> — Manual UTR verification ───────────────────
  bot.onText(/\/verify (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(/\s+/);
    const link = await db.get(`telegram_links/${chatId}`);
    if (!link) return bot.sendMessage(chatId, '❗ Please link your account first: /start YOUR_ENTERPRISE_ID YOUR_SECRET');

    let orderId = null;
    let utr = null;

    if (parts.length >= 2) {
      orderId = parts[0].toUpperCase();
      utr = parts[1].toUpperCase();
    } else {
      utr = parts[0].toUpperCase();
    }

    await handleUtrVerification(chatId, link.enterprise_id, utr, orderId);
  });

  // ── Any text message — treat as a bank SMS ────────────────────────────────
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const link = await db.get(`telegram_links/${chatId}`);

    if (!link) {
      return bot.sendMessage(chatId,
        '❗ Please link your merchant account first:\n/start YOUR_ENTERPRISE_ID YOUR_SECRET'
      );
    }

    await handleSmsText(chatId, link.enterprise_id, msg.text);
  });
}

// ── Core: Parse & verify an SMS text ─────────────────────────────────────────
async function handleSmsText(chatId, enterpriseId, rawText) {
  try {
    const parsed = parseSmsAlert(rawText);

    if (!parsed.amount) {
      return bot.sendMessage(chatId,
        `⚠️ Could not parse a payment amount from this message.\n\n` +
        `Make sure it's a bank credit alert. Example:\n` +
        `_"Rs.499.01 credited to A/c XX1234 UPI Ref 412345678901"_`,
        { parse_mode: 'Markdown' }
      );
    }

    // Find matching order
    const ordersData = await db.query('orders', 'enterprise_id', enterpriseId);
    const matching = ordersData.filter(o =>
      o.status === 'pending' &&
      Math.abs(parseFloat(o.amount) - parseFloat(parsed.amount)) < 0.009 &&
      new Date(o.expires_at) > new Date()
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!matching.length) {
      return bot.sendMessage(chatId,
        `⚠️ No pending order found for *₹${parsed.amount}*.\n\n` +
        `The order may have expired or already been paid. Check the dashboard.`,
        { parse_mode: 'Markdown' }
      );
    }

    const result = await verifyPayment({
      orderId: matching[0].id,
      upiRef: parsed.ref,
      amount: parsed.amount,
      source: 'telegram_bot',
      rawText: rawText.slice(0, 500),
      enterpriseId,
    });

    if (result.success) {
      bot.sendMessage(chatId,
        `✅ *Payment Verified!*\n\n` +
        `💰 Amount: ₹${parsed.amount}\n` +
        `📋 Order: \`${matching[0].id}\`\n` +
        `🔑 UTR: \`${parsed.ref || 'N/A'}\`\n` +
        `🎉 Service activated for customer!`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(chatId,
        `❌ Verification failed: ${result.message}\n\nCode: \`${result.code}\``,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    console.error('[TelegramBot] Error handling SMS:', err.message);
    if (bot) bot.sendMessage(chatId, '❌ Server error. Please try again.');
  }
}

// ── Core: Verify by UTR number directly ──────────────────────────────────────
async function handleUtrVerification(chatId, enterpriseId, utr, specificOrderId = null) {
  try {
    // Check if UTR already used
    const used = await db.get(`used_refs/${utr}`);
    if (used) {
      return bot.sendMessage(chatId,
        `⚠️ UTR \`${utr}\` was already used to verify order \`${used.order_id}\`.`,
        { parse_mode: 'Markdown' }
      );
    }

    let targetOrder = null;
    if (specificOrderId) {
      targetOrder = await db.get(`orders/${specificOrderId}`);
      if (!targetOrder || targetOrder.enterprise_id !== enterpriseId) {
        return bot.sendMessage(chatId, `❌ Order \`${specificOrderId}\` not found for your merchant account.`);
      }
      if (targetOrder.status !== 'pending') {
        return bot.sendMessage(chatId, `⚠️ Order \`${specificOrderId}\` is already ${targetOrder.status}.`);
      }
    } else {
      // Find pending orders for this enterprise
      const ordersData = await db.query('orders', 'enterprise_id', enterpriseId);
      const pending = ordersData.filter(o =>
        o.status === 'pending' && new Date(o.expires_at) > new Date()
      ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (!pending.length) {
        return bot.sendMessage(chatId, '⚠️ No pending orders found to match this UTR against.');
      }
      if (pending.length > 1) {
        return bot.sendMessage(chatId,
          `⚠️ Multiple pending orders exist. Please specify the Order ID:\n` +
          `Usage: \`/verify ${pending[0].id} ${utr}\`\n\n` +
          `Pending Orders:\n` +
          pending.slice(0, 5).map(o => `• \`${o.id}\` — ₹${o.amount}`).join('\n'),
          { parse_mode: 'Markdown' }
        );
      }
      targetOrder = pending[0];
    }

    const result = await verifyPayment({
      orderId: targetOrder.id,
      upiRef: utr,
      amount: null, // Skip amount check when manually providing UTR
      source: 'telegram_manual_utr',
      rawText: `Manual Telegram UTR verification: ${utr}`,
      enterpriseId,
    });

    if (result.success) {
      bot.sendMessage(chatId,
        `✅ *Payment Verified by UTR!*\n\n` +
        `📋 Order: \`${pending[0].id}\`\n` +
        `🔑 UTR: \`${utr}\`\n` +
        `💰 Amount: ₹${pending[0].amount}\n` +
        `🎉 Service activated!`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(chatId,
        `❌ Verification failed: ${result.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    bot.sendMessage(chatId, '❌ Error during UTR verification.');
  }
}

async function sendTelegramMessage(chatId, text) {
  if (!bot || !chatId) return false;
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return true;
  } catch(e) {
    console.error('[TelegramBot] Failed to send message:', e.message);
    return false;
  }
}

module.exports = { init, sendTelegramMessage };
