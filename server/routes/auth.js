const express = require('express');
const router = express.Router();
const { supabase } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, first_name, last_name, role, tos_accepted } = req.body;
    if (!email || !password || !first_name || !last_name || !role) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }
    if (!tos_accepted) {
      return res.status(400).json({
        success: false,
        error: 'You must accept the Terms of Use and Privacy Policy to register.'
      });
    }
    if (!['student', 'employer'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Role must be student or employer' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Create user via admin API (auto-confirms email)
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name, last_name, role, full_name: `${first_name} ${last_name}` }
    });
    if (createErr) {
      return res.status(400).json({ success: false, error: createErr.message });
    }

    // Sign in immediately to get a session token
    const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      return res.status(400).json({ success: false, error: signInErr.message });
    }

    // Record ToS acceptance timestamp on the profile row
    // Requires tos_accepted_at TIMESTAMPTZ column in profiles (add via migration if missing)
    await supabase.from('profiles')
      .update({ tos_accepted_at: new Date().toISOString() })
      .eq('id', created.user.id);

    // Create role-specific profile row
    if (role === 'student') {
      await supabase.from('students').insert({
        id: created.user.id,
        full_name: `${first_name} ${last_name}`,
        email: email.toLowerCase()
      });
    } else {
      await supabase.from('employers').insert({
        id: created.user.id,
        company_name: '',
        contact_name: `${first_name} ${last_name}`,
        email: email.toLowerCase()
      });
    }

    res.status(201).json({
      success: true,
      data: {
        token: session.session.access_token,
        user: buildUserPayload(created.user, first_name, last_name, role)
      }
    });
  } catch (err) {
    console.error('register error:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return res.status(401).json({ success: false, error: error.message });
    }

    const meta = data.user.user_metadata || {};
    let role = meta.role;

    // Check profiles table for role override (e.g. coordinator set via SQL)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profile?.role) role = profile.role;

    // Include coordinator_approved for employer accounts
    let coordinatorApproved = false;
    if (role === 'employer') {
      const { data: emp } = await supabase
        .from('employers')
        .select('coordinator_approved')
        .eq('id', data.user.id)
        .single();
      coordinatorApproved = !!emp?.coordinator_approved;
    }

    res.json({
      success: true,
      data: {
        token: data.session.access_token,
        user: { ...buildUserPayload(data.user, meta.first_name, meta.last_name, role), coordinatorApproved }
      }
    });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      await supabase.auth.admin.signOut(header.split(' ')[1]);
    }
  } catch (_) {
    // Swallow errors — logout always succeeds from the client's perspective
  }
  res.json({ success: true });
});

// GET /api/auth/session — verify token, return user + profile status (used by OAuth callback)
router.get('/session', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Token required' });
    }
    const token = header.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ success: false, error: 'Invalid token' });

    const meta = user.user_metadata || {};

    // Check which profile table the user appears in
    let role = meta.role || null;
    let profileExists = false;

    // Check profiles table first — coordinator role is set there via SQL
    try {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role === 'coordinator') { role = 'coordinator'; profileExists = true; }
    } catch (_) {}

    if (!profileExists) {
      const { data: student } = await supabase.from('students').select('id').eq('id', user.id).single();
      if (student) { role = 'student'; profileExists = true; }
      else {
        const { data: employer } = await supabase.from('employers').select('id').eq('id', user.id).single();
        if (employer) { role = 'employer'; profileExists = true; }
      }
    }

    const fullName = meta.full_name || meta.name || '';
    const nameParts = fullName.trim().split(' ');
    const first = meta.first_name || nameParts[0] || '';
    const last = meta.last_name || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : '');

    res.json({
      success: true,
      data: {
        needsRoleSetup: !profileExists,
        user: {
          id: user.id,
          email: user.email,
          role,
          name: first && last ? `${first} ${last.charAt(0)}.` : (first || user.email),
          first
        }
      }
    });
  } catch (err) {
    console.error('session error:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/setup-profile — create profile row for Google OAuth users picking role
router.post('/setup-profile', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Token required' });
    }
    const token = header.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ success: false, error: 'Invalid token' });

    const { role } = req.body;
    if (!['student', 'employer'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Role must be student or employer' });
    }

    const meta = user.user_metadata || {};
    const fullName = meta.full_name || meta.name || user.email;
    const email = user.email.toLowerCase();
    const nameParts = fullName.trim().split(' ');
    const first = meta.first_name || nameParts[0] || '';
    const last = meta.last_name || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : '');

    // Tag the user's metadata with the chosen role
    await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: { ...meta, role, first_name: first, last_name: last }
    });

    // Sync role into profiles (trigger set it to 'student' at OAuth signup time)
    await supabase.from('profiles').upsert({ id: user.id, role }, { onConflict: 'id' });

    // Create profile (upsert in case of retry)
    if (role === 'student') {
      await supabase.from('students').upsert({ id: user.id, full_name: fullName, email });
    } else {
      await supabase.from('employers').upsert({
        id: user.id, company_name: '', contact_name: fullName, email
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          role,
          name: first && last ? `${first} ${last.charAt(0)}.` : (first || user.email),
          first
        }
      }
    });
  } catch (err) {
    console.error('setup-profile error:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

function buildUserPayload(user, firstName, lastName, role) {
  const first = firstName || '';
  const last = lastName || '';
  return {
    id: user.id,
    email: user.email,
    role: role || user.user_metadata?.role || 'student',
    name: first && last ? `${first} ${last.charAt(0)}.` : user.email,
    first: first
  };
}

module.exports = router;
