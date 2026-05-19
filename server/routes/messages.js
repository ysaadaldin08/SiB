// Messages router — mounted inside threads.js as router.use('/:id/messages', messagesRouter)
// mergeParams: true gives access to the parent thread id via req.params.id.
const express = require('express');
const router = express.Router({ mergeParams: true });
const { supabase, authenticate } = require('../middleware/auth');

async function _getUserRole(userId) {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
  return data?.role || null;
}

// GET /api/threads/:id/messages
router.get('/', authenticate, async (req, res) => {
  try {
    const threadId = req.params.id;
    const userId   = req.user.id;
    const role     = await _getUserRole(userId);

    const { data: thread } = await supabase
      .from('message_threads')
      .select('student_id, employer_id')
      .eq('id', threadId)
      .single();
    if (!thread) return res.status(404).json({ success: false, error: 'Thread not found' });
    if (role !== 'coordinator' && thread.student_id !== userId && thread.employer_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('messages GET /:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/threads/:id/messages
router.post('/', authenticate, async (req, res) => {
  try {
    const threadId = req.params.id;
    const userId   = req.user.id;
    const role     = await _getUserRole(userId);

    const { data: thread } = await supabase
      .from('message_threads')
      .select('student_id, employer_id, status')
      .eq('id', threadId)
      .single();
    if (!thread) return res.status(404).json({ success: false, error: 'Thread not found' });
    if (role !== 'coordinator' && thread.student_id !== userId && thread.employer_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { body, flagged, flag_reasons } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ success: false, error: 'body is required' });
    }

    // Server-side rate limit: 20 messages per sender per hour
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count: msgCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', userId)
      .gte('created_at', hourAgo);
    if (msgCount >= 20) {
      return res.status(429).json({
        success: false,
        error: "You've reached the limit of 20 messages per hour. Please wait before sending more."
      });
    }

    const isFlagged = !!flagged;
    const { data: msg, error } = await supabase
      .from('messages')
      .insert({
        thread_id:    threadId,
        sender_id:    userId,
        sender_role:  role,
        body:         body.trim(),
        flagged:      isFlagged,
        flag_reasons: flag_reasons || []
      })
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });

    // Update thread.last_message_at; also flip status to flagged if needed
    const updates = { last_message_at: msg.created_at };
    if (isFlagged && thread.status !== 'flagged') updates.status = 'flagged';
    await supabase.from('message_threads').update(updates).eq('id', threadId);

    res.json({ success: true, data: msg });
  } catch (err) {
    console.error('messages POST /:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
