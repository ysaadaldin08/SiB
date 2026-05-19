// ——— SiB DATA LAYER — API-backed ———
// All functions are async. Page-level DOMContentLoaded handlers must use
// async/await or .then() when calling these functions.
// API_BASE and getToken() are provided by config.js, loaded before this script.

function _authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` };
}

async function _get(path) {
  const res = await fetch(API_BASE + path, { headers: _authHeaders() });
  return res.json();
}
async function _post(path, body) {
  const res = await fetch(API_BASE + path, { method: 'POST', headers: _authHeaders(), body: JSON.stringify(body) });
  return res.json();
}
async function _put(path, body) {
  const res = await fetch(API_BASE + path, { method: 'PUT', headers: _authHeaders(), body: JSON.stringify(body) });
  return res.json();
}
async function _del(path) {
  const res = await fetch(API_BASE + path, { method: 'DELETE', headers: _authHeaders() });
  return res.json();
}

// ——— SHAPE CONVERTERS ———
// API returns snake_case; the frontend uses camelCase. These translate between them.

function _postingFromApi(p) {
  if (!p) return null;
  return {
    id: p.id,
    employerId: p.employer_id,
    companyName: p.employers?.company_name || '',
    supervisorName: p.employers?.contact_name || '',
    title: p.title || '',
    track: p.track || '',
    workMode: p.work_mode || 'On-site',
    hoursPerWeek: p.hours_per_week || 20,
    location: p.location || 'Ottawa',
    startDate: p.start_date || '',
    deadline: p.deadline || '',
    description: p.description || '',
    responsibilities: p.responsibilities || '',
    requirements: p.requirements || '',
    isActive: p.is_active,
    createdAt: p.created_at,
    updatedAt: p.updated_at
  };
}

function _postingToApi(data) {
  const body = {};
  if (data.title !== undefined)           body.title = data.title;
  if (data.description !== undefined)     body.description = data.description;
  if (data.responsibilities !== undefined) body.responsibilities = data.responsibilities;
  if (data.requirements !== undefined)    body.requirements = data.requirements;
  if (data.track !== undefined)           body.track = data.track;
  if (data.workMode !== undefined)        body.work_mode = data.workMode;
  if (data.hoursPerWeek !== undefined)    body.hours_per_week = data.hoursPerWeek;
  if (data.location !== undefined)        body.location = data.location;
  if (data.startDate !== undefined)       body.start_date = data.startDate;
  if (data.deadline !== undefined)        body.deadline = data.deadline;
  if (data.isActive !== undefined)        body.is_active = data.isActive;
  return body;
}

function _appFromApi(a) {
  if (!a) return null;
  return {
    id: a.id,
    postingId: a.posting_id,
    studentId: a.student_id,
    studentEmail: a.students?.email || null,
    studentName: a.students?.full_name || '',
    school: a.students?.school || '',
    grade: a.students?.grade || '',
    coverNote: a.cover_note || '',
    resumeUrl: a.resume_url || '',
    status: a.status || 'Applied',
    appliedAt: a.created_at,
    updatedAt: a.updated_at,
    _posting: a.postings ? _postingFromApi(a.postings) : null,
    _student: a.students || null
  };
}

// ——— POSTINGS ———

async function getActivePostings() {
  try {
    const result = await _get('/postings');
    if (!result.success) return [];
    return result.data.map(_postingFromApi);
  } catch (_) { return []; }
}

async function getPostingById(id) {
  try {
    const result = await _get(`/postings/${id}`);
    if (!result.success) return null;
    return _postingFromApi(result.data);
  } catch (_) { return null; }
}

async function getPostingsByEmployer(_email) {
  // _email ignored — identity comes from the auth token
  try {
    const result = await _get('/postings/mine');
    if (!result.success) return [];
    return result.data.map(_postingFromApi);
  } catch (_) { return []; }
}

async function createPosting(data) {
  const result = await _post('/postings', _postingToApi(data));
  if (!result.success) throw new Error(result.error);
  return _postingFromApi(result.data);
}

async function updatePosting(id, data) {
  const result = await _put(`/postings/${id}`, _postingToApi(data));
  return result.success;
}

async function archivePosting(id)    { return updatePosting(id, { isActive: false }); }
async function reactivatePosting(id) { return updatePosting(id, { isActive: true }); }

async function deletePosting(id) {
  const result = await _del(`/postings/${id}`);
  return result.success;
}

// ——— APPLICATIONS ———

async function getApplicationsByStudent(_email) {
  // _email ignored — identity comes from the auth token
  try {
    const result = await _get('/applications/mine');
    if (!result.success) return [];
    return result.data.map(_appFromApi);
  } catch (_) { return []; }
}

async function getApplicationsByPosting(postingId) {
  try {
    const result = await _get(`/applications/posting/${postingId}`);
    if (!result.success) return [];
    return result.data.map(_appFromApi);
  } catch (_) { return []; }
}

async function hasApplied(_studentEmail, postingId) {
  if (!postingId) return false;
  try {
    const apps = await getApplicationsByStudent();
    return apps.some(a => a.postingId === postingId);
  } catch (_) { return false; }
}

async function getApplicationForPosting(_studentEmail, postingId) {
  if (!postingId) return null;
  try {
    const apps = await getApplicationsByStudent();
    return apps.find(a => a.postingId === postingId) || null;
  } catch (_) { return null; }
}

async function createApplication(data) {
  const result = await _post('/applications', {
    posting_id: data.postingId,
    cover_note: data.coverNote || '',
    resume_url: data.resumeUrl || ''
  });
  if (!result.success) throw new Error(result.error);
  return _appFromApi(result.data);
}

async function updateApplicationStatus(id, status) {
  const result = await _put(`/applications/${id}`, { status });
  return result.success;
}

// ——— STATS ———

async function getStudentStats(_email) {
  const apps = await getApplicationsByStudent();
  const active = apps.filter(a => a.status === 'Under Review' || a.status === 'Interview').length;
  return { total: apps.length, active, latest: apps[0]?.appliedAt || null };
}

async function getEmployerStats(_email) {
  const postings = await getPostingsByEmployer();
  const appArrays = await Promise.all(postings.map(p => getApplicationsByPosting(p.id)));
  const totalApplicants = appArrays.reduce((sum, arr) => sum + arr.length, 0);
  return {
    total: postings.length,
    active: postings.filter(p => p.isActive).length,
    totalApplicants
  };
}

// ——— FORMATTERS (unchanged — no API dependency) ———

function formatDateShort(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDeadlineDate(dateStr) {
  if (!dateStr) return 'Open until filled';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(e) { return dateStr; }
}

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + 'd ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  return Math.floor(days / 30) + 'mo ago';
}

// ——— BADGE / PILL HELPERS (unchanged) ———

const TRACK_CLASS = {
  'Technology & IT':              'tt-tech',
  'Business & Finance':           'tt-bizfin',
  'Marketing & Communications':   'tt-mktcomm',
  'Health & Sciences':            'tt-health',
  'Education & Social Services':  'tt-edu',
  'Trades & Engineering':         'tt-trades',
  'Arts, Media & Design':         'tt-arts',
  'Law & Government':             'tt-law',
  'Hospitality & Food Services':  'tt-hosp',
  'Retail & Customer Service':    'tt-retail'
};
const STATUS_CLASS = {
  'Applied': 'sp-applied', 'Under Review': 'sp-review',
  'Interview': 'sp-interview', 'Rejected': 'sp-rejected', 'Accepted': 'sp-approved'
};
const WORK_MODE_CLASS = { 'Remote': 'wm-remote', 'Hybrid': 'wm-hybrid', 'On-site': 'wm-onsite' };

function statusPill(status) {
  return `<span class="status-pill ${STATUS_CLASS[status] || 'sp-applied'}">${status}</span>`;
}
function trackTag(track) {
  return `<span class="ttag ${TRACK_CLASS[track] || 'tt-biz'}">${track}</span>`;
}
function workModeBadge(mode) {
  return `<span class="wm-badge ${WORK_MODE_CLASS[mode] || 'wm-onsite'}">${mode}</span>`;
}

function postingCardHTML(posting, opts = {}) {
  const initial = posting.companyName ? posting.companyName.charAt(0) : '?';
  const deadlineText = posting.deadline
    ? 'Deadline: ' + formatDeadlineDate(posting.deadline)
    : 'Open until filled';
  const deadlineCls = posting.deadline ? 'posting-card-deadline' : 'posting-card-date';
  const href = opts.href || ('posting.html?id=' + posting.id);
  return `
    <a class="posting-card" href="${href}">
      <div class="posting-card-top">
        <div class="posting-company-logo">${initial}</div>
        <div class="posting-card-info">
          <div class="posting-card-company">${posting.companyName}</div>
          <div class="posting-card-title">${posting.title}</div>
        </div>
        ${workModeBadge(posting.workMode)}
      </div>
      <div class="posting-card-tags">
        ${trackTag(posting.track)}
        <span class="ttag" style="background:var(--mist);color:var(--text-muted);">${posting.hoursPerWeek} hrs/week</span>
      </div>
      <div class="posting-card-meta">
        <span>${posting.location}</span>
        ${posting.startDate ? `<span>Start: ${posting.startDate}</span>` : ''}
      </div>
      <div class="posting-card-footer">
        <span class="posting-card-date">Posted ${timeAgo(posting.createdAt)}</span>
        <span class="${deadlineCls}">${deadlineText}</span>
      </div>
    </a>`;
}

// ——— FLAGGED TERMS CONFIG ———
// offPlatformPhrases and profanity are substring-matched (case-insensitive) against
// every message body. The regex arrays (phoneNumbers, emails, etc.) are reserved for
// future server-side or custom override use — moderation.js uses its own hard-coded
// regex patterns which are more reliable.
const flaggedTerms = {
  phoneNumbers:       [],  // RegExp[] — moderation.js handles phone detection via its own patterns
  emails:             [],  // RegExp[] — moderation.js handles personal email detection
  socialHandles:      [],  // RegExp[] — moderation.js handles @handle and platform name detection
  urls:               [],  // RegExp[] — moderation.js handles URL detection
  profanity:          [],  // string[] — add terms here; matched as substrings, case-insensitive
  offPlatformPhrases: [    // string[] — phrases that suggest moving off-platform
    'text me', 'call me', 'my number is', 'my phone is', 'phone number is',
    'add me on', 'dm me', "let's move this to", 'email me at', 'reach me at',
    'contact me at', 'message me on', 'find me on', 'follow me on',
    'my instagram', 'my snapchat', 'my discord', 'my telegram', 'my whatsapp',
    'on instagram', 'on snapchat', 'on discord', 'on telegram', 'on whatsapp',
    'text me at', 'call me at', 'phone me', "i'll text you", "i'll call you",
    'outside of this', 'off this platform', 'off-platform', 'another way to reach'
  ]
};

// ——— DOMAIN TRUST CONFIG ———
// trustedStudentDomains: board-issued addresses receive a "Verified school account" badge.
// Non-board students may still sign up but are flagged for coordinator review.
// trustedEmployerDomains: known KNBA-member company domains bypass coordinator approval.
// requireEmployerApproval: when true, unknown employer domains cannot post until a
// coordinator explicitly approves their account.
const domainConfig = {
  trustedStudentDomains:   ['ocdsb.ca', 'ocdsbstudents.ca', 'ocsb.ca'],
  trustedEmployerDomains:  [], // Populate with KNBA-member domains when confirmed
  flagNonBoardStudents:    true,
  requireEmployerApproval: true
};

function getDomainFromEmail(email) {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

function isStudentTrustedDomain(email) {
  const domain = getDomainFromEmail(email);
  return domainConfig.trustedStudentDomains.some(d => domain === d || domain.endsWith('.' + d));
}

function isEmployerTrustedDomain(email) {
  const domain = getDomainFromEmail(email);
  return domainConfig.trustedEmployerDomains.some(d => domain === d || domain.endsWith('.' + d));
}

// Returns true if this employer may create new listings.
// After 2.3 migration, coordinatorApproved comes from employers.coordinator_approved
// (reflected on the user object from login) — no localStorage fallback.
function employerCanPost(user) {
  if (!user || user.role !== 'employer') return false;
  if (!domainConfig.requireEmployerApproval) return true;
  return !!(user.domainVerified || user.coordinatorApproved);
}

// ——— localStorage HELPERS (legacy — only sib_user and sib_token remain here) ———

function _lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { return []; }
}
function _lsSet(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }
function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function _defaultNotificationPreferences() {
  return {
    signupConfirm:     'immediate',
    newApplication:    'immediate',
    applicationStatus: 'immediate',
    newListing:        'immediate',
    newMessage:        'immediate'
  };
}

// ——— SHAPE CONVERTERS (API → camelCase) ———

function _notificationFromApi(n) {
  return {
    id:        n.id,
    userId:    n.user_id,
    type:      n.type,
    payload:   n.payload    || {},
    createdAt: n.created_at,
    readAt:    n.read_at    || null,
    emailedAt: n.emailed_at || null
  };
}

function _threadFromApi(t) {
  return {
    id:               t.id,
    studentId:        t.student_id,
    employerId:       t.employer_id,
    listingId:        t.listing_id        || null,
    applicationId:    t.application_id    || null,
    createdAt:        t.created_at,
    createdBy:        t.created_by        || null,
    lastMessageAt:    t.last_message_at   || t.created_at,
    status:           t.status            || 'open',
    reviewedAt:       t.reviewed_at       || null,
    reviewedBy:       t.reviewed_by       || null,
    coordinatorNote:  t.coordinator_note  || null,
    participantNames: typeof t.participant_names === 'object' && t.participant_names
      ? {
          studentName:  t.participant_names.studentName  || 'Student',
          employerName: t.participant_names.employerName || 'Employer',
          listingTitle: t.participant_names.listingTitle || ''
        }
      : { studentName: 'Student', employerName: 'Employer', listingTitle: '' },
    // Enrichment fields populated by the server on list endpoints
    preview:            t._preview       || null,
    messageCount:       t._message_count || 0,
    flaggedCount:       t._flagged_count || 0,
    flagReasonsSummary: t._flag_reasons  || []
  };
}

function _messageFromApi(m) {
  return {
    id:                    m.id,
    threadId:              m.thread_id,
    senderId:              m.sender_id,
    senderRole:            m.sender_role,
    body:                  m.body,
    createdAt:             m.created_at,
    flagged:               m.flagged               || false,
    flagReasons:           m.flag_reasons          || [],
    reviewedByCoordinator: m.reviewed_by_coordinator || false
  };
}

// ——— NOTIFICATIONS (server-backed — 2.1) ———

async function getNotifications(_userId) {
  // _userId param kept for call-site compatibility; server filters by JWT token.
  try {
    const r = await _get('/notifications');
    if (!r.success) return [];
    return (r.data || []).map(_notificationFromApi);
  } catch (_) { return []; }
}

async function _insertNotification(data) {
  try {
    const r = await _post('/notifications', {
      user_id: data.userId,
      type:    data.type,
      payload: data.payload || {}
    });
    if (!r.success) return null;
    return _notificationFromApi(r.data);
  } catch (_) { return null; }
}

async function markNotificationRead(id) {
  try { await _put(`/notifications/${id}/read`, {}); return true; } catch (_) { return false; }
}

async function markNotificationEmailed(id) {
  try { await _put(`/notifications/${id}/emailed`, {}); return true; } catch (_) { return false; }
}

async function markAllNotificationsRead() {
  try { await _put('/notifications/read-all', {}); return true; } catch (_) { return false; }
}

// ——— MESSAGE THREADS (server-backed — 2.4) ———

async function getMessageThreads(_userId, _role) {
  // _userId/_role kept for call-site compatibility; server filters by JWT token.
  try {
    const r = await _get('/threads');
    if (!r.success) return [];
    return (r.data || []).map(_threadFromApi);
  } catch (_) { return []; }
}

async function getMessageThreadById(id) {
  try {
    const r = await _get(`/threads/${id}`);
    if (!r.success) return null;
    return _threadFromApi(r.data);
  } catch (_) { return null; }
}

async function createMessageThread(data) {
  const r = await _post('/threads', {
    student_id:        data.studentId,
    employer_id:       data.employerId,
    listing_id:        data.listingId        || null,
    application_id:    data.applicationId    || null,
    participant_names: data.participantNames || {}
  });
  if (!r.success) throw new Error(r.error || 'Could not create thread');
  return _threadFromApi(r.data);
}

async function updateMessageThreadStatus(id, status) {
  try {
    const r = await _put(`/threads/${id}/status`, { status });
    return r.success;
  } catch (_) { return false; }
}

// Returns all threads — coordinator-only (calls /api/coordinator/threads).
async function getAllMessageThreads() {
  try {
    const r = await _get('/coordinator/threads');
    if (!r.success) return [];
    return (r.data || []).map(_threadFromApi);
  } catch (_) { return []; }
}

async function coordinatorReviewThread(threadId, { note } = {}) {
  try {
    const r = await _put(`/threads/${threadId}/review`, { note: note || null });
    return r.success;
  } catch (_) { return false; }
}

// ——— MESSAGES (server-backed — 2.5) ———

async function getMessages(threadId) {
  try {
    const r = await _get(`/threads/${threadId}/messages`);
    if (!r.success) return [];
    return (r.data || []).map(_messageFromApi);
  } catch (_) { return []; }
}

async function createMessage(data) {
  const r = await _post(`/threads/${data.threadId}/messages`, {
    body:         data.body,
    flagged:      data.flagged      || false,
    flag_reasons: data.flagReasons  || []
  });
  if (!r.success) throw new Error(r.error || 'Could not send message');
  return _messageFromApi(r.data);
}

// flagMessage is now a no-op — flag state is embedded in createMessage call.
async function flagMessage(_id, _reasons) { return true; }

async function markMessageReviewed(id) {
  try {
    const r = await _put(`/coordinator/messages/${id}/review`, {});
    return r.success;
  } catch (_) { return false; }
}

async function getThreadForApplication(applicationId) {
  if (!applicationId) return null;
  try {
    const threads = await getMessageThreads();
    return threads.find(t => t.applicationId === applicationId) || null;
  } catch (_) { return null; }
}

// Rate limiting is now enforced server-side (POST /api/threads returns 429 on limit).
// Always returns allowed on the client; callers handle 429 errors from the server.
function checkMessageRateLimit(_userId) {
  return { allowed: true, reason: '' };
}

// ——— COORDINATORS (server-backed — 2.2) ———
// Reads from profiles where role='coordinator' via GET /api/coordinators.

async function getCoordinators() {
  try {
    const r = await _get('/coordinators');
    if (!r.success) return [];
    return (r.data || []).map(c => ({ id: c.id, email: c.email, role: c.role }));
  } catch (_) { return []; }
}

// Stubs kept for call-site compatibility; filter from the live list.
async function getCoordinatorById(id) {
  const all = await getCoordinators();
  return all.find(c => c.id === id) || null;
}

async function getCoordinatorByEmail(email) {
  if (!email) return null;
  const all = await getCoordinators();
  return all.find(c => c.email.toLowerCase() === email.toLowerCase()) || null;
}

// No-op — coordinators are now real Supabase Auth users; creation is out-of-scope.
function createCoordinator(_data) { return null; }

// ——— MIGRATION ———
// Runs once on every page load. Version-gated to skip the body on repeat loads.
// Bump DATA_VERSION any time you change the migration logic.
const DATA_VERSION = '2026-05-14'; // bumped for Phase 2 (sib_coordinators seed removed)

function migrateExistingData() {
  if (localStorage.getItem('sib_data_version') === DATA_VERSION) return;

  // Extend any stored sib_user with the new auth/notification fields.
  // emailVerified is set to true for existing accounts so dev sessions aren't locked out.
  try {
    const raw = localStorage.getItem('sib_user');
    if (raw) {
      const user = JSON.parse(raw);
      let dirty = false;
      const defaults = {
        emailVerified:              true,
        emailVerificationToken:     null,
        emailVerificationExpiresAt: null,
        notificationPreferences:    _defaultNotificationPreferences(),
        createdAt:                  new Date().toISOString(),
        domainVerified:             true,
        coordinatorApproved:        true
      };
      Object.entries(defaults).forEach(([k, v]) => {
        if (!Object.prototype.hasOwnProperty.call(user, k)) { user[k] = v; dirty = true; }
      });
      if (dirty) localStorage.setItem('sib_user', JSON.stringify(user));
    }
  } catch (_) {}

  localStorage.setItem('sib_data_version', DATA_VERSION);
}

migrateExistingData();
