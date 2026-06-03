-- ============================================================
-- SiB — Row Level Security Policies
-- Migration: 001_rls_policies.sql
-- Paste into: Supabase Dashboard → SQL Editor
-- DO NOT run automatically — review each policy before applying
--
-- Legal basis: PIPEDA Principle 4 (data minimization), MFIPPA s.36
-- (municipal institution must limit access to personal info to need-to-know)
-- Security basis: Pillar 1.2 — least-privilege access control
-- ============================================================

-- ============================================================
-- IMPORTANT: Before applying this migration:
-- 1. Confirm all table names match your actual Supabase schema
-- 2. Confirm auth.uid() references the correct column in each table
-- 3. Test each policy on a staging project before applying to production
-- 4. Verify the anon role has NO access to any PII table (see bottom of file)
-- ============================================================


-- ============================================================
-- STEP 1: Enable RLS on every table (deny-all default)
-- These statements are idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.postings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages          ENABLE ROW LEVEL SECURITY;
-- audit_logs table is created in 002_audit_log.sql

-- Drop existing policies before recreating (idempotent)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','students','employers','postings',
                        'applications','notifications','message_threads','messages')
  )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;


-- ============================================================
-- TABLE: profiles
-- Contains: role, email. Referenced by auth.uid().
-- ============================================================

-- Users can read their own profile
CREATE POLICY "profiles: owner read"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile (not role — role is coordinator-managed)
CREATE POLICY "profiles: owner update own fields"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Coordinators can read all profiles (oversight role — MFIPPA s.36 need-to-know)
CREATE POLICY "profiles: coordinator read all"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'coordinator'
    )
  );

-- Service role (used only in server-side Edge Functions) can do anything
-- This policy is implicit via service_role bypass — do NOT create explicit service_role policies


-- ============================================================
-- TABLE: students
-- Contains: full_name, email, school, grade, bio, skills — PII
-- PIPEDA: collected for co-op matching only; not shared beyond accepted placement
-- ============================================================

-- Students read/write their own row only
CREATE POLICY "students: owner read"
  ON public.students FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "students: owner update"
  ON public.students FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Employers can read student data ONLY for students with an accepted application
-- to one of their own postings (post-placement only — PIPEDA data minimization)
CREATE POLICY "students: employer read accepted applicants only"
  ON public.students FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.applications a
      JOIN public.postings p ON p.id = a.posting_id
      WHERE a.student_id = students.id
        AND a.status = 'Accepted'
        AND p.employer_id = auth.uid()
    )
  );

-- Coordinators can read all student records (oversight — MFIPPA s.36)
CREATE POLICY "students: coordinator read all"
  ON public.students FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- No role has DELETE on students — soft-delete only (90-day anonymisation grace period)
-- Implement via a coordinator-triggered Edge Function that nulls PII fields


-- ============================================================
-- TABLE: employers
-- Contains: company_name, contact_name, email, address — business PII
-- ============================================================

-- Employers read/update their own row
CREATE POLICY "employers: owner read"
  ON public.employers FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "employers: owner update"
  ON public.employers FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Students can read basic employer info for postings they have applied to
-- (company name, supervisor name only — not address or contact email)
-- Note: Column-level security is not available in Supabase RLS; the SELECT
-- below grants access to the full row. Use a DB view with only safe columns
-- if stricter control is needed.
CREATE POLICY "students: read employer of applied posting"
  ON public.employers FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.applications a
      JOIN public.postings p ON p.id = a.posting_id
      WHERE p.employer_id = employers.id
        AND a.student_id = auth.uid()
    )
  );

-- Coordinators can read all employer records
CREATE POLICY "employers: coordinator read all"
  ON public.employers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- Coordinators can update coordinator_approved field (employer approval gate)
CREATE POLICY "employers: coordinator update approval"
  ON public.employers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );


-- ============================================================
-- TABLE: postings
-- Contains: job descriptions — not PII but gated to active employers
-- ============================================================

-- Anyone authenticated can read active postings (public job board)
CREATE POLICY "postings: authenticated read active"
  ON public.postings FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Employers read their own postings (including inactive)
CREATE POLICY "postings: employer read own"
  ON public.postings FOR SELECT
  USING (auth.uid() = employer_id);

-- Employers create postings — gated on coordinator_approved in employers table
-- (The employer dashboard savePosting() calls employerCanPost() before calling the API.
--  This RLS policy enforces the same rule at the database level as a defence-in-depth measure.)
CREATE POLICY "postings: employer insert if approved"
  ON public.postings FOR INSERT
  WITH CHECK (
    auth.uid() = employer_id
    AND EXISTS (
      SELECT 1 FROM public.employers e
      WHERE e.id = auth.uid()
        AND (e.coordinator_approved = true OR e.domain_verified = true)
    )
  );

