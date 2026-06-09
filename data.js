// ——— SiB DATA LAYER — direct Supabase (Path A) ———
// All functions are async. Page-level DOMContentLoaded handlers must use
// async/await or .then() when calling these functions.
// window._supabase is created in config.js (loaded before this script). There is
// NO Node API in Path A — every read/write goes straight to Supabase and is
// scoped by Row Level Security (see supabase/migrations/20260603000000_*).

function _sb() { return window._supabase || null; }
async function _uid() {
  const sb = _sb();
  if (!sb) return null;
  try { const { data } = await sb.auth.getUser(); return data?.user?.id || null; } catch (_) { return null; }
}

// ——— SHAPE CONVERTERS ———
// Supabase returns snake_case; the frontend uses camelCase.

function _postingFromApi(p) {
  if (!p) return null;
  return {
    id: p.id,
    employerId: p.employer_id,
    // company_name is denormalized onto postings (set by a DB trigger from the
    // employer row) so the public board never has to read the employers table.
    companyName: p.company_name || p.employers?.company_name || '',
    supervisorName: p.supervisor_name || p.employers?.contact_name || '',
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
  if (data.title !== undefined)            body.title = data.title;
  if (data.description !== undefined)      body.description = data.description;
  if (data.responsibilities !== undefined) body.responsibilities = data.responsibilities;
  if (data.requirements !== undefined)     body.requirements = data.requirements;
  if (data.track !== undefined)            body.track = data.track;
  if (data.workMode !== undefined)         body.work_mode = data.workMode;
  if (data.hoursPerWeek !== undefined)     body.hours_per_week = data.hoursPerWeek;
  if (data.location !== undefined)         body.location = data.location;
  if (data.startDate !== undefined)        body.start_date = data.startDate;
  if (data.deadline !== undefined)         body.deadline = data.deadline;
  if (data.supervisorName !== undefined)   body.supervisor_name = data.supervisorName;
  if (data.isActive !== undefined)         body.is_active = data.isActive;
  // NOTE: company_name is intentionally NOT settable from the client — the DB
  // trigger derives it from the authoritative employers row.
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
    flagged:               m.flagged                 || false,
    flagReasons:           m.flag_reasons            || [],
    reviewedByCoordinator: m.reviewed_by_coordinator || false
  };
}

// ——— POSTINGS ———
// Public job board reads the `postings_public` VIEW (active rows, no person-level
// fields). Employer management + the owner/coordinator/accepted paths read the
// base `postings` table (RLS scopes the rows; the view hides supervisor_name).

async function getActivePostings() {
  const sb = _sb();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('postings_public')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map(_postingFromApi);
  } catch (_) { return []; }
}

async function getPostingById(id) {
  const sb = _sb();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('postings_public')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return _postingFromApi(data);
  } catch (_) { return null; }
}

async function getPostingsByEmployer(_email) {
  // _email ignored — RLS scopes the SELECT to the signed-in employer's own rows.
  const sb = _sb();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('postings')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map(_postingFromApi);
  } catch (_) { return []; }
}

async function createPosting(data) {
  const sb = _sb();
  if (!sb) throw new Error('Auth service not ready');
  const employerId = await _uid();
  if (!employerId) throw new Error('You must be signed in to post a listing.');
  const { data: row, error } = await sb
    .from('postings')
    .insert({ ..._postingToApi(data), employer_id: employerId })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return _postingFromApi(row);
}

async function updatePosting(id, data) {
  const sb = _sb();
  if (!sb) return false;
  try {
    const { error } = await sb.from('postings').update(_postingToApi(data)).eq('id', id);
    return !error;
  } catch (_) { return false; }
}

async function archivePosting(id)    { return updatePosting(id, { isActive: false }); }
async function reactivatePosting(id) { return updatePosting(id, { isActive: true }); }

async function deletePosting(id) {
  const sb = _sb();
  if (!sb) return false;
  try {
    const { error } = await sb.from('postings').delete().eq('id', id);
    return !error;
  } catch (_) { return false; }
}

// ——— APPLICATIONS ———

