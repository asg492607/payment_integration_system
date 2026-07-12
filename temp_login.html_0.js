
const API = '';

// Redirect if already logged in
const existingToken = localStorage.getItem('pf_token');
if (existingToken) {
  fetch(`${API}/api/auth/me`, { headers: { 'Authorization': `Bearer ${existingToken}` } })
    .then(r => r.ok ? window.location.href = '/dashboard.html' : null)
    .catch(() => {});
}

function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('form-login').classList.toggle('active', tab === 'login');
  document.getElementById('form-signup').classList.toggle('active', tab === 'signup');
  clearError();
}

function showError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.add('visible');
}

function clearError() {
  document.getElementById('auth-error').classList.remove('visible');
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}

async function handleLogin(e) {
  e.preventDefault();
  clearError();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  setLoading('btn-login', true);
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) { showError(data.error || 'Login failed'); return; }

    localStorage.setItem('pf_token', data.token);
    localStorage.setItem('pf_user', JSON.stringify(data.user));
    toast('Welcome back! Redirecting...', 'success');
    setTimeout(() => window.location.href = '/dashboard.html', 800);
  } catch (err) {
    showError('Connection error. Is the server running?');
  } finally {
    setLoading('btn-login', false);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  clearError();
  const name = document.getElementById('signup-name').value.trim();
  const company = document.getElementById('signup-company').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  if (password.length < 8) { showError('Password must be at least 8 characters'); return; }

  setLoading('btn-signup', true);
  try {
    const res = await fetch(`${API}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, company, email, password }),
    });
    const data = await res.json();

    if (!res.ok) { showError(data.error || 'Signup failed'); return; }

    localStorage.setItem('pf_token', data.token);
    localStorage.setItem('pf_user', JSON.stringify(data.user));
    toast('Account created! Setting up dashboard...', 'success');
    setTimeout(() => window.location.href = '/dashboard.html', 800);
  } catch (err) {
    showError('Connection error. Is the server running?');
  } finally {
    setLoading('btn-signup', false);
  }
}

function toast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3500);
}

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const activeForm = document.querySelector('.auth-form.active');
    if (activeForm) activeForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
});
