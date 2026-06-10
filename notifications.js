// ——— NOTIFICATION SYSTEM ———
// Single entry point: createNotification({ userId, type, payload, userEmail })
// Decides email dispatch based on that user's notificationPreferences.
//
// Cross-user notifications (e.g. employer notified when student applies) store
// an in-app record but skip email because the recipient's email / prefs aren't
// accessible client-side. Server-side transport handles those.

// Maps notification type → notificationPreferences key
const _PREF_KEY = {
  signupConfirm:        'signupConfirm',
  newListing:           'newListing',
  listingDigest:        'newListing',
  newApplication:       'newApplication',
  applicationSubmitted: 'applicationStatus',
  applicationStatus:    'applicationStatus',
  newMessage:           'newMessage',
  messageFlagged:       'newMessage', // coordinator-targeted; pref slot is a fallback only
  newPlacement:            'newApplication', // coordinator-targeted
  newUserReview:           'newApplication', // coordinator-targeted: non-board student signup
  employerPendingApproval: 'newApplication', // coordinator-targeted: unknown employer domain
  employerApproved:        'signupConfirm',  // employer-targeted: account approved
  concernReport:           'newApplication', // coordinator-targeted: user-submitted concern
};

// ——— EMAIL CONTENT ———

function _notifSubject(type, p) {
  switch (type) {
    case 'signupConfirm':        return 'Welcome to Students in Business — your account is ready';
    case 'newApplication':       return `New applicant: ${p.studentName || 'A student'} applied to "${p.postingTitle || 'your listing'}"`;
    case 'applicationSubmitted': return `Application received: ${p.postingTitle || 'your co-op application'}`;
    case 'applicationStatus':    return `Application update (${p.status}): ${p.postingTitle || 'Co-op listing'}`;
    case 'newListing':           return `Your listing "${p.postingTitle || 'Co-op listing'}" is now live on SiB`;
    case 'listingDigest':        return `New co-op opportunity: ${p.postingTitle || 'New listing'}`;
    case 'newMessage':           return `New message from ${p.senderName || 'your co-op contact'}`;
    case 'messageFlagged':       return `⚑ Flagged message requires coordinator review`;
    case 'newPlacement':            return `New co-op placement: ${p.studentName || 'A student'} → ${p.companyName || 'employer'}`;
    case 'newUserReview':           return `New student signup (non-board email): ${p.email || 'unknown'}`;
    case 'employerPendingApproval': return `Employer pending approval: ${p.companyName || p.email || 'unknown'}`;
    case 'employerApproved':        return 'Your SiB employer account has been approved — you can now post listings';
    case 'concernReport':           return `⚑ Concern report from ${p.senderName || 'a user'}`;
    default:                        return 'New SiB notification';
  }
}

