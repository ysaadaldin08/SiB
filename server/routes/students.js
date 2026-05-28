const express = require('express');
const router = express.Router();
const { supabase } = require('../middleware/auth');

const LIMITS = { full_name: 100, school: 200, grade: 50, program: 200, bio: 5000 };

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
    console.error('students/me GET:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/students/me
router.put('/me', async (req, res) => {
  try {
    const allowed = ['full_name', 'school', 'grade', 'program', 'bio', 'skills'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (LIMITS[key] && typeof req.body[key] === 'string' && req.body[key].length > LIMITS[key]) {
          return res.status(400).json({ success: false, error: `${key} must be ${LIMITS[key]} characters or fewer` });
        }
        updates[key] = req.body[key];
      }
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
    console.error('students/me PUT:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
