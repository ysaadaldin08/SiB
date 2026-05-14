// ——— SiB DEMO DATA SEEDER ———
// Only active on localhost / 127.0.0.1. Injects a floating "⚡ Demo" button
// that lets reviewers enter the platform as any role with realistic data pre-loaded.
// Safe to include on every page — no-ops in production environments.

(function () {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;

  // ——— DEMO PERSONAS ———

  const NOW = Date.now();
  const daysAgo = d => new Date(NOW - d * 86400000).toISOString();

  const DEMO_STUDENT = {
    id: 'demo-student-1',
    name: 'Alex Thompson',
    first: 'Alex',
    email: 'alex.thompson@ocdsbstudents.ca',
    role: 'student',
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    domainVerified: true,
    coordinatorApproved: true,
    notificationPreferences: {
      signupConfirm: 'immediate', applicationStatus: 'immediate',
      newListing: 'immediate', newMessage: 'immediate', newApplication: 'immediate'
    },
    createdAt: daysAgo(28)
  };

  const DEMO_EMPLOYER = {
    id: 'demo-employer-1',
    name: 'Shopify Ottawa',
    first: 'Jane',
    email: 'jane.smith@shopify.com',
    role: 'employer',
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    domainVerified: false,
    coordinatorApproved: true,
    notificationPreferences: {
      signupConfirm: 'immediate', newApplication: 'immediate',
      newMessage: 'immediate', applicationStatus: 'off', newListing: 'off'
    },
    createdAt: daysAgo(22)
  };

  const DEMO_COORDINATOR = {
    id: 'coord-seed-1',
    name: 'Mr. Caap',
    first: 'Caap',
    email: 'ysaadaldin08@gmail.com',
    role: 'coordinator',
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    notificationPreferences: {
      signupConfirm: 'immediate', newApplication: 'immediate',
      applicationStatus: 'immediate', newListing: 'off', newMessage: 'immediate'
    },
    createdAt: daysAgo(60)
  };

  // ——— DEMO THREAD + MESSAGES ———

  const THREAD_1 = 'demo-thread-normal';
  const THREAD_2 = 'demo-thread-flagged';

  function _buildThreads() {
    return [
      {
        id: THREAD_1,
        studentId: DEMO_STUDENT.email,
        employerId: DEMO_EMPLOYER.email,
        listingId: 'demo-posting-1',
        applicationId: 'demo-app-1',
        createdAt: daysAgo(14),
        createdBy: DEMO_STUDENT.email,
        lastMessageAt: daysAgo(2),
        status: 'open',
        reviewedAt: daysAgo(10),
        reviewedBy: 'Mr. Caap',
        coordinatorNote: 'Looks like a strong fit. Monitoring — no issues.',
        participantNames: {
          studentName: 'Alex Thompson',
          employerName: 'Shopify Ottawa',
          listingTitle: 'Software Dev Intern (Spring 2026)'
        }
      },
      {
        id: THREAD_2,
        studentId: 'maya.santos@ocdsbstudents.ca',
        employerId: 'hr@techcorp-ottawa.ca',
        listingId: 'demo-posting-2',
        applicationId: 'demo-app-2',
        createdAt: daysAgo(5),
        createdBy: 'hr@techcorp-ottawa.ca',
        lastMessageAt: daysAgo(4),
        status: 'flagged',
        reviewedAt: null,
        reviewedBy: null,
        coordinatorNote: null,
        participantNames: {
          studentName: 'Maya Santos',
          employerName: 'TechCorp Ottawa',
          listingTitle: 'Marketing Intern (Spring 2026)'
        }
      }
    ];
  }

  function _buildMessages() {
    return [
      // Normal thread
      {
        id: 'demo-msg-1', threadId: THREAD_1, senderId: DEMO_EMPLOYER.email,
        senderRole: 'employer', body: 'Hi Alex! Congratulations on being accepted for the Software Dev Intern position. We\'re looking forward to having you on the team.',
        createdAt: daysAgo(14), flagged: false, flagReasons: [], reviewedByCoordinator: true
      },
      {
        id: 'demo-msg-2', threadId: THREAD_1, senderId: DEMO_STUDENT.email,
        senderRole: 'student', body: 'Thank you so much! I\'m really excited. What should I bring on my first day, and what time should I arrive?',
        createdAt: daysAgo(13), flagged: false, flagReasons: [], reviewedByCoordinator: true
      },
      {
        id: 'demo-msg-3', threadId: THREAD_1, senderId: DEMO_EMPLOYER.email,
        senderRole: 'employer', body: 'Arrive at 9 AM at 150 Elgin St, Suite 800. Bring government-issued ID and your signed placement agreement. We\'ll have a laptop ready for you.',
        createdAt: daysAgo(13), flagged: false, flagReasons: [], reviewedByCoordinator: true
      },
      {
        id: 'demo-msg-4', threadId: THREAD_1, senderId: DEMO_STUDENT.email,
        senderRole: 'student', body: 'Perfect, I\'ll be there. Looking forward to it!',
        createdAt: daysAgo(2), flagged: false, flagReasons: [], reviewedByCoordinator: false
      },
      // Flagged thread
      {
        id: 'demo-msg-5', threadId: THREAD_2, senderId: 'hr@techcorp-ottawa.ca',
        senderRole: 'employer', body: 'Hi Maya, congratulations on your accepted application! We\'re excited to have you.',
        createdAt: daysAgo(5), flagged: false, flagReasons: [], reviewedByCoordinator: false
      },
      {
        id: 'demo-msg-6', threadId: THREAD_2, senderId: 'hr@techcorp-ottawa.ca',
        senderRole: 'employer', body: 'Actually it would be easier to coordinate outside the portal — my cell is 613-555-0192. Text me and we can sort out the details.',
        createdAt: daysAgo(4),
        flagged: true,
        flagReasons: ['Phone number detected (613-555-0192)', 'Off-platform contact requested'],
        reviewedByCoordinator: false
      }
    ];
  }

  function _buildNotifications() {
    const notifs = [];
    const uid = () => Math.random().toString(36).slice(2, 9);

    // ——— Coordinator notifications ———
    notifs.push(
      { id: uid(), userId: 'coord-seed-1', type: 'newPlacement',
        payload: { studentName: 'Alex Thompson', school: 'Earl of March SS', postingTitle: 'Software Dev Intern', companyName: 'Shopify Ottawa', postingId: 'demo-posting-1' },
        createdAt: daysAgo(14), readAt: daysAgo(13), emailedAt: null },
      { id: uid(), userId: 'coord-seed-1', type: 'messageFlagged',
        payload: { threadId: THREAD_2, reasons: ['Phone number detected', 'Off-platform contact requested'], messagePreview: 'my cell is 613-555-0192', senderName: 'TechCorp Ottawa', senderRole: 'employer' },
        createdAt: daysAgo(4), readAt: null, emailedAt: null },
      { id: uid(), userId: 'coord-seed-1', type: 'newUserReview',
        payload: { email: 'jordan.b@gmail.com', name: 'Jordan B.' },
        createdAt: daysAgo(3), readAt: null, emailedAt: null },
      { id: uid(), userId: 'coord-seed-1', type: 'concernReport',
        payload: { senderName: 'Anonymous', senderEmail: '', type: 'inappropriate_message', detail: 'The employer asked me to text them privately. I felt uncomfortable.' },
        createdAt: daysAgo(4), readAt: null, emailedAt: null }
    );

    // ——— Student notifications ———
    notifs.push(
      { id: uid(), userId: 'demo-student-1', type: 'signupConfirm',
        payload: { firstName: 'Alex' },
        createdAt: daysAgo(28), readAt: daysAgo(28), emailedAt: daysAgo(28) },
      { id: uid(), userId: 'demo-student-1', type: 'applicationStatus',
        payload: { status: 'Under Review', postingTitle: 'Software Dev Intern', firstName: 'Alex' },
        createdAt: daysAgo(20), readAt: daysAgo(19), emailedAt: daysAgo(20) },
      { id: uid(), userId: 'demo-student-1', type: 'applicationStatus',
        payload: { status: 'Accepted', postingTitle: 'Software Dev Intern', firstName: 'Alex' },
        createdAt: daysAgo(14), readAt: daysAgo(14), emailedAt: daysAgo(14) },
      { id: uid(), userId: 'demo-student-1', type: 'newMessage',
        payload: { senderName: 'Shopify Ottawa', senderRole: 'employer', preview: 'Hi Alex! Congratulations on being accepted…' },
        createdAt: daysAgo(14), readAt: daysAgo(13), emailedAt: null },
      { id: uid(), userId: 'demo-student-1', type: 'newMessage',
        payload: { senderName: 'Shopify Ottawa', senderRole: 'employer', preview: 'Arrive at 9 AM at 150 Elgin St…' },
        createdAt: daysAgo(13), readAt: null, emailedAt: null }
    );

    // ——— Employer notifications ———
    notifs.push(
      { id: uid(), userId: 'demo-employer-1', type: 'signupConfirm',
        payload: { firstName: 'Jane' },
        createdAt: daysAgo(22), readAt: daysAgo(22), emailedAt: daysAgo(22) },
      { id: uid(), userId: 'demo-employer-1', type: 'newApplication',
        payload: { studentName: 'Alex Thompson', postingTitle: 'Software Dev Intern', postingId: 'demo-posting-1' },
        createdAt: daysAgo(18), readAt: daysAgo(18), emailedAt: null },
      { id: uid(), userId: 'demo-employer-1', type: 'newMessage',
        payload: { senderName: 'Alex Thompson', senderRole: 'student', preview: 'Thank you so much! I\'m really excited…' },
        createdAt: daysAgo(13), readAt: daysAgo(12), emailedAt: null }
    );

    return notifs;
  }

  // ——— SEED FUNCTION ———

  // Populates localStorage with demo threads/messages/notifications so the demo
  // works even when the server isn't running or returns 401 (production fallback).
  function _seedLocalStorage(overrides = {}) {
    const { coordId, studentId, employerId } = overrides;

    // Threads
    const existingThreads = JSON.parse(localStorage.getItem('sib_message_threads') || '[]');
    const demoIds = [THREAD_1, THREAD_2];
    const filtered = existingThreads.filter(t => !demoIds.includes(t.id));
    localStorage.setItem('sib_message_threads', JSON.stringify([...filtered, ..._buildThreads()]));

    // Messages
    const existingMsgs = JSON.parse(localStorage.getItem('sib_messages') || '[]');
    const demoMsgIds = ['demo-msg-1','demo-msg-2','demo-msg-3','demo-msg-4','demo-msg-5','demo-msg-6'];
    const filteredMsgs = existingMsgs.filter(m => !demoMsgIds.includes(m.id));
    localStorage.setItem('sib_messages', JSON.stringify([...filteredMsgs, ..._buildMessages()]));

    // Notifications — use real server IDs if available, fall back to fake IDs
    const notifCoordId  = coordId   || 'coord-seed-1';
    const notifStudentId = studentId || 'demo-student-1';
    const notifEmployerId = employerId || 'demo-employer-1';
    const existingNotifs = JSON.parse(localStorage.getItem('sib_notifications') || '[]');
    const demoUserIds = ['coord-seed-1', 'demo-student-1', 'demo-employer-1', notifCoordId, notifStudentId, notifEmployerId];
    const filteredNotifs = existingNotifs.filter(n => !demoUserIds.includes(n.userId));
    const builtNotifs = _buildNotifications().map(n => ({
      ...n,
      userId: n.userId === 'coord-seed-1'    ? notifCoordId
            : n.userId === 'demo-student-1'  ? notifStudentId
            : n.userId === 'demo-employer-1' ? notifEmployerId
            : n.userId
    }));
    localStorage.setItem('sib_notifications', JSON.stringify([...filteredNotifs, ...builtNotifs]));

    // Approved employers (Shopify is coordinator-approved)
    const approved = JSON.parse(localStorage.getItem('sib_approved_employers') || '[]');
    if (!approved.includes(DEMO_EMPLOYER.email)) {
      approved.push(DEMO_EMPLOYER.email);
      localStorage.setItem('sib_approved_employers', JSON.stringify(approved));
    }
  }

  // Calls /api/dev/seed to get real tokens and server-side data.
  // Falls back to empty tokens silently on failure (production / server down).
  async function _seedServer() {
    try {
      const res = await fetch((typeof API_BASE !== 'undefined' ? API_BASE : 'http://localhost:3001/api').replace(/\/api$/, '') + '/api/dev/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json.success ? json.data : null;
    } catch (_) { return null; }
  }

  // ——— ROLE ENTRY POINTS ———

  window.demoAsStudent = async function () {
    const server = await _seedServer();
    const studentUser = { ...DEMO_STUDENT, id: server?.student_id || DEMO_STUDENT.id };
    _seedLocalStorage({ coordId: server?.coordinator_id, studentId: server?.student_id, employerId: server?.employer_id });
    localStorage.setItem('sib_user', JSON.stringify(studentUser));
    localStorage.setItem('sib_token', server?.student_token || '');
    sessionStorage.setItem('sib_student_app', JSON.stringify({
      first: 'Alex', last: 'Thompson',
      school: 'Earl of March SS', grade: 'Grade 12',
      tracks: 'Technology & IT',
      hrs: '25',
      q1: 'I want to build real software and understand how professional development teams work. Co-op is the best way to bridge that gap.',
      q2: 'Over the summer I built a personal budget app — designed the schema, wrote the logic in Python, and deployed it on a Raspberry Pi at home.',
      resumeName: 'AlexThompson_Resume.pdf'
    }));
    window.location.href = 'dashboard-student.html';
  };

  window.demoAsEmployer = async function () {
    const server = await _seedServer();
    const employerUser = { ...DEMO_EMPLOYER, id: server?.employer_id || DEMO_EMPLOYER.id };
    _seedLocalStorage({ coordId: server?.coordinator_id, studentId: server?.student_id, employerId: server?.employer_id });
    localStorage.setItem('sib_user', JSON.stringify(employerUser));
    localStorage.setItem('sib_token', server?.employer_token || '');
    sessionStorage.setItem('sib_emp_data', JSON.stringify({
      company: 'Shopify Ottawa',
      industry: 'Technology / E-Commerce',
      format: 'Full-Time Co-op (Hybrid)',
      hours: '30',
      students: '1–2',
      supervisor: 'Jane Smith, Engineering Manager'
    }));
    window.location.href = 'dashboard-employer.html';
  };

  window.demoAsCoordinator = async function () {
    const server = await _seedServer();
    const coordUser = { ...DEMO_COORDINATOR, id: server?.coordinator_id || DEMO_COORDINATOR.id };
    _seedLocalStorage({ coordId: server?.coordinator_id, studentId: server?.student_id, employerId: server?.employer_id });
    localStorage.setItem('sib_user', JSON.stringify(coordUser));
    localStorage.setItem('sib_token', server?.coordinator_token || '');
    window.location.href = 'coordinator-dashboard.html';
  };

  // ——— DEV PANEL ———

  document.addEventListener('DOMContentLoaded', () => {
    // Don't inject on legal/auth-only pages
    const path = location.pathname;
    if (path.endsWith('privacy.html') || path.endsWith('terms.html')) return;

    const panel = document.createElement('div');
    panel.id = '_devPanel';
    panel.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:99999',
      'background:#0d1117', 'color:#fff', 'border-radius:12px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.4)', 'font-family:var(--sans,sans-serif)',
      'overflow:hidden', 'min-width:180px'
    ].join(';');

    panel.innerHTML = `
      <div id="_devHeader" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;"
           onclick="document.getElementById('_devBody').style.display=document.getElementById('_devBody').style.display==='none'?'block':'none'">
        <span style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#f9fafb;">⚡ DEMO MODE</span>
        <span style="font-size:16px;color:#6b7280;margin-left:10px;">▾</span>
      </div>
      <div id="_devBody" style="padding:0 10px 10px;display:block;">
        <div style="font-size:11px;color:#6b7280;margin-bottom:8px;padding-left:4px;">Enter as:</div>
        <button onclick="demoAsStudent()"
          style="display:block;width:100%;text-align:left;padding:8px 12px;margin-bottom:4px;border:none;border-radius:7px;background:#1a1f2e;color:#93c5fd;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;">
          🎓 Student — Alex Thompson
        </button>
        <button onclick="demoAsEmployer()"
          style="display:block;width:100%;text-align:left;padding:8px 12px;margin-bottom:4px;border:none;border-radius:7px;background:#1a1f2e;color:#86efac;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;">
          🏢 Employer — Shopify Ottawa
        </button>
        <button onclick="demoAsCoordinator()"
          style="display:block;width:100%;text-align:left;padding:8px 12px;border:none;border-radius:7px;background:#1a1f2e;color:#fde68a;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;">
          🏫 Coordinator — Mr. Caap
        </button>
      </div>`;

    document.body.appendChild(panel);
  });
})();
