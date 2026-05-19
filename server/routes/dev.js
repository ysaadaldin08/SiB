// ——— DEV SEED ROUTE ———
// POST /api/dev/seed — creates demo users + seeds reference data.
// Only active when NODE_ENV=development. Returns 403 in production.
// Called by demo.js on localhost before setting localStorage personas.

const express = require('express');
const router = express.Router();
const { supabase } = require('../middleware/auth');

const DEMO_STUDENT_EMAIL = 'alex.thompson@ocdsbstudents.ca';
const DEMO_EMPLOYER_EMAIL = 'jane.smith@shopify.com';
const DEMO_COORDINATOR_EMAIL = 'ysaadaldin08@gmail.com';
const COORD_PASSWORD = '***REMOVED***';
const DEMO_PASSWORD = '***REMOVED***';

router.post('/', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ success: false, error: 'Seed endpoint only available in development.' });
  }

  try {
    // ── 1. Upsert coordinator password (Google OAuth user already exists) ──────
    const { error: coordPwErr } = await supabase.auth.admin.updateUserById(
      '419dca7c-b9a6-4d5a-a7fe-ce91e0781c05',
      { password: COORD_PASSWORD }
    );
    if (coordPwErr) console.warn('Coordinator password update:', coordPwErr.message);

    // ── 2. Upsert demo student ────────────────────────────────────────────────
    const studentId = await _upsertDemoUser({
      email: DEMO_STUDENT_EMAIL,
      password: DEMO_PASSWORD,
      firstName: 'Alex',
      lastName: 'Thompson',
      role: 'student',
    });
    await supabase.from('students').upsert({
      id: studentId,
      full_name: 'Alex Thompson',
      email: DEMO_STUDENT_EMAIL,
      school: 'Earl of March SS',
      grade: 12,
      program: 'Technology & IT',
      bio: 'Grade 12 student passionate about technology and data.',
      skills: ['Python', 'Excel', 'Project coordination'],
    }, { onConflict: 'id' });

    // ── 3. Upsert demo employer ───────────────────────────────────────────────
    const employerId = await _upsertDemoUser({
      email: DEMO_EMPLOYER_EMAIL,
      password: DEMO_PASSWORD,
      firstName: 'Jane',
      lastName: 'Smith',
      role: 'employer',
    });
    await supabase.from('employers').upsert({
      id: employerId,
      company_name: 'Shopify Ottawa',
      contact_name: 'Jane Smith',
      email: DEMO_EMPLOYER_EMAIL,
      industry: 'Technology / E-Commerce',
      website: 'https://shopify.com',
      description: 'Global e-commerce platform, Ottawa office.',
    }, { onConflict: 'id' });

    // ── 4. Upsert a demo posting ──────────────────────────────────────────────
    const { data: existingPostings } = await supabase
      .from('postings')
      .select('id')
      .eq('employer_id', employerId)
      .limit(1);

    let postingId;
    if (existingPostings && existingPostings.length) {
      postingId = existingPostings[0].id;
    } else {
      const { data: newPosting, error: postErr } = await supabase.from('postings').insert({
        employer_id: employerId,
        title: 'Software Dev Intern (Spring 2026)',
        description: 'Work alongside Shopify engineers on real product features.',
        responsibilities: 'Build features, write tests, participate in code reviews.',
        requirements: 'Some programming experience; eager to learn.',
        track: 'Technology & IT',
        work_mode: 'Hybrid',
        hours_per_week: 30,
        location: 'Ottawa',
        start_date: '2026-05-01',
        deadline: '2026-04-15',
        is_active: true,
      }).select('id').single();
      if (postErr) throw postErr;
      postingId = newPosting.id;
    }

    // ── 5. Upsert a demo application (student → posting) ─────────────────────
    await supabase.from('applications').upsert({
      student_id: studentId,
      posting_id: postingId,
      status: 'Accepted',
      cover_note: 'I am very excited about this opportunity.',
      resume_url: '',
    }, { onConflict: 'student_id, posting_id' });

    // ── 6. Sign in each persona to get real tokens ────────────────────────────
    const [studentSession, employerSession, coordSession] = await Promise.all([
      supabase.auth.signInWithPassword({ email: DEMO_STUDENT_EMAIL,     password: DEMO_PASSWORD }),
      supabase.auth.signInWithPassword({ email: DEMO_EMPLOYER_EMAIL,    password: DEMO_PASSWORD }),
      supabase.auth.signInWithPassword({ email: DEMO_COORDINATOR_EMAIL, password: COORD_PASSWORD }),
    ]);

    if (studentSession.error)  throw new Error('Student sign-in: ' + studentSession.error.message);
    if (employerSession.error) throw new Error('Employer sign-in: ' + employerSession.error.message);
    if (coordSession.error)    throw new Error('Coordinator sign-in: ' + coordSession.error.message);

    res.json({
      success: true,
      data: {
        student_token:     studentSession.data.session.access_token,
        employer_token:    employerSession.data.session.access_token,
        coordinator_token: coordSession.data.session.access_token,
        student_id:        studentId,
        employer_id:       employerId,
        coordinator_id:    '419dca7c-b9a6-4d5a-a7fe-ce91e0781c05',
        posting_id:        postingId,
      }
    });
  } catch (err) {
    console.error('dev/seed error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function _upsertDemoUser({ email, password, firstName, lastName, role }) {
  // Try to find existing user first
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing?.users?.find(u => u.email === email);

  if (found) {
    await supabase.auth.admin.updateUserById(found.id, { password });
    await supabase.from('profiles').upsert(
      { id: found.id, email, role },
      { onConflict: 'id' }
    );
    return found.id;
  }

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, role, full_name: `${firstName} ${lastName}` },
  });
  if (error) throw error;

  await supabase.from('profiles').upsert(
    { id: created.user.id, email, role },
    { onConflict: 'id' }
  );
  return created.user.id;
}

module.exports = router;
