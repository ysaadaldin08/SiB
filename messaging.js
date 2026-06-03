// ——— MESSAGING SYSTEM ———
// Shared UI logic for student and employer dashboards.
// Depends on: data.js, moderation.js, notifications.js.
//
// SAFEGUARDS (required for school board / minor-adult communication):
//   1. Messaging only unlocked on Accepted applications — no cold messages.
//   2. Every message is permanently logged; participants are notified on every page.
//   3. analyzeMessage() runs on every outbound message before delivery.
//   4. Flagged messages are delivered but marked for coordinator review.
//   5. Pre-flight warning dialog shown to sender before any flagged message is sent.
//   6. Rate limiting: 20 messages/hour, 5 new threads/day per user.
//   7. No file attachments in v1. Text only.
//      TODO: Phase 6 — coordinator-reviewed file attachments
//   8. "Report this conversation" button on every thread → immediate coordinator notification.
//   9. Coordinator notification fired on every flagged message.

// ——— STATE ———
let _msActiveThread = null;

// ——— HELPERS ———
function _msPrefix() {
  return currentUser && currentUser.role === 'employer' ? 'edash' : 'sdash';
}

function _msOtherName(thread) {
  if (!thread) return 'Unknown';
  const pn = thread.participantNames || {};
  return currentUser.role === 'employer'
    ? (pn.studentName  || 'Student')
    : (pn.employerName || 'Employer');
}

// ——— COORDINATOR NOTIFICATION ———
// Delegates to notifyCoordinators() in notifications.js (loaded before this script).
// Fire-and-forget — callers do not need to await.
function _notifyCoordinators(type, payload) {
  notifyCoordinators(type, payload);
}

// ——— INIT (called from each dashboard's DOMContentLoaded) ———
function msInit() {
  if (!currentUser) return;
  const params = new URLSearchParams(location.search);
  if (params.get('section') !== 'messages') return;

  // Show the messages section
  if (currentUser.role === 'employer') showEDashSection('messages');
  else showSDashSection('messages');

  // Pick up cross-page thread open request (e.g. from applicants.html)
  const raw = sessionStorage.getItem('sib_open_thread_params');
  if (raw) {
    try {
      sessionStorage.removeItem('sib_open_thread_params');
      msOpenOrCreate(JSON.parse(raw)); // fire-and-forget async
    } catch (_) {}
  }
}

// ——— OPEN OR CREATE THREAD ———
async function msOpenOrCreate(params) {
  if (!currentUser) return;
  const { applicationId, studentId, employerId, studentName, employerName, listingId, listingTitle } = params || {};

  // Reuse an existing thread for this application
  let thread = applicationId ? await getThreadForApplication(applicationId) : null;

  if (!thread) {
    try {
      thread = await createMessageThread({
        studentId:   studentId  || (currentUser.role === 'student'  ? currentUser.id : ''),
        employerId:  employerId || (currentUser.role === 'employer' ? currentUser.id : ''),
        applicationId: applicationId || null,
        listingId:   listingId || null,
        participantNames: {
          studentName:  studentName  || (currentUser.role === 'student'  ? currentUser.name : 'Student'),
          employerName: employerName || (currentUser.role === 'employer' ? currentUser.name : 'Employer'),
          listingTitle: listingTitle || ''
        }
      });
    } catch (err) {
      showToast(err.message || 'Could not start conversation.', true);
      return;
    }
  }

  await msOpenThread(thread);
}

// ——— THREAD VIEW ———
async function msOpenThread(thread) {
  if (!thread) return;
  _msActiveThread = thread;
  const prefix = _msPrefix();

  // Switch sub-panels
  const inboxEl  = document.getElementById(prefix + '-messages-inbox');
  const threadEl = document.getElementById(prefix + '-messages-thread');
  if (inboxEl)  inboxEl.style.display  = 'none';
  if (threadEl) threadEl.style.display = 'block';

  _msRenderThreadHeader(thread);
  await _msRenderMessages(thread.id);
}

