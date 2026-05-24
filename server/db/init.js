/**
 * Database Initialization — SQLite via better-sqlite3
 * Enterprise multi-tenant schema
 * Render: DB_PATH=/data/payments.db (persistent disk)
 * Local:  DB_PATH=./server/db/payments.db
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

const rawPath = process.env.DB_PATH || path.join(__dirname, 'payments.db');
const dbPath  = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
const dbDir   = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- ── Enterprise Accounts (startup owners who run their own UPI flow) ────────
  CREATE TABLE IF NOT EXISTS enterprise_users (
    id                 TEXT PRIMARY KEY,
    email              TEXT UNIQUE NOT NULL,
    name               TEXT NOT NULL,
    company            TEXT,
    password_hash      TEXT NOT NULL,
    upi_vpa            TEXT,
    upi_payee_name     TEXT,
    hmac_secret        TEXT,
    sms_webhook_secret TEXT,
    trusted_sms_sender TEXT,
    is_verified        INTEGER DEFAULT 0,
    is_active          INTEGER DEFAULT 1,
    plan               TEXT DEFAULT 'starter',
    setup_complete     INTEGER DEFAULT 0,
    created_at         TEXT DEFAULT (datetime('now')),
    updated_at         TEXT DEFAULT (datetime('now'))
  );

  -- ── Sessions for enterprise users ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS enterprise_sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TEXT NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES enterprise_users(id)
  );

  -- ── End-customers who pay (linked to an enterprise account) ───────────────
  -- NOTE: SQLite NULLs are never equal, so UNIQUE(email, enterprise_id) would
  -- allow duplicate rows when enterprise_id IS NULL. We use a workaround:
  -- store 'global' as the enterprise_id sentinel instead of NULL.
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    enterprise_id   TEXT NOT NULL DEFAULT 'global',
    email           TEXT NOT NULL,
    name            TEXT NOT NULL,
    phone           TEXT,
    is_active       INTEGER DEFAULT 0,
    plan            TEXT DEFAULT 'free',
    activated_at    TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(email, enterprise_id)
  );

  -- ── Orders ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    enterprise_id   TEXT NOT NULL DEFAULT 'global',
    user_id         TEXT NOT NULL,
    amount          REAL NOT NULL,
    currency        TEXT DEFAULT 'INR',
    plan            TEXT NOT NULL,
    upi_link        TEXT,
    status          TEXT DEFAULT 'pending',
    expires_at      TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ── Transactions ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS transactions (
    id              TEXT PRIMARY KEY,
    enterprise_id   TEXT NOT NULL DEFAULT 'global',
    order_id        TEXT NOT NULL,
    upi_ref         TEXT,
    amount_verified REAL,
    signal_source   TEXT,
    raw_signal      TEXT,
    status          TEXT DEFAULT 'unverified',
    verified_at     TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  -- ── Audit Log (immutable append-only) ─────────────────────────────────────
  CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    enterprise_id TEXT NOT NULL DEFAULT 'global',
    event_type    TEXT NOT NULL,
    order_id      TEXT,
    user_id       TEXT,
    payload       TEXT,
    ip_address    TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  -- ── Replay attack prevention ───────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS used_refs (
    upi_ref    TEXT PRIMARY KEY,
    order_id   TEXT NOT NULL,
    used_at    TEXT DEFAULT (datetime('now'))
  );

  -- ── Indexes for performance ────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_orders_enterprise   ON orders(enterprise_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_amount       ON orders(amount, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_order  ON transactions(order_id);
  CREATE INDEX IF NOT EXISTS idx_audit_enterprise    ON audit_log(enterprise_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_token      ON enterprise_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_user       ON enterprise_sessions(user_id, expires_at);
`);

console.log('[DB] ✅ PayForge Enterprise DB ready:', dbPath);
module.exports = db;
