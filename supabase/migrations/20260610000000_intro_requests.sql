-- =============================================================
-- SiB — Path A: intro_requests table (employer "Request an Intro")
-- Migration: 20260610000000_intro_requests.sql
-- Run AFTER 20260609020000_concern_reports.sql.
--   Depends on helpers established by earlier Path A migrations (all already live):
--     - public.current_user_employer_approved()  (20260603030000, EXECUTE granted 20260603040000)
--     - public.is_coordinator()                  (20260526000000, search_path pinned later)
--     - public._notify_coordinators(text, jsonb) (20260603020000; definer, client-revoked)
--   This migration creates NO new helper — it only references the proven ones.
--
-- *** DRAFT — NOT YET APPLIED. Pending review. ***
--
-- WHY THIS EXISTS
--   The employer "Browse Candidates -> Request an Intro" flow is currently a
--   frontend-only stub: submitIntro() (app.js) shows a success toast but writes
--   nothing, there is no table, and no coordinator is notified. This gives intro
--   requests a real home — a dedicated table the coordinator can read/triage and
--   the requesting employer can see under "My Requests" — and fans the request
--   out to coordinators using the SAME SECURITY DEFINER path as new applications
--   and placements. (The frontend rewire — submitIntro -> data.js writer -> this
--   table, plus a "My Requests" reader — is a SEPARATE follow-up; this migration
--   only creates the table + RLS + the notification trigger.)
--
-- FIELD MAPPING (from the intro modal):
--   currentIntroId (the browsed candidate's students.id) -> student_id
--   employer (the signed-in employer)                    -> employer_id (= auth.uid())
--   "Additional context" textarea (OPTIONAL)             -> note
--   (status)                                             -> status
--                                                           ('open' default; coordinator
--                                                            triage: open / reviewed / resolved)
--
-- SECURITY MODEL
--   * INSERT: authenticated, gated to an APPROVED/VERIFIED employer acting as
--     themselves — WITH CHECK (employer_id = auth.uid() AND
--     current_user_employer_approved()). This is the exact gate that authorizes
--     posting creation and the students_public browse gallery, so only employers
--     who can already see candidates can request an intro.
--   * SELECT: the owning employer (for "My Requests") OR any coordinator
--     (is_coordinator()). Students are intentionally NOT given read access — an
--     intro is employer -> coordinator-mediated, matching the existing design
--     (the student is not notified directly).
--   * UPDATE: coordinators only (to advance `status` during triage).
--   * No DELETE policy: intro requests are a permanent record (like notifications,
--     messages, applications, concern_reports). The service role can still manage
--     rows out-of-band.
--   * status has no CHECK constraint, matching concern_reports (the triage values
--     open/reviewed/resolved are enforced by the UI, not the DB).
--
-- COORDINATOR NOTIFICATION
--   An AFTER INSERT trigger (tg_intro_request_inserted) fans the request out to
--   EVERY coordinator via _notify_coordinators('introRequest', ...), mirroring
--   tg_application_inserted / the 'newPlacement' payload. There is no per-student
--   coordinator link in the schema (students carry only school/grade), so this is
--   a global fan-out with `school` included in the payload for manual triage.
--   The notification is written DB-side (definer), never by the client — the
--   browser can only insert notifications addressed to itself
--   (notifications_insert_self_only).
--
-- HOW TO RUN (you, not the agent)
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--   DROP POLICY/TRIGGER IF EXISTS before each CREATE, idempotent ENABLE RLS /
--   GRANTs. Single transaction. Safe to re-run.
-- =============================================================

BEGIN;

-- ---- Table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.intro_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid        NOT NULL REFERENCES public.employers(id) ON DELETE CASCADE,
  student_id  uuid        NOT NULL REFERENCES public.students(id)  ON DELETE CASCADE,
  note        text,                                  -- optional "additional context"
  status      text        NOT NULL DEFAULT 'open',   -- open | reviewed | resolved (no CHECK; matches concern_reports)
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---- Indexes (one per FK, matching the schema convention) -------------------
CREATE INDEX IF NOT EXISTS idx_intro_requests_employer_id ON public.intro_requests(employer_id);
CREATE INDEX IF NOT EXISTS idx_intro_requests_student_id  ON public.intro_requests(student_id);

-- ---- RLS --------------------------------------------------------------------
ALTER TABLE public.intro_requests ENABLE ROW LEVEL SECURITY;

-- Table-level grants (Path A: a role needs the verb, then RLS scopes the rows).
GRANT SELECT, INSERT, UPDATE ON public.intro_requests TO authenticated;   -- no DELETE

-- INSERT — an approved/verified employer may create a request as themselves.
DROP POLICY IF EXISTS intro_requests_insert_employer ON public.intro_requests;
CREATE POLICY intro_requests_insert_employer
  ON public.intro_requests FOR INSERT TO authenticated
  WITH CHECK (employer_id = auth.uid() AND public.current_user_employer_approved());

-- SELECT — owning employer ("My Requests") or any coordinator.
DROP POLICY IF EXISTS intro_requests_select_owner_or_coordinator ON public.intro_requests;
CREATE POLICY intro_requests_select_owner_or_coordinator
  ON public.intro_requests FOR SELECT TO authenticated
  USING (employer_id = auth.uid() OR public.is_coordinator());

-- UPDATE — coordinators only (triage: advance status).
DROP POLICY IF EXISTS intro_requests_update_coordinator ON public.intro_requests;
CREATE POLICY intro_requests_update_coordinator
  ON public.intro_requests FOR UPDATE TO authenticated
  USING  (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

-- ---- Coordinator notification trigger ---------------------------------------
-- Mirrors tg_application_inserted: definer, pinned search_path, fans out via the
-- client-revoked _notify_coordinators(). Payload matches the 'newPlacement' style.
CREATE OR REPLACE FUNCTION public.tg_intro_request_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_first text; v_school text; v_company text;
BEGIN
  SELECT s.profile ->> 'first', s.school
    INTO v_first, v_school
  FROM public.students s WHERE s.id = NEW.student_id;

  SELECT e.company_name INTO v_company
  FROM public.employers e WHERE e.id = NEW.employer_id;

  PERFORM public._notify_coordinators('introRequest',
    jsonb_build_object(
      'introRequestId', NEW.id,
      'studentId',      NEW.student_id,
      'firstName',      COALESCE(v_first, 'A student'),
      'school',         v_school,
      'companyName',    v_company
    ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_intro_request_inserted ON public.intro_requests;
CREATE TRIGGER trg_intro_request_inserted
  AFTER INSERT ON public.intro_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_intro_request_inserted();

COMMIT;

-- =============================================================
-- NOTES / FOLLOW-UPS (NOT applied here)
--   * Frontend rewire (separate change): make submitIntro() async, read the note
--     textarea (needs an id, e.g. #introNote, in dashboard-employer.html), and call
--     a new data.js writer (e.g. createIntroRequest({ studentId, note })) that
--     inserts into public.intro_requests — employer_id comes from auth.uid() via
--     the INSERT policy, so the client sends only student_id + note.
--   * "My Requests" tab (dashboard-employer.html #elink-requests) can read the
--     employer's own rows (getIntroRequests()) thanks to the owner SELECT policy.
--   * Coordinator dashboard: add an 'introRequest' notification renderer and/or a
--     triage view over intro_requests (coordinator SELECT/UPDATE already allowed).
--   * If duplicate requests (same employer + same student) should be prevented,
--     add UNIQUE (employer_id, student_id) — deliberately NOT added here, since a
--     re-request after a prior one is resolved is plausibly valid.
--   * Rate-limiting deferred, same posture as notify_coordinators / concern_reports.
-- =============================================================
-- END
-- =============================================================
