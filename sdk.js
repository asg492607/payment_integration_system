/**
 * PayForge Embeddable Payment SDK v2.0
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Drop this on any website to accept UPI payments.
 *
 * Usage:
 *   <script>
 *     window.PAYFORGE_ENTERPRISE_ID = 'your-enterprise-id';
 *     window.PAYFORGE_SERVER        = 'https://your-payforge.onrender.com';
 *   </script>
 *   <script src="https://your-payforge.onrender.com/sdk.js"></script>
 *
 *   PayForge.pay({
 *     plan:      'pro',
 *     name:      'Customer Name',
 *     email:     'customer@email.com',
 *     onSuccess: (data) => console.log('Paid!', data),
 *     onCancel:  ()     => console.log('Cancelled'),
 *     onError:   (err)  => console.error(err),
 *   });
 */

(function (global) {
  'use strict';

  const SERVER   = global.PAYFORGE_SERVER        || '';
  const ENT_ID   = global.PAYFORGE_ENTERPRISE_ID || '';
  const POLL_MS  = 3000;

  // ── State ─────────────────────────────────────────────
  let _state = {
    orderId: null, amount: null, upiLink: null,
    expiresAt: null, plan: null, planList: [],
    pollTimer: null, expiryTimer: null,
    opts: {},
  };

  // ── Inject CSS ─────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('pf-sdk-styles')) return;
    const style = document.createElement('style');
    style.id = 'pf-sdk-styles';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap');

      #pf-overlay {
        position:fixed;inset:0;z-index:999999;
        background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);
        display:flex;align-items:center;justify-content:center;padding:16px;
        font-family:'Outfit',system-ui,sans-serif;
        animation:pf-fade-in 0.2s ease;
      }
      @keyframes pf-fade-in{from{opacity:0}to{opacity:1}}

      #pf-modal {
        width:100%;max-width:440px;max-height:95vh;overflow-y:auto;
        background:linear-gradient(145deg,#0d1220,#0a0f1e);
        border:1px solid rgba(255,255,255,0.1);border-radius:24px;
        padding:36px;box-shadow:0 25px 80px rgba(0,0,0,0.7);
        color:#f1f5f9;position:relative;
        animation:pf-slide-up 0.3s cubic-bezier(0.4,0,0.2,1);
      }
      @keyframes pf-slide-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}

      #pf-modal *{box-sizing:border-box;margin:0;padding:0}

      .pf-header {
        display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;
      }
      .pf-brand {
        display:flex;align-items:center;gap:8px;font-size:1rem;font-weight:800;
        letter-spacing:-0.3px;
      }
      .pf-brand-icon {
        width:32px;height:32px;border-radius:9px;
        background:linear-gradient(135deg,#6366f1,#4f46e5);
        display:flex;align-items:center;justify-content:center;font-size:1rem;
        box-shadow:0 4px 12px rgba(99,102,241,0.4);
      }
      .pf-close {
        width:30px;height:30px;border-radius:8px;border:none;cursor:pointer;
        background:rgba(255,255,255,0.07);color:#94a3b8;font-size:0.9rem;
        display:flex;align-items:center;justify-content:center;transition:all 0.2s;
      }
      .pf-close:hover{background:rgba(255,255,255,0.12);color:#f1f5f9}

      .pf-step{display:none}
      .pf-step.pf-active{display:block;animation:pf-fade-in 0.25s ease}

      .pf-steps {
        display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:28px;
      }
      .pf-step-dot {
        width:28px;height:28px;border-radius:50%;
        background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);
        color:#475569;font-size:0.75rem;font-weight:700;
        display:flex;align-items:center;justify-content:center;transition:all 0.3s;flex-shrink:0;
      }
      .pf-step-dot.pf-dot-active{background:#6366f1;border-color:#6366f1;color:#fff;box-shadow:0 0 14px rgba(99,102,241,0.5)}
      .pf-step-dot.pf-dot-done{background:#10b981;border-color:#10b981;color:#fff}
      .pf-step-line{width:40px;height:2px;background:rgba(255,255,255,0.08);flex-shrink:0;transition:all 0.3s}
      .pf-step-line.pf-line-active{background:#6366f1}

      .pf-title{font-size:1.4rem;font-weight:800;letter-spacing:-0.4px;margin-bottom:6px}
      .pf-sub{font-size:0.85rem;color:#94a3b8;margin-bottom:24px;line-height:1.5}

      .pf-field{margin-bottom:14px}
      .pf-label{display:block;font-size:0.72rem;font-weight:700;color:#94a3b8;
        text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px}
      .pf-input {
        width:100%;padding:11px 14px;border-radius:10px;
        background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
        color:#f1f5f9;font-family:'Outfit',system-ui,sans-serif;font-size:0.9rem;
        outline:none;transition:all 0.2s;
      }
      .pf-input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,0.15)}
      .pf-input::placeholder{color:#475569}

      .pf-plan-pill {
        display:flex;justify-content:space-between;align-items:center;
        padding:12px 16px;border-radius:10px;
        background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);
        margin-bottom:20px;font-weight:600;font-size:0.9rem;
      }
      .pf-plan-pill span:last-child{color:#818cf8;font-size:1rem;font-weight:800}

      .pf-btn {
        width:100%;padding:13px;border-radius:10px;border:none;cursor:pointer;
        font-family:'Outfit',system-ui,sans-serif;font-size:0.95rem;font-weight:700;
        transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;
      }
      .pf-btn-primary{
        background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;
        box-shadow:0 4px 16px rgba(99,102,241,0.4);
      }
      .pf-btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(99,102,241,0.5)}
      .pf-btn-primary:disabled{opacity:0.6;cursor:wait;transform:none}
      .pf-btn-green{
        background:linear-gradient(135deg,#10b981,#059669);color:#fff;
        box-shadow:0 4px 16px rgba(16,185,129,0.4);
      }
      .pf-btn-ghost{
        background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
        color:#94a3b8;font-size:0.85rem;
      }
      .pf-btn-ghost:hover{border-color:rgba(99,102,241,0.4);color:#f1f5f9}
      .pf-btn-row{display:flex;gap:10px;margin-bottom:16px}
      .pf-btn-row .pf-btn{flex:1}

      .pf-info-box{
        border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;margin-bottom:18px;
      }
      .pf-info-row{
        display:flex;justify-content:space-between;align-items:center;
        padding:11px 14px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.85rem;
      }
      .pf-info-row:last-child{border-bottom:none}
      .pf-info-row span:first-child{color:#94a3b8}
      .pf-mono{font-family:'JetBrains Mono',monospace;font-size:0.78rem;color:#818cf8}
      .pf-amount-big{color:#34d399;font-weight:800;font-size:1.05rem}
      .pf-timer{color:#f59e0b;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:0.85rem}
      .pf-timer.pf-urgent{color:#f43f5e;animation:pf-pulse 1s ease-in-out infinite}
      @keyframes pf-pulse{0%,100%{opacity:1}50%{opacity:0.4}}

      .pf-divider{
        text-align:center;font-size:0.75rem;color:#475569;margin:14px 0;position:relative;
      }
      .pf-divider::before,.pf-divider::after{
        content:'';position:absolute;top:50%;width:30%;height:1px;background:rgba(255,255,255,0.07);
      }
      .pf-divider::before{left:0}.pf-divider::after{right:0}

      .pf-poll-notice{
        display:flex;align-items:center;justify-content:center;gap:6px;
        font-size:0.75rem;color:#475569;margin-top:14px;
      }
      .pf-poll-dot{
        width:6px;height:6px;border-radius:50%;background:#10b981;flex-shrink:0;
        animation:pf-pulse 1.5s ease-in-out infinite;
      }

      .pf-success-wrap{text-align:center;padding:8px 0}
      .pf-success-icon{
        width:72px;height:72px;border-radius:50%;margin:0 auto 20px;
        background:linear-gradient(135deg,#10b981,#059669);
        display:flex;align-items:center;justify-content:center;font-size:2rem;
        box-shadow:0 0 40px rgba(16,185,129,0.4);
        animation:pf-check-pop 0.5s cubic-bezier(0.4,0,0.2,1) both;
      }
      @keyframes pf-check-pop{from{transform:scale(0) rotate(-45deg)}to{transform:scale(1) rotate(0)}}
      .pf-success-title{font-size:1.5rem;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px}
      .pf-success-sub{font-size:0.85rem;color:#94a3b8;margin-bottom:20px}
      .pf-success-details{
        border:1px solid rgba(16,185,129,0.25);border-radius:12px;overflow:hidden;
        background:rgba(16,185,129,0.04);margin-bottom:20px;text-align:left;
      }
      .pf-success-row{
        display:flex;justify-content:space-between;padding:10px 14px;
        border-bottom:1px solid rgba(16,185,129,0.1);font-size:0.82rem;
      }
      .pf-success-row:last-child{border-bottom:none}
      .pf-success-row span:first-child{color:#94a3b8}

      .pf-error{
        padding:10px 14px;border-radius:8px;margin-bottom:14px;
        background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);
        color:#f87171;font-size:0.83rem;display:none;
      }
      .pf-error.pf-visible{display:block}

      .pf-powered{
        text-align:center;font-size:0.68rem;color:#334155;margin-top:16px;
      }
      .pf-powered a{color:#475569;text-decoration:none}
      .pf-powered a:hover{color:#94a3b8}

      @media(max-width:480px){
        #pf-modal{padding:24px 20px;border-radius:20px}
        .pf-btn-row{flex-direction:column}
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build Modal HTML ───────────────────────────────────
  function buildModal(opts) {
    const planMeta = _state.plan;
    const el = document.createElement('div');
    el.id = 'pf-overlay';
    el.innerHTML = `
      <div id="pf-modal" role="dialog" aria-modal="true" aria-label="PayForge Checkout">

        <div class="pf-header">
          <div class="pf-brand">
            <div class="pf-brand-icon">⚡</div>
            <span>PayForge</span>
          </div>
          <button class="pf-close" id="pf-close-btn" aria-label="Close">✕</button>
        </div>

        <!-- STEP 1: User Details -->
        <div class="pf-step pf-active" id="pf-step-1">
          <div class="pf-steps">
            <div class="pf-step-dot pf-dot-active">1</div>
            <div class="pf-step-line"></div>
            <div class="pf-step-dot">2</div>
            <div class="pf-step-line"></div>
            <div class="pf-step-dot">3</div>
          </div>
          <div class="pf-title">Complete Purchase</div>
          <div class="pf-sub">Enter your details to get started.</div>

          <div class="pf-error" id="pf-error"></div>

          <div class="pf-field">
            <label class="pf-label" for="pf-inp-name">Full Name</label>
            <input class="pf-input" type="text" id="pf-inp-name" placeholder="Your name"
              value="${escAttr(opts.name||'')}" autocomplete="name"/>
          </div>
          <div class="pf-field">
            <label class="pf-label" for="pf-inp-email">Email Address</label>
            <input class="pf-input" type="email" id="pf-inp-email" placeholder="you@company.com"
              value="${escAttr(opts.email||'')}" autocomplete="email"/>
          </div>
          <div class="pf-field">
            <label class="pf-label" for="pf-inp-phone">Phone <span style="color:#334155;font-weight:400;text-transform:none">(optional)</span></label>
            <input class="pf-input" type="tel" id="pf-inp-phone" placeholder="+91 9876543210" autocomplete="tel"/>
          </div>

          <div class="pf-plan-pill">
            <span>${planMeta.label} · ${planMeta.duration}</span>
            <span>₹${planMeta.amount}</span>
          </div>

          <button class="pf-btn pf-btn-primary" id="pf-btn-proceed">
            Continue to Payment →
          </button>
        </div>

        <!-- STEP 2: UPI Payment -->
        <div class="pf-step" id="pf-step-2">
          <div class="pf-steps">
            <div class="pf-step-dot pf-dot-done">✓</div>
            <div class="pf-step-line pf-line-active"></div>
            <div class="pf-step-dot pf-dot-active">2</div>
            <div class="pf-step-line"></div>
            <div class="pf-step-dot">3</div>
          </div>
          <div class="pf-title">Pay via UPI</div>
          <div class="pf-sub">Pay the exact amount shown — service activates automatically.</div>

          <div class="pf-info-box">
            <div class="pf-info-row"><span>UPI ID</span><span class="pf-mono" id="pf-disp-vpa">—</span></div>
            <div class="pf-info-row"><span>Amount</span><span class="pf-amount-big" id="pf-disp-amount">₹—</span></div>
            <div class="pf-info-row"><span>Payment Note</span><span class="pf-mono" id="pf-disp-note" style="font-size:0.7rem">—</span></div>
            <div class="pf-info-row"><span>Order ID</span><span class="pf-mono" id="pf-disp-order" style="font-size:0.7rem">—</span></div>
            <div class="pf-info-row"><span>Expires In</span><span class="pf-timer" id="pf-disp-expiry">—</span></div>
          </div>

          <!-- QR Code Container for Desktop Users -->
          <div style="text-align:center; margin: 20px 0;">
            <p style="font-size:0.75rem; color:#94a3b8; margin-bottom:10px;">Scan to pay via any UPI App</p>
            <div style="background:#fff; padding:12px; border-radius:16px; display:inline-block; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
              <img id="pf-qr-code" src="" alt="UPI QR Code" style="width:180px; height:180px; display:block; opacity:0; transition:opacity 0.3s;" />
            </div>
          </div>

          <div class="pf-btn-row">
            <a class="pf-btn pf-btn-green" id="pf-upi-link" href="#">📱 Open UPI App</a>
            <button class="pf-btn pf-btn-ghost" id="pf-copy-btn">📋 Copy Link</button>
          </div>

          <div class="pf-divider">Pay the exact amount — do not round off</div>
          <div class="pf-poll-notice">
            <div class="pf-poll-dot"></div>
            Waiting for bank SMS confirmation...
          </div>
        </div>

        <!-- STEP 3: Success -->
        <div class="pf-step" id="pf-step-3">
          <div class="pf-steps">
            <div class="pf-step-dot pf-dot-done">✓</div>
            <div class="pf-step-line pf-line-active"></div>
            <div class="pf-step-dot pf-dot-done">✓</div>
            <div class="pf-step-line pf-line-active"></div>
            <div class="pf-step-dot pf-dot-done">✓</div>
          </div>
          <div class="pf-success-wrap">
            <div class="pf-success-icon">✓</div>
            <div class="pf-success-title">Activated! 🎉</div>
            <div class="pf-success-sub">Your service is live. Check your email for confirmation.</div>
            <div class="pf-success-details">
              <div class="pf-success-row"><span>Plan</span><strong id="pf-act-plan">—</strong></div>
              <div class="pf-success-row"><span>Order ID</span><span class="pf-mono" id="pf-act-order" style="font-size:0.7rem">—</span></div>
              <div class="pf-success-row"><span>Txn ID</span><span class="pf-mono" id="pf-act-txn" style="font-size:0.7rem">—</span></div>
              <div class="pf-success-row"><span>Status</span><span style="color:#34d399;font-weight:700">✅ ACTIVE</span></div>
            </div>
            <button class="pf-btn pf-btn-primary" id="pf-done-btn">Done ✓</button>
          </div>
        </div>

        <div class="pf-powered">
          Secured by <a href="${SERVER}" target="_blank">PayForge</a> · UPI Payment Engine
        </div>
      </div>
    `;
    return el;
  }

  // ── Mount ─────────────────────────────────────────────
  function mount(opts) {
    if (document.getElementById('pf-overlay')) return; // already open
    injectStyles();
    const overlay = buildModal(opts);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Events
    document.getElementById('pf-close-btn').addEventListener('click', dismiss);
    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey);
    document.getElementById('pf-btn-proceed').addEventListener('click', handleProceed);
    document.getElementById('pf-copy-btn').addEventListener('click', handleCopyLink);
    document.getElementById('pf-done-btn').addEventListener('click', dismiss);

    // Enter key on form
    ['pf-inp-name','pf-inp-email','pf-inp-phone'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleProceed();
      });
    });
  }

  function onKey(e) { if (e.key === 'Escape') dismiss(); }

  function dismiss() {
    clearTimers();
    document.removeEventListener('keydown', onKey);
    const overlay = document.getElementById('pf-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.2s';
      setTimeout(() => { overlay.remove(); document.body.style.overflow = ''; }, 200);
    }
    if (_state.opts.onCancel && !_state._succeeded) {
      _state.opts.onCancel();
    }
    resetState();
  }

  // ── Step Transitions ──────────────────────────────────
  function goToStep(n) {
    document.querySelectorAll('.pf-step').forEach(s => s.classList.remove('pf-active'));
    document.getElementById(`pf-step-${n}`)?.classList.add('pf-active');
  }

  // ── Proceed: Create Order ─────────────────────────────
  async function handleProceed() {
    const name  = document.getElementById('pf-inp-name')?.value.trim();
    const email = document.getElementById('pf-inp-email')?.value.trim();
    const phone = document.getElementById('pf-inp-phone')?.value.trim();
    const errEl = document.getElementById('pf-error');

    if (!name || !email) { showError('Name and email are required.'); return; }
    if (!email.includes('@')) { showError('Please enter a valid email address.'); return; }

    const btn = document.getElementById('pf-btn-proceed');
    btn.disabled = true;
    btn.textContent = 'Creating Order...';
    hideError();

    try {
      const res  = await fetch(`${SERVER}/api/orders/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, plan: _state.plan.plan_code, enterprise_id: ENT_ID }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create order');

      _state.orderId   = data.orderId;
      _state.amount    = data.amount;
      _state.upiLink   = data.upiLink;
      _state.expiresAt = new Date(data.expiresAt);

      document.getElementById('pf-disp-vpa').textContent   = data.upiVpa || '—';
      document.getElementById('pf-disp-amount').textContent = `₹${data.amount}`;
      document.getElementById('pf-disp-note').textContent   = data.paymentNote || data.orderId;
      document.getElementById('pf-disp-order').textContent  = data.orderId;
      document.getElementById('pf-upi-link').href = data.upiLink;
      
      // Render QR Code via api.qrserver.com
      const qrImg = document.getElementById('pf-qr-code');
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(data.upiLink)}`;
      qrImg.onload = () => qrImg.style.opacity = '1';
      qrImg.onerror = () => qrImg.style.opacity = '1'; // Show broken image icon if it completely fails

      goToStep(2);
      startExpiryTimer();
      startPolling();
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
      btn.textContent = 'Continue to Payment →';
    }
  }

  // ── Polling ────────────────────────────────────────────
  function startPolling() {
    async function poll() {
      if (!_state.orderId) return;
      try {
        const res  = await fetch(`${SERVER}/api/orders/${_state.orderId}`);
        const data = await res.json();
        if (data.order?.status === 'paid') {
          clearTimers();
          showSuccess(data);
          return;
        }
        if (data.order?.status === 'expired') { clearTimers(); return; }
      } catch (e) { /* retry */ }
      _state.pollTimer = setTimeout(poll, POLL_MS);
    }
    _state.pollTimer = setTimeout(poll, POLL_MS);
  }

  function startExpiryTimer() {
    const el = document.getElementById('pf-disp-expiry');
    function tick() {
      const diff = _state.expiresAt - new Date();
      if (diff <= 0) {
        if (el) { el.textContent = 'Expired'; el.classList.add('pf-urgent'); }
        clearTimers(); return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (el) {
        el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
        el.classList.toggle('pf-urgent', diff < 180000);
      }
      _state.expiryTimer = setTimeout(tick, 1000);
    }
    tick();
  }

  function clearTimers() {
    clearTimeout(_state.pollTimer);
    clearTimeout(_state.expiryTimer);
  }

  // ── Success ────────────────────────────────────────────
  function showSuccess(data) {
    _state._succeeded = true;
    const planLabel = data?.order?.plan || _state.plan.label;
    const oId  = data?.order?.id || _state.orderId;
    const tId  = data?.transaction?.id || '—';

    document.getElementById('pf-act-plan').textContent  = planLabel;
    document.getElementById('pf-act-order').textContent = oId;
    document.getElementById('pf-act-txn').textContent   = tId;

    goToStep(3);

    if (_state.opts.onSuccess) {
      _state.opts.onSuccess({
        orderId: oId, txnId: tId, plan: planLabel,
        email: document.getElementById('pf-inp-email')?.value,
        name:  document.getElementById('pf-inp-name')?.value,
        amount: _state.amount,
      });
    }
  }

  // ── UPI Helpers ────────────────────────────────────────
  async function handleCopyLink() {
    if (!_state.upiLink) return;
    try {
      await navigator.clipboard.writeText(_state.upiLink);
      const btn = document.getElementById('pf-copy-btn');
      if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = '📋 Copy Link', 2000); }
    } catch (e) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = _state.upiLink;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }

  // ── Error Helpers ──────────────────────────────────────
  function showError(msg) {
    const el = document.getElementById('pf-error');
    if (el) { el.textContent = msg; el.classList.add('pf-visible'); }
  }
  function hideError() {
    const el = document.getElementById('pf-error');
    if (el) el.classList.remove('pf-visible');
  }

  function escAttr(s) { return String(s||'').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

  function resetState() {
    _state = { orderId:null, amount:null, upiLink:null, expiresAt:null, plan:null, planList:[], pollTimer:null, expiryTimer:null, opts:{}, _succeeded:false };
  }

  // ── Public API ─────────────────────────────────────────
  const PayForge = {
    /**
     * Open the payment modal.
     * @param {object} opts
     * @param {string}   opts.plan       - 'starter' | 'pro' | 'empire'
     * @param {string}   [opts.name]     - Pre-fill customer name
     * @param {string}   [opts.email]    - Pre-fill customer email
     * @param {function} [opts.onSuccess]- Called with { orderId, txnId, plan, email, amount }
     * @param {function} [opts.onCancel] - Called when user closes modal before paying
     * @param {function} [opts.onError]  - Called with error message string
     */
    pay(opts = {}) {
      if (!ENT_ID) {
        console.error('[PayForge] window.PAYFORGE_ENTERPRISE_ID is not set!');
        if (opts.onError) opts.onError('PayForge Enterprise ID not configured.');
        return;
      }
      resetState();
      _state.opts = opts;
      
      // Fetch dynamic plans for this enterprise
      fetch(`${SERVER}/api/orders/plans/${ENT_ID}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          if (data.length === 0) throw new Error('Enterprise has no active plans.');
          
          _state.planList = data;
          const reqPlan = data.find(p => p.plan_code === opts.plan);
          if (!reqPlan) throw new Error(`Plan code '${opts.plan}' not found for this enterprise.`);
          
          _state.plan = reqPlan;
          mount(opts);
        })
        .catch(err => {
          if (opts.onError) opts.onError(err.message);
          else console.error('[PayForge] Error fetching plans:', err.message);
        });
    },

    /** Programmatically close the modal */
    close() { dismiss(); },

    /** Get available plans (async now, so this just returns cached if available) */
    get plans() { return _state.planList; },

    version: '2.0.0',
  };

  global.PayForge = PayForge;

  // Auto-init from data attributes on script tag
  const selfScript = document.currentScript;
  if (selfScript) {
    const autoPlan = selfScript.getAttribute('data-plan');
    const autoBtn  = selfScript.getAttribute('data-button');
    if (autoBtn) {
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll(autoBtn).forEach(btn => {
          btn.addEventListener('click', () => PayForge.pay({ plan: btn.dataset.plan || autoPlan || 'pro' }));
        });
      });
    }
  }

}(typeof window !== 'undefined' ? window : global));

