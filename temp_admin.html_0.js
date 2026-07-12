
const API = '';
let adminToken = '';

function toast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  const icon = document.createElement('span');
  const text = document.createElement('span');
  el.className = `toast ${type}`;
  icon.textContent = icons[type] || 'ℹ️';
  text.textContent = message;
  el.append(icon, text);
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function adminFetch(url) {
  const res = await fetch(url, { headers: { 'x-admin-token': adminToken } });
  if (res.status === 401) { toast('Unauthorized. Check your token.', 'error'); throw new Error('401'); }
  return res.json();
}

async function unlockAdmin() {
  const token = document.getElementById('admin-token-inp').value.trim();
  if (!token) { toast('Enter a token.', 'error'); return; }
  adminToken = token;

  try {
    const stats = await adminFetch(`${API}/api/admin/stats`);
    document.getElementById('token-gate-overlay').style.display = 'none';
    document.getElementById('admin-dashboard').style.display    = 'block';
    populateStats(stats);
    loadTransactions();
  } catch(e) {
    if (e.message !== '401') toast('Connection error.', 'error');
    else { toast('Invalid token.', 'error'); adminToken = ''; }
  }
}

function populateStats(s) {
  document.getElementById('stat-revenue').textContent = `₹${(s.totalRevenue||0).toLocaleString('en-IN')}`;
  document.getElementById('stat-paid').textContent    = s.paidOrders;
  document.getElementById('stat-pending').textContent = s.pendingOrders;
  document.getElementById('stat-active').textContent  = s.activeUsers;
  document.getElementById('stat-total').textContent   = s.totalOrders;
}

function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-content-${name}`).classList.add('active');
  document.getElementById(`tab-${name === 'transactions' ? 'txn' : name}`).classList.add('active');
  if (name === 'transactions') loadTransactions();
  if (name === 'audit') loadAudit();
  if (name === 'users') loadUsers();
}

function fmt(dt) {
  if (!dt) return '—';
  const date = new Date(dt);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
function sourceClass(s) {
  s = String(s || '');
  if (!s) return 'badge-manual';
  if (s.includes('intent'))   return 'badge-intent';
  if (s.includes('sms'))      return 'badge-sms';
  return 'badge-manual';
}

async function loadTransactions() {
  try {
    const data = await adminFetch(`${API}/api/admin/transactions`);
    const wrap = document.getElementById('txn-table-wrap');
    if (!data.length) { wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">💳</div><p>No transactions yet.</p></div>`; return; }
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>Order ID</th><th>User</th><th>Plan</th><th>Amount</th><th>UPI Ref</th><th>Source</th><th>Date</th>
      </tr></thead>
      <tbody>${data.map(t => `
        <tr>
          <td><code>${escapeHtml(t.order_id)}</code></td>
          <td>${escapeHtml(t.name || '—')}<br/><span style="font-size:0.75rem;color:var(--text-3)">${escapeHtml(t.email||'')}</span></td>
          <td>${escapeHtml((t.plan||'—').toUpperCase())}</td>
          <td style="color:var(--emerald-lt);font-weight:700">₹${t.order_amount}</td>
          <td><code>${escapeHtml(t.upi_ref||'—')}</code></td>
          <td><span class="badge ${sourceClass(t.signal_source)}">${escapeHtml(t.signal_source||'manual')}</span></td>
          <td style="font-size:0.75rem;color:var(--text-3)">${fmt(t.verified_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  } catch(e) { if(e.message!=='401') toast('Failed to load transactions.', 'error'); }
}

async function loadAudit() {
  try {
    const data = await adminFetch(`${API}/api/admin/audit`);
    const wrap = document.getElementById('audit-table-wrap');
    if (!data.length) { wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>Audit log is empty.</p></div>`; return; }
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>#</th><th>Event</th><th>Order ID</th><th>User ID</th><th>IP</th><th>Time</th>
      </tr></thead>
      <tbody>${data.map(l => `
        <tr>
          <td style="color:var(--text-3);font-family:var(--mono);font-size:0.75rem">${l.id}</td>
          <td><span class="badge ${l.event_type.includes('SUCCESS')||l.event_type.includes('VERIFIED') ? 'badge-verified' : l.event_type.includes('FAIL') ? 'badge-expired' : 'badge-intent'}">${escapeHtml(l.event_type)}</span></td>
          <td><code>${escapeHtml(l.order_id||'—')}</code></td>
          <td><code style="font-size:0.7rem;color:var(--text-3)">${escapeHtml((l.user_id||'—').slice(0,12))}…</code></td>
          <td style="font-size:0.75rem;color:var(--text-3)">${escapeHtml(l.ip_address||'—')}</td>
          <td style="font-size:0.75rem;color:var(--text-3)">${fmt(l.created_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  } catch(e) { if(e.message!=='401') toast('Failed to load audit log.', 'error'); }
}

async function loadUsers() {
  try {
    const data = await adminFetch(`${API}/api/admin/users`);
    const wrap = document.getElementById('users-table-wrap');
    if (!data.length) { wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div><p>No users yet.</p></div>`; return; }
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>Name</th><th>Email</th><th>Plan</th><th>Status</th><th>Activated</th><th>Joined</th>
      </tr></thead>
      <tbody>${data.map(u => `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td style="color:var(--text-2)">${escapeHtml(u.email)}</td>
          <td>${escapeHtml((u.plan||'—').toUpperCase())}</td>
          <td><span class="badge ${u.is_active ? 'badge-verified' : 'badge-pending'}">${u.is_active ? 'ACTIVE' : 'INACTIVE'}</span></td>
          <td style="font-size:0.75rem;color:var(--text-3)">${fmt(u.activated_at)}</td>
          <td style="font-size:0.75rem;color:var(--text-3)">${fmt(u.created_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  } catch(e) { if(e.message!=='401') toast('Failed to load users.', 'error'); }
}

async function testSms() {
  const orderId = document.getElementById('sms-order-id').value.trim();
  const sender = document.getElementById('sms-sender').value.trim();
  const rawText = document.getElementById('sms-raw-text').value.trim();
  const resultEl = document.getElementById('sms-result');

  if (!orderId || !sender || !rawText) { toast('Enter Order ID, sender number, and SMS text.', 'error'); return; }

  try {
    const res = await fetch(`${API}/api/orders/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ orderId, sender, rawText }),
    });
    const data = await res.json();
    resultEl.style.display = 'block';
    resultEl.textContent = JSON.stringify(data, null, 2);
    if (data.success) toast('✅ SMS verified & service activated!', 'success');
    else toast(data.message || data.error || 'Verification failed.', 'error');
  } catch(e) { toast('Network error.', 'error'); }
}

function fillSampleSms() {
  document.getElementById('sms-raw-text').value =
    'Your a/c XXXXXX is credited by Rs.499 on 16-05-26. Ref 421234567890. -HDFC Bank';
  toast('Sample SMS filled. Add a valid Order ID to test.', 'info');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('admin-token-inp') === document.activeElement) unlockAdmin();
});
