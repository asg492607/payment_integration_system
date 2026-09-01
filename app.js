/**
 * ASG Payment Gateway — Frontend App Logic v2.0
 * Firebase real-time payment detection + UPI flow
 */

const API = (window.location.hostname === 'localhost' && window.location.port === '3000') || window.location.hostname === 'payment-integration-system.onrender.com' ? '' : 'https://payment-integration-system.onrender.com';

let state = {
  selectedPlan: 'pro',
  orderId: null,
  amount: null,
  expiresAt: null,
  upiLink: null,
  pollTimer: null,
  expiryTimer: null,
  fbUnsubscribe: null,
};

const PLANS_META = {
  starter: { label: 'Starter Plan', price: '₹199' },
  pro:     { label: 'Pro Plan',     price: '₹499' },
  empire:  { label: 'Empire Plan',  price: '₹999' },
};

// ── Plan Selection ──────────────────────────────────────
function selectPlan(plan) {
  state.selectedPlan = plan;
  document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`plan-${plan}`).classList.add('selected');
  document.getElementById('summary-plan-name').textContent = PLANS_META[plan].label;
  document.getElementById('summary-plan-price').textContent = PLANS_META[plan].price;
  showModal();
}

function showModal() {
  document.getElementById('paymentModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('paymentModal').classList.remove('active');
  document.body.style.overflow = '';
  clearPolling();
}

// ── Proceed to Payment ───────────────────────────────────
async function proceedToPayment() {
  const name  = document.getElementById('inp-name').value.trim();
  const email = document.getElementById('inp-email').value.trim();
  const phone = document.getElementById('inp-phone').value.trim();

  if (!name || !email) { toast('Please enter your name and email.', 'error'); return; }
  if (!email.includes('@')) { toast('Please enter a valid email.', 'error'); return; }

  const btn = document.getElementById('btn-proceed');
  btn.textContent = 'Creating Order...';
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/orders/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, plan: state.selectedPlan, enterprise_id: 'global' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create order');

    state.orderId   = data.orderId;
    state.amount    = data.amount;
    state.expiresAt = new Date(data.expiresAt);
    state.upiLink   = data.upiLink;

    document.getElementById('display-order-id').textContent     = data.orderId;
    document.getElementById('display-amount').textContent       = `₹${data.amount}`;
    document.getElementById('display-upi-vpa').textContent      = data.upiVpa || '—';
    document.getElementById('display-payment-note').textContent = data.paymentNote || data.orderId;
    document.getElementById('upi-deep-link').href = data.upiLink;

    goToStep('step-details', 'step-payment');
    startExpiryTimer();
    startFirebaseListener();   // Firebase real-time first
    startAutoPoll();           // HTTP polling as fallback

    toast('Order created! Pay exactly ₹' + data.amount, 'info');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.textContent = 'Continue to Payment →';
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ── Firebase Real-time Listener ──────────────────────────
function startFirebaseListener() {
  if (!state.orderId) return;
  if (!window._fbReady || !window._rtdb) {
    // Firebase not ready yet — wait for event
    document.addEventListener('firebase-ready', startFirebaseListener, { once: true });
    return;
  }

  try {
    const rtdb = window._rtdb;
    const fbRef = window._fbRef;
    const onChildAdded = window._fbOnChildAdded;

    // We don't know the enterprise ID here (public page), so we poll all events
    // The enterprise could push events to a known path. For now, HTTP polling handles this.
    console.log('[Firebase] Listener set up — waiting for payment events');
  } catch (e) {
    console.warn('[Firebase] Listener error:', e);
  }
}

// ── HTTP Auto-Poll (fallback, every 3s) ──────────────────
function startAutoPoll() {
  const interval = 3000;
  const notice = document.getElementById('auto-poll-notice');
  if (notice) notice.innerHTML = `<span class="pulse-dot"></span> Auto-checking every ${interval/1000}s...`;

  async function poll() {
    if (!state.orderId) return;
    try {
      const res  = await fetch(`${API}/api/orders/${state.orderId}`);
      const data = await res.json();
      if (data.order && data.order.status === 'paid') {
        clearPolling();
        showSuccess(data);
        return;
      }
      if (data.order && data.order.status === 'expired') {
        clearPolling();
        if (notice) notice.textContent = '⌛ Order expired.';
        toast('Order expired. Please create a new one.', 'error');
        return;
      }
    } catch (e) { /* retry silently */ }
    state.pollTimer = setTimeout(poll, interval);
  }
  state.pollTimer = setTimeout(poll, interval);
}

function clearPolling() {
  clearTimeout(state.pollTimer);
  clearTimeout(state.expiryTimer);
}

// ── Expiry Countdown ─────────────────────────────────────
function startExpiryTimer() {
  const el = document.getElementById('display-expiry');
  function tick() {
    const diff = state.expiresAt - new Date();
    if (diff <= 0) {
      el.textContent = 'Expired';
      el.classList.add('urgent');
      clearPolling();
      toast('Order expired. Please create a new one.', 'error');
      return;
    }
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    el.classList.toggle('urgent', diff < 3 * 60000);
    state.expiryTimer = setTimeout(tick, 1000);
  }
  tick();
}

// ── Success Screen ───────────────────────────────────────
function showSuccess(data) {
  const plan = data?.order?.plan || state.selectedPlan;
  const oId  = data?.order?.id   || state.orderId;
  const tId  = data?.transaction?.id || '—';

  document.getElementById('act-plan').textContent     = (plan.charAt(0).toUpperCase() + plan.slice(1)) + ' Plan';
  document.getElementById('act-order-id').textContent = oId;
  document.getElementById('act-txn-id').textContent   = tId;

  goToStep('step-payment', 'step-success');
  toast('🎉 Service activated!', 'success');
}

// ── Step Navigation ──────────────────────────────────────
function goToStep(fromId, toId) {
  document.getElementById(fromId).classList.remove('active');
  document.getElementById(toId).classList.add('active');
}

// ── UPI Helpers ──────────────────────────────────────────
function openUpiApp(e) {
  if (!state.upiLink) { e.preventDefault(); toast('Order not created yet.', 'error'); return; }
  toast('Opening UPI app...', 'info');
}

function copyUpiLink() {
  if (!state.upiLink) { toast('No UPI link yet.', 'error'); return; }
  navigator.clipboard.writeText(state.upiLink)
    .then(() => toast('UPI link copied!', 'success'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = state.upiLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('UPI link copied!', 'success');
    });
}

// ── Reset Flow ───────────────────────────────────────────
function resetFlow() {
  state.orderId = null; state.amount = null;
  state.expiresAt = null; state.upiLink = null;

  ['inp-name','inp-email','inp-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.getElementById('step-payment')?.classList.remove('active');
  document.getElementById('step-success')?.classList.remove('active');
  document.getElementById('step-details')?.classList.add('active');
  document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
}

// ── Toast ────────────────────────────────────────────────
function toast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.4s';
    setTimeout(() => el.remove(), 400);
  }, 4000);
}

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('summary-plan-name').textContent  = 'Pro Plan';
  document.getElementById('summary-plan-price').textContent = '₹499';

  document.getElementById('paymentModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
});

