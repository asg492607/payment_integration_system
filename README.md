# ⚡ PayForge Enterprise — Multi-Tenant UPI Payment Engine

> Enterprise-grade automatic payment verification. No bank APIs. No gateway fees. Pure UPI, powered by Firebase and SMS Forwarding.

---

## 🚀 Overview

PayForge Enterprise is a highly scalable, multi-tenant payment integration system. It allows multiple businesses (merchants) to sign up, configure their own UPI VPA, and embed a simple JS SDK on their websites to collect payments.

When a customer pays via UPI, the merchant's Android phone automatically catches the bank SMS, forwards it securely to the PayForge backend, and instantly verifies the customer's order. 

**Zero manual intervention. Zero API fees.**

---

## 🏗️ Architecture Stack

### 1. Backend (Express.js + Node-Cron)
- **REST API:** Handles authentication, SDK checkouts, admin dashboard stats, and SMS webhook ingestion.
- **Verification Engine:** Matches incoming bank SMS alerts to pending orders using exact paise-level amounts (e.g., ₹499.01).
- **Security:** Strict rate-limiting, DoS protection, string truncation, and reservation lock systems to prevent race conditions.

### 2. Database (Firebase Realtime Database)
- **NoSQL via REST:** Uses `firebase.js` to communicate with Firebase RTDB via direct REST calls for ultra-low latency and low memory overhead.
- **Data Models:** `enterprise_users`, `users` (customers), `orders`, `transactions`, `sms_queue`.

### 3. Frontend & SDK (Vanilla JS)
- **Merchant Dashboard:** A beautiful, responsive dashboard for merchants to view stats, transactions, configure UPI, and manage their API keys.
- **PayForge SDK (`sdk.js`):** A drop-in `<script>` tag that merchants embed on their own websites. It automatically generates a beautiful checkout modal with a QR code and intent links.

### 4. Official Android App (PayForge-App.apk)
- **Background SMS Forwarding:** A lightweight, battery-optimized Android app built specifically for PayForge.
- **Simple Setup:** Merchants just install the app, paste their `Enterprise ID` and `Webhook Secret` from the dashboard, and the app automatically filters and forwards bank credit alerts to the backend.

---

## 🔐 Security Features

We take security seriously. The entire stack has been audited and hardened against modern web threats:

| Feature | Implementation |
|---------|---------------|
| **Multi-Tenant Isolation** | Every order and transaction is strictly scoped to its `enterprise_id` to prevent cross-merchant data leakage. |
| **Storefront DoS Protection** | Strict IP-based rate limiting (5 req/min) on the checkout endpoint to prevent attackers from hoarding paise variations. |
| **Race Condition Locks** | A Firebase-backed reservation system (`active_amounts`) ensures two concurrent checkouts never get the same paise amount. |
| **Stored XSS Prevention** | The entire dashboard strictly escapes all HTML characters (`escapeHtml()`) before rendering customer names or emails. |
| **Payload Truncation** | Backend APIs strictly truncate all incoming strings to 100 characters to prevent memory bloat and database exhaustion attacks. |
| **Ghost Payment Prevention** | The verification engine strictly enforces the presence of a UPI Reference Number (UTR) to prevent fake webhook hits. |
| **Webhook Authentication** | The Android app must provide a matching `x-sms-webhook-secret` header to verify payments. |

---

## 🛠️ Setup & Deployment

### 1. Server Environment (`.env`)
```env
PORT=10000
NODE_ENV=production
ALLOWED_ORIGIN=https://payment-integration-system.onrender.com

# Firebase Configuration
FIREBASE_DB_URL=https://your-project.firebaseio.com
FIREBASE_DB_SECRET=your_firebase_legacy_token
```

### 2. Running Locally
```bash
npm install
npm start
```
The server runs on `http://localhost:3000`. 
- Visit `/` to see the landing page.
- Visit `/login.html` to sign up as a merchant.

### 3. Merchant Onboarding
1. Sign up on the dashboard.
2. Go to **UPI Setup** and enter your VPA (e.g., `yourname@sbi`).
3. Download the **Official App** (`PayForge-App.apk`) to your Android phone.
4. Copy your **Enterprise ID** and **Webhook Secret** from the dashboard into the Android app.
5. Embed the `<script>` tag on your website to start collecting payments!

---

## 📦 Integrating the SDK

Merchants can add the PayForge checkout to their website with just three lines of code:

```html
<script>
  window.PAYFORGE_ENTERPRISE_ID = 'YOUR_ENTERPRISE_ID';
  window.PAYFORGE_SERVER = 'https://payment-integration-system.onrender.com';
</script>
<script src="https://payment-integration-system.onrender.com/sdk.js"></script>

<button onclick="PayForge.pay({ plan:'pro', email:'user@example.com', name:'John Doe' })">
  Buy Now
</button>
```

---

## 📱 Android App Details

The official PayForge APK ensures maximum deliverability of SMS webhooks even when the phone is sleeping. 
- It uses `goAsync()` and background Executors to prevent the Android OS from killing the process during network latency.
- It automatically handles retries if the server is temporarily unreachable.

*Built for absolute performance, scale, and autonomy.*
