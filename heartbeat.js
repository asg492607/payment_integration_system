/**
 * ASG Payment Gateway — Device Heartbeat Monitor
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks "last seen" timestamps for every registered Android forwarder device.
 * The Android app POSTs a heartbeat ping every 5 minutes.
 * If no ping is received in > 10 minutes, the device is flagged as OFFLINE.
 *
 * Merchants can register MULTIPLE devices per enterprise (for redundancy).
 * The dashboard shows a live status badge (Online / Offline) for each device.
 *
 * API Endpoints:
 *   POST /api/heartbeat              — called by Android app every 5 minutes
 *   GET  /api/heartbeat/status       — dashboard polls this to show device status
 *   POST /api/heartbeat/register     — register a new device for an enterprise
 *   DELETE /api/heartbeat/:deviceId  — deregister a device
 */

require('dotenv').config();
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { requireAuth } = require('./auth');

const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// ── POST /api/heartbeat ──────────────────────────────────────────────────────
// Called by the Android app every 5 minutes.
// Auth: x-sms-webhook-secret header (same secret as SMS webhook).
router.post('/', async (req, res) => {
  try {
    const secretHeader = req.headers['x-sms-webhook-secret'] || req.body?.secret || '';
    const eId = req.body?.enterprise_id || req.query.enterprise_id || 'global';
    const deviceId = req.body?.device_id || req.headers['x-device-id'] || 'default';
    const deviceLabel = req.body?.device_label || 'Android Phone';
    const batteryLevel = req.body?.battery || null;
    const networkType = req.body?.network || null;

    // Validate secret
    let webhookSecret = process.env.SMS_WEBHOOK_SECRET;
    if (eId !== 'global') {
      const enterprise = await db.get(`enterprise_users/${eId}`);
      if (!enterprise) return res.status(404).json({ error: 'Enterprise not found' });
      webhookSecret = enterprise.sms_webhook_secret;
    }

    if (secretHeader !== webhookSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const now = new Date().toISOString();
    const deviceKey = `devices/${eId}_${deviceId}`;

    const existing = await db.get(deviceKey);
    await db.put(deviceKey, {
      id: deviceId,
      enterprise_id: eId,
      label: deviceLabel,
      last_seen: now,
      battery: batteryLevel,
      network: networkType,
      registered_at: existing?.registered_at || now,
      status: 'online',
    });

    res.json({ success: true, message: 'Heartbeat received', timestamp: now });
  } catch (err) {
    console.error('[Heartbeat] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/heartbeat/status ─────────────────────────────────────────────────
// Called by the merchant's dashboard to check device statuses.
// Requires merchant auth token.
router.get('/status', requireAuth, async (req, res) => {
  try {
    const eId = req.enterpriseUserId;
    const allDevices = await db.find('devices', d => d.enterprise_id === eId);
    const now = Date.now();

    const devices = allDevices.map(d => ({
      ...d,
      is_online: d.last_seen && (now - new Date(d.last_seen).getTime()) < OFFLINE_THRESHOLD_MS,
      minutes_ago: d.last_seen ? Math.floor((now - new Date(d.last_seen).getTime()) / 60000) : null,
    }));

    const anyOnline = devices.some(d => d.is_online);

    res.json({
      devices,
      anyOnline,
      totalDevices: devices.length,
      onlineCount: devices.filter(d => d.is_online).length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/heartbeat/:deviceId ─────────────────────────────────────────
// Merchant deregisters a device from their enterprise.
router.delete('/:deviceId', requireAuth, async (req, res) => {
  try {
    const eId = req.enterpriseUserId;
    const deviceKey = `devices/${eId}_${req.params.deviceId}`;
    const device = await db.get(deviceKey);
    if (!device || device.enterprise_id !== eId) {
      return res.status(403).json({ error: 'Device not found or not yours' });
    }
    await db.remove(deviceKey);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Background check: called by cron every minute.
 * Logs a warning if ALL devices for an enterprise have gone offline.
 */
async function checkOfflineDevices() {
  try {
    const allDevices = await db.getAll('devices');
    if (!allDevices.length) return;

    const now = Date.now();
    // Group by enterprise
    const byEnterprise = {};
    for (const d of allDevices) {
      if (!byEnterprise[d.enterprise_id]) byEnterprise[d.enterprise_id] = [];
      const isOnline = d.last_seen && (now - new Date(d.last_seen).getTime()) < OFFLINE_THRESHOLD_MS;
      byEnterprise[d.enterprise_id].push({ ...d, isOnline });
    }

    for (const [eId, devices] of Object.entries(byEnterprise)) {
      const hasOnline = devices.some(d => d.isOnline);
      if (!hasOnline && devices.length > 0) {
        console.warn(`[Heartbeat] ⚠️  ALL devices OFFLINE for enterprise: ${eId}. Last seen: ${devices[0]?.last_seen}`);
        // Update Firebase so dashboard shows warning immediately
        for (const d of devices) {
          if (d.status !== 'offline') {
            await db.patch(`devices/${eId}_${d.id}`, { status: 'offline' }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal
  }
}

module.exports = { router, checkOfflineDevices };
