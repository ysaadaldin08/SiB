-- =============================================================
-- SiB — Path A: GRANTS + RLS + privilege locks
-- Migration: 20260603000000_pathA_grants_rls.sql
-- Target: the LIVE database (baseline = 20260526000000_initial_schema.sql
--         PLUS the prod-only "employers: own insert" policy).
--
-- WHY THIS EXISTS
--   In "Path A" the browser talks to Supabase directly; there is no Node API.
--   Today the `anon` and `authenticated` roles have NO table privileges, so
--   every client read/write is denied regardless of RLS. This migration grants
--   each role exactly the verbs it needs, then RLS scopes which rows, and
--   triggers freeze the columns that would allow privilege escalation.
--
-- HOW TO RUN (you, not the agent)
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   It is idempotent: it drops and recreates the policies it manages, uses
--   CREATE OR REPLACE for functions, ADD COLUMN IF NOT EXISTS, and
--   DROP TRIGGER IF EXISTS. Safe to run more than once.
--
-- SAFETY MODEL (summary)
--   profiles        SELECT (own + coordinator). No client writes.
--   students        SELECT (own / coordinator / employer-after-Accepted), UPDATE (own).
--   employers       SELECT (own / coordinator / student-who-applied), INSERT (own), UPDATE (own + coordinator).
--   postings        Base table: SELECT (own incl. inactive, coordinator, ACCEPTED student), INSERT/UPDATE/DELETE (own + coordinator).
--                   Public board: postings_public VIEW (active only, NO supervisor_name) granted to anon + authenticated.
--   applications    SELECT (student own / employer of posting / coordinator), INSERT (student own), UPDATE (employer status + coordinator).
--   notifications   SELECT/UPDATE (own + coordinator read), INSERT (self only; cross-user via SECURITY DEFINER later).
--   message_threads SELECT (participant + coordinator), INSERT (participant, gated on an Accepted application), UPDATE (participant + coordinator).
--   messages        SELECT (participant + coordinator), INSERT (sender, open thread), UPDATE (coordinator reviewed-flag only; body immutable).
--   audit_logs / age_verification_consents / rate_limit_log: service-role only (explicitly revoked from anon/authenticated).
-- =============================================================


-- =============================================================
-- SECTION 0 — Helpers
-- =============================================================

-- is_coordinator() already exists in prod; recreate to keep this file self-contained.
-- SECURITY DEFINER so it can read profiles without tripping profiles' own RLS.
CREATE OR REPLACE FUNCTION public.is_coordinator()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'coordinator'
  );
$$;

-- A caller is "privileged" (bypasses column locks) when there is no end-user
-- JWT context (service_role key or you in the SQL editor -> auth.uid() IS NULL)
-- OR the end user is a coordinator. Normal students/employers are NOT privileged.
CREATE OR REPLACE FUNCTION public.is_privileged_caller()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (auth.uid() IS NULL) OR public.is_coordinator();
$$;


-- =============================================================
-- SECTION 1 — Denormalize company name onto postings
-- So the PUBLIC job board reads only `postings` and never exposes the
-- employers table (phone / website / business reg) to browsing visitors.
-- company_name is set by a trigger from the authoritative employers row,
-- so the client cannot spoof it. supervisor_name is a per-posting display
-- field supplied by the employer (Step 3 wires the form field to it).
-- =============================================================

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS company_name    TEXT,
  ADD COLUMN IF NOT EXISTS supervisor_name TEXT;

CREATE OR REPLACE FUNCTION public.set_posting_company_name()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Always derive company_name from the owning employer (anti-spoof).
  SELECT e.company_name INTO NEW.company_name
  FROM public.employers e
  WHERE e.id = NEW.employer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_postings_company_name ON public.postings;
CREATE TRIGGER trg_postings_company_name
  BEFORE INSERT OR UPDATE OF employer_id ON public.postings
  FOR EACH ROW EXECUTE FUNCTION public.set_posting_company_name();

-- Backfill any existing rows (0 in prod today, but keep it correct).
UPDATE public.postings p
SET    company_name = e.company_name
FROM   public.employers e
WHERE  e.id = p.employer_id
  AND  (p.company_name IS NULL OR p.company_name = '');


-- =============================================================
-- SECTION 2 — Column-lock triggers (privilege-escalation guard)
-- =============================================================

