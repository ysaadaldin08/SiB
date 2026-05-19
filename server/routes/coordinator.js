const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

async function requireCoordinator(req, res, next) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    if (profile?.role === 'coordinator') return next();
    // Fallback: user_metadata (if profiles table doesn't exist yet)
    if (req.user.user_metadata?.role === 'coordinator') return next();
    return res.status(403).json({ success: false, error: 'Coordinator access required.' });
  } catch (_) {
    return res.status(403).json({ success: false, error: 'Coordinator access required.' });
  }
}

// GET /api/coordinator/postings — all postings with employer info + applicant counts
router.get('/postings', authenticate, requireCoordinator, async (req, res) => {
  try {
    const { data: postings, error: pErr } = await supabase
      .from('postings')
      .select('*, employers(company_name, contact_name, email)')
      .order('created_at', { ascending: false });
    if (pErr) return res.status(500).json({ success: false, error: pErr.message });

    const { data: appRows } = await supabase.from('applications').select('posting_id');
    const countMap = {};
    if (appRows) appRows.forEach(a => { countMap[a.posting_id] = (countMap[a.posting_id] || 0) + 1; });

    res.json({
      success: true,
      data: postings.map(p => ({ ...p, applicant_count: countMap[p.id] || 0 }))
    });
  } catch (err) {
    console.error('coordinator GET /postings:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/coordinator/applications — all applications with student + posting info
router.get('/applications', authenticate, requireCoordinator, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('applications')
      .select('*, students(full_name, school, grade, email), postings(title, employers(company_name))')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('coordinator GET /applications:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/coordinator/applications/:id — update application status
router.put('/applications/:id', authenticate, requireCoordinator, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['Applied', 'Under Review', 'Interview', 'Rejected', 'Accepted'];
    if (!status || !valid.includes(status)) {
      return res.status(400).json({ success: false, error: `status must be one of: ${valid.join(', ')}` });
    }
    const { data, error } = await supabase
      .from('applications')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('coordinator PUT /applications/:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/coordinator/postings/:id — update any posting field
router.put('/postings/:id', authenticate, requireCoordinator, async (req, res) => {
  try {
    const allowed = ['title', 'description', 'responsibilities', 'requirements', 'track', 'work_mode', 'hours_per_week', 'location', 'start_date', 'deadline', 'is_active'];
    const updates = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const { data, error } = await supabase
      .from('postings')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('coordinator PUT /postings/:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// DELETE /api/coordinator/postings/:id — delete posting and all its applications
router.delete('/postings/:id', authenticate, requireCoordinator, async (req, res) => {
  try {
    await supabase.from('applications').delete().eq('posting_id', req.params.id);
    const { error } = await supabase.from('postings').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true });
  } catch (err) {
    console.error('coordinator DELETE /postings/:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/coordinator/users — all users from profiles table
router.get('/users', authenticate, requireCoordinator, async (req, res) => {
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, role, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });

    const employerIds = profiles.filter(u => u.role === 'employer').map(u => u.id);
    const studentIds  = profiles.filter(u => u.role === 'student').map(u => u.id);

    const [employers, students, appRows, postRows] = await Promise.all([
      employerIds.length
        ? supabase.from('employers').select('id, company_name, contact_name, coordinator_approved').in('id', employerIds).then(r => r.data || [])
        : Promise.resolve([]),
      studentIds.length
        ? supabase.from('students').select('id, full_name').in('id', studentIds).then(r => r.data || [])
        : Promise.resolve([]),
      studentIds.length
        ? supabase.from('applications').select('student_id').in('student_id', studentIds).then(r => r.data || [])
        : Promise.resolve([]),
      employerIds.length
        ? supabase.from('postings').select('employer_id').eq('is_active', true).in('employer_id', employerIds).then(r => r.data || [])
        : Promise.resolve([]),
    ]);

    const companyMap       = {};
    const nameMap          = {};
    const appCountMap      = {};
    const postCountMap     = {};
    const coordApprovedMap = {};
    employers.forEach(e => {
      companyMap[e.id]       = e.company_name;
      nameMap[e.id]          = e.contact_name || e.company_name;
      coordApprovedMap[e.id] = !!e.coordinator_approved;
    });
    students.forEach(s  => { nameMap[s.id] = s.full_name; });
    appRows.forEach(a   => { appCountMap[a.student_id]   = (appCountMap[a.student_id]   || 0) + 1; });
    postRows.forEach(p  => { postCountMap[p.employer_id] = (postCountMap[p.employer_id] || 0) + 1; });

    res.json({
      success: true,
      data: profiles.map(u => ({
        ...u,
        full_name:            nameMap[u.id]          || null,
        company_name:         companyMap[u.id]        || null,
        application_count:    appCountMap[u.id]       || 0,
        active_posting_count: postCountMap[u.id]      || 0,
        coordinator_approved: coordApprovedMap[u.id]  || false
      }))
    });
  } catch (err) {
    console.error('coordinator GET /users:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/coordinator/users/:id — email-verify a user (fix for B-2)
router.put('/users/:id', authenticate, requireCoordinator, async (req, res) => {
  try {
    if (req.body.email_verified) {
      await supabase.auth.admin.updateUserById(req.params.id, { email_confirm: true });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('coordinator PUT /users/:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/coordinator/employers/:id/approve — grant employer posting rights
router.put('/employers/:id/approve', authenticate, requireCoordinator, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('employers')
      .update({ coordinator_approved: true })
      .eq('id', req.params.id)
      .select('id, coordinator_approved')
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('coordinator PUT /employers/:id/approve:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/coordinator/threads — all message threads (coordinator-only)
router.get('/threads', authenticate, requireCoordinator, async (req, res) => {
  try {
    const { data: threads, error } = await supabase
      .from('message_threads')
      .select('*')
      .order('last_message_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });

    // Enrich with per-thread message preview and counts
    const enriched = await _enrichCoordThreads(threads || []);
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('coordinator GET /threads:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/coordinator/messages/:id/review — mark a message as coordinator-reviewed
router.put('/messages/:id/review', authenticate, requireCoordinator, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .update({ reviewed_by_coordinator: true })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('coordinator PUT /messages/:id/review:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

async function _enrichCoordThreads(threads) {
  if (!threads.length) return threads;
  const ids = threads.map(t => t.id);
  const { data: messages } = await supabase
    .from('messages')
    .select('thread_id, body, flagged, flag_reasons, created_at')
    .in('thread_id', ids)
    .order('created_at', { ascending: true });

  const previewMap     = {};
  const countMap       = {};
  const flaggedCntMap  = {};
  const flagReasonsMap = {};
  if (messages) {
    messages.forEach(m => {
      previewMap[m.thread_id]    = m.body;
      countMap[m.thread_id]      = (countMap[m.thread_id] || 0) + 1;
      if (m.flagged) {
        flaggedCntMap[m.thread_id] = (flaggedCntMap[m.thread_id] || 0) + 1;
        const cur = flagReasonsMap[m.thread_id] || [];
        (m.flag_reasons || []).forEach(r => { if (!cur.includes(r)) cur.push(r); });
        flagReasonsMap[m.thread_id] = cur;
      }
    });
  }
  return threads.map(t => ({
    ...t,
    _preview:       previewMap[t.id]     || null,
    _message_count: countMap[t.id]       || 0,
    _flagged_count: flaggedCntMap[t.id]  || 0,
    _flag_reasons:  flagReasonsMap[t.id] || []
  }));
}

module.exports = router;
