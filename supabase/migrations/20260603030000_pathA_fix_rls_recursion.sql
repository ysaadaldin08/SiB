-- =============================================================
-- SiB — Path A: fix RLS infinite recursion
-- Migration: 20260603030000_pathA_fix_rls_recursion.sql
-- Run AFTER 20260603000000_pathA_grants_rls.sql (and 010 / 020).
--
-- THE BUG
--   Several RLS policies queried another table whose own policy queried back,
--   forming a cycle:  applications <-> postings (and students / employers /
--   message_threads all read applications/postings, feeding the same loop).
--   Inserting an application tripped it:
--     ERROR: infinite recursion detected in policy for relation "applications"
--
-- THE FIX
--   Move every cross-table lookup into a SECURITY DEFINER helper (same trick as
--   is_coordinator). A definer function runs as the table owner, so the lookup
--   it does is NOT re-checked by RLS — the chain stops and cannot loop. The
--   helpers are bound to the caller (auth.uid()) so they only answer questions
--   about the current user's own relationships (no probing other people).
--
-- WHY search_path IS SET VIA ALTER FUNCTION (not inline)
--   The search_path hardening is applied with a separate
--   `ALTER FUNCTION ... SET search_path = public;` after each CREATE, instead of
--   an inline `... SET search_path = public AS $$ ... $$`. The end result is
--   identical (the function's search_path is pinned to public), but it keeps the
--   CREATE FUNCTION statement free of the inline SET clause so the SQL editor's
--   statement splitter parses each statement cleanly.
--
-- ATOMICITY
--   The whole migration runs inside ONE transaction (BEGIN/COMMIT) so all helper
--   functions exist before any policy references them, and any failure rolls the
--   entire file back cleanly (no half-applied state).
--
-- Re-hardens is_coordinator() (search_path) and drops+recreates the 8 affected
-- policies. All other policies from the grants migration are left untouched.
-- Idempotent: CREATE OR REPLACE functions, ALTER FUNCTION SET is repeatable,
-- DROP POLICY IF EXISTS before CREATE.
-- =============================================================

BEGIN;


-- =============================================================
-- SECTION 1 — SECURITY DEFINER predicate helpers (no RLS re-entry)
-- All helpers take uuid and are created BEFORE any policy below.
-- search_path is pinned to public via ALTER FUNCTION after each CREATE.
-- =============================================================

-- Re-harden the most privileged predicate in the system. Same body as the grants
-- migration; search_path pinned to public so a shadowed `profiles` cannot trick it.
CREATE OR REPLACE FUNCTION public.is_coordinator()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'coordinator'
  );
$$;
ALTER FUNCTION public.is_coordinator() SET search_path = public;

-- Does the current user own the posting this application belongs to?
CREATE OR REPLACE FUNCTION public.current_user_owns_posting(p_posting uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.postings p
    WHERE p.id = p_posting AND p.employer_id = auth.uid()
  );
$$;
ALTER FUNCTION public.current_user_owns_posting(uuid) SET search_path = public;

-- Does the current user have a students row? (gate for applying)
CREATE OR REPLACE FUNCTION public.current_user_is_student()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.students s WHERE s.id = auth.uid());
$$;
ALTER FUNCTION public.current_user_is_student() SET search_path = public;

-- Is the posting active? (posting activeness is already public via postings_public)
CREATE OR REPLACE FUNCTION public.posting_is_active(p_posting uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.postings p WHERE p.id = p_posting AND p.is_active = true
  );
$$;
ALTER FUNCTION public.posting_is_active(uuid) SET search_path = public;

