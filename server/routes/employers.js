const express = require('express');
const router = express.Router();
const { supabase } = require('../middleware/auth');

// GET /api/employers/me
router.get('/me', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('employers')
      .select('*')
      .eq('id', req.user.id)
      .single();
    if (error) return res.status(404).json({ success: false, error: 'Employer profile not found' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('employers/me GET:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/employers/me
router.put('/me', async (req, res) => {
  try {
    const allowed = ['company_name', 'contact_name', 'industry', 'website', 'description'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from('employers')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('employers/me PUT:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
