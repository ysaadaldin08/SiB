const express = require('express');
const router = express.Router();
const { supabase, authenticate } = require('../middleware/auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COVER_NOTE  = 2000;
const MAX_RESUME_URL  = 500;

// POST /api/applications — student applies to a posting
router.post('/', authenticate, async (req, res) => {
  try {
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('id', req.user.id)
      .single();
    if (!student) return res.status(403).json({ success: false, error: 'Only students can apply' });

    const { posting_id, cover_note, resume_url } = req.body;
    if (!posting_id) return res.status(400).json({ success: false, error: 'posting_id is required' });
    if (!UUID_RE.test(posting_id)) return res.status(400).json({ success: false, error: 'Invalid posting_id format' });

    // Validate optional fields
    if (cover_note && cover_note.length > MAX_COVER_NOTE) {
      return res.status(400).json({ success: false, error: `Cover note must be ${MAX_COVER_NOTE} characters or fewer` });
    }
    if (resume_url) {
      if (resume_url.length > MAX_RESUME_URL) {
        return res.status(400).json({ success: false, error: `Resume URL must be ${MAX_RESUME_URL} characters or fewer` });
      }
      if (!/^https?:\/\//i.test(resume_url)) {
        return res.status(400).json({ success: false, error: 'Resume URL must start with https://' });
      }
    }

    // Server-side daily application limit: 5 applications per student per day
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const { count: appCount } = await supabase
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', req.user.id)
      .gte('created_at', dayAgo);
    if (appCount >= 5) {
      return res.status(429).json({
        success: false,
        error: "You've reached the daily application limit. Try again tomorrow."
      });
    }

    // Check if posting exists and is active
    const { data: posting } = await supabase
      .from('postings')
      .select('id, is_active')
      .eq('id', posting_id)
      .single();
    if (!posting) return res.status(404).json({ success: false, error: 'Posting not found' });
    if (!posting.is_active) return res.status(400).json({ success: false, error: 'This posting is no longer active' });

    const { data, error } = await supabase
      .from('applications')
      .insert({ student_id: req.user.id, posting_id, cover_note: cover_note || '', resume_url: resume_url || '', status: 'Applied' })
      .select()
      .single();

    if (error) {
      // Unique constraint = already applied
      if (error.code === '23505') return res.status(409).json({ success: false, error: 'You have already applied to this posting' });
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('applications POST /:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/applications/mine — student sees their own applications
router.get('/mine', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('applications')
      .select('*, postings(*, employers(company_name, contact_name))')
      .eq('student_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('applications GET /mine:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/applications/posting/:id — employer sees applicants for a posting
router.get('/posting/:id', authenticate, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid posting ID' });
    const { data: posting } = await supabase
      .from('postings')
      .select('employer_id')
      .eq('id', req.params.id)
      .single();
    if (!posting) return res.status(404).json({ success: false, error: 'Posting not found' });
    if (posting.employer_id !== req.user.id) return res.status(403).json({ success: false, error: 'Not authorized' });

    const { data, error } = await supabase
      .from('applications')
      .select('*, students(full_name, email, school, grade, program, bio, skills)')
      .eq('posting_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('applications GET /posting/:id:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/applications/:id — employer updates application status
router.put('/:id', authenticate, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid application ID' });
    const { status } = req.body;
    const valid = ['Applied', 'Under Review', 'Interview', 'Rejected', 'Accepted'];
    if (!status || !valid.includes(status)) {
      return res.status(400).json({ success: false, error: `status must be one of: ${valid.join(', ')}` });
    }

    // Verify the employer owns the posting this application belongs to
    const { data: app } = await supabase
      .from('applications')
      .select('id, postings(employer_id)')
      .eq('id', req.params.id)
      .single();
    if (!app) return res.status(404).json({ success: false, error: 'Application not found' });
    if (app.postings.employer_id !== req.user.id) return res.status(403).json({ success: false, error: 'Not authorized' });

    const { data, error } = await supabase
      .from('applications')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('applications PUT /:id:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
