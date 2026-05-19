const express = require('express');
const router = express.Router();
const { supabase } = require('../middleware/auth');

// GET /api/students/me
router.get('/me', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', req.user.id)
      .single();
    if (error) return res.status(404).json({ success: false, error: 'Student profile not found' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('students/me GET:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/students/me
router.put('/me', async (req, res) => {
  try {
    const allowed = ['full_name', 'school', 'grade', 'program', 'bio', 'skills'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from('students')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('students/me PUT:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
