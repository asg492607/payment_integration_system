
const API = '';
let authToken = '';
let currentUser = null;
let currentOrderFilter = 'all';
let fbListenerActive = false;

// ── Auth Guard ──────────────────────────────────────────
function init() {
  authToken = localStorage.getItem('pf_token') || '';
  if (!authToken) return window.location.href = '/login.html';

  fetchMe();
  setupMobileMenu();
}

async function fetchMe() {
  try {
    const res = await apiFetch('/api/auth/me');
    if (!res.ok) { clearAuth(); return; }
    const data = await res.json();
    currentUser = data.user;
    populateUserUI(data.user, data.stats);
    loadSetupConfig();
    setupFirebaseListener();
    loadDashboardData();
  } catch (e) {
    toast('Connection error. Is the server running?', 'error');
  }
}

function populateUserUI(user, stats) {
  const name = user.name || 'User';
  document.getElementById('sidebar-name').textContent = name;
  document.getElementById('sidebar-email').textContent = user.email;
  document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();

  // Settings page
  if (document.getElementById('set-name')) document.getElementById('set-name').value = name;
  if (document.getElementById('set-email')) document.getElementById('set-email').value = user.email;
  if (document.getElementById('api-enterprise-id')) document.getElementById('api-enterprise-id').textContent = user.id;
  if (document.getElementById('api-webhook-secret')) document.getElementById('api-webhook-secret').textContent = user.sms_webhook_secret || '—';
  const wUrl = `${location.origin}/api/orders/sms`;
  if (document.getElementById('api-webhook-url')) document.getElementById('api-webhook-url').textContent = wUrl;

  // Integration page
  if (document.getElementById('int-enterprise-id')) document.getElementById('int-enterprise-id').textContent = user.id;

  // Setup page fields
  if (document.getElementById('inp-upi-vpa')) document.getElementById('inp-upi-vpa').value = user.upi_vpa || '';
  if (document.getElementById('inp-upi-name')) document.getElementById('inp-upi-name').value = user.upi_payee_name || '';
  if (document.getElementById('inp-company')) document.getElementById('inp-company').value = user.company || '';
  if (document.getElementById('inp-sms-sender')) document.getElementById('inp-sms-sender').value = user.trusted_sms_sender || '';

  // SMS page config
  const webhookUrl = `${location.origin}/api/orders/sms`;
  const wuEl = document.getElementById('webhook-url-val');
  if (wuEl) wuEl.textContent = webhookUrl;
  
  const cashierUrl = `${location.origin}/cashier.html?eid=${user.id}`;
  const cLink = document.getElementById('api-cashier-link');
  if (cLink) cLink.textContent = cashierUrl;
  const cTest = document.getElementById('api-cashier-test');
  if (cTest) cTest.href = cashierUrl;

  const posUrl = `${location.origin}/pos.html?eid=${user.id}`;
  const pLink = document.getElementById('api-pos-link');
  if (pLink) pLink.textContent = posUrl;
  const pTest = document.getElementById('api-pos-test');
  if (pTest) pTest.href = posUrl;

  // Dev API
  const dKey = document.getElementById('dev-api-key');
  if (dKey) dKey.textContent = user.api_key || 'Generate via Setup';
  const dWeb = document.getElementById('dev-webhook-url');
  if (dWeb) dWeb.value = user.merchant_webhook_url || '';

  // Telegram
  const tCmd = document.getElementById('telegram-link-cmd');
  if (tCmd) tCmd.textContent = `/start ${user.id}`;
  const tStatus = document.getElementById('telegram-status');
  if (tStatus) {
    if (user.telegram_chat_id) {
      tStatus.className = 'badge badge-active';
      tStatus.textContent = 'Linked ✅';
    } else {
      tStatus.className = 'badge badge-inactive';
      tStatus.textContent = 'Not Linked';
    }
  }


  document.getElementById('s-revenue').textContent = `₹${(stats.totalRevenue||0).toFixed(2)}`;
  document.getElementById('s-paid').textContent = stats.paidOrders||0;
  document.getElementById('s-pending').textContent = stats.pendingOrders||0;
  document.getElementById('s-users').textContent = stats.activeUsers||0;
  
  loadAnalytics();
  const cfgSec = document.getElementById('cfg-secret');
  if (cfgSec) cfgSec.textContent = user.sms_webhook_secret || '(save UPI config first)';
  const cfgEid = document.getElementById('cfg-enterprise-id');
  if (cfgEid) cfgEid.textContent = user.id;

  const jsonTemplate = document.getElementById('json-body-template');
  if (jsonTemplate) {
    jsonTemplate.innerHTML = `<button class="copy-btn" onclick="copyCodeBlock(this)">Copy</button>{
  "rawText": "[content]",
  "sender":  "[from]",
  "secret":  "${user.sms_webhook_secret || 'YOUR_SECRET_KEY'}",
  "enterprise_id": "${user.id}"
}`;
  }

  // Setup checklist
  updateSetupChecklist(user);

  // Setup banner
  const banner = document.getElementById('setup-banner');
  if (banner) banner.style.display = user.setup_complete ? 'none' : 'flex';

  // Stats
  if (stats) populateStats(stats);
}

function updateSetupChecklist(user) {
  const stepUpi = document.getElementById('step-upi');
  const stepSms = document.getElementById('step-sms-fw');

  if (user.setup_complete && user.upi_vpa) {
    if (stepUpi) { stepUpi.className = 'setup-step completed'; stepUpi.querySelector('.step-num').textContent = '✓'; }
    const badge = document.getElementById('setup-status-badge');
    if (badge) badge.innerHTML = '<span class="badge badge-active">✓ Configured</span>';
  } else {
    if (stepUpi) stepUpi.className = 'setup-step current';
  }
}

function populateStats(s) {
  const el = (id, val) => { const e = document.getElementById(id); if(e) e.textContent = val; };
  el('s-revenue', `₹${Number(s.totalRevenue||0).toLocaleString('en-IN')}`);
  el('s-paid',    s.paidOrders ?? '0');
  el('s-pending', s.pendingOrders ?? '0');
  el('s-users',   s.activeUsers ?? '0');
}

async function loadSetupConfig() {
  try {
    const res = await apiFetch('/api/auth/setup');
    if (!res.ok) return;
    const data = await res.json();
    populateUserUI(data.user, null);
  } catch(e) {}
}