async function getApplicationsByStudent(_email) {
  const sb = _sb();
  if (!sb) return [];
  try {
    const uid = await _uid();
    if (!uid) return [];
    const { data: apps, error } = await sb
      .from('applications')
      .select('*')
      .eq('student_id', uid)
      .order('created_at', { ascending: false });
    if (error) return [];
    // Posting details come from the public view (active listings the student
    // applied to). RLS won't embed the base postings row for a non-accepted
    // application, so we join client-side against postings_public.
    const ids = [...new Set((apps || []).map(a => a.posting_id))];
    const pmap = {};
    if (ids.length) {
      const { data: posts } = await sb.from('postings_public').select('*').in('id', ids);
      (posts || []).forEach(p => { pmap[p.id] = p; });
      // Accepted-then-archived postings drop out of postings_public (active-only).
      // The accepted-student RLS path (postings_select_accepted_student) still lets
      // the student read the base postings row, so backfill any ids the public view
      // didn't return. Genuinely deleted postings stay absent -> "Listing removed".
      const missing = ids.filter(id => !pmap[id]);
      if (missing.length) {
        const { data: basePosts } = await sb.from('postings').select('*').in('id', missing);
        (basePosts || []).forEach(p => { pmap[p.id] = p; });
      }
    }
    return (apps || []).map(a => _appFromApi({ ...a, postings: pmap[a.posting_id] || null }));
  } catch (_) { return []; }
}

