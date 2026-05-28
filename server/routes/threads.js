const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');
const messagesRouter = require('./messages');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Nest messages under /:id/messages
router.use('/:id/messages', messagesRouter);

async function _getUserRole(userId) {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
  return data?.role || null;
}

// Enrich threads with last-message preview and counts.
// Fetches all messages for the given thread ids in one query.
async function _enrichThreads(threads) {
  if (!threads.length) return threads;
  const ids = threads.map(t => t.id);
  const { data: messages } = await supabase
    .from('messages')
    .select('thread_id, body, flagged, flag_reasons, created_at')
    .in('thread_id', ids)
    .order('created_at', { ascending: true }); // last one wins in the forEach

  const previewMap     = {};
  const countMap       = {};
  const flaggedCntMap  = {};
  const flagReasonsMap = {};
  if (messages) {
    messages.forEach(m => {
      previewMap[m.thread_id]    = m.body; // sorted asc → last overwrites
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
    _preview:       previewMap[t.id]    || null,
    _message_count: countMap[t.id]      || 0,
    _flagged_count: flaggedCntMap[t.id] || 0,
    _flag_reasons:  flagReasonsMap[t.id] || []
  }));
}

// GET /api/threads — threads for the current user (student or employer)
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const role   = await _getUserRole(userId);
    let query = supabase
      .from('message_threads')
      .select('*')
      .order('last_message_at', { ascending: false });
    if (role === 'employer') query = query.eq('employer_id', userId);
    else                     query = query.eq('student_id',  userId);

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });
    const enriched = await _enrichThreads(data || []);
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('threads GET /:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/threads — create a thread; idempotent on application_id
router.post('/', authenticate, async (req, res) => {
  try {
    const { student_id, employer_id, listing_id, application_id, participant_names } = req.body;
    if (!student_id || !employer_id) {
      return res.status(400).json({ success: false, error: 'student_id and employer_id are required' });
    }

    // Idempotency: reuse existing thread for this application
    if (application_id) {
      const { data: existing } = await supabase
        .from('message_threads')
        .select('*')
        .eq('application_id', application_id)
        .maybeSingle();
      if (existing) return res.json({ success: true, data: existing });
    }

    // Thread rate limit: 5 new threads per user per 24 hours
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await supabase
      .from('message_threads')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', req.user.id)
      .gte('created_at', dayAgo);
    if (count >= 5) {
      return res.status(429).json({
        success: false,
        error: 'You can start at most 5 new conversations per day.'
      });
    }

    const { data, error } = await supabase
      .from('message_threads')
      .insert({
        student_id,
        employer_id,
        listing_id:        listing_id     || null,
        application_id:    application_id || null,
        created_by:        req.user.id,
        participant_names: participant_names || {}
      })
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('threads POST /:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/threads/:id — single thread (participant or coordinator)
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid thread ID' });
    const { data, error } = await supabase
      .from('message_threads')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ success: false, error: 'Thread not found' });

    const userId = req.user.id;
    const role   = await _getUserRole(userId);
    if (role !== 'coordinator' && data.student_id !== userId && data.employer_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('threads GET /:id:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/threads/:id/status — update status (participant or coordinator)
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid thread ID' });
    const { status } = req.body;
    if (!['open', 'closed', 'flagged'].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be open, closed, or flagged' });
    }
    const { data: thread } = await supabase
      .from('message_threads')
      .select('student_id, employer_id')
      .eq('id', req.params.id)
      .single();
    if (!thread) return res.status(404).json({ success: false, error: 'Thread not found' });

    const userId = req.user.id;
    const role   = await _getUserRole(userId);
    if (role !== 'coordinator' && thread.student_id !== userId && thread.employer_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const { data, error } = await supabase
      .from('message_threads')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('threads PUT /:id/status:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/threads/:id/review — coordinator-only: record review + optional note
router.put('/:id/review', authenticate, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid thread ID' });
    const role = await _getUserRole(req.user.id);
    if (role !== 'coordinator') {
      return res.status(403).json({ success: false, error: 'Coordinator access required' });
    }
    const { note } = req.body;
    const { data, error } = await supabase
      .from('message_threads')
      .update({
        reviewed_at:      new Date().toISOString(),
        reviewed_by:      req.user.id,
        coordinator_note: note || null
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('threads PUT /:id/review:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