// ── Firebase Real-time Listener ─────────────────────────
function setupFirebaseListener() {
  if (!currentUser?.id) return;

  function trySetup() {
    if (!window._fbReady) return;
    const rtdb  = window._fbRTDB;
    const fbRef = window._fbRef;
    const onChildAdded = window._fbOnChildAdded;

    const eventsRef = fbRef(rtdb, `events/${currentUser.id}`);
    onChildAdded(eventsRef, (snapshot) => {
      const evt = snapshot.val();
      if (!evt) return;
      addEventToFeed(evt);
      if (evt.type === 'PAYMENT_VERIFIED') {
        toast(`💸 Payment verified! ₹${evt.amount} — ${evt.plan}`, 'success');
        
        // Virtual Soundbox
        if (soundboxEnabled) {
          playTTS(`Payment of rupees ${evt.amount} received on ASG Payment Gateway.`);
        }

        // Refresh stats
        fetchMe();
        if (document.getElementById('page-transactions').classList.contains('active')) {
          loadTransactions();
        }
      }
    });

    // Also listen to stats
    const statsRef = fbRef(rtdb, `stats/${currentUser.id}`);
    window._fbOnChildAdded(statsRef, (snapshot) => {
      const stats = snapshot.val();
      if (stats) populateStats(stats);
    });

    fbListenerActive = true;
    console.log('[Firebase] ✅ Real-time listener active for enterprise:', currentUser.id);
  }

  if (window._fbReady) {
    trySetup();
  } else {
    document.addEventListener('firebase-ready', trySetup, { once: true });
  }
}

function addEventToFeed(evt) {
  const feed = document.getElementById('event-feed');
  if (!feed) return;

  // Remove empty state
  const empty = feed.querySelector('.empty-state');
  if (empty) empty.remove();

  const typeColors = { PAYMENT_VERIFIED: 'success', SMS_RECEIVED: 'info', ORDER_CREATED: 'info' };
  const typeLabels = { PAYMENT_VERIFIED: '💸 Payment Verified', SMS_RECEIVED: '📩 SMS Received', ORDER_CREATED: '📦 Order Created' };

  const item = document.createElement('div');
  item.className = 'event-item';
  item.innerHTML = `
    <div class="event-dot ${typeColors[evt.type] || 'info'}"></div>
    <div>
      <div class="event-text">${typeLabels[evt.type] || evt.type}
        ${evt.amount ? `<strong style="color:var(--emerald-lt)">₹${evt.amount}</strong>` : ''}
        ${evt.plan ? `· ${evt.plan}` : ''}
        ${evt.userEmail ? `· ${evt.userEmail}` : ''}
      </div>
      <div class="event-time">${new Date().toLocaleTimeString('en-IN')}</div>
    </div>`;
  feed.insertBefore(item, feed.firstChild);

  // Keep max 20 items
  while (feed.children.length > 20) feed.removeChild(feed.lastChild);
}

function clearEventFeed() {
  const feed = document.getElementById('event-feed');
  if (feed) feed.innerHTML = '<div class="empty-state" style="padding:30px"><div class="ei">📡</div><p>Waiting for events...</p></div>';
}

// ── Analytics (Chart & Top Products) ──────────────────────────────────────
let revChart;
async function loadAnalytics() {
  try {
    const res = await apiFetch('/api/admin/analytics');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;
    
    // 1. Render Chart
    const ctx = document.getElementById('revenueChart');
    if (ctx) {
      if (revChart) revChart.destroy();
      
      Chart.defaults.color = '#94a3b8';
      Chart.defaults.font.family = "'Inter', sans-serif";
      
      revChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.trend.labels,
          datasets: [{
            label: 'Revenue (₹)',
            data: data.trend.data,
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(79,70,229,0.1)',
            borderWidth: 3,
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#818cf8',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: '#4f46e5',
            pointRadius: 4,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, border: { dash: [4,4] } },
            x: { grid: { display: false } }
          },
          interaction: { intersect: false, mode: 'index' }
        }
      });
    }
    
    // 2. Render Top Products
    const wrap = document.getElementById('top-products-wrap');
    if (wrap) {
      if (data.topProducts && data.topProducts.length > 0) {
        wrap.innerHTML = data.topProducts.map((p, i) => `
          <div style="display:flex; justify-content:space-between; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <div style="display:flex; align-items:center; gap: 12px;">
              <div style="width: 24px; height: 24px; background: rgba(79,70,229,0.2); color: #818cf8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold;">${i+1}</div>
              <div>
                <div style="font-weight: 600; font-size: 0.9rem;">${escapeHTML(p.name)}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${p.sold} sold</div>
              </div>
            </div>
            <div style="font-weight: bold; color: var(--text);">₹${p.revenue.toFixed(2)}</div>
          </div>
        `).join('');
      } else {
        wrap.innerHTML = `<div class="empty-state">No product sales yet</div>`;
      }
    }
    
  } catch(e) {
    console.error('Analytics load failed', e);
  }
}

// ── Smart Links ───────────────────────────────────────────────────────────
function generateSmartLink() {
  const amt = document.getElementById('smart-link-amount').value;
  if (!amt || amt <= 0) return showToast('Enter a valid amount', 'error');
  if (!currentUser || !currentUser.id) return showToast('User not loaded', 'error');
  const url = window.location.origin + '/pay/' + currentUser.id + '?amount=' + amt;
  document.getElementById('smart-link-result').style.display = 'block';
  document.getElementById('smart-link-url').textContent = url;
  document.getElementById('smart-link-test').href = url;
}


function updateOverviewUI() {
  const feed = document.getElementById('event-feed');
  if (feed) feed.innerHTML = '<div class="empty-state" style="padding:30px"><div class="ei">📡</div><p>Waiting for events...</p></div>';
}

// ── Dashboard Data ──────────────────────────────────────
async function loadDashboardData() {
  try {
    const res = await apiFetch('/api/admin/stats');
    if (res.ok) {
      const s = await res.json();
      populateStats(s);
    }
    await loadRecentTransactions();
  } catch(e) {}
}

