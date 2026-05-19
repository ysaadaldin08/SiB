const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// GET /api/notifications — current user's last 50 notifications
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('notifications GET /:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/notifications — insert one notification
// user_id in body allows coordinator fan-out; falls back to own id.
router.post('/', authenticate, async (req, res) => {
  try {
    const { user_id, type, payload } = req.body;
    if (!type) return res.status(400).json({ success: false, error: 'type is required' });
    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: user_id || req.user.id, type, payload: payload || {} })
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('notifications POST /:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/notifications/read-all — bulk mark own unread notifications as read
// Must be defined before /:id/read so Express doesn't treat "read-all" as an id.
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .is('read_at', null);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true });
  } catch (err) {
    console.error('notifications PUT /read-all:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/notifications/:id/read — mark one notification as read (own only)
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('notifications PUT /:id/read:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/notifications/:id/emailed — mark one notification as emailed (own only)
router.put('/:id/emailed', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ emailed_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('notifications PUT /:id/emailed:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
