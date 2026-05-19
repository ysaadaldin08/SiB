const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

// GET /api/postings — all active postings (public)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('postings')
      .select('*, employers(company_name, contact_name, industry)')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('postings GET /:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/postings/mine — employer's own postings (must come before /:id)
router.get('/mine', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('postings')
      .select('*')
      .eq('employer_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('postings GET /mine:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/postings/:id — single posting (public)
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('postings')
      .select('*, employers(company_name, contact_name, industry, website)')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ success: false, error: 'Posting not found' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('postings GET /:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/postings — employer creates posting
router.post('/', authenticate, async (req, res) => {
  try {
    const { data: employer, error: empErr } = await supabase
      .from('employers')
      .select('id')
      .eq('id', req.user.id)
      .single();
    if (empErr || !employer) {
      return res.status(403).json({ success: false, error: 'Only employers can create postings' });
    }

    const { title, description, responsibilities, requirements, track, work_mode, hours_per_week, location, start_date, deadline } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'Title is required' });

    const { data, error } = await supabase
      .from('postings')
      .insert({
        employer_id: req.user.id,
        title,
        description: description || '',
        responsibilities: responsibilities || '',
        requirements: requirements || '',
        track: track || '',
        work_mode: work_mode || 'On-site',
        hours_per_week: parseInt(hours_per_week) || 20,
        location: location || 'Ottawa',
        start_date: start_date || null,
        deadline: deadline || null,
        is_active: true
      })
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('postings POST /:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/postings/:id — employer updates own posting
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { data: existing, error: findErr } = await supabase
      .from('postings')
      .select('employer_id')
      .eq('id', req.params.id)
      .single();
    if (findErr || !existing) return res.status(404).json({ success: false, error: 'Posting not found' });
    if (existing.employer_id !== req.user.id) return res.status(403).json({ success: false, error: 'Not authorized' });

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
    console.error('postings PUT /:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// DELETE /api/postings/:id — employer deletes own posting
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { data: existing, error: findErr } = await supabase
      .from('postings')
      .select('employer_id')
      .eq('id', req.params.id)
      .single();
    if (findErr || !existing) return res.status(404).json({ success: false, error: 'Posting not found' });
    if (existing.employer_id !== req.user.id) return res.status(403).json({ success: false, error: 'Not authorized' });

    const { error } = await supabase.from('postings').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true });
  } catch (err) {
    console.error('postings DELETE /:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