async function loadRecentTransactions() {
  try {
    const res = await apiFetch('/api/admin/transactions?limit=5');
    if (!res.ok) return;
    const data = await res.json();
    const wrap = document.getElementById('recent-txn-wrap');
    if (!wrap) return;
    if (!data.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="ei">💳</div><p>No transactions yet</p></div>';
      return;
    }
    wrap.innerHTML = `<table><thead><tr><th>Order</th><th>User</th><th>Amount</th><th>Date</th></tr></thead>
      <tbody>${data.map(t => `<tr>
        <td><code style="font-size:0.75rem">${esc(t.order_id?.slice(0,16))}…</code></td>
        <td><div style="font-size:0.8rem">${esc(t.name||'—')}</div><div style="font-size:0.72rem;color:var(--text-3)">${esc(t.email||'')}</div></td>
        <td style="color:var(--emerald-lt);font-weight:700">₹${t.order_amount}</td>
        <td style="font-size:0.75rem;color:var(--text-3)">${fmt(t.verified_at)}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch(e) {}
}

// ── Transactions ────────────────────────────────────────
async function loadTransactions() {
  try {
    const res = await apiFetch('/api/admin/transactions?limit=100');
    const wrap = document.getElementById('txn-wrap');
    if (!res.ok) { wrap.innerHTML = '<div class="empty-state"><div class="ei">⚠️</div><p>Failed to load</p></div>'; return; }
    const data = await res.json();
    if (!data.length) { wrap.innerHTML = '<div class="empty-state"><div class="ei">💳</div><p>No transactions yet</p></div>'; return; }
    wrap.innerHTML = `<table><thead><tr><th>Order ID</th><th>Customer</th><th>Plan</th><th>Amount</th><th>UPI Ref</th><th>Source</th><th>Date</th></tr></thead>
      <tbody>${data.map(t=>`<tr>
        <td><code>${esc(t.order_id)}</code></td>
        <td><div>${esc(t.name||'—')}</div><div style="font-size:0.72rem;color:var(--text-3)">${esc(t.email||'')}</div></td>
        <td>${esc((t.plan||'—').toUpperCase())}</td>
        <td style="color:var(--emerald-lt);font-weight:700">₹${t.order_amount}</td>
        <td><code>${esc(t.upi_ref||'—')}</code></td>
        <td><span class="badge ${t.signal_source?.includes('sms')?'badge-sms':'badge-paid'}">${esc(t.signal_source||'manual')}</span></td>
        <td style="font-size:0.75rem;color:var(--text-3)">${fmt(t.verified_at)}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch(e) { toast('Failed to load transactions','error'); }
}

// ── Orders ──────────────────────────────────────────────
async function loadOrders(status='all') {
  currentOrderFilter = status;
  try {
    const q = status !== 'all' ? `?status=${status}&limit=100` : '?limit=100';
    const res = await apiFetch(`/api/admin/orders${q}`);
    const wrap = document.getElementById('orders-wrap');
    if (!res.ok) { wrap.innerHTML = '<div class="empty-state"><div class="ei">⚠️</div><p>Failed</p></div>'; return; }
    const data = await res.json();
    window.allOrdersRaw = data;
    if (!data.length) { wrap.innerHTML = `<div class="empty-state"><div class="ei">📦</div><p>No ${status !== 'all' ? status : ''} orders</p></div>`; return; }
    wrap.innerHTML = `<table><thead><tr><th>Order ID</th><th>Customer</th><th>Plan</th><th>Amount</th><th>Status</th><th>Expires</th><th>Created</th></tr></thead>
      <tbody>${data.map(o=>`<tr>
        <td><code>${esc(o.id)}</code></td>
        <td><div>${esc(o.name||'—')}</div><div style="font-size:0.72rem;color:var(--text-3)">${esc(o.email||'')}</div></td>
        <td>${esc((o.plan||'—').toUpperCase())}</td>
        <td style="font-weight:600">₹${o.amount}</td>
        <td><span class="badge badge-${o.status}">${o.status.toUpperCase()}</span></td>
        <td style="font-size:0.75rem;color:var(--text-3)">${fmt(o.expires_at)}</td>
        <td style="font-size:0.75rem;color:var(--text-3)">${fmt(o.created_at)}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch(e) { toast('Failed to load orders','error'); }
}

function filterOrders(status, btn) {
  document.querySelectorAll('.tabs .tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  loadOrders(status);
}

// ── Customers ───────────────────────────────────────────
async function loadCustomers() {
  try {
    const res = await apiFetch('/api/admin/customers');
    const wrap = document.getElementById('customers-wrap');
    if (!res.ok) { wrap.innerHTML = '<div class="empty-state"><div class="ei">⚠️</div><p>Failed</p></div>'; return; }
    const data = await res.json();
    if (!data.length) { wrap.innerHTML = '<div class="empty-state"><div class="ei">👥</div><p>No customers yet. Share your payment link!</p></div>'; return; }
    wrap.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>LTV (Total Spent)</th><th>Status</th><th>Activated</th><th>Joined</th></tr></thead>
      <tbody>${data.map(u=>`<tr>
        <td>
          ${esc(u.name)}
          ${u.is_vip ? '<span class="badge" style="background:rgba(234,179,8,0.2);color:#eab308;border:1px solid rgba(234,179,8,0.4)">👑 VIP</span>' : ''}
        </td>
        <td style="color:var(--text-2)">${esc(u.email)}</td>
        <td style="font-weight:700;color:var(--emerald-lt)">₹${(u.ltv||0).toFixed(2)}</td>
        <td><span class="badge ${u.is_active?'badge-active':'badge-inactive'}">${u.is_active?'Active':'Inactive'}</span></td>
        <td style="font-size:0.75rem;color:var(--text-3)">${fmt(u.activated_at)}</td>
        <td style="font-size:0.75rem;color:var(--text-3)">${fmt(u.created_at)}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch(e) { toast('Failed to load customers','error'); }
}

// ── UPI Setup Save ──────────────────────────────────────
async function saveSetup() {
  const vpa    = document.getElementById('inp-upi-vpa').value.trim();
  const name   = document.getElementById('inp-upi-name').value.trim();
  const sender = document.getElementById('inp-sms-sender').value.trim();
  const company= document.getElementById('inp-company').value.trim();

  if (!vpa) { toast('UPI ID is required','error'); return; }

  const btn = document.getElementById('btn-save-setup');
  btn.textContent = 'Saving...'; btn.disabled = true;

  try {
    const res = await apiFetch('/api/auth/setup', {
      method: 'PUT',
      body: JSON.stringify({ upi_vpa: vpa, upi_payee_name: name, trusted_sms_sender: sender, company }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Save failed', 'error'); return; }

    currentUser = data.user;
    populateUserUI(data.user, null);
    toast('✅ UPI configuration saved!', 'success');
  } catch(e) { toast('Save failed. Is the server running?','error'); }
  finally { btn.textContent = '💾 Save Configuration'; btn.disabled = false; }
}

// ── SMS Webhook Test ────────────────────────────────────
async function testSmsWebhook() {
  const orderId = document.getElementById('test-order-id').value.trim();
  const sender  = document.getElementById('test-sender').value.trim();
  const rawText = document.getElementById('test-sms-text').value.trim();
  const result  = document.getElementById('sms-test-result');

  if (!sender || !rawText) { toast('Sender and SMS text are required','error'); return; }

  try {
    const res = await fetch(`${API}/api/orders/sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sms-webhook-secret': currentUser?.sms_webhook_secret || ''
      },
      body: JSON.stringify({
        orderId: orderId || undefined,
        sender,
        rawText,
        enterprise_id: currentUser?.id,
      }),
    });
    const data = await res.json();
    result.style.display = 'block';
    const ok = data.success;
    result.innerHTML = `<div class="alert ${ok?'alert-success':'alert-danger'}">
      <strong>${ok ? '✅ Verified!' : '❌ Failed'}</strong> ${esc(data.message || data.error || '')}
      ${data.parsed ? `<br/><br/><strong>Parsed:</strong> Amount=₹${data.parsed.amount}, Ref=${data.parsed.ref||'—'}` : ''}
    </div>`;
    if (ok) { toast('Payment verified & service activated!','success'); loadDashboardData(); }
    else toast(data.message || data.error || 'Verification failed','error');
  } catch(e) { toast('Network error','error'); }
}

async function clearPendingOrders() {
  if (!confirm('Are you sure you want to permanently delete all Pending and Expired orders?')) return;
  try {
    const res = await apiFetch('/api/admin/orders/pending', { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      toast(`Cleared ${data.deleted} orders!`, 'success');
      loadOrders(currentOrderFilter);
    } else {
      toast(data.error || 'Failed to clear orders', 'error');
    }
  } catch(e) {
    toast('Network error', 'error');
  }
}

async function generateTestOrder() {
  try {
    const res = await apiFetch('/api/admin/orders/test', { method: 'POST' });
    if (res.ok) {
      toast('Test order created!', 'success');
      loadOrders(currentOrderFilter);
    } else {
      toast('Failed to create test order', 'error');
    }
  } catch(e) { toast('Network error', 'error'); }
}

async function fillSampleSms() {
  try {
    const res = await apiFetch('/api/admin/orders');
    const orders = await res.json();
    const pending = orders.find(o => o.status === 'pending');
    if (pending) {
      document.getElementById('test-sms-text').value =
        `Your a/c XXXXXX is credited by Rs.${pending.amount} on 24-05-26. Ref 421234567890. -HDFC Bank`;
      toast(`Filled sample for Order ${pending.id}`, 'success');
    } else {
      document.getElementById('test-sms-text').value =
        'Your a/c XXXXXX is credited by Rs.99.01 on 24-05-26. Ref 421234567890. -HDFC Bank';
      toast('No pending order found. Using default text.', 'warn');
    }
  } catch(e) {
    document.getElementById('test-sms-text').value =
      'Your a/c XXXXXX is credited by Rs.99.01 on 24-05-26. Ref 421234567890. -HDFC Bank';
  }
}

// ── Settings ────────────────────────────────────────────
async function changePassword() {
  const curr = document.getElementById('set-curr-pass').value;
  const nw   = document.getElementById('set-new-pass').value;
  if (!curr || !nw) { toast('Both fields required','error'); return; }
  if (nw.length < 8) { toast('New password must be 8+ chars','error'); return; }
  try {
    const res = await apiFetch('/api/auth/password', {
      method:'PUT', body: JSON.stringify({ current_password: curr, new_password: nw })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error||'Failed','error'); return; }
    toast('Password updated successfully!','success');
    document.getElementById('set-curr-pass').value = '';
    document.getElementById('set-new-pass').value  = '';
  } catch(e) { toast('Error updating password','error'); }
}

// ── Developer API ─────────────────────────────────────────────────────────────
async function saveWebhookUrl() {
  const url = document.getElementById('dev-webhook-url').value.trim();
  if (url && !url.startsWith('http')) return toast('Webhook must start with http/https', 'error');
  try {
    const res = await apiFetch('/api/auth/setup', {
      method: 'PUT',
      body: JSON.stringify({ merchant_webhook_url: url })
    });
    if (res.ok) toast('Webhook URL saved!', 'success');
    else toast('Failed to save webhook', 'error');
  } catch(e) { toast('Error saving webhook', 'error'); }
}

// ── Integration tabs ────────────────────────────────────
function switchIntegTab(name, btn) {
  ['create','poll','embed','firebase'].forEach(t => {
    const el = document.getElementById(`integ-${t}`);
    if (el) el.style.display = t === name ? 'block' : 'none';
  });
  document.querySelectorAll('#page-integrate .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ── Navigation ──────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add('active');
  const nav = document.getElementById(`nav-${name}`);
  if (nav) nav.classList.add('active');

  // ── Smart POS Logic ─────────────────────────────────────────────────────────
async function pushToPOS() {
  const amount = document.getElementById('pos-amount').value.trim();
  if(!amount || isNaN(amount)) return toast('Enter a valid amount', 'error');
  
  // 1. First create an order to get the UPI link
  try {
    toast('Generating dynamic QR...', 'info');
    const res = await apiFetch('/api/orders/create', {
      method: 'POST',
      body: JSON.stringify({ name: 'POS Customer', email: 'pos@local', plan: 'custom', enterprise_id: currentUser.id, amount })
    });
    const orderData = await res.json();
    if(!res.ok) return toast(orderData.error || 'Failed to create order', 'error');

    // 2. Push state to POS screen
    const pushRes = await apiFetch('/api/admin/pos/push', {
      method: 'POST',
      body: JSON.stringify({ amount, orderId: orderData.orderId, upiLink: orderData.upiLink })
    });
    if(pushRes.ok) {
      toast('🚀 Sent to Customer Display!', 'success');
      document.getElementById('pos-amount').value = '';
    } else {
      toast('Failed to push to POS', 'error');
    }
  } catch(e) { toast('Error pushing to POS', 'error'); }
}

async function clearPOS() {
  try {
    await apiFetch('/api/admin/pos/clear', { method: 'POST' });
    toast('POS Screen reset to idle', 'success');
  } catch(e) { toast('Failed to clear POS', 'error'); }
}

// ── Catalog & Cash Register (POS) ───────────────────────────────────────────
let currentCatalog = [];
let currentCart = [];

async function loadCatalog() {
  try {
    const res = await apiFetch('/api/admin/catalog');
    if (!res.ok) throw new Error();
    const data = await res.json();
    currentCatalog = data.products || [];
    renderCatalogTable();
    renderCashRegisterProducts();
  } catch (e) {
    document.getElementById('catalog-wrap').innerHTML = `<div class="empty-state">Error loading catalog</div>`;
  }
}

function renderCatalogTable() {
  const wrap = document.getElementById('catalog-wrap');
  if (!currentCatalog.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="ei">📦</div><p>Your catalog is empty.</p></div>`;
    return;
  }
  let html = `<table class="table"><thead><tr><th>Name</th><th>Type</th><th>Price</th><th>Actions</th></tr></thead><tbody>`;
  currentCatalog.forEach(p => {
    html += `<tr>
      <td><strong>${escapeHTML(p.name)}</strong></td>
      <td><span class="badge ${p.type === 'service' ? 'badge-active' : 'badge-inactive'}">${p.type}</span></td>
      <td>₹${p.price}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">Delete</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

async function saveProduct() {
  const name = document.getElementById('cat-prod-name').value.trim();
  const price = document.getElementById('cat-prod-price').value;
  const type = document.getElementById('cat-prod-type').value;
  if (!name || !price) return toast('Name and price are required', 'error');
  
  try {
    const res = await apiFetch('/api/admin/catalog', {
      method: 'POST',
      body: JSON.stringify({ name, price, type })
    });
    if (res.ok) {
      toast('Product added', 'success');
      document.getElementById('cat-prod-name').value = '';
      document.getElementById('cat-prod-price').value = '';
      loadCatalog();
    } else throw new Error();
  } catch (e) { toast('Error saving product', 'error'); }
}

async function deleteProduct(id) {
  if(!confirm('Delete this product?')) return;
  try {
    const res = await apiFetch(`/api/admin/catalog/${id}`, { method: 'DELETE' });
    if(res.ok) loadCatalog();
  } catch(e) { toast('Error deleting', 'error'); }
}

function renderCashRegisterProducts() {
  const grid = document.getElementById('cash-register-products');
  if(!grid) return;
  if (!currentCatalog.length) {
    grid.innerHTML = `<div class="empty-state" style="padding:10px;grid-column:1/-1;">No products found. Add them in the Catalog tab.</div>`;
    return;
  }
  let html = '';
  currentCatalog.forEach(p => {
    html += `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;cursor:pointer;transition:0.2s;" 
      onmouseover="this.style.borderColor='var(--indigo)'" onmouseout="this.style.borderColor='var(--border)'"
      onclick="addToCart('${p.id}')">
      <div style="font-weight:700;font-size:0.85rem;margin-bottom:8px;">${escapeHTML(p.name)}</div>
      <div style="color:var(--indigo-lt);font-weight:bold;font-size:0.9rem;">₹${p.price}</div>
    </div>`;
  });
  grid.innerHTML = html;
}

function addToCart(productId) {
  const p = currentCatalog.find(x => x.id === productId);
  if(!p) return;
  const existing = currentCart.find(x => x.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    currentCart.push({ ...p, qty: 1 });
  }
  renderCart();
}

function removeFromCart(productId) {
  currentCart = currentCart.filter(x => x.id !== productId);
  renderCart();
}

function clearCart() {
  currentCart = [];
  renderCart();
}

function renderCart() {
  const cartEl = document.getElementById('cash-register-cart');
  const totalEl = document.getElementById('cash-register-total');
  if(!cartEl || !totalEl) return;
  
  if (!currentCart.length) {
    cartEl.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:0.8rem;margin-top:20px;">Cart is empty</div>`;
    totalEl.textContent = '₹0.00';
    return;
  }
  
  let html = '';
  let total = 0;
  currentCart.forEach(item => {
    const itemTotal = item.qty * parseFloat(item.price);
    total += itemTotal;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;">
        <div style="font-size:0.8rem;font-weight:600;">${escapeHTML(item.name)}</div>
        <div style="font-size:0.75rem;color:var(--text-3);">${item.qty} x ₹${item.price}</div>
      </div>
      <div style="font-weight:bold;font-size:0.85rem;margin-right:8px;">₹${itemTotal.toFixed(2)}</div>
      <button class="mini-copy" style="color:#ef4444" onclick="removeFromCart('${item.id}')">✖</button>
    </div>`;
  });
  cartEl.innerHTML = html;
  totalEl.textContent = `₹${total.toFixed(2)}`;
}

async function pushCartToPOS() {
  if (!currentCart.length) return toast('Cart is empty', 'error');
  const total = currentCart.reduce((sum, item) => sum + (item.qty * parseFloat(item.price)), 0);
  
  try {
    const res = await apiFetch('/api/admin/pos/push', {
      method: 'POST',
      body: JSON.stringify({ 
        amount: total.toFixed(2), 
        cartItems: currentCart 
      })
    });
    if (res.ok) toast('Pushed to POS!', 'success');
    else toast('Failed to push', 'error');
  } catch (e) { toast('Error', 'error'); }
}

// ── INIT ──────────────────────────────────────────────────────────────────
  const titles = {
    overview:'Dashboard', transactions:'Transactions', orders:'Orders',
    customers:'Customers', catalog:'Product Catalog', setup:'UPI Setup', sms:'SMS Forwarder',
    devices:'Device Status', fallback:'Fallback Systems', integrate:'Integration Guide',
    settings:'Settings', developer: 'Developer API'
  };
  document.getElementById('topbar-title').textContent = titles[name] || name;

  // Lazy load
  if (name === 'transactions') loadTransactions();
  else if (name === 'orders')  loadOrders(currentOrderFilter);
  else if (name === 'customers') loadCustomers();
  else if (name === 'catalog') loadCatalog();

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
}

// ── Helpers ─────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  return fetch(`${API}${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      ...(opts.headers || {}),
    },
    body: opts.body,
  });
}

function clearAuth() {
  localStorage.removeItem('pf_token');
  localStorage.removeItem('pf_user');
  window.location.href = '/login.html';
}

function logout() {
  apiFetch('/api/auth/logout', { method:'POST' }).catch(()=>{});
  clearAuth();
}

function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
}

function copyText(id, label) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent.trim())
    .then(() => toast(`${label} copied!`, 'success'))
    .catch(() => toast('Copy failed', 'error'));
}

function copyCodeBlock(btn) {
  const block = btn.parentElement;
  const text = block.innerText.replace('Copy','').trim();
  navigator.clipboard.writeText(text)
    .then(() => { btn.textContent = '✓ Copied'; setTimeout(()=>btn.textContent='Copy',2000); })
    .catch(() => toast('Copy failed','error'));
}

function toast(msg, type='info') {
  const icons = { success:'✅', error:'❌', info:'ℹ️', warn:'⚠️' };
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(()=>el.remove(),400); }, 4000);
}

function setupMobileMenu() {
  const btn = document.getElementById('menu-btn');
  if (window.innerWidth <= 768 && btn) btn.style.display = 'block';
  window.addEventListener('resize', () => {
    if (btn) btn.style.display = window.innerWidth <= 768 ? 'block' : 'none';
  });
}

// ── EXPORT CSV ──────────────────────────────────────────────────────────────
function exportTransactionsCSV() {
  if (!allTransactions || allTransactions.length === 0) return toast('No transactions to export', 'error');
  let csv = 'Transaction ID,Order ID,Amount,Currency,Plan,Status,Verified By,Timestamp\n';
  allTransactions.forEach(t => {
    const verifiedBy = (t.upi_ref && t.upi_ref.startsWith('RZR')) ? 'Razorpay' :
                       (t.upi_ref && t.upi_ref.startsWith('CSH')) ? 'Cashfree' :
                       (t.upi_ref && t.upi_ref.startsWith('M-')) ? 'Manual' :
                       (t.upi_ref && t.upi_ref.startsWith('BOT')) ? 'Telegram' : 'SMS/Engine';
    csv += `${t.id},${t.order_id},${t.amount},INR,${t.plan||''},${t.status},${verifiedBy},${t.created_at}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', `ASG Payment Gateway_Transactions_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(a);
  document.body.removeChild(a);
}

function exportOrdersCSV() {
  if (!window.allOrdersRaw || window.allOrdersRaw.length === 0) return toast('No orders to export', 'error');
  let csv = 'Order ID,Customer Email,Amount,Status,UPI Link,Created At,Reminded\n';
  window.allOrdersRaw.forEach(o => {
    // Escape possible commas in upi_link or email
    const email = o.user_id ? o.user_id : '';
    const link = o.upi_link ? `"${o.upi_link}"` : '';
    csv += `${o.id},${email},${o.amount},${o.status},${link},${o.created_at},${o.reminded || false}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', `ASG Payment Gateway_Orders_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// -- Plans Management --------------------------------------------------------
async function loadPlans() {
  try {
    const response = await apiFetch('/api/admin/plans');
    const wrap = document.getElementById('plans-wrap');
    if (!response.ok) throw new Error('Failed to fetch plans');
    const res = await response.json();
    if (res.error) throw new Error(res.error);
    if (!res.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="ei">🏷️</div><p>No custom plans created yet.</p></div>`;
      return;
    }
    
    let html = `<table><thead><tr><th>Plan Code</th><th>Display Name</th><th>Amount</th><th>Duration</th><th>Action</th></tr></thead><tbody>`;
    res.forEach(p => {
      html += `<tr>
        <td><code>` + p.plan_code + `</code></td>
        <td><strong>` + p.label + `</strong></td>
        <td>₹` + p.amount + `</td>
        <td>` + p.duration + `</td>
        <td><button class="btn btn-danger btn-sm" onclick="deletePlan('` + p.id + `')">Delete</button></td>
      </tr>`;
    });
    html += `</tbody></table>`;
    wrap.innerHTML = html;
  } catch (err) {
    document.getElementById('plans-wrap').innerHTML = `<div class="empty-state"><p style="color:var(--rose)">Failed to load plans.</p></div>`;
  }
}

async function createPlan() {
  const code = document.getElementById('inp-plan-code').value.trim();
  const label = document.getElementById('inp-plan-label').value.trim();
  const amount = document.getElementById('inp-plan-amount').value.trim();
  const duration = document.getElementById('inp-plan-duration').value.trim();
  
  if (!code || !label || !amount) return toast('Code, Label, and Amount are required', 'error');
  
  try {
    const response = await apiFetch('/api/admin/plans', {
      method: 'POST',
      body: JSON.stringify({ plan_code: code, label, amount, duration })
    });
    if (!response.ok) throw new Error('Failed to create plan');
    const res = await response.json();
    if (res.error) throw new Error(res.error);
    toast('Plan created successfully!', 'success');
    document.getElementById('inp-plan-code').value = '';
    document.getElementById('inp-plan-label').value = '';
    document.getElementById('inp-plan-amount').value = '';
    document.getElementById('inp-plan-duration').value = '';
    loadPlans();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deletePlan(id) {
  if (!confirm('Are you sure you want to delete this plan?')) return;
  try {
    const response = await apiFetch('/api/admin/plans/' + id, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete plan');
    const res = await response.json();
    if (res.error) throw new Error(res.error);
    toast('Plan deleted', 'info');
    loadPlans();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Add loadPlans to showPage if page is plans
const originalShowPage = showPage;
showPage = function(page) {
  originalShowPage(page);
  if (page === 'plans') loadPlans();
  if (page === 'devices') loadDeviceStatus();
  if (page === 'fallback') populateFallbackPage();
};

// ── Device Status ──────────────────────────────────────────────────────────
async function loadDeviceStatus() {
  const wrap = document.getElementById('devices-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-state"><div class="ei">⏳</div><p>Loading...</p></div>';
  try {
    const r = await apiFetch('/api/heartbeat/status');
    if (!r.ok) { wrap.innerHTML = '<div class="empty-state"><div class="ei">⚠️</div><p>Could not load device status.</p></div>'; return; }
    const data = await r.json();
    if (!data.devices || data.devices.length === 0) {
      wrap.innerHTML = `<div class="alert alert-warn">
        ⚠️ No devices registered yet. Install the ASG Payment Gateway Android App and configure your Enterprise ID + Webhook Secret.
        <br><br><button class="btn btn-ghost btn-sm" onclick="showPage('sms')">Go to SMS Forwarder →</button>
      </div>`;
      document.getElementById('layer1-status').className = 'badge badge-inactive';
      document.getElementById('layer1-status').textContent = 'No device';
      return;
    }
    const onlineCount = data.devices.filter(d => d.is_online).length;
    wrap.innerHTML = `
      <div style="display:grid;gap:12px">
        ${data.devices.map(d => `
          <div style="display:flex;align-items:center;gap:16px;padding:18px;border-radius:var(--radius);
            background:var(--surface);border:1px solid ${d.is_online ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}">
            <div style="font-size:2rem">${d.is_online ? '🟢' : '🔴'}</div>
            <div style="flex:1">
              <div style="font-size:0.95rem;font-weight:700">${d.label || d.id}</div>
              <div style="font-size:0.78rem;color:var(--text-2);margin-top:2px">
                ${d.is_online
                  ? `Online — last seen ${d.minutes_ago === 0 ? 'just now' : d.minutes_ago + ' min ago'}`
                  : `OFFLINE — last seen ${d.minutes_ago ? d.minutes_ago + ' min ago' : 'never'}`}
                ${d.battery != null ? ` • Battery: ${d.battery}%` : ''}
                ${d.network ? ` • ${d.network}` : ''}
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="removeDevice('${d.id}')">Remove</button>
          </div>
        `).join('')}
      </div>
      <p style="font-size:0.78rem;color:var(--text-3);margin-top:12px">
        ${onlineCount}/${data.devices.length} device(s) online. Devices ping every 5 minutes.
      </p>`;
    const l1 = document.getElementById('layer1-status');
    if (l1) { l1.className = onlineCount > 0 ? 'badge badge-active' : 'badge badge-inactive'; l1.textContent = onlineCount > 0 ? `${onlineCount} Online` : 'All Offline'; }
  } catch(e) { wrap.innerHTML = '<div class="empty-state"><div class="ei">❌</div><p>Error loading devices.</p></div>'; }
}

async function removeDevice(deviceId) {
  if (!confirm('Remove this device?')) return;
  const r = await apiFetch(`/api/heartbeat/${deviceId}`, { method: 'DELETE' });
  if (r.ok) { showToast('Device removed', 'success'); loadDeviceStatus(); }
  else showToast('Failed to remove device', 'error');
}

// ── Fallback Page Tabs ────────────────────────────────────────────────────
function switchFallbackTab(name, btn) {
  ['razorpay','cashfree','email','telegram','utr'].forEach(t => {
    const el = document.getElementById('fallback-' + t);
    if (el) el.style.display = t === name ? 'block' : 'none';
  });
  document.querySelectorAll('#page-fallback > .tabs .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function switchUtrTab(name, btn) {
  ['by-utr','by-amount','force'].forEach(t => {
    const el = document.getElementById('utr-' + t);
    if (el) el.style.display = t === name ? 'block' : 'none';
  });
  document.querySelectorAll('#fallback-utr .tabs .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function populateFallbackPage() {
  // Set Telegram link command
  const tgEl = document.getElementById('tg-link-cmd');
  if (tgEl && currentUser) tgEl.textContent = `/start ${currentUser.id}`;
  // Populate email fields if already configured
  if (currentUser) {
    if (currentUser.razorpay_webhook_secret) document.getElementById('inp-razorpay-secret').value = currentUser.razorpay_webhook_secret;
    const rzpWebhookUrl = window.location.origin + '/api/webhooks/razorpay/' + currentUser.id;
    const rzpUrlEl = document.getElementById('razorpay-webhook-url');
    if (rzpUrlEl) rzpUrlEl.textContent = rzpWebhookUrl;

    if (currentUser.cashfree_webhook_secret) document.getElementById('inp-cashfree-secret').value = currentUser.cashfree_webhook_secret;
    const cfWebhookUrl = window.location.origin + '/api/webhooks/cashfree/' + currentUser.id;
    const cfUrlEl = document.getElementById('cashfree-webhook-url');
    if (cfUrlEl) cfUrlEl.textContent = cfWebhookUrl;
    
    if (currentUser.email_imap_user) document.getElementById('inp-imap-user').value = currentUser.email_imap_user;
    if (currentUser.email_imap_host) document.getElementById('inp-imap-host').value = currentUser.email_imap_host;
    if (currentUser.email_imap_port) document.getElementById('inp-imap-port').value = currentUser.email_imap_port;
  }
  // Update layer 2 (email) status in devices page
  const l2 = document.getElementById('layer2-status');
  if (l2) { const hasEmail = _state.user?.email_imap_user; l2.className = hasEmail ? 'badge badge-active' : 'badge badge-inactive'; l2.textContent = hasEmail ? 'Configured' : 'Not Set'; }
  const l3 = document.getElementById('layer3-status');
  if (l3) { l3.className = 'badge badge-pending'; l3.textContent = 'Set TELEGRAM_BOT_TOKEN'; }
}

// ── Save Razorpay Webhook ─────────────────────────────────────────────────
async function saveRazorpaySecret() {
  const secret = document.getElementById('inp-razorpay-secret').value.trim();
  if (!secret) return showToast('Please enter a Webhook Secret', 'error');
  const btn = event.target; btn.classList.add('btn-loading'); btn.textContent = 'Saving...';
  try {
    const r = await apiFetch('/api/auth/setup', { method: 'PUT', body: JSON.stringify({
      upi_vpa: _state.user.upi_vpa || 'placeholder@upi',
      razorpay_webhook_secret: secret
    })});
    const d = await r.json();
    if (d.success || d.user) { showToast('✅ Razorpay Webhook Secret saved!', 'success'); if (d.user) _state.user = d.user; }
    else showToast(d.error || 'Failed to save', 'error');
  } catch(e) { showToast('Network error', 'error'); }
  finally { btn.classList.remove('btn-loading'); btn.textContent = '💾 Save Razorpay Secret'; }
}

// ── Save Cashfree Webhook ─────────────────────────────────────────────────
async function saveCashfreeSecret() {
  const secret = document.getElementById('inp-cashfree-secret').value.trim();
  if (!secret) return showToast('Please enter a Webhook Secret', 'error');
  const btn = event.target; btn.classList.add('btn-loading'); btn.textContent = 'Saving...';
  try {
    const r = await apiFetch('/api/auth/setup', { method: 'PUT', body: JSON.stringify({
      upi_vpa: _state.user.upi_vpa || 'placeholder@upi',
      cashfree_webhook_secret: secret
    })});
    const d = await r.json();
    if (d.success || d.user) { showToast('✅ Cashfree Webhook Secret saved!', 'success'); if (d.user) _state.user = d.user; }
    else showToast(d.error || 'Failed to save', 'error');
  } catch(e) { showToast('Network error', 'error'); }
  finally { btn.classList.remove('btn-loading'); btn.textContent = '💾 Save Cashfree Secret'; }
}

// ── Save Email Fallback ───────────────────────────────────────────────────
async function saveEmailFallback() {
  const user = document.getElementById('inp-imap-user').value.trim();
  const pass = document.getElementById('inp-imap-pass').value.trim();
  const host = document.getElementById('inp-imap-host').value.trim() || 'imap.gmail.com';
  const port = document.getElementById('inp-imap-port').value || 993;
  if (!user || !pass) return showToast('Email and App Password are required', 'error');
  if (!user.includes('@')) return showToast('Enter a valid email address', 'error');
  const btn = event.target; btn.classList.add('btn-loading'); btn.textContent = 'Saving...';
  try {
    const r = await apiFetch('/api/auth/setup', { method: 'PUT', body: JSON.stringify({
      upi_vpa: _state.user.upi_vpa || 'placeholder@upi',
      email_imap_user: user, email_imap_pass: pass, email_imap_host: host, email_imap_port: port
    })});
    const d = await r.json();
    if (d.success || d.user) { showToast('✅ Email fallback saved! Server will poll every 2 minutes.', 'success'); if (d.user) _state.user = d.user; }
    else showToast(d.error || 'Failed to save', 'error');
  } catch(e) { showToast('Network error', 'error'); }
  finally { btn.classList.remove('btn-loading'); btn.textContent = '💾 Save Email Fallback'; }
}

// ── Manual UTR Verification ───────────────────────────────────────────────
async function verifyByUtr() {
  const orderId = document.getElementById('mutr-order-id').value.trim();
  const utr = document.getElementById('mutr-utr').value.trim();
  const resEl = document.getElementById('utr-result-1');
  if (!orderId || !utr) return showToast('Order ID and UTR are required', 'error');
  resEl.style.display = 'none';
  const btn = event.target; btn.classList.add('btn-loading'); btn.textContent = 'Verifying...';
  try {
    const r = await apiFetch('/api/admin/verify-utr', { method: 'POST', body: JSON.stringify({ order_id: orderId, utr }) });
    const d = await r.json();
    resEl.style.display = 'block';
    resEl.innerHTML = d.success
      ? `<div class="alert alert-success">✅ ${d.message}<br><small>Transaction ID: ${d.txnId}</small></div>`
      : `<div class="alert alert-danger">❌ ${d.error || 'Verification failed'}</div>`;
  } catch(e) { resEl.style.display = 'block'; resEl.innerHTML = '<div class="alert alert-danger">❌ Network error</div>'; }
  finally { btn.classList.remove('btn-loading'); btn.textContent = '✅ Verify Payment'; }
}

async function verifyByAmount() {
  const amount = document.getElementById('mutr-amount').value.trim();
  const utr = document.getElementById('mutr-utr2').value.trim();
  const resEl = document.getElementById('utr-result-2');
  if (!amount || !utr) return showToast('Amount and UTR are required', 'error');
  resEl.style.display = 'none';
  const btn = event.target; btn.classList.add('btn-loading'); btn.textContent = 'Searching...';
  try {
    const r = await apiFetch('/api/admin/verify-amount', { method: 'POST', body: JSON.stringify({ amount, utr }) });
    const d = await r.json();
    resEl.style.display = 'block';
    resEl.innerHTML = d.success
      ? `<div class="alert alert-success">✅ ${d.message}<br><small>Order: ${d.orderId} | TxnID: ${d.txnId}</small></div>`
      : `<div class="alert alert-danger">❌ ${d.error || 'Not found'}</div>`;
  } catch(e) { resEl.style.display = 'block'; resEl.innerHTML = '<div class="alert alert-danger">❌ Network error</div>'; }
  finally { btn.classList.remove('btn-loading'); btn.textContent = '🔍 Find & Verify'; }
}

async function forceMarkPaid() {
  const orderId = document.getElementById('force-order-id').value.trim();
  const utr = document.getElementById('force-utr').value.trim();
  const reason = document.getElementById('force-reason').value.trim();
  const resEl = document.getElementById('utr-result-3');
  if (!orderId) return showToast('Order ID is required', 'error');
  if (!confirm('⚠️ Are you sure you want to FORCE mark this order as paid? Only do this if you have CONFIRMED the payment in your bank.')) return;
  resEl.style.display = 'none';
  const btn = event.target; btn.classList.add('btn-loading'); btn.textContent = 'Processing...';
  try {
    const r = await apiFetch(`/api/admin/mark-paid/${orderId}`, { method: 'POST', body: JSON.stringify({ utr, reason }) });
    const d = await r.json();
    resEl.style.display = 'block';
    resEl.innerHTML = d.success
      ? `<div class="alert alert-success">✅ Order force-marked as paid. Customer service activated.<br><small>TxnID: ${d.txnId}</small></div>`
      : `<div class="alert alert-danger">❌ ${d.error}</div>`;
  } catch(e) { resEl.style.display = 'block'; resEl.innerHTML = '<div class="alert alert-danger">❌ Network error</div>'; }
  finally { btn.classList.remove('btn-loading'); btn.textContent = '⚠️ Force Mark as Paid'; }
}

async function saveBrandSettings() {
  const brandName = document.getElementById('set-brand-name').value;
  const brandColor = document.getElementById('set-brand-color').value;
  try {
    const res = await fetch('/api/auth/setup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` },
      body: JSON.stringify({ brand_name: brandName, brand_color: brandColor })
    });
    if (res.ok) {
      showToast('Brand settings saved!', 'success');
      currentUser.brand_name = brandName;
      currentUser.brand_color = brandColor;
    } else showToast('Failed to save', 'error');
  } catch (e) { showToast('Error saving settings', 'error'); }
}

// ── Virtual Soundbox ──────────────────────────────────────────────────────
let soundboxEnabled = false;
function toggleSoundbox() {
  soundboxEnabled = !soundboxEnabled;
  const btn = document.getElementById('btn-soundbox');
  if (soundboxEnabled) {
    btn.textContent = '🔊';
    btn.style.opacity = '1';
    playTTS("Virtual Soundbox Activated.");
    showToast('Virtual Soundbox Enabled', 'success');
  } else {
    btn.textContent = '🔇';
    btn.style.opacity = '0.5';
    showToast('Virtual Soundbox Disabled', 'info');
  }
}
function playTTS(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-IN';
  utterance.rate = 1.0;
  window.speechSynthesis.speak(utterance);
}

document.addEventListener('DOMContentLoaded', init);