-- Generic guard: rejects changes to the columns named in TG_ARGV unless the
-- caller is privileged (service_role / SQL editor / coordinator).
CREATE OR REPLACE FUNCTION public.enforce_locked_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  col text;
BEGIN
  IF public.is_privileged_caller() THEN
    RETURN NEW;
  END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) ->> col) IS DISTINCT FROM (to_jsonb(OLD) ->> col) THEN
      RAISE EXCEPTION 'Column "%" on % is protected and cannot be changed by this user.',
        col, TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Messages are append-only: body is immutable for EVERYONE (including
-- coordinators). The only field anyone may change post-send is the
-- coordinator review flag. Direct DB/service access (auth.uid() IS NULL)
-- is allowed so you can repair data if ever needed.
CREATE OR REPLACE FUNCTION public.enforce_message_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service_role / SQL editor
  END IF;
  IF NEW.body        IS DISTINCT FROM OLD.body
     OR NEW.sender_id   IS DISTINCT FROM OLD.sender_id
     OR NEW.sender_role IS DISTINCT FROM OLD.sender_role
     OR NEW.thread_id   IS DISTINCT FROM OLD.thread_id
     OR NEW.flagged     IS DISTINCT FROM OLD.flagged
     OR NEW.flag_reasons IS DISTINCT FROM OLD.flag_reasons
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Message content is immutable; only the coordinator review flag may change.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


-- =============================================================
-- SECTION 3 — Reset the policies this migration manages
-- (drop every existing policy on the managed tables, then recreate the
--  canonical set below; this makes the file a repeatable source of truth)
-- =============================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','students','employers','postings',
                        'applications','notifications','message_threads','messages')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- RLS stays enabled on every managed table (idempotent).
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.postings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages        ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- SECTION 4 — profiles  (read-only to clients)
-- =============================================================

GRANT SELECT ON public.profiles TO authenticated;

CREATE POLICY "profiles_select_own_or_coord"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_coordinator());

-- No client INSERT/UPDATE/DELETE: the row is created by the signup trigger
-- (Step 2); role/email are changed by a coordinator/service role only.

DROP TRIGGER IF EXISTS trg_profiles_lock ON public.profiles;
CREATE TRIGGER trg_profiles_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_locked_columns('id','email','role');


-- =============================================================
-- SECTION 5 — students
-- =============================================================

GRANT SELECT, UPDATE ON public.students TO authenticated;

CREATE POLICY "students_select_own"
  ON public.students FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "students_select_coordinator"
  ON public.students FOR SELECT TO authenticated
  USING (public.is_coordinator());

-- Employer may read a student's row ONLY after that student's application to
-- one of the employer's postings is Accepted (PII minimization).
CREATE POLICY "students_select_employer_accepted"
  ON public.students FOR SELECT TO authenticated
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

CREATE POLICY "students_update_own"
  ON public.students FOR UPDATE TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Student cannot self-suspend / clear minor status / change identity.
DROP TRIGGER IF EXISTS trg_students_lock ON public.students;
CREATE TRIGGER trg_students_lock
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_locked_columns('id','account_status','is_minor');


-- =============================================================
-- SECTION 6 — employers
-- =============================================================

GRANT SELECT, INSERT, UPDATE ON public.employers TO authenticated;

CREATE POLICY "employers_select_own"
  ON public.employers FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "employers_select_coordinator"
  ON public.employers FOR SELECT TO authenticated
  USING (public.is_coordinator());

-- A student who has applied to one of this employer's postings may read the
-- employer row (application / placement context).
CREATE POLICY "employers_select_applied_student"
  ON public.employers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.applications a
      JOIN public.postings p ON p.id = a.posting_id
      WHERE p.employer_id = employers.id
        AND a.student_id = auth.uid()
    )
  );

