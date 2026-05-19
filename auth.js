// —— AUTH STATE ——
// currentUser shape: { id, name, first, email, role, emailVerified,
//   emailVerificationToken, emailVerificationExpiresAt, notificationPreferences,
//   createdAt } — see CLAUDE.md Data Model for full field definitions.
// config.js (API_BASE, getToken) and email.js (sendEmail) are loaded before this script.

function loadCurrentUser() {
  try { return JSON.parse(localStorage.getItem('sib_user') || 'null'); } catch(e) { return null; }
}
function saveCurrentUser(user) {
  if (user) localStorage.setItem('sib_user', JSON.stringify(user));
  else localStorage.removeItem('sib_user');
}
function saveToken(t) { if (t) localStorage.setItem('sib_token', t); else localStorage.removeItem('sib_token'); }

let currentUser = loadCurrentUser();
let selectedRole = 'student';

// —— HELPERS ——
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidPhone(p) {
  if (!p) return false;
  const digits = p.replace(/\D/g, '');
  return (digits.length === 10) || (digits.length === 11 && digits[0] === '1');
}

// Shared HTML escaper — also defined in email.js; var allows safe redeclaration
var _htmlEsc = function (s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

// —— VERIFICATION CONSTANTS ——
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESEND_COOLDOWN_MS  = 60 * 1000;            // 60 seconds

function _generateVerificationToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// Merges a fresh API user with the stored localStorage user to preserve the
// client-side emailVerified state. On a new device or different user, defaults
// to verified — the DB will own this field properly in production.
function _mergeVerificationState(apiUser) {
  const stored = loadCurrentUser();
  if (stored && stored.email === apiUser.email &&
      Object.prototype.hasOwnProperty.call(stored, 'emailVerified')) {
    apiUser.emailVerified              = stored.emailVerified;
    apiUser.emailVerificationToken     = stored.emailVerificationToken     ?? null;
    apiUser.emailVerificationExpiresAt = stored.emailVerificationExpiresAt ?? null;
    apiUser.notificationPreferences    = stored.notificationPreferences    || _defaultNotificationPreferences();
    apiUser.createdAt                  = stored.createdAt                  || new Date().toISOString();
  } else {
    // Different user or fresh device — treat as verified (existing-account leniency)
    apiUser.emailVerified              = true;
    apiUser.emailVerificationToken     = null;
    apiUser.emailVerificationExpiresAt = null;
    apiUser.notificationPreferences    = _defaultNotificationPreferences();
    apiUser.createdAt                  = new Date().toISOString();
  }
  return apiUser;
}

// —— PASSWORD VISIBILITY TOGGLE ——
const EYE_OPEN = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF  = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function initPasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.toggleInit) return;
    input.dataset.toggleInit = '1';
    const wrap = document.createElement('div');
    wrap.className = 'field-pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye-btn';
    btn.setAttribute('aria-label', 'Toggle password visibility');
    btn.innerHTML = EYE_OPEN;
    btn.addEventListener('click', () => {
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      btn.innerHTML = isPass ? EYE_OFF : EYE_OPEN;
    });
    wrap.appendChild(btn);
  });
}
document.addEventListener('DOMContentLoaded', initPasswordToggles);

// —— MODAL ——
function openAuth(tab, role) {
  switchAuthTab(tab);
  openModal('authModal');
  if (tab === 'signup' && role) selectRole(role);
}

function switchAuthTab(tab) {
  document.getElementById('authLogin').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('authSignup').style.display = tab === 'signup' ? 'block' : 'none';
  document.getElementById('authTabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('authTabSignup').classList.toggle('active', tab === 'signup');
  const note = document.getElementById('noAccountNote');
  if (note) note.classList.remove('show');
}

function selectRole(r) {
  selectedRole = r;
  document.getElementById('roleStudent').classList.toggle('selected', r === 'student');
  document.getElementById('roleEmployer').classList.toggle('selected', r === 'employer');
}

// —— GOOGLE OAUTH ——
// Google auth implicitly verifies the email — skip the token flow for OAuth users.
function handleGoogleAuth() {
  const redirectTo = encodeURIComponent(window.location.origin + '/auth-callback.html');
  window.location.href = SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + redirectTo;
}

// —— LOGIN ——
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  if (!email || !pass) { showToast('Please enter your email and password.', true); return; }
  if (!isValidEmail(email)) { showToast('Please enter a valid email address.', true); return; }

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const result = await res.json();

    if (!result.success) {
      if (res.status === 401) {
        document.getElementById('noAccountNote').classList.add('show');
      } else {
        showToast(result.error || 'Login failed.', true);
      }
      return;
    }

    document.getElementById('noAccountNote').classList.remove('show');
    saveToken(result.data.token);
    currentUser = _mergeVerificationState(result.data.user);
    saveCurrentUser(currentUser);
    closeModal('authModal');
    updateNavForAuth();

    if (!currentUser.emailVerified) {
      showToast('Please verify your email to access your dashboard.');
      _showVerifyPending(currentUser.email);
      return;
    }

    showToast('✓ Welcome back, ' + currentUser.first + '!');
    afterAuth();
  } catch (err) {
    showToast('Could not reach the server. Is it running?', true);
  }
}