async function getApplicationsByPosting(postingId) {
  const sb = _sb();
  if (!sb) return [];
  try {
    const { data: apps, error } = await sb
      .from('applications')
      .select('*')
      .eq('posting_id', postingId)
      .order('created_at', { ascending: false });
    if (error) return [];
    // Student identity (name/school/grade) is readable ONLY for Accepted
    // applicants (RLS). Pre-acceptance these come back empty and the UI shows a
    // neutral "Applicant" label — by design (PII minimization).
    const sids = [...new Set((apps || []).map(a => a.student_id))];
    const smap = {};
    if (sids.length) {
      const { data: studs } = await sb.from('students').select('id, school, grade, profile').in('id', sids);
      (studs || []).forEach(s => { smap[s.id] = s; });
    }
    return (apps || []).map(a => {
      const s = smap[a.student_id];
      const name = s ? [s.profile?.first, s.profile?.last].filter(Boolean).join(' ').trim() : '';
      return _appFromApi({
        ...a,
        students: s ? { full_name: name || 'Applicant', school: s.school, grade: s.grade } : null
      });
    });
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
  const sb = _sb();
  if (!sb) throw new Error('Auth service not ready');
  const uid = await _uid();
  if (!uid) throw new Error('You must be signed in to apply.');
  const { data: row, error } = await sb
    .from('applications')
    .insert({
      posting_id: data.postingId,
      student_id: uid,
      cover_note: data.coverNote || '',
      resume_url: data.resumeUrl || ''
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('You have already applied to this posting.');
    throw new Error(error.message);
  }
  // Cross-user notifications (employer + applicant confirmation) are fired by the
  // applications INSERT trigger — no client-side notification call needed.
  return _appFromApi(row);
}

async function updateApplicationStatus(id, status) {
  const sb = _sb();
  if (!sb) return false;
  try {
    // The status-change trigger notifies the student (+ coordinators on Accepted).
    const { error } = await sb.from('applications').update({ status }).eq('id', id);
    return !error;
  } catch (_) { return false; }
}

// ——— BROWSE CANDIDATES (employer gallery) ———
// Reads the students_public VIEW: a privacy-safe projection that the DB exposes
// ONLY to coordinator-approved / domain-verified employers (gated in the view's
// WHERE via current_user_employer_approved()). Students and non-approved
// employers get [] — there is no client-side gate to trust here, RLS/grants do it.
// Exposed fields ONLY: id, first name, grade, school, tracks, hours/week, start
// date, commute. No last name, email, phone, guardian, teacher, free-text
// answers, or resume exist on the view, so they cannot leak.

function _candidateFromApi(c) {
  if (!c) return null;
  return {
    id:           c.id,
    firstName:    c.first_name    || '',
    grade:        c.grade         || '',
    school:       c.school        || '',
    tracks:       Array.isArray(c.tracks) ? c.tracks : (c.tracks ? [c.tracks] : []),
    hoursPerWeek: c.hours_per_week || '',
    startDate:    c.start_date    || '',
    commute:      c.commute       || ''
  };
}

async function getBrowseCandidates() {
  const sb = _sb();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('students_public')
      .select('*')
      .order('first_name', { ascending: true });
    if (error) return [];
    return (data || []).map(_candidateFromApi);
  } catch (_) { return []; }
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

// ——— FORMATTERS (no API dependency) ———

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

// ——— BADGE / PILL HELPERS ———

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
  // Only allow relative URLs or same-origin hrefs to prevent open-redirect
  const safeHref = (opts.href && /^[^:]*$/.test(opts.href)) ? opts.href : ('posting.html?id=' + encodeURIComponent(posting.id));
  return `
    <a class="posting-card" href="${_htmlEsc(safeHref)}">
      <div class="posting-card-top">
        <div class="posting-company-logo">${_htmlEsc(initial)}</div>
        <div class="posting-card-info">
          <div class="posting-card-company">${_htmlEsc(posting.companyName)}</div>
          <div class="posting-card-title">${_htmlEsc(posting.title)}</div>
        </div>
        ${workModeBadge(posting.workMode)}
      </div>
      <div class="posting-card-tags">
        ${trackTag(posting.track)}
        <span class="ttag" style="background:var(--mist);color:var(--text-muted);">${_htmlEsc(String(posting.hoursPerWeek))} hrs/week</span>
      </div>
      <div class="posting-card-meta">
        <span>${_htmlEsc(posting.location)}</span>
        ${posting.startDate ? `<span>Start: ${_htmlEsc(posting.startDate)}</span>` : ''}
      </div>
      <div class="posting-card-footer">
        <span class="posting-card-date">Posted ${timeAgo(posting.createdAt)}</span>
        <span class="${deadlineCls}">${_htmlEsc(deadlineText)}</span>
      </div>
    </a>`;
}

// ——— FLAGGED TERMS CONFIG ———
// offPlatformPhrases is substring-matched (case-insensitive) against message
// bodies by moderation.js. The regex arrays are reserved for future use —
// moderation.js uses its own hard-coded patterns.
const flaggedTerms = {
  phoneNumbers:       [],
  emails:             [],
  socialHandles:      [],
  urls:               [],
  profanity:          [],
  offPlatformPhrases: [
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
const domainConfig = {
  trustedStudentDomains:   [],
  trustedEmployerDomains:  [],
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

// Client-side UX gate (informational). The RLS policy postings_insert_own_if_approved
// is the real enforcement. employerCanPost() works off the cached user object;
// employerCanPostNow() re-reads the authoritative flag from the DB.
function employerCanPost(user) {
  if (!user || user.role !== 'employer') return false;
  if (!domainConfig.requireEmployerApproval) return true;
  return !!(user.domainVerified || user.coordinatorApproved);
}

async function employerCanPostNow() {
  const sb = _sb();
  if (!sb) return false;
  try {
    const uid = await _uid();
    if (!uid) return false;
    const { data } = await sb.from('employers')
      .select('coordinator_approved, domain_verified')
      .eq('id', uid)
      .maybeSingle();
    return !!(data && (data.coordinator_approved || data.domain_verified));
  } catch (_) { return false; }
}

// ——— EMPLOYER COMPANY PROFILE (DB-backed dashboard/posting gate) ———
// Path A replaces the old sessionStorage.sib_emp_data gate with a database check,
// so an employer returning on a new device is NEVER forced to re-register.

// Returns the signed-in employer's own row (or null). `select('*')` keeps this
// resilient whether or not the company-profile columns migration
// (20260605000000_employer_company_profile.sql) has been applied yet.
async function getMyEmployerProfile() {
  const sb = _sb();
  if (!sb) return null;
  try {
    const uid = await _uid();
    if (!uid) return null;
    const { data } = await sb.from('employers').select('*').eq('id', uid).maybeSingle();
    return data || null;
  } catch (_) { return null; }
}

// A company profile is "complete" once the one-time profile form has been
// submitted: a real company_name (the signup trigger seeds an empty '') AND the
// commitment obligations acknowledged. Reads only columns that exist pre-migration
// so the gate is correct even before the new columns land.
async function employerProfileComplete() {
  const sb = _sb();
  if (!sb) return false;
  try {
    const uid = await _uid();
    if (!uid) return false;
    const { data } = await sb.from('employers')
      .select('company_name, obligations_acknowledged_at')
      .eq('id', uid)
      .maybeSingle();
    return !!(data && data.company_name && data.company_name.trim() && data.obligations_acknowledged_at);
  } catch (_) { return false; }
}

// ——— localStorage HELPERS (only sib_user and sib_token live here) ———

function _lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { return []; }
}
function _lsSet(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }

function _defaultNotificationPreferences() {
  return {
    signupConfirm:     'immediate',
    newApplication:    'immediate',
    applicationStatus: 'immediate',
    newListing:        'immediate',
    newMessage:        'immediate'
  };
}

// ——— NOTIFICATIONS ———
// Clients may only INSERT notifications addressed to THEMSELVES (RLS). Cross-user
// notifications are created by SECURITY DEFINER triggers / notify_coordinators().

async function getNotifications(userId) {
  const sb = _sb();
  if (!sb) return [];
  try {
    const uid = userId || (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null);
    if (!uid) return [];
    const { data, error } = await sb
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return [];
    return (data || []).map(_notificationFromApi);
  } catch (_) { return []; }
}

async function _insertNotification(data) {
  const sb = _sb();
  if (!sb) return null;
  try {
    const { data: row, error } = await sb
      .from('notifications')
      .insert({ user_id: data.userId, type: data.type, payload: data.payload || {} })
      .select()
      .single();
    if (error) return null;
    return _notificationFromApi(row);
  } catch (_) { return null; }
}

async function markNotificationRead(id) {
  const sb = _sb();
  if (!sb) return false;
  try { const { error } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id); return !error; }
  catch (_) { return false; }
}

async function markNotificationEmailed(id) {
  const sb = _sb();
  if (!sb) return false;
  try { const { error } = await sb.from('notifications').update({ emailed_at: new Date().toISOString() }).eq('id', id); return !error; }
  catch (_) { return false; }
}

async function markAllNotificationsRead() {
  const sb = _sb();
  if (!sb) return false;
  try {
    const uid = await _uid();
    if (!uid) return false;
    const { error } = await sb.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', uid)
      .is('read_at', null);
    return !error;
  } catch (_) { return false; }
}

// ——— MESSAGE THREADS ———

// Attach last-message preview + counts client-side (replaces the old server
// _enrichThreads). One batched messages query for the whole thread set.
async function _enrichThreadsClient(threads) {
  if (!threads.length) return threads;
  const sb = _sb();
  const ids = threads.map(t => t.id);
  const { data: msgs } = await sb
    .from('messages')
    .select('thread_id, body, flagged, flag_reasons, created_at')
    .in('thread_id', ids)
    .order('created_at', { ascending: true });
  const prev = {}, cnt = {}, fc = {}, fr = {};
  (msgs || []).forEach(m => {
    prev[m.thread_id] = m.body; // asc order → last wins
    cnt[m.thread_id]  = (cnt[m.thread_id] || 0) + 1;
    if (m.flagged) {
      fc[m.thread_id] = (fc[m.thread_id] || 0) + 1;
      const c = fr[m.thread_id] || [];
      (m.flag_reasons || []).forEach(r => { if (!c.includes(r)) c.push(r); });
      fr[m.thread_id] = c;
    }
  });
  return threads.map(t => ({
    ...t,
    _preview:       prev[t.id] || null,
    _message_count: cnt[t.id]  || 0,
    _flagged_count: fc[t.id]   || 0,
    _flag_reasons:  fr[t.id]   || []
  }));
}

async function getMessageThreads(userId, _role) {
  const sb = _sb();
  if (!sb) return [];
  try {
    const uid = userId || (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null) || await _uid();
    if (!uid) return [];
    const { data, error } = await sb
      .from('message_threads')
      .select('*')
      .or(`student_id.eq.${uid},employer_id.eq.${uid}`)
      .order('last_message_at', { ascending: false });
    if (error) return [];
    const enriched = await _enrichThreadsClient(data || []);
    return enriched.map(_threadFromApi);
  } catch (_) { return []; }
}

async function getMessageThreadById(id) {
  const sb = _sb();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from('message_threads').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return _threadFromApi(data);
  } catch (_) { return null; }
}

async function createMessageThread(data) {
  const sb = _sb();
  if (!sb) throw new Error('Auth service not ready');
  // Idempotent: reuse the existing thread for this application if present.
  if (data.applicationId) {
    const { data: existing } = await sb
      .from('message_threads').select('*').eq('application_id', data.applicationId).maybeSingle();
    if (existing) return _threadFromApi(existing);
  }
  const uid = await _uid();
  const { data: row, error } = await sb
    .from('message_threads')
    .insert({
      student_id:        data.studentId,
      employer_id:       data.employerId,
      listing_id:        data.listingId        || null,
      application_id:    data.applicationId    || null,
      participant_names: data.participantNames || {},
      created_by:        uid
    })
    .select()
    .single();
  // RLS rejects this insert unless an Accepted application exists between the two
  // parties — surfaced here as a friendly error.
  if (error) throw new Error(error.message || 'Could not start this conversation.');
  return _threadFromApi(row);
}

async function updateMessageThreadStatus(id, status) {
  const sb = _sb();
  if (!sb) return false;
  try { const { error } = await sb.from('message_threads').update({ status }).eq('id', id); return !error; }
  catch (_) { return false; }
}

// Coordinator-only: all threads (RLS returns everything for a coordinator).
async function getAllMessageThreads() {
  const sb = _sb();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('message_threads').select('*').order('last_message_at', { ascending: false });
    if (error) return [];
    const enriched = await _enrichThreadsClient(data || []);
    return enriched.map(_threadFromApi);
  } catch (_) { return []; }
}

