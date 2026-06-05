// —— TOAST ——
let toastTimer;
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  if (!t) return;
  document.getElementById('toastMsg').textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, 3500);
}

// —— MODALS ——
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) {
    document.body.style.overflow = '';
  }
}

// —— FAQ ——
function toggleFaq(el) { el.closest('.faq-item').classList.toggle('open'); }

// —— CLAUSES ——
function toggleClause(el) { el.classList.toggle('checked'); }

// —— NAV SCROLL (fallback; primary handler is in per-page Lenis init) ——
window.addEventListener('scroll', () => {
  const nav = document.getElementById('mainNav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 10);
});

// —— TRACK SELECTION ——
const studentSelectedTracks = new Set();

function toggleTrackSel(el, name) {
  const grid = el.parentElement;
  if (grid.id === 'trackSelGrid') {
    if (el.classList.contains('selected')) {
      el.classList.remove('selected');
      studentSelectedTracks.delete(name);
    } else {
      el.classList.add('selected');
      studentSelectedTracks.add(name);
    }
    const cnt = document.getElementById('trackSelCount');
    if (cnt) cnt.textContent = studentSelectedTracks.size + ' selected';
  } else {
    el.classList.toggle('selected');
  }
}

// —— UPLOAD ——
let uploadedResume = null;
let uploadedResumeDataUrl = null;

function handleUpload(input) {
  if (input.files && input.files[0]) {
    const f = input.files[0];
    if (f.type !== 'application/pdf') { showToast('Please upload a PDF file only.', true); return; }
    if (f.size > 2 * 1024 * 1024) { showToast('File exceeds 2MB limit. Please compress your resume.', true); return; }
    uploadedResume = f;
    const reader = new FileReader();
    reader.onload = e => { uploadedResumeDataUrl = e.target.result; };
    reader.readAsDataURL(f);
    const zone = document.getElementById('uploadZone');
    if (zone) zone.classList.add('filled');
    const lbl = document.getElementById('uploadLabel');
    if (lbl) lbl.textContent = '✓ Resume uploaded';
    const info = document.getElementById('uploadFileInfo');
    document.getElementById('uploadFileName').textContent = f.name;
    document.getElementById('uploadFileSize').textContent = (f.size / 1024).toFixed(0) + ' KB';
    if (info) info.classList.add('show');
    showToast('✓ Resume attached: ' + f.name);
  }
}

function viewResume() {
  if (uploadedResume) {
    const url = URL.createObjectURL(uploadedResume);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else { showToast('No resume on file.', true); }
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function dashViewOrReplace() {
  const stored = sessionStorage.getItem('sib_student_app');
  if (stored) {
    try {
      const d = JSON.parse(stored);
      if (d.resumeDataUrl) {
        const blob = dataUrlToBlob(d.resumeDataUrl);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
    } catch(e) {}
  }
  // No data URL stored — prompt re-upload to link the file
  document.getElementById('sdash-resumeinput').click();
}

function dashReplaceResume(input) {
  if (!input.files || !input.files[0]) return;
  const f = input.files[0];
  if (f.type !== 'application/pdf') { showToast('Please select a PDF file.', true); return; }
  if (f.size > 2 * 1024 * 1024) { showToast('File exceeds 2MB limit.', true); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    const stored = sessionStorage.getItem('sib_student_app');
    if (stored) {
      try {
        const d = JSON.parse(stored);
        d.resumeName = f.name;
        d.resumeDataUrl = dataUrl;
        sessionStorage.setItem('sib_student_app', JSON.stringify(d));
        const nameEl = document.getElementById('sdash-resumename');
        if (nameEl) nameEl.innerHTML = `<span style="color:var(--ink);font-weight:500;">${f.name}</span>`;
        showToast('✓ Resume linked. Click "View PDF" to open it.');
      } catch(err) {}
    }
    const blob = dataUrlToBlob(dataUrl);
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  };
  reader.readAsDataURL(f);
}

// —— OTHER ELABORATION ——
function handleOther(select, targetId) {
  const el = document.getElementById(targetId);
  if (el) el.classList.toggle('show', select.value === 'other');
}

// —— PROFANITY FILTER ——
const badWords = ['damn','hell','ass','crap','shit','fuck','bitch','bastard','piss','dick','cock','pussy','tits','whore','slut','cunt','motherfuck','nigger','faggot','retard'];
function containsProfanity(text) { const l = text.toLowerCase(); return badWords.some(w => l.includes(w)); }

// —— STUDENT PROFILES ——
function renderStudents(list) {
  const grid = document.getElementById('studentGrid');
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">👥</div><div class="empty-state-title">No candidates match your filter</div><div class="empty-state-body">Try clearing the search, or check back as more students complete their profiles.</div></div>`;
    return;
  }
  grid.innerHTML = list.map((s, i) => `
    <div class="scard" data-aos="fade-up" data-aos-delay="${Math.min(i * 80, 320)}" onclick="openSProfile(${Number(s.id)})">
      <div class="scard-top">
        <div class="scard-avatar">${_htmlEsc(s.name.charAt(0))}</div>
        <span class="${s.status==='verified'?'badge-v':'badge-p'}">${s.status==='verified'?'Verified Ready':'Pending Review'}</span>
      </div>
      <div class="scard-name">${_htmlEsc(s.name)}</div>
      <div class="scard-school">${_htmlEsc(s.school)} · Grade ${_htmlEsc(String(s.grade))}</div>
      <div class="tag-row">${s.tracks.map(t=>`<span class="ttag ${TRACK_CLASS[t]||'tt-biz'}">${_htmlEsc(t)}</span>`).join('')}</div>
      <div class="scard-skills">Skills: ${_htmlEsc(s.skills.slice(0,3).join(', '))}</div>
      <div class="scard-footer">
        <div class="avail-label"><strong>${_htmlEsc(s.availability)}</strong> available</div>
        <button class="btn-intro" onclick="event.stopPropagation();openIntroModal(${Number(s.id)})">Request Intro</button>
      </div>
    </div>
  `).join('');
  if (typeof AOS !== 'undefined') AOS.refresh();
}

function filterStudents(val) {
  const q = (typeof val === 'string' ? val : '').toLowerCase();
  // Candidate data is not wired in Path A yet; treat the list as empty until a
  // real source exists, so typing in the Browse search never throws.
  const src = (typeof students !== 'undefined') ? students : [];
  renderStudents(src.filter(s =>
    !q || s.name.toLowerCase().includes(q) || s.school.toLowerCase().includes(q) ||
    s.skills.some(sk => sk.toLowerCase().includes(q)) || s.tracks.some(t => t.toLowerCase().includes(q))
  ));
}

function openSProfile(id) {
  const s = students.find(x => x.id === id);
  if (!s) return;
  document.getElementById('profileModalContent').innerHTML = `
    <div class="pmodal-avatar">${_htmlEsc(s.name.charAt(0))}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
      <div class="modal-title" style="margin-bottom:0;">${_htmlEsc(s.name)}</div>
      <span class="${s.status==='verified'?'badge-v':'badge-p'}">${s.status==='verified'?'Verified Ready':'Pending Review'}</span>
    </div>
    <div class="modal-sub">${_htmlEsc(s.school)} · Grade ${_htmlEsc(String(s.grade))}</div>
    <div class="pmodal-bio">${_htmlEsc(s.bio)}</div>
    <div class="pmodal-sec">Tracks</div>
    <div class="tag-row" style="margin-bottom:16px;">${s.tracks.map(t=>`<span class="ttag ${TRACK_CLASS[t]||'tt-biz'}">${_htmlEsc(t)}</span>`).join('')}</div>
    <div class="pmodal-sec">Skills</div>
    <div class="skills-row">${s.skills.map(sk=>`<span class="skill-chip">${_htmlEsc(sk)}</span>`).join('')}</div>
    <div class="pmeta">
      <div class="pmeta-item"><div class="pk">Availability</div><div class="pv">${_htmlEsc(s.availability)}</div></div>
      <div class="pmeta-item"><div class="pk">Commute</div><div class="pv">${_htmlEsc(s.commute)}</div></div>
      <div class="pmeta-item"><div class="pk">Preferred Start</div><div class="pv">${_htmlEsc(s.startDate)}</div></div>
      <div class="pmeta-item"><div class="pk">References</div><div class="pv">${_htmlEsc(s.references)}</div></div>
    </div>
    <div class="modal-btns">
      <button class="btn-modal-outline" onclick="showToast('Resume request sent to coordinator')">Request Resume</button>
      <button class="btn-modal-fill" onclick="closeModal('profileModal');openIntroModal(${Number(s.id)})">Request Introduction →</button>
    </div>
  `;
  openModal('profileModal');
}

let currentIntroId = null;
function openIntroModal(id) {
  currentIntroId = id;
  const s = students.find(x => x.id === id);
  const sub = document.getElementById('introModalSub');
  if (sub) sub.textContent = `Requesting an intro for ${s?.name || 'this candidate'} — coordinator will respond within 1–2 business days.`;
  openModal('introModal');
}
function submitIntro() {
  const s = students.find(x => x.id === currentIntroId);
  closeModal('introModal');
  showToast('✓ Intro request sent for ' + (s?.name || 'candidate') + ' to coordinator');
}

// —— DASHBOARD SECTIONS ——
function showSDashSection(sec) {
  ['overview','application','placement'].forEach(s => {
    const el = document.getElementById('sdash-' + s);
    if (el) el.style.display = s === sec ? 'block' : 'none';
  });
  document.querySelectorAll('#page-student-dashboard .sidebar-link, .dash-sidebar .sidebar-link').forEach((l,i) => {
    const map = ['overview','application','placement','resources'];
    l.classList.toggle('active', map[i] === sec);
  });
}

function showEDashSection(sec) {
  ['overview','browse','requests','listing'].forEach(s => {
    const el = document.getElementById('edash-' + s);
    if (el) el.style.display = s === sec ? 'block' : 'none';
  });
  document.querySelectorAll('.dash-sidebar .sidebar-link').forEach((l,i) => {
    const map = ['overview','browse','requests','listing','resources'];
    l.classList.toggle('active', map[i] === sec);
  });
  if (sec === 'browse') renderStudents([]);
}

// —— STUDENT FORM ——
let currentSStep = 0;
const totalSSteps = 5;

function updateSDots(step) {
  for (let i = 0; i < totalSSteps; i++) {
    const d = document.getElementById('sd' + i);
    if (d) d.className = 'sdot' + (i < step ? ' done' : i === step ? ' current' : '');
  }
}

function nextSStep(from) {
  if (from === 0) {
    const f = document.getElementById('s1first').value.trim();
    const l = document.getElementById('s1last').value.trim();
    const e = document.getElementById('s1email').value.trim();
    const p = document.getElementById('s1phone').value.trim();
    const sc = document.getElementById('s1school').value.trim();
    const g = document.getElementById('s1grade').value;
    const tn = document.getElementById('s1teachername').value.trim();
    const te = document.getElementById('s1teacheremail').value.trim();
    if (!f||!l||!e||!sc||!g||!tn||!te) { showToast('Please fill in all required fields.', true); return; }
    if (!isValidEmail(te)) { showToast('Please enter a valid co-op teacher email.', true); return; }
    const emailErr = document.getElementById('s1emailErr');
    if (!isValidEmail(e)) { emailErr.classList.add('show'); return; } else { emailErr.classList.remove('show'); }
    const phoneErr = document.getElementById('s1phoneErr');
    if (p && !isValidPhone(p)) { phoneErr.classList.add('show'); return; } else { phoneErr.classList.remove('show'); }
  }
  if (from === 1) {
    if (studentSelectedTracks.size === 0) { showToast('Please select at least one track.', true); return; }
  }
  if (from === 2) {
    const hrs = parseInt(document.getElementById('s3hours').value);
    if (!hrs || hrs < 14) { showToast('You must be available at least 14 hours per week to apply.', true); return; }
    const dt = document.getElementById('s3date').value;
    if (!dt) { showToast('Please select a preferred start date.', true); return; }
    const today = new Date(); today.setHours(0,0,0,0);
    const chosen = new Date(dt + 'T00:00:00');
    if (chosen < today) { showToast('Preferred start date cannot be before today.', true); return; }
    const commute = document.getElementById('s3commute').value;
    if (!commute) { showToast('Please indicate commute option.', true); return; }
    const auth = document.getElementById('s3auth').value;
    if (!auth) { showToast('Please indicate parent/guardian authorization.', true); return; }
    if (auth === 'no') { showToast('Parent/guardian authorization is required to proceed. Please obtain approval before submitting.', true); return; }
  }
  if (from === 3) {
    const q1 = document.getElementById('s4q1').value.trim();
    const q2 = document.getElementById('s4q2').value.trim();
    const q3 = document.getElementById('s4q3').value.trim();
    if (!q1||!q2||!q3) { showToast('Please answer all screening questions.', true); return; }
    if (containsProfanity(q1+q2+q3)) { showToast('⚠️ Please keep your responses professional and appropriate.', true); return; }
  }
  document.getElementById('ss' + from).classList.remove('active');
  const next = from + 1;
  if (next < totalSSteps) {
    document.getElementById('ss' + next).classList.add('active');
    updateSDots(next);
    currentSStep = next;
  }
  window.scrollTo(0,180);
}

function prevSStep(from) {
  document.getElementById('ss' + from).classList.remove('active');
  const prev = from - 1;
  if (prev >= 0) {
    document.getElementById('ss' + prev).classList.add('active');
    updateSDots(prev);
  }
  window.scrollTo(0,180);
}

function submitStudentApp() {
  const allChecked = [...document.querySelectorAll('#ss4 .clause')].every(c => c.classList.contains('checked'));
  if (!allChecked) { showToast('Please check all commitment clauses before submitting.', true); return; }
  if (!uploadedResume) {
    if (!confirm('You have not uploaded a resume. Are you sure you want to submit without one?')) return;
    doSubmit();
  } else if (uploadedResumeDataUrl) {
    doSubmit();
  } else {
    // FileReader still running — re-read synchronously via a new reader
    const reader = new FileReader();
    reader.onload = e => { uploadedResumeDataUrl = e.target.result; doSubmit(); };
    reader.readAsDataURL(uploadedResume);
  }
}

async function doSubmit() {
  // Persist to Supabase first; do NOT advance to the success screen on failure.
  const ok = await _persistStudentProfile();
  if (!ok) return;
  populateStudentDash();   // keeps sessionStorage for dashboard display + resume preview
  document.getElementById('studentFormMain').style.display = 'none';
  document.getElementById('studentSuccess').classList.add('show');
  window.scrollTo(0,0);
}

// Writes the onboarding answers to the signed-in student's row. The row itself
// is created at signup by the handle_new_user() trigger, so this is an UPDATE
// (students has no client INSERT grant by design). school + grade are typed
// columns; the rest is stored in the students.profile jsonb.
async function _persistStudentProfile() {
  const sb = window._supabase;
  if (!sb) { showToast('Service not ready — please wait a moment and try again.', true); return false; }

  const { data: authData } = await sb.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) {
    showToast('Please sign in to submit your application.', true);
    if (typeof openAuth === 'function') openAuth('login', 'student');
    return false;
  }

  const school = (document.getElementById('s1school')?.value || '').trim();
  const grade  = document.getElementById('s1grade')?.value || '';
  const profile = {
    first:           (document.getElementById('s1first')?.value || '').trim(),
    last:            (document.getElementById('s1last')?.value  || '').trim(),
    phone:           (document.getElementById('s1phone')?.value || '').trim(),
    teacherName:     (document.getElementById('s1teachername')?.value  || '').trim(),
    teacherEmail:    (document.getElementById('s1teacheremail')?.value || '').trim(),
    hoursPerWeek:    document.getElementById('s3hours')?.value || '',
    startDate:       document.getElementById('s3date')?.value  || '',
    commute:         document.getElementById('s3commute')?.value || '',
    guardianAuth:    document.getElementById('s3auth')?.value || '',
    tracks:          [...studentSelectedTracks],
    goals:           (document.getElementById('s4q1')?.value || '').trim(),
    experience:      (document.getElementById('s4q2')?.value || '').trim(),
    schedulingNotes: (document.getElementById('s4q3')?.value || '').trim(),
    resumeName:      uploadedResume ? uploadedResume.name : null,
    submittedAt:     new Date().toISOString()
    // NOTE: the resume FILE is not persisted yet — it stays in sessionStorage as a
    // data URL. Proper resume storage needs a Supabase Storage bucket (follow-up).
  };

  const { error } = await sb.from('students').update({ school, grade, profile }).eq('id', userId);
  if (error) {
    showToast(error.message || 'Could not save your application. Please try again.', true);
    return false;
  }
  return true;
}

function populateStudentDash() {
  const appData = {
    first: document.getElementById('s1first')?.value || '',
    last: document.getElementById('s1last')?.value || '',
    school: document.getElementById('s1school')?.value || '',
    grade: document.getElementById('s1grade')?.value || '',
    hrs: document.getElementById('s3hours')?.value || '',
    tracks: [...studentSelectedTracks].join(', ') || '',
    q1: document.getElementById('s4q1')?.value || '',
    q2: document.getElementById('s4q2')?.value || '',
    resumeName: uploadedResume ? uploadedResume.name : null,
    resumeDataUrl: uploadedResumeDataUrl || null
  };
  sessionStorage.setItem('sib_student_app', JSON.stringify(appData));
}

// —— EMPLOYER FORM ——
let currentEmpStep = 0;

function nextEmpStep(from) {
  if (from === 0) {
    // Company Profile step — company-level fields only (no placement details).
    const company  = document.getElementById('e1company').value.trim();
    const industry = document.getElementById('e1industry').value;
    const website  = document.getElementById('e1website').value.trim();
    const address  = document.getElementById('e1address').value.trim();
    const cname    = document.getElementById('e1cname').value.trim();
    const ctitle   = document.getElementById('e1ctitle').value.trim();
    const phone    = document.getElementById('e1phone').value.trim();
    if (!company||!industry||!website||!address||!cname||!ctitle||!phone) { showToast('Please fill in all required fields.', true); return; }
    const phoneErr = document.getElementById('e1phoneErr');
    if (!isValidPhone(phone)) { phoneErr.classList.add('show'); return; } else { phoneErr.classList.remove('show'); }
    const websiteErr = document.getElementById('e1websiteErr');
    try { new URL(website); websiteErr.classList.remove('show'); } catch(e) { websiteErr.classList.add('show'); return; }
  }
  document.getElementById('es' + from).classList.remove('active');
  document.getElementById('etab' + from).classList.remove('active');
  document.getElementById('etab' + from).classList.add('done');
  const next = from + 1;
  document.getElementById('es' + next).classList.add('active');
  document.getElementById('etab' + next).classList.add('active');
  currentEmpStep = next;
  window.scrollTo(0,180);
}

function prevEmpStep(from) {
  document.getElementById('es' + from).classList.remove('active');
  document.getElementById('etab' + from).classList.remove('active');
  const prev = from - 1;
  document.getElementById('es' + prev).classList.add('active');
  document.getElementById('etab' + prev).classList.add('active');
  document.getElementById('etab' + from).classList.remove('done');
  currentEmpStep = prev;
  window.scrollTo(0,180);
}

async function submitEmpReg() {
  // Commitment is the final step (#es1). All three clauses must be checked.
  const allChecked = [...document.querySelectorAll('#es1 .clause')].every(c => c.classList.contains('checked'));
  if (!allChecked) { showToast('Please check all commitment clauses before submitting.', true); return; }

  const sb = window._supabase;
  if (!sb) { showToast('Service not ready — please wait a moment and try again.', true); return; }

  // The employers row id MUST equal the logged-in user's auth id; the
  // "employers: own insert" RLS policy rejects any other id. Require a session.
  const { data: authData } = await sb.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) {
    showToast('Please sign in to save your company profile.', true);
    if (typeof openAuth === 'function') openAuth('login', 'employer');
    return;
  }

  const companyName = (document.getElementById('e1company')?.value || '').trim();
  if (!companyName) { showToast('Company name is required.', true); return; }

  // Industry: when "Other" is picked, persist the free-text elaboration instead.
  const industrySel = document.getElementById('e1industry')?.value || '';
  let industry = industrySel;
  if (industrySel === 'other') {
    industry = (document.querySelector('#industryOther input')?.value || '').trim() || 'Other';
  }

  // Company-level columns only — placement details (track, hours, supervisor, etc.)
  // belong to postings, not to the company profile.
  const employerRow = {
    id:                          userId,            // = auth.uid()
    company_name:                companyName,
    industry:                    industry || null,
    website:                     (document.getElementById('e1website')?.value || '').trim() || null,
    office_address:              (document.getElementById('e1address')?.value || '').trim() || null,
    contact_name:                (document.getElementById('e1cname')?.value   || '').trim() || null,
    contact_title:               (document.getElementById('e1ctitle')?.value  || '').trim() || null,
    phone:                       (document.getElementById('e1phone')?.value   || '').trim() || null,
    obligations_acknowledged_at: new Date().toISOString()
    // domain_verified / coordinator_approved / verification_status are DB-locked — never set client-side.
  };

  const { error } = await sb.from('employers').upsert(employerRow, { onConflict: 'id' });
  if (error) {
    showToast(error.message || 'Could not save your company profile. Please try again.', true);
    return;
  }

  showToast('✓ Company profile saved.');

  // If the employer came here from "Create Posting", return them to it; otherwise
  // land them on their dashboard. (No sessionStorage profile cache — the dashboard
  // reads the authoritative employers row directly.)
  if (sessionStorage.getItem('sib_post_after_profile') === '1') {
    sessionStorage.removeItem('sib_post_after_profile');
    setTimeout(() => { window.location.href = 'dashboard-employer.html?openPost=1'; }, 450);
    return;
  }
  setTimeout(() => { window.location.href = 'dashboard-employer.html'; }, 450);
}

// —— RESOURCE CENTRE NAVIGATION ——
let appSavedStep = null;

function goToResourceFromForm() {
  appSavedStep = currentSStep;
  sessionStorage.setItem('sib_resource_return', 'student-apply');
  sessionStorage.setItem('sib_resource_step', currentSStep);
  window.location.href = 'resources.html';
}

function goToResourceFromDash(role) {
  sessionStorage.setItem('sib_resource_return', role === 'employer' ? 'dashboard-employer' : 'dashboard-student');
  window.location.href = 'resources.html';
}

function returnToDash() {
  const pg = sessionStorage.getItem('sib_resource_return') || 'index';
  sessionStorage.removeItem('sib_resource_return');
  window.location.href = pg + '.html';
}

function returnToApplication() {
  const step = parseInt(sessionStorage.getItem('sib_resource_step') || '4');
  sessionStorage.removeItem('sib_resource_return');
  sessionStorage.removeItem('sib_resource_step');
  sessionStorage.setItem('sib_restore_step', step);
  window.location.href = 'student-apply.html';
}

// —— INIT ——
document.addEventListener('DOMContentLoaded', () => {
  updateNavForAuth();

  // Restore student form step if returning from resources
  const restoreStep = sessionStorage.getItem('sib_restore_step');
  if (restoreStep !== null && document.getElementById('ss0')) {
    sessionStorage.removeItem('sib_restore_step');
    const step = parseInt(restoreStep);
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('ss' + step);
    if (target) { target.classList.add('active'); updateSDots(step); currentSStep = step; }
  }

  // (Employer dashboard company fields are populated from the DB by
  // renderCompanyProfile() in dashboard-employer.html — no sessionStorage cache.)

  // Populate student dashboard from sessionStorage if present
  const appStored = sessionStorage.getItem('sib_student_app');
  if (appStored) {
    try {
      const d = JSON.parse(appStored);
      const el = (id, val) => { const e = document.getElementById(id); if(e) e.textContent = val; };
      el('sdash-firstname', d.first || 'there');
      el('sdash-fullname', (d.first || '') + ' ' + (d.last ? d.last.charAt(0) + '.' : ''));
      el('sdash-school', (d.school || '') + ' · ' + (d.grade || '') + ' · ' + (d.tracks || ''));
      el('sdash-tracks', d.tracks || '—');
      el('sdash-avail', (d.hrs || '—') + ' hrs/week');
      el('sdash-username', (d.first || '') + ' ' + (d.last ? d.last.charAt(0) + '.' : ''));
      el('sdash-name', (d.first || '') + ' ' + (d.last ? d.last.charAt(0) + '.' : ''));
      el('sdash-q1', d.q1 || '—');
      el('sdash-q2', d.q2 || '—');
      const resumeEl = document.getElementById('sdash-resumename');
      const resumeBtn = document.getElementById('sdash-resumebtn');
      if (resumeEl) {
        if (d.resumeName && d.resumeDataUrl) {
          resumeEl.innerHTML = `<a href="${d.resumeDataUrl}" target="_blank" style="color:var(--blue);font-weight:600;text-decoration:none;">${d.resumeName}</a>`;
          if (resumeBtn) resumeBtn.style.display = 'none';
        } else if (d.resumeName) {
          resumeEl.textContent = d.resumeName;
          if (resumeBtn) resumeBtn.textContent = 'Re-upload to View';
        } else {
          resumeEl.textContent = 'No resume uploaded';
          if (resumeBtn) resumeBtn.style.display = 'none';
        }
      }
    } catch(e) {}
  }

  // Render the (empty) candidate grid if on the employer dashboard. Real
  // candidate data is not wired in Path A yet, so render an empty state rather
  // than referencing a demo array that no longer exists.
  if (document.getElementById('studentGrid')) renderStudents([]);

  // Inject Privacy Policy / Terms of Use links and "Report a concern" into all footers.
  // Single injection point so every page gets them without editing each HTML file.
  document.querySelectorAll('.footer-inner').forEach(fi => {
    if (fi.querySelector('._footer-legal')) return; // already injected
    const legal = document.createElement('div');
    legal.className = '_footer-legal';
    legal.style.cssText = 'grid-column:1/-1;margin-top:12px;padding-top:12px;border-top:1px solid var(--line);display:flex;gap:18px;flex-wrap:wrap;align-items:center;';
    legal.innerHTML = `
      <a href="privacy.html" style="font-size:12px;color:var(--text-faint);text-decoration:none;font-weight:500;transition:color .15s;" onmouseover="this.style.color='var(--ink)'" onmouseout="this.style.color='var(--text-faint)'">Privacy Policy</a>
      <a href="terms.html"   style="font-size:12px;color:var(--text-faint);text-decoration:none;font-weight:500;transition:color .15s;" onmouseover="this.style.color='var(--ink)'" onmouseout="this.style.color='var(--text-faint)'">Terms of Use</a>
      <button onclick="openReportConcernModal()" style="font-size:12px;color:#dc2626;background:none;border:none;cursor:pointer;padding:0;font-weight:600;font-family:var(--sans);letter-spacing:-0.01em;">Report a concern</button>`;
    fi.appendChild(legal);
  });

  // Inject the report-concern modal once into the body
  if (!document.getElementById('_reportConcernModal')) {
    const m = document.createElement('div');
    m.id = '_reportConcernModal';
    m.className = 'modal-overlay';
    m.innerHTML = `
      <div class="modal-box" style="max-width:480px;">
        <button class="modal-close" onclick="closeReportConcernModal()">×</button>
        <h3 style="font-family:var(--serif);font-size:22px;font-weight:400;color:var(--ink);margin:0 0 6px;letter-spacing:-0.02em;">Report a concern</h3>
        <p style="font-size:13.5px;color:var(--text-muted);margin:0 0 20px;line-height:1.6;">All reports are reviewed by the SiB co-op coordinator. If this is an urgent safety matter, contact your school or emergency services directly.</p>
        <div class="field">
          <label>Your name <span style="color:var(--text-faint);font-weight:400;">(optional)</span></label>
          <input type="text" id="_rcName" placeholder="Your name">
        </div>
        <div class="field">
          <label>Your email <span style="color:var(--text-faint);font-weight:400;">(optional — for follow-up)</span></label>
          <input type="email" id="_rcEmail" placeholder="you@example.com">
        </div>
        <div class="field">
          <label>What are you reporting?</label>
          <select id="_rcType">
            <option value="inappropriate_message">Inappropriate message or communication</option>
            <option value="unsafe_employer">Unsafe or concerning employer behaviour</option>
            <option value="student_concern">Concern about a student's wellbeing</option>
            <option value="technical_issue">Technical issue on the platform</option>
            <option value="other">Other concern</option>
          </select>
        </div>
        <div class="field">
          <label>Details</label>
          <textarea id="_rcDetail" rows="4" placeholder="Describe the issue…" style="resize:vertical;"></textarea>
        </div>
        <div style="display:flex;gap:9px;margin-top:20px;padding-top:18px;border-top:1px solid var(--line);">
          <button class="btn-modal-outline" onclick="closeReportConcernModal()">Cancel</button>
          <button class="btn-modal-fill" onclick="submitReportConcern()" style="background:#dc2626;">Submit Report →</button>
        </div>
      </div>`;
    document.body.appendChild(m);
  }
});

function openReportConcernModal() {
  if (typeof openModal === 'function') openModal('_reportConcernModal');
}
function closeReportConcernModal() {
  if (typeof closeModal === 'function') closeModal('_reportConcernModal');
}
function submitReportConcern() {
  const detail = (document.getElementById('_rcDetail').value || '').trim();
  if (!detail) { showToast('Please describe your concern before submitting.', true); return; }
  const payload = {
    senderName:  (document.getElementById('_rcName').value  || '').trim() || (currentUser ? currentUser.name : 'Anonymous'),
    senderEmail: (document.getElementById('_rcEmail').value || '').trim() || (currentUser ? currentUser.email : ''),
    type:        document.getElementById('_rcType').value,
    detail
  };
  if (typeof notifyCoordinators === 'function') notifyCoordinators('concernReport', payload);
  closeReportConcernModal();
  showToast('✓ Report submitted. A coordinator will review it shortly.');
  ['_rcName','_rcEmail','_rcDetail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}