// —— SIGNUP ——
async function doSignup() {
  const first = document.getElementById('signupFirst').value.trim();
  const last  = document.getElementById('signupLast').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const pass  = document.getElementById('signupPass').value;
  if (!first || !last || !email || !pass) { showToast('Please fill in all fields.', true); return; }
  if (!isValidEmail(email)) { showToast('Please enter a valid email address.', true); return; }
  if (pass.length < 8) { showToast('Password must be at least 8 characters.', true); return; }
  const termsBox = document.getElementById('_termsCheck');
  if (termsBox && !termsBox.checked) {
    showToast('Please accept the Terms of Use and Privacy Policy to continue.', true);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, first_name: first, last_name: last, role: selectedRole })
    });
    const result = await res.json();

    if (!result.success) {
      showToast(result.error || 'Registration failed.', true);
      return;
    }

    saveToken(result.data.token);
    currentUser = result.data.user;

    // New signups must verify their email before accessing the platform
    currentUser.emailVerified              = false;
    currentUser.emailVerificationToken     = _generateVerificationToken();
    currentUser.emailVerificationExpiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
    currentUser.notificationPreferences    = _defaultNotificationPreferences();
    currentUser.createdAt                  = currentUser.createdAt || new Date().toISOString();

    // Domain trust — determines posting permissions and coordinator review triggers
    const _domainTrusted = selectedRole === 'student'
      ? (typeof isStudentTrustedDomain === 'function' && isStudentTrustedDomain(currentUser.email))
      : (typeof isEmployerTrustedDomain === 'function' && isEmployerTrustedDomain(currentUser.email));
    currentUser.domainVerified    = _domainTrusted;
    currentUser.coordinatorApproved = _domainTrusted; // trusted domains auto-approve
    saveCurrentUser(currentUser);

    // Notify coordinators for non-board students and unknown employer domains
    if (typeof notifyCoordinators === 'function') {
      if (selectedRole === 'student' && !_domainTrusted &&
          typeof domainConfig !== 'undefined' && domainConfig.flagNonBoardStudents) {
        notifyCoordinators('newUserReview', {
          email: currentUser.email,
          name:  currentUser.name
        });
      } else if (selectedRole === 'employer' && !_domainTrusted &&
          typeof domainConfig !== 'undefined' && domainConfig.requireEmployerApproval) {
        notifyCoordinators('employerPendingApproval', {
          email:       currentUser.email,
          companyName: currentUser.name,
          userId:      currentUser.id
        });
      }
    }

    closeModal('authModal');
    updateNavForAuth();
    _sendVerificationEmail(currentUser);
    createNotification({
      userId: currentUser.id,
      type: 'signupConfirm',
      payload: { firstName: currentUser.first },
      userEmail: currentUser.email,
    });
    _showVerifyPending(currentUser.email);
  } catch (err) {
    showToast('Could not reach the server. Is it running?', true);
  }
}

// —— SIGN OUT ——
async function doSignOut() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
  } catch (_) {
    // Proceed with local logout even if server is unreachable
  }
  currentUser = null;
  saveCurrentUser(null);
  saveToken(null);
  _removeVerifyOverlays();
  updateNavForAuth();
  window.location.href = 'index.html';
}