-- Captures the prod-only "employers: own insert" policy in the repo.
CREATE POLICY "employers_insert_own"
  ON public.employers FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "employers_update_own"
  ON public.employers FOR UPDATE TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "employers_update_coordinator"
  ON public.employers FOR UPDATE TO authenticated
  USING  (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

-- Employer cannot self-approve / self-verify (these gate posting rights).
DROP TRIGGER IF EXISTS trg_employers_lock ON public.employers;
CREATE TRIGGER trg_employers_lock
  BEFORE UPDATE ON public.employers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_locked_columns(
    'id','coordinator_approved','domain_verified','verification_status');


-- =============================================================
-- SECTION 7 — postings (base table) + public board VIEW
--   Anonymous + general logged-in browsers read the postings_public VIEW,
--   which omits supervisor_name (the only person-level field). The base row
--   (incl. supervisor) is readable only by the owner employer, coordinators,
--   and the ACCEPTED student for that posting.
-- =============================================================

-- No anon grant on the base table. The authenticated SELECT grant only takes
-- effect through the owner / coordinator / accepted-student row policies below;
-- general browsing happens through postings_public instead.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.postings TO authenticated;

-- Owner sees their own postings including inactive (for management).
CREATE POLICY "postings_select_own"
  ON public.postings FOR SELECT TO authenticated
  USING (employer_id = auth.uid());

CREATE POLICY "postings_select_coordinator"
  ON public.postings FOR SELECT TO authenticated
  USING (public.is_coordinator());

-- An ACCEPTED student may read the full posting row (to see their supervisor on
-- the confirmed placement). Applied-but-not-accepted students use the view.
CREATE POLICY "postings_select_accepted_student"
  ON public.postings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.posting_id = postings.id
        AND a.student_id = auth.uid()
        AND a.status = 'Accepted'
    )
  );

-- Employer may create a posting only for themselves AND only if approved/verified.
CREATE POLICY "postings_insert_own_if_approved"
  ON public.postings FOR INSERT TO authenticated
  WITH CHECK (
    employer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employers e
      WHERE e.id = auth.uid()
        AND (e.coordinator_approved = true OR e.domain_verified = true)
    )
  );

CREATE POLICY "postings_update_own"
  ON public.postings FOR UPDATE TO authenticated
  USING  (employer_id = auth.uid())
  WITH CHECK (employer_id = auth.uid());

CREATE POLICY "postings_update_coordinator"
  ON public.postings FOR UPDATE TO authenticated
  USING  (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

CREATE POLICY "postings_delete_own"
  ON public.postings FOR DELETE TO authenticated
  USING (employer_id = auth.uid());

CREATE POLICY "postings_delete_coordinator"
  ON public.postings FOR DELETE TO authenticated
  USING (public.is_coordinator());

-- employer_id is identity (cannot be reassigned); company_name is derived by the
-- set_posting_company_name() trigger from the authoritative employers row, so a
-- normal user can never set it directly (no spoofing the public board).
DROP TRIGGER IF EXISTS trg_postings_lock ON public.postings;
CREATE TRIGGER trg_postings_lock
  BEFORE UPDATE ON public.postings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_locked_columns('employer_id','company_name');

-- ---- Public board view (no person-level fields) ---------------------------
-- This is a DEFINER view ON PURPOSE: it runs as its owner and so bypasses the
-- base table's RLS, exposing ONLY active postings and ONLY non-person columns.
-- supervisor_name is intentionally excluded, so anonymous + general logged-in
-- browsers never see an individual's name. anon is granted the VIEW only (never
-- the base table), so it cannot reach supervisor_name by any path. This is the
-- job board's data source. (Supabase's "security definer view" advisor will
-- flag this view; that is expected and acceptable for a deliberately-public,
-- column-restricted board.)
DROP VIEW IF EXISTS public.postings_public;
CREATE VIEW public.postings_public AS
  SELECT id, employer_id, company_name, title, track, work_mode,
         hours_per_week, location, start_date, deadline, description,
         responsibilities, requirements, is_active, created_at, updated_at
  FROM public.postings
  WHERE is_active = true;

GRANT SELECT ON public.postings_public TO anon, authenticated;


-- =============================================================
-- SECTION 8 — applications
-- =============================================================

GRANT SELECT, INSERT, UPDATE ON public.applications TO authenticated;  -- no DELETE (permanent record)

CREATE POLICY "applications_select_student_own"
  ON public.applications FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "applications_select_employer"
  ON public.applications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.postings p
      WHERE p.id = applications.posting_id AND p.employer_id = auth.uid()
    )
  );

CREATE POLICY "applications_select_coordinator"
  ON public.applications FOR SELECT TO authenticated
  USING (public.is_coordinator());

-- Student applies for themselves; must have a students row; posting must be active.
CREATE POLICY "applications_insert_student_own"
  ON public.applications FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.postings p WHERE p.id = posting_id AND p.is_active = true)
  );