// Open a thread by id — used from inline onclick in the inbox list.
async function msOpenThreadById(threadId) {
  const thread = await getMessageThreadById(threadId);
  if (thread) await msOpenThread(thread);
}

async function msBackToInbox() {
  _msActiveThread = null;
  const prefix = _msPrefix();
  const inboxEl  = document.getElementById(prefix + '-messages-inbox');
  const threadEl = document.getElementById(prefix + '-messages-thread');
  if (inboxEl)  { inboxEl.style.display = 'block'; await msRenderInbox(); }
  if (threadEl) threadEl.style.display = 'none';
}

function _msRenderThreadHeader(thread) {
  const prefix = _msPrefix();
  const header = document.getElementById(prefix + '-thread-header');
  if (!header) return;
  const otherName = _msOtherName(thread);
  const pn = thread.participantNames || {};
  const listing = pn.listingTitle ? ` · ${pn.listingTitle}` : '';
  const flagBanner = thread.status === 'flagged'
    ? `<div style="font-size:12px;color:#b45309;font-weight:600;margin-top:4px;">⚑ This conversation has been flagged and is under coordinator review.</div>`
    : '';
  const reviewedBadge = thread.reviewedAt
    ? `<div style="font-size:11.5px;color:#15803d;font-weight:600;margin-top:4px;">✓ Reviewed by coordinator · ${new Date(thread.reviewedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</div>`
    : '';

  header.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:16px;">
      <div>
        <div style="font-size:15.5px;font-weight:700;color:var(--ink);">${_htmlEsc(otherName)}${_htmlEsc(listing)}</div>
        ${flagBanner}${reviewedBadge}
      </div>
      ${thread.status === 'flagged'
        ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:8px;
                        border:1.5px solid #fca5a5;background:#fff5f5;color:#b91c1c;
                        font-size:12.5px;font-weight:700;white-space:nowrap;">
             ⚑ Reported
           </span>`
        : `<button onclick="msReportThread('${thread.id}')"
             style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:8px;
                    border:1.5px solid #fca5a5;background:#fff5f5;color:#b91c1c;
                    font-family:var(--sans);font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
               <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
             </svg>
             Report this conversation
           </button>`
      }
    </div>`;
}

async function _msRenderMessages(threadId) {
  const prefix = _msPrefix();
  const container = document.getElementById(prefix + '-thread-messages');
  if (!container) return;

  const msgs = (await getMessages(threadId)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (!msgs.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px 0;color:var(--text-faint);font-size:13.5px;">No messages yet. Send the first one.</div>`;
  } else {
    container.innerHTML = msgs.map(m => {
      const isMine = m.senderId === currentUser.id;
      const time = new Date(m.createdAt).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
      const flagNote = m.flagged
        ? `<div style="font-size:11px;color:#b45309;margin-top:4px;text-align:${isMine ? 'right' : 'left'};">⚑ Flagged: ${_htmlEsc(moderationReasonLabels(m.flagReasons).join(', '))}</div>`
        : '';
      return `
        <div style="display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'};margin-bottom:16px;">
          <div style="max-width:74%;padding:11px 15px;
                      border-radius:${isMine ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};
                      background:${isMine ? '#1a6cf6' : '#f3f4f6'};
                      color:${isMine ? '#fff' : '#0d1117'};
                      font-size:14px;line-height:1.55;word-break:break-word;
                      box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            ${_htmlEsc(m.body).replace(/\n/g, '<br>')}
          </div>
          <div style="font-size:11px;color:var(--text-faint);margin-top:3px;">${time}</div>
          ${flagNote}
        </div>`;
    }).join('');
  }

  container.scrollTop = container.scrollHeight;
}

// ——— INBOX ———
async function msRenderInbox() {
  if (!currentUser) return;
  _msActiveThread = null;
  const prefix = _msPrefix();
  const role   = currentUser.role;
  const threads = (await getMessageThreads(currentUser.id, role))
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

  const list = document.getElementById(prefix + '-inbox-list');
  if (!list) return;

  if (!threads.length) {
    const hint = role === 'employer'
      ? 'Click "Message" on an accepted applicant\'s card to start a conversation.'
      : 'Messages from employers appear here once your application is accepted.';
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-faint)">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="empty-state-title">No messages yet</div>
        <div class="empty-state-body">${hint}</div>
      </div>`;
    return;
  }

  // Thread previews come from the server (_preview field); no per-thread message fetch needed.
  list.innerHTML = threads.map(t => {
    const otherName = role === 'employer' ? (t.participantNames.studentName || 'Student') : (t.participantNames.employerName || 'Employer');
    const listing   = t.participantNames.listingTitle;
    const preview   = t.preview ? t.preview.slice(0, 72) + (t.preview.length > 72 ? '…' : '') : 'No messages yet';
    const ago       = typeof timeAgo === 'function' ? timeAgo(t.lastMessageAt) : '';
    const flagBadge = t.status === 'flagged'
      ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:4px;padding:1px 6px;font-weight:700;margin-left:6px;">FLAGGED</span>`
      : '';

    return `
      <div class="job-app-card" style="cursor:pointer;border-left:3px solid ${t.status === 'flagged' ? '#fca5a5' : 'transparent'};"
           onclick="msOpenThreadById('${t.id}')">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:2px;">
            <span style="font-size:14px;font-weight:600;color:var(--ink);">${_htmlEsc(otherName)}</span>
            ${flagBadge}
          </div>
          ${listing ? `<div style="font-size:12px;color:var(--text-faint);margin-bottom:2px;">${_htmlEsc(listing)}</div>` : ''}
          <div style="font-size:13px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${_htmlEsc(preview)}</div>
        </div>
        <div style="font-size:12px;color:var(--text-faint);white-space:nowrap;margin-left:12px;flex-shrink:0;">${ago}</div>
      </div>`;
  }).join('');
}

