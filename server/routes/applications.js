const express = require('express');
const router = express.Router();
const { supabase } = require('../middleware/auth');

// POST /api/applications — student applies to a posting
router.post('/', async (req, res) => {
  try {
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('id', req.user.id)
      .single();
    if (!student) return res.status(403).json({ success: false, error: 'Only students can apply' });

    const { posting_id, cover_note, resume_url } = req.body;
    if (!posting_id) return res.status(400).json({ success: false, error: 'posting_id is required' });

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
    console.error('applications POST /:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/applications/mine — student sees their own applications
router.get('/mine', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('applications')
      .select('*, postings(*, employers(company_name, contact_name))')
      .eq('student_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error('applications GET /mine:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/applications/posting/:id — employer sees applicants for a posting
router.get('/posting/:id', async (req, res) => {
  try {
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
    console.error('applications GET /posting/:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/applications/:id — employer updates application status
router.put('/:id', async (req, res) => {
  try {
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
    console.error('applications PUT /:id:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