async function coordinatorReviewThread(threadId, { note } = {}) {
  const sb = _sb();
  if (!sb) return false;
  try {
    const uid = await _uid();
    const { error } = await sb.from('message_threads')
      .update({ reviewed_at: new Date().toISOString(), reviewed_by: uid, coordinator_note: note || null })
      .eq('id', threadId);
    return !error;
  } catch (_) { return false; }
}

// ——— MESSAGES ———

async function getMessages(threadId) {
  const sb = _sb();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: true });
    if (error) return [];
    return (data || []).map(_messageFromApi);
  } catch (_) { return []; }
}

async function createMessage(data) {
  const sb = _sb();
  if (!sb) throw new Error('Auth service not ready');
  const uid = await _uid();
  const role = (typeof currentUser !== 'undefined' && currentUser ? currentUser.role : null) || 'student';
  const { data: row, error } = await sb
    .from('messages')
    .insert({
      thread_id:    data.threadId,
      sender_id:    uid,
      sender_role:  role,
      body:         data.body,
      flagged:      data.flagged     || false,
      flag_reasons: data.flagReasons || []
    })
    .select()
    .single();
  // The message INSERT trigger bumps the thread, flags it if needed, and notifies
  // the recipient (+ coordinators on a flag).
  if (error) throw new Error(error.message || 'Could not send message');
  return _messageFromApi(row);
}