function _notifBody(type, p) {
  // Subpath-aware base (mirrors auth.js _authCallbackUrl): include the directory
  // the app is served from so links resolve under /SiB/ on GitHub Pages, then trim
  // the trailing slash to keep the `${base}/page.html` joins clean.
  const base = (window.location.origin + window.location.pathname.replace(/[^/]*$/, '')).replace(/\/$/, '');
  const sig  = '\n\n— The SiB Team\n' + base;
  switch (type) {
    case 'signupConfirm':
      return `Hi ${p.firstName || 'there'},\n\nYour SiB account is ready. Browse open co-op listings and apply when you're set.\n\n${base}/job-listings.html${sig}`;
    case 'newApplication':
      return `Hi,\n\n${p.studentName || 'A student'} applied to your listing "${p.postingTitle || '—'}".\n\nReview their application:\n${base}/applicants.html?postingId=${p.postingId || ''}${sig}`;
    case 'applicationSubmitted':
      return `Hi ${p.firstName || 'there'},\n\nYour application to "${p.postingTitle || '—'}" at ${p.companyName || 'the employer'} was received. You can track its status in your dashboard:\n${base}/dashboard-student.html?tab=applications${sig}`;
    case 'applicationStatus':
      return `Hi ${p.firstName || 'there'},\n\nYour application to "${p.postingTitle || '—'}" has been updated.\n\nNew status: ${p.status}\n\nView it in your dashboard:\n${base}/dashboard-student.html?tab=applications${sig}`;
    case 'newListing':
      return `Hi,\n\nYour listing "${p.postingTitle || '—'}" is now live and accepting applications.\n\nView listing:\n${base}/posting.html?id=${p.postingId || ''}${sig}`;
    case 'listingDigest':
      return `Hi ${p.firstName || 'there'},\n\nA new co-op opportunity matching your interests just went live: "${p.postingTitle || '—'}"\n\nView it:\n${base}/posting.html?id=${p.postingId || ''}${sig}`;
    case 'newMessage':
      return `Hi,\n\nYou have a new message from ${p.senderName || 'your co-op contact'}: "${p.preview || ''}"\n\nReply in your dashboard:\n${base}/dashboard-${p.senderRole === 'employer' ? 'student' : 'employer'}.html?section=messages${sig}`;
    case 'messageFlagged':
      return `A message in thread ${p.threadId || ''} has been flagged for coordinator review.\nReasons: ${(p.reasons || []).join(', ')}\nPreview: "${p.messagePreview || ''}"\nReported by: ${p.senderName || 'unknown'} (${p.senderRole || ''})\n\nLog in to the coordinator dashboard to review.${sig}`;
    case 'newPlacement':
      return `A student has been accepted for a co-op placement.\n\nStudent: ${p.studentName || '—'}\nSchool: ${p.school || '—'}\nPosition: ${p.postingTitle || '—'}\nEmployer: ${p.companyName || '—'}\n\nLog in to the coordinator dashboard to track this placement:\n${base}/coordinator-dashboard.html${sig}`;
    case 'newUserReview':
      return `A student signed up with a non-board email address and requires coordinator review.\n\nName: ${p.name || '—'}\nEmail: ${p.email || '—'}\n\nLog in to review and verify:\n${base}/coordinator-dashboard.html?section=users${sig}`;
    case 'employerPendingApproval':
      return `An employer registered with an unrecognised domain and cannot post listings until approved.\n\nCompany: ${p.companyName || '—'}\nEmail: ${p.email || '—'}\n\nLog in to approve or reject:\n${base}/coordinator-dashboard.html?section=users${sig}`;
    case 'employerApproved':
      return `Hi ${p.firstName || 'there'},\n\nYour SiB employer account has been reviewed and approved by a co-op coordinator. You can now create and post co-op listings.\n\n${base}/dashboard-employer.html${sig}`;
    case 'concernReport':
      return `A concern report has been submitted.\n\nFrom: ${p.senderName || 'Anonymous'}${p.senderEmail ? ' (' + p.senderEmail + ')' : ''}\nType: ${p.type || '—'}\nDetails: ${p.detail || '—'}\n\nLog in to follow up:\n${base}/coordinator-dashboard.html${sig}`;
    default:
      return `You have a new notification on SiB.\n\nVisit your dashboard: ${base}${sig}`;
  }
}

// ——— IN-APP LABEL + NAV TARGET ———

function _notifLabel(type, p) {
  switch (type) {
    case 'signupConfirm':        return 'Welcome to SiB! Your account is ready.';
    case 'newApplication':       return `${p.studentName || 'A student'} applied to "${p.postingTitle || 'your listing'}"`;
    case 'applicationSubmitted': return `Your application to "${p.postingTitle || '—'}" was submitted.`;
    case 'applicationStatus':    return `Application update (${p.status}): ${p.postingTitle || '—'}`;
    case 'newListing':           return `Your listing "${p.postingTitle || '—'}" is now live.`;
    case 'listingDigest':        return `New listing: "${p.postingTitle || '—'}"`;
    case 'newMessage':           return `New message from ${p.senderName || 'your co-op contact'}${p.preview ? ': "' + p.preview + '"' : ''}`;
    case 'messageFlagged':          return '⚑ Flagged message — coordinator review required';
    case 'newPlacement':            return `New placement: ${p.studentName || 'A student'} accepted at ${p.companyName || 'employer'}`;
    case 'newUserReview':           return `Review needed: student signup from non-board email (${p.email || '—'})`;
    case 'employerPendingApproval': return `Employer pending approval: ${p.companyName || p.email || '—'}`;
    case 'employerApproved':        return 'Your employer account has been approved — you can now post listings.';
    case 'concernReport':           return `⚑ Concern report from ${p.senderName || 'a user'}: ${p.type || '—'}`;
    case 'introRequestReceived':    return `${p.companyName || 'An employer'} requested an introduction${p.note ? ': "' + p.note + '"' : ''}`;
    default:                        return 'New notification';
  }
}