// —— POST-AUTH ROUTING ——
function afterAuth() {
  if (currentUser.role === 'coordinator') {
    window.location.href = 'coordinator-dashboard.html';
    return;
  }
  const fullRedirect = sessionStorage.getItem('sib_auth_redirect');
  if (fullRedirect) {
    sessionStorage.removeItem('sib_auth_redirect');
    window.location.href = fullRedirect;
    return;
  }
  const target = sessionStorage.getItem('sib_auth_target');
  sessionStorage.removeItem('sib_auth_target');
  if (target) {
    if (target === 'student-apply'    && currentUser.role === 'employer') { window.location.href = 'employer-register.html'; return; }
    if (target === 'employer-register' && currentUser.role === 'student') { window.location.href = 'student-apply.html';    return; }
    window.location.href = target + '.html';
  } else {
    window.location.href = currentUser.role === 'employer' ? 'employer-register.html' : 'student-apply.html';
  }
}

// —— REQUIRE AUTH FOR A SPECIFIC URL ——
function requireAuthForUrl(url) {
  if (!currentUser) {
    sessionStorage.setItem('sib_auth_redirect', url);
    openModal('authModal');
    return;
  }
  if (!currentUser.emailVerified) {
    _showVerifyPending(currentUser.email);
    return;
  }
  window.location.href = url;
}

// —— NAV UPDATE ——
function updateNavForAuth() {
  const actions = document.getElementById('navActions');
  if (!actions) return;
  if (currentUser) {
    const unverifiedBadge = currentUser.emailVerified ? '' :
      `<span style="display:inline-block;background:#fef2f2;color:#dc2626;font-size:11px;font-weight:700;
                    padding:2px 7px;border-radius:6px;margin-left:6px;letter-spacing:0.01em;">Unverified</span>`;
    actions.innerHTML = `
      <button class="btn-fill-sm" onclick="goDashboard()">Dashboard</button>
      <div style="position:relative;display:inline-block;" id="_userMenu">
        <button onclick="toggleUserMenu(event)"
          style="display:flex;align-items:center;gap:7px;padding:7px 13px;border-radius:9px;
                 border:1.5px solid #e5e7eb;background:#fff;font-size:13.5px;font-weight:600;
                 color:var(--ink);cursor:pointer;">
          <span>${currentUser.name}</span>${unverifiedBadge}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l4 4 4-4"/></svg>
        </button>
        <div id="_userDropdown"
          style="display:none;position:absolute;right:0;top:calc(100% + 6px);background:#fff;
                 border:1.5px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.1);
                 min-width:160px;overflow:hidden;z-index:999;">
          ${!currentUser.emailVerified ? `
          <button onclick="_showVerifyPending('${_htmlEsc(currentUser.email)}')"
            style="width:100%;padding:10px 16px;text-align:left;font-size:13px;font-weight:600;
                   color:#d97706;background:#fffbeb;border:none;border-bottom:1px solid #fef3c7;
                   cursor:pointer;display:flex;align-items:center;gap:8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Verify email
          </button>` : ''}
          <button onclick="doSignOut()"
            style="width:100%;padding:11px 16px;text-align:left;font-size:13.5px;font-weight:600;
                   color:#dc2626;background:none;border:none;cursor:pointer;
                   display:flex;align-items:center;gap:9px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out
          </button>
        </div>
      </div>`;
  } else {
    actions.innerHTML = `
      <button class="btn-outline-sm" onclick="openAuth('login')">Sign In</button>
      <button class="btn-fill-sm" onclick="openAuth('signup')">Get Started</button>`;
  }
}

function toggleUserMenu(e) {
  e.stopPropagation();
  const d = document.getElementById('_userDropdown');
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', () => {
  const d = document.getElementById('_userDropdown');
  if (d) d.style.display = 'none';
});

