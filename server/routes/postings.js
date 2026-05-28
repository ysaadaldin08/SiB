const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE       = 200;
const MAX_DESCRIPTION = 10000;
const MAX_LOCATION    = 200;

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
    console.error('postings GET /:', err.message);
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
    console.error('postings GET /mine:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/postings/:id — single posting (public)
router.get('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid posting ID' });
    const { data, error } = await supabase
      .from('postings')
      .select('*, employers(company_name, contact_name, industry, website)')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ success: false, error: 'Posting not found' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('postings GET /:id:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/postings — employer creates posting
router.post('/', authenticate, async (req, res) => {
  try {
    const { data: employer, error: empErr } = await supabase
      .from('employers')
      .select('id, coordinator_approved, domain_verified')
      .eq('id', req.user.id)
      .single();
    if (empErr || !employer) {
      return res.status(403).json({ success: false, error: 'Only employers can create postings' });
    }
    // Defence-in-depth: verify coordinator_approved server-side (RLS also enforces this)
    if (!employer.coordinator_approved && !employer.domain_verified) {
      return res.status(403).json({ success: false, error: 'Your account is pending coordinator approval before you can post listings.' });
    }

    const { title, description, responsibilities, requirements, track, work_mode, hours_per_week, location, start_date, deadline } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'Title is required' });

    // Length validation
    if (title.length > MAX_TITLE) return res.status(400).json({ success: false, error: `Title must be ${MAX_TITLE} characters or fewer` });
    if (description && description.length > MAX_DESCRIPTION) return res.status(400).json({ success: false, error: `Description must be ${MAX_DESCRIPTION} characters or fewer` });
    if (location && location.length > MAX_LOCATION) return res.status(400).json({ success: false, error: `Location must be ${MAX_LOCATION} characters or fewer` });
    const hrs = parseInt(hours_per_week);
    if (hours_per_week !== undefined && (isNaN(hrs) || hrs < 1 || hrs > 168)) {
      return res.status(400).json({ success: false, error: 'hours_per_week must be between 1 and 168' });
    }

    // Server-side daily posting limit: 10 postings per employer per day
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const { count: postCount } = await supabase
      .from('postings')
      .select('*', { count: 'exact', head: true })
      .eq('employer_id', req.user.id)
      .gte('created_at', dayAgo);
    if (postCount >= 10) {
      return res.status(429).json({
        success: false,
        error: "You've reached the daily listing limit. Contact a coordinator if you need more."
      });
    }

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
    console.error('postings POST /:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/postings/:id — employer updates own posting
router.put('/:id', authenticate, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid posting ID' });
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
    console.error('postings PUT /:id:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// DELETE /api/postings/:id — employer deletes own posting
router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid posting ID' });
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
    console.error('postings DELETE /:id:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
