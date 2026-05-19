const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// GET /api/coordinators — list all coordinator profiles (any authenticated user)
// Used by client-side notifyCoordinators() to fan out in-app notifications.
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role')
      .eq('role', 'coordinator')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('coordinators GET /:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