// ——— SEND ———
async function msSendMessage() {
  if (!currentUser || !_msActiveThread) return;
  const prefix = _msPrefix();
  const input  = document.getElementById(prefix + '-msg-input');
  if (!input) return;
  const body = input.value.trim();
  if (!body) { input.focus(); return; }

  // Pre-flight moderation — show warning to sender but do NOT block
  const analysis = analyzeMessage(body);
  if (analysis.flagged) {
    const labels = moderationReasonLabels(analysis.reasons).join(', ');
    const proceed = await _msConfirmSend(labels);
    if (!proceed) return;
  }

  // Deliver message (flagged state embedded — server updates thread status automatically)
  let msg;
  try {
    msg = await createMessage({
      threadId:   _msActiveThread.id,
      body,
      flagged:    analysis.flagged,
      flagReasons: analysis.flagged ? analysis.reasons : []
    });
  } catch (err) {
    showToast(err.message || 'Could not send message.', true);
    return;
  }

  if (analysis.flagged) {
    // Refresh thread object so the flagged banner shows updated status
    _msActiveThread = await getMessageThreadById(_msActiveThread.id) || _msActiveThread;
    _notifyCoordinators('messageFlagged', {
      threadId:       _msActiveThread.id,
      reasons:        analysis.reasons,
      messagePreview: body.slice(0, 80) + (body.length > 80 ? '…' : ''),
      senderRole:     currentUser.role,
      senderName:     currentUser.name
    });
  }

  // Notify recipient in-app (Phase 5 handles cross-user email server-side)
  const recipientId = currentUser.role === 'student'
    ? _msActiveThread.employerId
    : _msActiveThread.studentId;
  createNotification({
    userId:    recipientId,
    type:      'newMessage',
    payload:   { preview: body.slice(0, 60), senderName: currentUser.name, senderRole: currentUser.role, threadId: _msActiveThread.id },
    userEmail: null // TODO: Phase 5 — pass recipient email server-side for immediate email
  });

  input.value = '';
  await _msRenderMessages(_msActiveThread.id);
  if (analysis.flagged) _msRenderThreadHeader(_msActiveThread);
}