// —— DASHBOARD GUARD ——
function goDashboard() {
  if (!currentUser) return;

  if (!currentUser.emailVerified) {
    _showVerifyPending(currentUser.email);
    return;
  }

  if (currentUser.role === 'coordinator') {
    window.location.href = 'coordinator-dashboard.html';
    return;
  }
  const isEmployer = currentUser.role === 'employer';
  const hasApp = isEmployer
    ? sessionStorage.getItem('sib_emp_data')
    : sessionStorage.getItem('sib_student_app');

  if (hasApp) {
    window.location.href = isEmployer ? 'dashboard-employer.html' : 'dashboard-student.html';
    return;
  }

  const applyPage  = isEmployer ? 'employer-register.html' : 'student-apply.html';
  const applyLabel = isEmployer ? 'Complete Company Registration' : 'Complete Your Application';
  const detail     = isEmployer
    ? 'Your dashboard will be ready once you complete the company registration form. It only takes a few minutes.'
    : 'Your dashboard will be ready once you submit your student application. It only takes about 12 minutes.';

  let overlay = document.getElementById('_dashBlockedOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_dashBlockedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,26,0.72);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:40px 36px;max-width:440px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.22);position:relative;text-align:center;">
        <button onclick="document.getElementById('_dashBlockedOverlay').remove()"
          style="position:absolute;top:14px;right:18px;font-size:22px;line-height:1;background:none;border:none;cursor:pointer;color:#9ca3af;">×</button>
        <div style="width:52px;height:52px;border-radius:14px;background:#f0f4ff;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1a6cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h2 style="font-size:20px;font-weight:700;color:#0d1117;margin:0 0 10px;letter-spacing:-0.02em;">Dashboard Not Unlocked Yet</h2>
        <p id="_dashBlockedDetail" style="font-size:14px;color:#6b7280;line-height:1.6;margin:0 0 28px;"></p>
        <button id="_dashBlockedCta" onclick=""
          style="width:100%;padding:13px;background:#0d1117;color:#fff;font-size:14px;font-weight:700;border:none;border-radius:10px;cursor:pointer;letter-spacing:-0.01em;"></button>
        <button onclick="document.getElementById('_dashBlockedOverlay').remove()"
          style="margin-top:12px;width:100%;padding:11px;background:none;color:#6b7280;font-size:13px;font-weight:600;border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;">Maybe later</button>
      </div>`;
    document.body.appendChild(overlay);
  }

  document.getElementById('_dashBlockedDetail').textContent = detail;
  const cta = document.getElementById('_dashBlockedCta');
  cta.textContent = applyLabel + ' →';
  cta.onclick = () => { window.location.href = applyPage; };
  overlay.style.display = 'flex';
}

// —— REQUIRE AUTH (used by CTA buttons) ——
function requireAuth(page) {
  if (currentUser) {
    if (!currentUser.emailVerified) { _showVerifyPending(currentUser.email); return; }
    if (page === 'student-apply'    && currentUser.role === 'employer') { window.location.href = 'employer-register.html'; return; }
    if (page === 'employer-register' && currentUser.role === 'student') { window.location.href = 'student-apply.html';    return; }
    window.location.href = page + '.html';
    return;
  }
  sessionStorage.setItem('sib_auth_target', page);
  openModal('authModal');
}

// —— REQUIRE VERIFIED (gate for protected actions) ——
// Returns true and optionally runs callback if user is logged in AND verified.
// Use this instead of requireAuth() when the action requires a verified account.
function requireVerified(callback) {
  if (!currentUser)              { openModal('authModal');                   return false; }
  if (!currentUser.emailVerified){ _showVerifyPending(currentUser.email);    return false; }
  if (typeof callback === 'function') callback();
  return true;
}

// —— VERIFICATION FLOW ——

function _sendVerificationEmail(user) {
  const link = window.location.origin + '/index.html#verify?token=' + user.emailVerificationToken;
  sendEmail({
    to:      user.email,
    subject: 'Verify your SiB email address',
    type:    'verification',
    body: [
      'Hi ' + user.first + ',',
      '',
      'Please verify your SiB email address by clicking this link:',
      link,
      '',
      'This link expires in 24 hours.',
      '',
      "If you're using an @ocdsb.ca or other school board address, this message may be",
      'filtered before reaching your inbox. Check your spam folder, or ask your',
      'co-op coordinator to manually verify your account.',
      '',
      '— The SiB Team'
    ].join('\n')
  });
}

function _handleVerificationToken(token) {
  // Clear the hash from the URL bar without reloading
  history.replaceState(null, '', window.location.pathname + window.location.search);

  if (!currentUser) {
    _showVerifyError('Please sign in first, then click the verification link again.', false);
    return;
  }
  if (currentUser.emailVerified) {
    // Already verified (e.g. link clicked twice) — just proceed
    afterAuth();
    return;
  }
  if (currentUser.emailVerificationToken !== token) {
    _showVerifyError(
      'This verification link is invalid or has already been used. Request a new one below.',
      true
    );
    return;
  }
  const expiry = currentUser.emailVerificationExpiresAt
    ? new Date(currentUser.emailVerificationExpiresAt).getTime()
    : 0;
  if (Date.now() > expiry) {
    _showVerifyError(
      'This link has expired — verification links are valid for 24 hours. Request a new one below.',
      true
    );
    return;
  }
  currentUser.emailVerified              = true;
  currentUser.emailVerificationToken     = null;
  currentUser.emailVerificationExpiresAt = null;
  saveCurrentUser(currentUser);
  _showVerifySuccess();
}

// —— RESEND (rate-limited to once per 60 s) ——
function resendVerificationEmail() {
  if (!currentUser) return;
  const lastAt = parseInt(sessionStorage.getItem('sib_resend_at') || '0');
  const elapsed = Date.now() - lastAt;
  if (elapsed < RESEND_COOLDOWN_MS) {
    const r = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
    showToast('Please wait ' + r + 's before resending.', true);
    return;
  }
  currentUser.emailVerificationToken     = _generateVerificationToken();
  currentUser.emailVerificationExpiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  saveCurrentUser(currentUser);
  _sendVerificationEmail(currentUser);
  sessionStorage.setItem('sib_resend_at', String(Date.now()));
  showToast('✓ Verification email resent.');
  _tickResendCooldown();
}

function _tickResendCooldown() {
  const btn = document.getElementById('_resendBtn');
  const cd  = document.getElementById('_resendCooldown');
  if (!btn) return;
  const lastAt = parseInt(sessionStorage.getItem('sib_resend_at') || '0');
  const remaining = RESEND_COOLDOWN_MS - (Date.now() - lastAt);
  if (remaining <= 0) return;
  btn.disabled = true;
  btn.style.opacity = '0.5';
  btn.style.cursor = 'not-allowed';
  if (cd) cd.style.display = 'block';
  (function tick() {
    const r = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - lastAt)) / 1000);
    if (r <= 0) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      if (cd) cd.style.display = 'none';
      return;
    }
    if (cd) cd.textContent = 'You can resend in ' + r + 's';
    setTimeout(tick, 1000);
  })();
}

// —— OVERLAY HELPERS ——

function _removeVerifyOverlays() {
  ['_verifyPendingOverlay', '_verifySuccessOverlay', '_verifyErrorOverlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

const _OL = 'position:fixed;inset:0;background:rgba(10,14,26,0.76);backdrop-filter:blur(6px);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
const _CW = 'background:#fff;border-radius:20px;padding:44px 36px 36px;max-width:460px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.24);text-align:center;position:relative;';

function _iconBox(bg, svg) {
  return `<div style="width:56px;height:56px;border-radius:16px;background:${bg};display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">${svg}</div>`;
}

function _showVerifyPending(email) {
  _removeVerifyOverlays();
  const el = document.createElement('div');
  el.id = '_verifyPendingOverlay';
  el.style.cssText = _OL;
  el.innerHTML = `<div style="${_CW}">
    ${_iconBox('#eff6ff','<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1a6cf6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>')}
    <h2 style="font-size:21px;font-weight:700;color:#0d1117;margin:0 0 10px;letter-spacing:-0.025em;">Check your inbox</h2>
    <p style="font-size:14px;color:#6b7280;line-height:1.65;margin:0 0 6px;">We sent a verification link to:</p>
    <p style="font-size:15px;font-weight:700;color:#0d1117;margin:0 0 20px;">${_htmlEsc(email)}</p>
    <p style="font-size:13px;color:#9ca3af;line-height:1.65;margin:0 0 28px;padding:0 4px;">
      Using an <strong style="color:#6b7280;">@ocdsb.ca</strong> or school board address?
      External mail may be filtered before it reaches you. Check your spam folder —
      or ask your <strong style="color:#6b7280;">co-op coordinator to verify your account manually</strong>
      if the email doesn't arrive.
    </p>
    <button id="_resendBtn" onclick="resendVerificationEmail()"
      style="width:100%;padding:13px;background:#0d1117;color:#fff;font-size:14px;font-weight:700;
             border:none;border-radius:10px;cursor:pointer;letter-spacing:-0.01em;margin-bottom:8px;">
      Resend verification email
    </button>
    <div id="_resendCooldown" style="display:none;font-size:12px;color:#9ca3af;padding:4px 0 8px;"></div>
    <button onclick="doSignOut()"
      style="width:100%;padding:11px;background:none;color:#9ca3af;font-size:13px;font-weight:600;
             border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;">
      Sign out
    </button>
  </div>`;
  document.body.appendChild(el);
  _tickResendCooldown();
}

function _showVerifySuccess() {
  _removeVerifyOverlays();
  const el = document.createElement('div');
  el.id = '_verifySuccessOverlay';
  el.style.cssText = _OL;
  el.innerHTML = `<div style="${_CW}">
    ${_iconBox('#f0fdf4','<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>')}
    <h2 style="font-size:21px;font-weight:700;color:#0d1117;margin:0 0 10px;letter-spacing:-0.025em;">Email verified!</h2>
    <p style="font-size:14px;color:#6b7280;line-height:1.65;margin:0 0 28px;">Your account is now fully active. Welcome to SiB.</p>
    <button onclick="_removeVerifyOverlays();afterAuth();"
      style="width:100%;padding:13px;background:#0d1117;color:#fff;font-size:14px;font-weight:700;
             border:none;border-radius:10px;cursor:pointer;letter-spacing:-0.01em;">
      Continue to dashboard →
    </button>
  </div>`;
  document.body.appendChild(el);
}

function _showVerifyError(message, showResend) {
  _removeVerifyOverlays();
  const el = document.createElement('div');
  el.id = '_verifyErrorOverlay';
  el.style.cssText = _OL;
  const resendHtml = (showResend && currentUser) ? `
    <button id="_resendBtn" onclick="resendVerificationEmail()"
      style="width:100%;padding:13px;background:#0d1117;color:#fff;font-size:14px;font-weight:700;
             border:none;border-radius:10px;cursor:pointer;letter-spacing:-0.01em;margin-bottom:8px;">
      Send a new verification link
    </button>
    <div id="_resendCooldown" style="display:none;font-size:12px;color:#9ca3af;padding:4px 0 8px;"></div>` : '';
  el.innerHTML = `<div style="${_CW}">
    ${_iconBox('#fef2f2','<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>')}
    <h2 style="font-size:21px;font-weight:700;color:#0d1117;margin:0 0 10px;letter-spacing:-0.025em;">Verification failed</h2>
    <p style="font-size:14px;color:#6b7280;line-height:1.65;margin:0 0 28px;">${_htmlEsc(message)}</p>
    ${resendHtml}
    <button onclick="_removeVerifyOverlays();"
      style="width:100%;padding:11px;background:none;color:#9ca3af;font-size:13px;font-weight:600;
             border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;">
      Close
    </button>
  </div>`;
  document.body.appendChild(el);
  if (showResend && currentUser) _tickResendCooldown();
}

// —— INIT ——
document.addEventListener('DOMContentLoaded', () => {
  updateNavForAuth();

  // Inject Terms + Privacy checkbox before the signup submit button
  const signupBtn = document.querySelector('#authSignup .btn-primary');
  if (signupBtn && !document.getElementById('_termsRow')) {
    const termsRow = document.createElement('div');
    termsRow.id = '_termsRow';
    termsRow.style.cssText = 'margin-bottom:12px;display:flex;align-items:flex-start;gap:9px;';
    termsRow.innerHTML = `
      <input type="checkbox" id="_termsCheck" style="margin-top:3px;width:15px;height:15px;accent-color:#0d1117;flex-shrink:0;cursor:pointer;">
      <label for="_termsCheck" style="font-size:12.5px;color:#6b7280;line-height:1.55;cursor:pointer;">
        I have read and agree to SiB's
        <a href="terms.html" target="_blank" style="color:#0d1117;font-weight:600;text-decoration:underline;">Terms of Use</a>
        and
        <a href="privacy.html" target="_blank" style="color:#0d1117;font-weight:600;text-decoration:underline;">Privacy Policy</a>.
      </label>`;
    signupBtn.parentNode.insertBefore(termsRow, signupBtn);
  }

  // Handle email verification link: index.html#verify?token=<token>
  const hash = window.location.hash;
  if (hash.startsWith('#verify?')) {
    const params = new URLSearchParams(hash.slice(8)); // after '#verify?'
    const token = params.get('token');
    if (token) _handleVerificationToken(token);
  }
});