function _notifHref(type, p) {
  switch (type) {
    case 'newApplication':        return `applicants.html?postingId=${p.postingId || ''}`;
    case 'applicationSubmitted':
    case 'applicationStatus':     return 'dashboard-student.html?tab=applications';
    case 'newListing':
    case 'listingDigest':         return `posting.html?id=${p.postingId || ''}`;
    case 'newMessage':
      return p.senderRole === 'employer'
        ? 'dashboard-student.html?section=messages'
        : 'dashboard-employer.html?section=messages';
    case 'messageFlagged':
    case 'newPlacement':
    case 'concernReport':           return 'coordinator-dashboard.html';
    case 'newUserReview':
    case 'employerPendingApproval': return 'coordinator-dashboard.html?section=users';
    case 'employerApproved':        return 'dashboard-employer.html';
    case 'introRequestReceived':    return 'dashboard-student.html?section=notifications';
    default:                        return '#';
  }
}

// ——— CORE FUNCTION ———

async function createNotification({ userId, type, payload = {}, userEmail = null }) {
  if (!userId || !type) return null;

  // 1. Always write the in-app record
  const notif = await _insertNotification({ userId, type, payload });

  // 2. Resolve preference — only possible when the recipient IS the current user
  const prefKey = _PREF_KEY[type] || type;
  let pref = 'immediate';
  if (currentUser && currentUser.id === userId && currentUser.notificationPreferences) {
    pref = currentUser.notificationPreferences[prefKey] ?? 'immediate';
  }

  // 3. Email dispatch
  if (pref === 'immediate' && userEmail && notif) {
    sendEmail({
      to:      userEmail,
      subject: _notifSubject(type, payload),
      body:    _notifBody(type, payload),
      type:    'notification',
    });
    markNotificationEmailed(notif.id); // fire-and-forget
  }
  // pref === 'daily' → stored for batch delivery; no immediate email sent
  // pref === 'off'   → in-app only, never emailed

  // 4. Refresh bell badge if the recipient is currently logged in
  if (currentUser && currentUser.id === userId) _refreshNotifBadge(); // fire-and-forget

  return notif;
}

// ——— COORDINATOR BULK NOTIFY ———
// Path A: clients cannot insert notifications for other users (RLS). Coordinator
// fan-out goes through the SECURITY DEFINER notify_coordinators() RPC, which
// validates the type and writes one record per coordinator server-side.
// Used by auth.js (newUserReview / employerPendingApproval), app.js
// (concernReport), and messaging.js (messageFlagged, user-initiated report).
// newPlacement / messageFlagged-on-send are fired by DB triggers, not here.
async function notifyCoordinators(type, payload) {
  try {
    const sb = window._supabase;
    if (!sb) return;
    await sb.rpc('notify_coordinators', { p_type: type, p_payload: payload || {} });
  } catch (_) {}
}

// ——— PREFERENCES ———

function setNotifPref(key, value) {
  if (!currentUser) return;
  if (!currentUser.notificationPreferences) {
    currentUser.notificationPreferences = _defaultNotificationPreferences();
  }
  currentUser.notificationPreferences[key] = value;
  saveCurrentUser(currentUser);
}

// ——— BELL BADGE ———