// Custom pre-flight confirmation dialog — replaces browser confirm() for better UX
function _msConfirmSend(flagReasonText) {
  return new Promise(resolve => {
    const existing = document.getElementById('_msConfirmDlg');
    if (existing) existing.remove();

    const dlg = document.createElement('div');
    dlg.id = '_msConfirmDlg';
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    dlg.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:28px 24px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.22);">
        <div style="font-size:15px;font-weight:700;color:#0d1117;margin-bottom:10px;">Review before sending</div>
        <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:11px 14px;margin-bottom:14px;">
          <div style="font-size:12.5px;color:#92400e;font-weight:600;margin-bottom:3px;">This message may contain:</div>
          <div style="font-size:12.5px;color:#92400e;">${_htmlEsc(flagReasonText)}</div>
        </div>
        <p style="font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:20px;">
          Your message will still be delivered, but a copy will be sent to the co-op coordinator for review.
          If this was unintentional, click <strong>Edit message</strong> to revise it.
        </p>
        <div style="display:flex;gap:9px;">
          <button id="_msConfirmCancel" style="flex:1;padding:10px;border-radius:8px;border:1.5px solid #e5e7eb;background:#fff;font-family:var(--sans);font-size:13.5px;font-weight:600;cursor:pointer;color:#374151;">Edit message</button>
          <button id="_msConfirmOk" style="flex:1;padding:10px;border-radius:8px;border:none;background:#1a6cf6;color:#fff;font-family:var(--sans);font-size:13.5px;font-weight:700;cursor:pointer;">Send anyway →</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    document.getElementById('_msConfirmCancel').onclick = () => { dlg.remove(); resolve(false); };
    document.getElementById('_msConfirmOk').onclick     = () => { dlg.remove(); resolve(true);  };
    dlg.addEventListener('click', e => { if (e.target === dlg) { dlg.remove(); resolve(false); } });
  });
}

// ——— REPORT THREAD ———
function msReportThread(threadId) {
  const existing = document.getElementById('_msReportDlg');
  if (existing) existing.remove();

  const dlg = document.createElement('div');
  dlg.id = '_msReportDlg';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
  dlg.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:28px 24px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.22);">
      <div style="font-size:15px;font-weight:700;color:#0d1117;margin-bottom:10px;">Report this conversation?</div>
      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:20px;">
        The co-op coordinator will be notified immediately and will review this conversation.
        Use this only if you have a genuine concern.
      </p>
      <div style="display:flex;gap:9px;">
        <button id="_msReportCancel" style="flex:1;padding:10px;border-radius:8px;border:1.5px solid #e5e7eb;background:#fff;font-family:var(--sans);font-size:13.5px;font-weight:600;cursor:pointer;color:#374151;">Cancel</button>
        <button id="_msReportOk" style="flex:1;padding:10px;border-radius:8px;border:none;background:#dc2626;color:#fff;font-family:var(--sans);font-size:13.5px;font-weight:700;cursor:pointer;">Report →</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const cleanup = () => dlg.remove();
  document.getElementById('_msReportCancel').onclick = cleanup;
  dlg.addEventListener('click', e => { if (e.target === dlg) cleanup(); });
  document.getElementById('_msReportOk').onclick = async () => {
    cleanup();
    await updateMessageThreadStatus(threadId, 'flagged');
    _notifyCoordinators('messageFlagged', {
      threadId,
      reasons:        ['user_report'],
      messagePreview: '',
      senderRole:     currentUser.role,
      senderName:     currentUser.name,
      userReported:   true
    });
    showToast('✓ Reported. The coordinator has been notified.');
    if (_msActiveThread && _msActiveThread.id === threadId) {
      _msActiveThread = await getMessageThreadById(threadId) || _msActiveThread;
      _msRenderThreadHeader(_msActiveThread);
    }
  };
}
