# ⚡ PayForge — Self-Verifying UPI Payment Engine

> Enterprise-grade automatic payment verification. No bank APIs. No gateway. Pure UPI.

---

## 🚀 Quick Start

**Prerequisites:** [Node.js 18+](https://nodejs.org/en/download)

```bash
# 1. Install dependencies
npm install

# 2. Configure your UPI VPA in .env
#    UPI_VPA=yourname@upi
#    UPI_PAYEE_NAME=YourService

# 3. Start the server
npm start
```

Or on Windows, just double-click **`start.bat`**

| URL | Description |
|-----|-------------|
| `http://localhost:3000` | Payment Portal |
| `http://localhost:3000/admin.html` | Admin Dashboard |
| Admin Token | `dev_admin_token` (change in `.env`) |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (public/)                        │
│  index.html  →  Plan selection → UPI details → Auto-poll    │
│  admin.html  →  Stats / Transactions / Audit / SMS Test     │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────────────┐
│                 EXPRESS SERVER (server/)                      │
│  POST /api/orders/create  → Generate UPI payment details    │
│  GET  /api/orders/:id     → Poll order status               │
│  POST /api/orders/verify  → Disabled (SMS-only activation)  │
│  POST /api/orders/sms     → Trusted SMS bank alert webhook  │
│  GET  /api/admin/*        → Admin APIs (token-gated)        │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              VERIFICATION ENGINE (engine/)                    │
│                                                              │
│  Only Signal: Trusted Bank SMS                               │
│    Your phone forwards bank SMS → protected POST /sms       │
│                                                              │
│  All signals → verifyPayment():                              │
│    ✓ Order exists & not expired                              │
│    ✓ Exact paise-level amount match                          │
│    ✓ Replay attack check (used_refs table)                   │
│    ✓ Promote order: pending → paid                           │
│    ✓ Activate user: isActive=true                            │
│    ✓ Immutable audit log entry                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  SQLite DATABASE (db/)                        │
│  users         → email, name, is_active, plan, activated_at  │
│  orders        → orderId, amount, plan, status, expires_at   │
│  transactions  → txnId, upiRef, amount, source, verified_at  │
│  audit_log     → immutable event trail (append-only)         │
│  used_refs     → replay attack prevention                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 Security Features

| Feature | Implementation |
|---------|---------------|
| **Tamper-proof Order IDs** | HMAC-SHA256 signature on every order |
| **Replay Attack Prevention** | `used_refs` table — each UTR can only be used once |
| **Daily Unique Amount Matching** | Orders get day-specific paise amounts, e.g. first `₹50.01`, second `₹50.02`, so SMS-only verification can identify the payer |
| **Order Expiry** | Orders expire in 15 min (configurable). Cron job enforces it. |
| **Rate Limiting** | 100 req/15min via `express-rate-limit` |
| **Admin Token Gate** | All admin APIs require `x-admin-token` header |
| **Helmet** | Standard HTTP security headers |

---

## 📡 Verification Signal Flow

### Trusted SMS Bank Alert Parser
Your Android SMS forwarder sends bank credit alerts from your trusted phone number:
```
POST /api/orders/sms
Header: x-sms-webhook-secret: your_sms_secret
{ "sender": "7972133643", "rawText": "Rs.499 credited for ORD-ABC-123. Ref 421234567890. -HDFC" }
```
The engine checks the webhook secret, confirms the sender matches `TRUSTED_SMS_SENDER`, extracts amount + UTR, prevents replay, matches the exact pending payable amount, marks the order paid, and activates the user.

### Auto-Poll (Frontend)
The frontend polls `GET /api/orders/:id` every 3 seconds. Once the trusted SMS webhook marks the order `paid`, the success screen appears automatically.

---

## 🗂️ File Structure

```
payment/
├── public/
│   ├── index.html          # Payment portal (3-step modal)
│   ├── admin.html          # Admin dashboard
│   ├── style.css           # Full design system
│   └── app.js              # Frontend logic
├── server/
│   ├── index.js            # Express app + cron jobs
│   ├── db/
│   │   └── init.js         # SQLite schema + initialization
│   ├── engine/
│   │   ├── upiEngine.js    # UPI link and HMAC signing
│   │   └── verificationEngine.js  # Multi-signal verification
│   └── routes/
│       ├── orders.js       # /api/orders/*
│       └── admin.js        # /api/admin/*
├── .env                    # Configuration
├── package.json
├── start.bat               # Windows one-click launcher
└── README.md
```

---

## ⚙️ Configuration (`.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `UPI_VPA` | Your UPI address | `yourname@upi` |
| `UPI_PAYEE_NAME` | Payee name shown in UPI app | `YourService` |
| `PORT` | Server port | `3000` |
| `HMAC_SECRET` | For order ID signing | `dev_secret` |
| `ADMIN_TOKEN` | Admin dashboard token | `dev_admin_token` |
| `SMS_WEBHOOK_SECRET` | Secret required by SMS webhook | none |
| `TRUSTED_SMS_SENDER` | Phone number allowed to trigger activation | derived from `UPI_VPA` |
| `ORDER_EXPIRY_MINUTES` | Order TTL | `15` |
| `VERIFICATION_POLL_INTERVAL_MS` | Frontend poll interval | `3000` |

---

## 🏛️ Scaling Path

```
Phase 1 (Now):     UPI payment details + trusted SMS webhook verification
Phase 2:           Android SMS listener hardening and delivery retries
Phase 3:           Dedicated device health checks and alerting
Phase 4:           Dynamic VPAs per order (requires bank partnership)
Phase 5:           Optional payment gateway webhook for enterprise
```

---

## 📊 Admin Dashboard

Access at `http://localhost:3000/admin.html`
- Token: `dev_admin_token` (set `ADMIN_TOKEN` in `.env` for production)
- Live stats: revenue, paid orders, active users
- Full transaction log with signal source
- Immutable audit trail
- SMS parser tester

---

*Built with Express + SQLite + vanilla frontend. No external payment gateway required.*