async function _refreshNotifBadge() {
  const badge = document.getElementById('_notifBadge');
  if (!badge || !currentUser) return;
  const notifs = await getNotifications(currentUser.id);
  const count = notifs.filter(n => !n.readAt).length;
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

// ——— DROPDOWN ———

async function toggleNotifDropdown(e) {
  if (e) e.stopPropagation();
  const existing = document.getElementById('_notifDropdown');
  if (existing) { existing.remove(); return; }
  if (!currentUser) return;

  const notifs = (await getNotifications(currentUser.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 12);

  // Position: fixed, just to the right of the sidebar
  const sidebar = document.querySelector('.dash-sidebar');
  const sidebarW = sidebar ? sidebar.getBoundingClientRect().right : 240;

  const dd = document.createElement('div');
  dd.id = '_notifDropdown';
  dd.style.cssText = [
    'position:fixed', `left:${sidebarW}px`, 'top:0',
    'width:330px', 'max-height:100vh', 'overflow-y:auto',
    'background:#fff', 'border-right:1.5px solid #e5e7eb', 'border-bottom:1.5px solid #e5e7eb',
    'border-radius:0 0 16px 0',
    'box-shadow:8px 0 32px rgba(0,0,0,0.12)',
    'z-index:8888', 'display:flex', 'flex-direction:column'
  ].join(';');

  const itemsHtml = notifs.length ? notifs.map(n => {
    const unread = !n.readAt;
    const label  = _notifLabel(n.type, n.payload);
    const href   = _notifHref(n.type, n.payload);
    const ago    = typeof timeAgo === 'function' ? timeAgo(n.createdAt) : '';
    return `
      <button onclick="_openNotif('${n.id}','${_htmlEsc(href)}')"
        style="width:100%;padding:13px 18px 11px;text-align:left;
               background:${unread ? '#f5f8ff' : '#fff'};border:none;
               border-bottom:1px solid #f3f4f6;cursor:pointer;
               display:flex;flex-direction:column;gap:3px;
               border-left:3px solid ${unread ? '#1a6cf6' : 'transparent'};">
        <div style="font-size:13px;font-weight:${unread ? '600' : '400'};
                    color:#0d1117;line-height:1.4;">${_htmlEsc(label)}</div>
        <div style="font-size:11.5px;color:#9ca3af;">${ago}</div>
      </button>`;
  }).join('') : `
    <div style="padding:36px 18px;text-align:center;font-size:13.5px;color:#9ca3af;">
      No notifications yet.
    </div>`;

  dd.innerHTML = `
    <div style="padding:15px 18px 12px;border-bottom:1px solid #f3f4f6;
                display:flex;justify-content:space-between;align-items:center;
                position:sticky;top:0;background:#fff;z-index:1;">
      <span style="font-size:14px;font-weight:700;color:#0d1117;">Notifications</span>
      <div style="display:flex;gap:10px;align-items:center;">
        <button onclick="_markAllRead()"
          style="font-size:12px;font-weight:600;color:#1a6cf6;background:none;border:none;cursor:pointer;padding:0;">
          Mark all read
        </button>
        <button onclick="document.getElementById('_notifDropdown').remove()"
          style="font-size:19px;line-height:1;color:#9ca3af;background:none;border:none;cursor:pointer;padding:0;">×</button>
      </div>
    </div>
    <div>${itemsHtml}</div>`;

  document.body.appendChild(dd);
  setTimeout(() => document.addEventListener('click', _closeNotifOnOutside, { once: true }), 0);
}

function _closeNotifOnOutside(e) {
  const dd = document.getElementById('_notifDropdown');
  if (dd && !dd.contains(e.target)) dd.remove();
  else if (dd) document.addEventListener('click', _closeNotifOnOutside, { once: true });
}

function _openNotif(id, href) {
  markNotificationRead(id);  // fire-and-forget async
  _refreshNotifBadge();      // fire-and-forget async
  const dd = document.getElementById('_notifDropdown');
  if (dd) dd.remove();
  if (href && href !== '#') window.location.href = href;
}

async function _markAllRead() {
  if (!currentUser) return;
  await markAllNotificationsRead(); // single bulk endpoint
  _refreshNotifBadge();             // fire-and-forget
  const dd = document.getElementById('_notifDropdown');
  if (dd) dd.remove();
}

// ——— BELL INIT (called from each dashboard's DOMContentLoaded) ———

function initNotifBell() {
  if (!currentUser) return;
  const bottom = document.querySelector('.sidebar-bottom');
  if (!bottom) return;

  const btn = document.createElement('button');
  btn.id = '_notifBellBtn';
  btn.title = 'Notifications';
  btn.onclick = toggleNotifDropdown;
  btn.style.cssText = [
    'display:flex', 'align-items:center', 'gap:8px',
    'background:none', 'border:none', 'cursor:pointer',
    'font-size:13px', 'font-weight:600', 'color:var(--text-muted,#6b7280)',
    'padding:8px 0', 'position:relative', 'width:100%'
  ].join(';');
  btn.innerHTML = `
    <span style="position:relative;display:inline-flex;align-items:center;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <span id="_notifBadge"
        style="display:none;position:absolute;top:-6px;right:-8px;background:#dc2626;color:#fff;
               font-size:9px;font-weight:800;min-width:16px;height:16px;border-radius:8px;
               align-items:center;justify-content:center;padding:0 3px;border:2px solid #fff;">0</span>
    </span>
    Notifications`;

  // Insert before the sign-out button
  const signout = bottom.querySelector('.sidebar-signout');
  if (signout) bottom.insertBefore(btn, signout);
  else bottom.prepend(btn);

  _refreshNotifBadge();
}

// ——— PREFERENCES PAGE BUILDER ———

const _PREF_ROWS_STUDENT = [
  { key: 'signupConfirm',     label: 'Account confirmation',  desc: 'When your account is created' },
  { key: 'applicationStatus', label: 'Application updates',   desc: 'When an employer changes your application status' },
  { key: 'newListing',        label: 'New co-op listings',    desc: 'When a new placement matching your interests is posted' },
  { key: 'newMessage',        label: 'Messages',              desc: 'When you receive a message from an employer or coordinator' },
];
const _PREF_ROWS_EMPLOYER = [
  { key: 'signupConfirm',  label: 'Account confirmation', desc: 'When your account is created' },
  { key: 'newApplication', label: 'New applicants',       desc: 'When a student applies to one of your listings' },
  { key: 'newMessage',     label: 'Messages',             desc: 'When you receive a message from a student or coordinator' },
];

function buildNotifPrefsHtml(role) {
  if (!currentUser) return '';
  const rows = role === 'employer' ? _PREF_ROWS_EMPLOYER : _PREF_ROWS_STUDENT;
  const prefs = currentUser.notificationPreferences || _defaultNotificationPreferences();

  const rowsHtml = rows.map(row => {
    const cur = prefs[row.key] || 'immediate';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:16px 0;border-bottom:1px solid #f3f4f6;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-size:14px;font-weight:600;color:#0d1117;">${row.label}</div>
          <div style="font-size:12.5px;color:#9ca3af;margin-top:2px;">${row.desc}</div>
        </div>
        <div style="display:flex;gap:4px;" id="pref-btns-${row.key}">
          ${['immediate','daily','off'].map(v => `
            <button onclick="setNotifPref('${row.key}','${v}');_highlightPrefBtn('${row.key}','${v}')"
              class="_pref-btn" data-key="${row.key}" data-val="${v}"
              style="padding:6px 13px;border-radius:7px;font-size:12.5px;font-weight:600;cursor:pointer;
                     border:1.5px solid ${v === cur ? '#1a6cf6' : '#e5e7eb'};
                     background:${v === cur ? '#eff6ff' : '#fff'};
                     color:${v === cur ? '#1a6cf6' : '#6b7280'};">
              ${v.charAt(0).toUpperCase() + v.slice(1)}
            </button>`).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="dash-header">
      <div class="dash-title">Notification Settings</div>
      <div class="dash-sub">Choose how you want to receive each type of notification.</div>
    </div>
    <div class="tracker-card">
      <div style="font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:4px;
                  padding:12px 16px;background:#f8f9fb;border-radius:9px;border:1px solid #e5e7eb;">
        <strong>Immediate</strong> — sent right away &nbsp;·&nbsp;
        <strong>Daily</strong> — batched into a digest (coming soon) &nbsp;·&nbsp;
        <strong>Off</strong> — in-app only, no emails
      </div>
      <div>${rowsHtml}</div>
    </div>`;
}

function _highlightPrefBtn(key, selected) {
  document.querySelectorAll(`._pref-btn[data-key="${key}"]`).forEach(btn => {
    const active = btn.dataset.val === selected;
    btn.style.border = `1.5px solid ${active ? '#1a6cf6' : '#e5e7eb'}`;
    btn.style.background = active ? '#eff6ff' : '#fff';
    btn.style.color = active ? '#1a6cf6' : '#6b7280';
  });
  showToast('✓ Preference saved.');
}