-- Is there an Accepted application between this student and this employer?
-- Caller-bound: only answers when the caller is one of the two parties.
CREATE OR REPLACE FUNCTION public.has_accepted_application(p_student uuid, p_employer uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT (auth.uid() = p_student OR auth.uid() = p_employer)
     AND EXISTS (
       SELECT 1
       FROM public.applications a
       JOIN public.postings p ON p.id = a.posting_id
       WHERE a.student_id  = p_student
         AND p.employer_id = p_employer
         AND a.status = 'Accepted'
     );
$$;
ALTER FUNCTION public.has_accepted_application(uuid, uuid) SET search_path = public;

-- Has the current student applied to ANY posting of this employer?
CREATE OR REPLACE FUNCTION public.current_user_applied_to_employer(p_employer uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    JOIN public.postings p ON p.id = a.posting_id
    WHERE p.employer_id = p_employer AND a.student_id = auth.uid()
  );
$$;
ALTER FUNCTION public.current_user_applied_to_employer(uuid) SET search_path = public;

-- Is the current user an Accepted applicant for this posting?
CREATE OR REPLACE FUNCTION public.current_user_accepted_for_posting(p_posting uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.posting_id = p_posting
      AND a.student_id = auth.uid()
      AND a.status = 'Accepted'
  );
$$;
ALTER FUNCTION public.current_user_accepted_for_posting(uuid) SET search_path = public;

-- Is the current user an approved/verified employer? (gate for posting)
CREATE OR REPLACE FUNCTION public.current_user_employer_approved()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employers e
    WHERE e.id = auth.uid()
      AND (e.coordinator_approved = true OR e.domain_verified = true)
  );
$$;
ALTER FUNCTION public.current_user_employer_approved() SET search_path = public;


-- =============================================================
-- SECTION 2 — recreate the 8 affected policies using the helpers
-- (identical intent to the originals; only the cross-table subqueries change)
-- =============================================================

-- ---- applications -------------------------------------------------------
DROP POLICY IF EXISTS "applications_select_employer" ON public.applications;
CREATE POLICY "applications_select_employer"
  ON public.applications FOR SELECT TO authenticated
  USING (public.current_user_owns_posting(posting_id));

DROP POLICY IF EXISTS "applications_insert_student_own" ON public.applications;
CREATE POLICY "applications_insert_student_own"
  ON public.applications FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND public.current_user_is_student()
    AND public.posting_is_active(posting_id)
  );

DROP POLICY IF EXISTS "applications_update_employer" ON public.applications;
CREATE POLICY "applications_update_employer"
  ON public.applications FOR UPDATE TO authenticated
  USING  (public.current_user_owns_posting(posting_id))
  WITH CHECK (public.current_user_owns_posting(posting_id));

-- ---- students -----------------------------------------------------------
DROP POLICY IF EXISTS "students_select_employer_accepted" ON public.students;
CREATE POLICY "students_select_employer_accepted"
  ON public.students FOR SELECT TO authenticated
  USING (public.has_accepted_application(students.id, auth.uid()));

-- ---- employers ----------------------------------------------------------
DROP POLICY IF EXISTS "employers_select_applied_student" ON public.employers;
CREATE POLICY "employers_select_applied_student"
  ON public.employers FOR SELECT TO authenticated
  USING (public.current_user_applied_to_employer(employers.id));

-- ---- postings -----------------------------------------------------------
DROP POLICY IF EXISTS "postings_select_accepted_student" ON public.postings;
CREATE POLICY "postings_select_accepted_student"
  ON public.postings FOR SELECT TO authenticated
  USING (public.current_user_accepted_for_posting(postings.id));

DROP POLICY IF EXISTS "postings_insert_own_if_approved" ON public.postings;
CREATE POLICY "postings_insert_own_if_approved"
  ON public.postings FOR INSERT TO authenticated
  WITH CHECK (
    employer_id = auth.uid()
    AND public.current_user_employer_approved()
  );

-- ---- message_threads ----------------------------------------------------
DROP POLICY IF EXISTS "threads_insert_gated_on_accepted" ON public.message_threads;
CREATE POLICY "threads_insert_gated_on_accepted"
  ON public.message_threads FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (student_id = auth.uid() OR employer_id = auth.uid())
    AND public.has_accepted_application(student_id, employer_id)
  );


COMMIT;

-- =============================================================
-- END
-- =============================================================