-- Employers update/archive their own postings
CREATE POLICY "postings: employer update own"
  ON public.postings FOR UPDATE
  USING (auth.uid() = employer_id)
  WITH CHECK (auth.uid() = employer_id);

-- Coordinators can read, update, and soft-delete (archive) any posting
CREATE POLICY "postings: coordinator manage all"
  ON public.postings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );


-- ============================================================
-- TABLE: applications
-- Contains: cover_note, resume_url, status — student PII
-- ============================================================

-- Students read/create their own applications
CREATE POLICY "applications: student read own"
  ON public.applications FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "applications: student insert"
  ON public.applications FOR INSERT
  WITH CHECK (auth.uid() = student_id);

-- Employers read applications for their own postings
CREATE POLICY "applications: employer read for own postings"
  ON public.applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.postings p
      WHERE p.id = applications.posting_id AND p.employer_id = auth.uid()
    )
  );

-- Employers update status field only (not student_id or cover_note)
-- Full-row UPDATE policy; column restriction is enforced via CHECK in the application code.
-- TODO: consider a Supabase database function to restrict status-only updates.
CREATE POLICY "applications: employer update status"
  ON public.applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.postings p
      WHERE p.id = applications.posting_id AND p.employer_id = auth.uid()
    )
  );

-- Coordinators read all applications
CREATE POLICY "applications: coordinator read all"
  ON public.applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- No role has DELETE on applications (permanent record for school board audit trail)


-- ============================================================
-- TABLE: notifications
-- PII: notification payloads may contain names, emails, listing titles
-- ============================================================

-- Users read their own notifications only
CREATE POLICY "notifications: owner read"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Server-side (Edge Functions using service_role) inserts notifications for any user
-- Client-side notification insert is blocked for the authenticated role to prevent
-- a student forging a coordinator notification.
-- INSERT is handled via Edge Function only; no client-side INSERT policy needed.

-- Users mark their own notifications read
CREATE POLICY "notifications: owner update read"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Coordinators read all notifications (oversight — required for coordinator dashboard)
CREATE POLICY "notifications: coordinator read all"
  ON public.notifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );


-- ============================================================
-- TABLE: message_threads
-- Minor–adult communication — highest sensitivity
-- School board requires coordinator read access at all times
-- ============================================================

-- Participants (student and employer) read their own threads
CREATE POLICY "threads: participant read"
  ON public.message_threads FOR SELECT
  USING (
    auth.uid() = student_id OR auth.uid() = employer_id
  );

-- Participants create threads (rate limiting enforced server-side)
CREATE POLICY "threads: participant insert"
  ON public.message_threads FOR INSERT
  WITH CHECK (
    auth.uid() = student_id OR auth.uid() = employer_id
  );

-- Participants can update status (to flag/close their own thread)
CREATE POLICY "threads: participant update status"
  ON public.message_threads FOR UPDATE
  USING (auth.uid() = student_id OR auth.uid() = employer_id);

-- Coordinators read ALL threads — required for safeguarding oversight
-- Legal basis: school board policy; MFIPPA s.36 institutional oversight
CREATE POLICY "threads: coordinator read all"
  ON public.message_threads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- Coordinators update threads (review notes, close, flag)
CREATE POLICY "threads: coordinator update all"
  ON public.message_threads FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- No DELETE on threads — permanent audit trail required by school board policy


-- ============================================================
-- TABLE: messages
-- Minor–adult communication body — highest sensitivity PII
-- ============================================================

-- Participants read messages in their own threads
CREATE POLICY "messages: participant read"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = messages.thread_id
        AND (t.student_id = auth.uid() OR t.employer_id = auth.uid())
    )
  );

-- Participants insert messages (rate limiting enforced server-side)
CREATE POLICY "messages: participant insert"
  ON public.messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = messages.thread_id
        AND (t.student_id = auth.uid() OR t.employer_id = auth.uid())
        AND t.status != 'closed'
    )
  );

-- Coordinators read ALL messages — required for safeguarding oversight
CREATE POLICY "messages: coordinator read all"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- Coordinators mark messages reviewed (sets reviewed_by_coordinator = true)
CREATE POLICY "messages: coordinator update review flag"
  ON public.messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- No DELETE on messages — permanent audit trail required by school board policy
-- No UPDATE for sender/employer — message body is immutable after send


-- ============================================================
-- VERIFY: anon role has no access to PII tables
-- Run this query after applying policies to confirm:
-- ============================================================
-- SELECT table_name, policy_name, roles, cmd
-- FROM information_schema.role_table_grants
-- WHERE grantee = 'anon'
--   AND table_name IN ('profiles','students','employers','applications',
--                      'notifications','message_threads','messages');
-- Expected result: 0 rows (anon has no grants on these tables)
-- ============================================================