-- Employer updates the status of applications to their own postings.
CREATE POLICY "applications_update_employer"
  ON public.applications FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.postings p
            WHERE p.id = applications.posting_id AND p.employer_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.postings p
            WHERE p.id = applications.posting_id AND p.employer_id = auth.uid())
  );

CREATE POLICY "applications_update_coordinator"
  ON public.applications FOR UPDATE TO authenticated
  USING  (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

-- An employer may change ONLY status. Identity columns plus the student's own
-- submission (cover_note / resume_url) and created_at are frozen, so an employer
-- can't tamper with what an applicant wrote. (Students have no UPDATE policy at all.)
DROP TRIGGER IF EXISTS trg_applications_lock ON public.applications;
CREATE TRIGGER trg_applications_lock
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_locked_columns('student_id','posting_id','cover_note','resume_url','created_at');


-- =============================================================
-- SECTION 9 — notifications
-- Cross-user notifications are created by SECURITY DEFINER triggers (added in
-- a later step); the client may only insert notifications addressed to itself.
-- =============================================================

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;  -- no DELETE

CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_select_coordinator"
  ON public.notifications FOR SELECT TO authenticated
  USING (public.is_coordinator());

CREATE POLICY "notifications_insert_self_only"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =============================================================
-- SECTION 10 — message_threads
-- Gated: a thread can be created only when an Accepted application exists
-- between exactly this student and this employer.
-- =============================================================

GRANT SELECT, INSERT, UPDATE ON public.message_threads TO authenticated;  -- no DELETE

CREATE POLICY "threads_select_participant_or_coord"
  ON public.message_threads FOR SELECT TO authenticated
  USING (
    student_id  = auth.uid()
    OR employer_id = auth.uid()
    OR public.is_coordinator()
  );

CREATE POLICY "threads_insert_gated_on_accepted"
  ON public.message_threads FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (student_id = auth.uid() OR employer_id = auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.applications a
      JOIN public.postings p ON p.id = a.posting_id
      WHERE a.student_id   = message_threads.student_id
        AND p.employer_id  = message_threads.employer_id
        AND a.status = 'Accepted'
    )
  );

CREATE POLICY "threads_update_participant"
  ON public.message_threads FOR UPDATE TO authenticated
  USING  (student_id = auth.uid() OR employer_id = auth.uid())
  WITH CHECK (student_id = auth.uid() OR employer_id = auth.uid());

CREATE POLICY "threads_update_coordinator"
  ON public.message_threads FOR UPDATE TO authenticated
  USING  (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

-- Participants may touch status/last_message_at; identity + coordinator review
-- fields are frozen for non-coordinators.
DROP TRIGGER IF EXISTS trg_threads_lock ON public.message_threads;
CREATE TRIGGER trg_threads_lock
  BEFORE UPDATE ON public.message_threads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_locked_columns(
    'student_id','employer_id','created_by','application_id',
    'reviewed_at','reviewed_by','coordinator_note');


-- =============================================================
-- SECTION 11 — messages
-- =============================================================

GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;  -- no DELETE

CREATE POLICY "messages_select_participant_or_coord"
  ON public.messages FOR SELECT TO authenticated
  USING (
    public.is_coordinator()
    OR EXISTS (
      SELECT 1 FROM public.message_threads mt
      WHERE mt.id = messages.thread_id
        AND (mt.student_id = auth.uid() OR mt.employer_id = auth.uid())
    )
  );

CREATE POLICY "messages_insert_participant"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.message_threads mt
      WHERE mt.id = messages.thread_id
        AND (mt.student_id = auth.uid() OR mt.employer_id = auth.uid())
        AND mt.status <> 'closed'
    )
  );

-- Only coordinators can update a message (to set reviewed_by_coordinator).
CREATE POLICY "messages_update_coordinator"
  ON public.messages FOR UPDATE TO authenticated
  USING  (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

-- Body and all content fields are immutable after send (even for coordinators).
DROP TRIGGER IF EXISTS trg_messages_immutable ON public.messages;
CREATE TRIGGER trg_messages_immutable
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_immutable();


-- =============================================================
-- SECTION 12 — Service-role-only tables: reassert the lockdown
-- The browser never touches these in Path A.
-- =============================================================

REVOKE ALL ON public.audit_logs                FROM anon, authenticated;
REVOKE ALL ON public.age_verification_consents FROM anon, authenticated;
REVOKE ALL ON public.rate_limit_log            FROM anon, authenticated;

-- =============================================================
-- END
-- =============================================================
