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
    console.error('notifications GET /:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

const VALID_NOTIFICATION_TYPES = [
  'signupConfirm', 'newListing', 'applicationSubmitted', 'newApplication',
  'applicationStatus', 'newMessage', 'messageFlagged', 'newPlacement',
  'newUserReview', 'employerPendingApproval', 'concernReport'
];

// POST /api/notifications — insert one notification
// Coordinators may fan-out to any user_id; other roles may only notify themselves.
router.post('/', authenticate, async (req, res) => {
  try {
    const { user_id, type, payload } = req.body;
    if (!type) return res.status(400).json({ success: false, error: 'type is required' });
    if (!VALID_NOTIFICATION_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid notification type.' });
    }

    // Only coordinators may post notifications for other users
    let targetUserId = req.user.id;
    if (user_id && user_id !== req.user.id) {
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', req.user.id).single();
      if (profile?.role !== 'coordinator') {
        return res.status(403).json({ success: false, error: 'Cannot create notifications for other users' });
      }
      targetUserId = user_id;
    }

    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: targetUserId, type, payload: payload || {} })
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('notifications POST /:', err.message);
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
    console.error('notifications PUT /read-all:', err.message);
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
    console.error('notifications PUT /:id/read:', err.message);
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
    console.error('notifications PUT /:id/emailed:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