// flag state is embedded in createMessage — kept as a no-op for call-site compatibility.
async function flagMessage(_id, _reasons) { return true; }

async function markMessageReviewed(id) {
  const sb = _sb();
  if (!sb) return false;
  try { const { error } = await sb.from('messages').update({ reviewed_by_coordinator: true }).eq('id', id); return !error; }
  catch (_) { return false; }
}

async function getThreadForApplication(applicationId) {
  if (!applicationId) return null;
  try {
    const threads = await getMessageThreads();
    return threads.find(t => t.applicationId === applicationId) || null;
  } catch (_) { return null; }
}

// Rate limiting is no longer enforced server-side in Path A. Always allowed here;
// add a DB-side limit (rate_limit_log + an Edge Function) if abuse appears.
function checkMessageRateLimit(_userId) {
  return { allowed: true, reason: '' };
}

// ——— COORDINATORS ———
// Reads profiles where role='coordinator'. RLS returns rows only to coordinators;
// other users get [] (fan-out to coordinators now happens via the
// notify_coordinators() RPC, not by enumerating them client-side).

async function getCoordinators() {
  const sb = _sb();
  if (!sb) return [];
  try {
    const { data, error } = await sb.from('profiles').select('id, email, role').eq('role', 'coordinator');
    if (error) return [];
    return (data || []).map(c => ({ id: c.id, email: c.email, role: c.role }));
  } catch (_) { return []; }
}

async function getCoordinatorById(id) {
  const all = await getCoordinators();
  return all.find(c => c.id === id) || null;
}

async function getCoordinatorByEmail(email) {
  if (!email) return null;
  const all = await getCoordinators();
  return all.find(c => c.email.toLowerCase() === email.toLowerCase()) || null;
}

function createCoordinator(_data) { return null; }

// ——— MIGRATION ———
// Runs once per page load; version-gated. Backfills new fields on the cached
// sib_user so existing dev sessions keep working.
const DATA_VERSION = '2026-06-03'; // Path A

function migrateExistingData() {
  if (localStorage.getItem('sib_data_version') === DATA_VERSION) return;
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
