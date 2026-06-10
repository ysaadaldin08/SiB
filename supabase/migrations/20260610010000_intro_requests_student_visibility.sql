-- =============================================================
-- SiB — Path A: intro_requests student visibility
-- Migration: 20260610010000_intro_requests_student_visibility.sql
-- Run AFTER 20260610000000_intro_requests.sql.
--
-- *** APPLIED 2026-06-10. ***
--
-- WHY THIS EXISTS
--   The original intro_requests design was employer -> coordinator-mediated: the
--   targeted student could neither read the request (no SELECT policy) nor was
--   notified (the AFTER INSERT trigger fanned out to coordinators only). This
--   migration makes the intro visible to the student directly while KEEPING the
--   coordinator fan-out intact:
--     1. A new SELECT RLS policy lets a student read intro_requests addressed to
--        them. This is sound because the identity chain
--        intro_requests.student_id = students.id = profiles.id = auth.uid() means
--        student_id already equals the logged-in student's auth uid — no bridge
--        column is needed.
--     2. The existing tg_intro_request_inserted() trigger is extended with ONE
--        additional _notify() call addressed to the student, alongside (not
--        replacing) the existing _notify_coordinators() fan-out. _notify() is the
--        single-recipient, definer-only helper that writes notifications.user_id =
--        NEW.student_id, so the student receives an in-app 'introRequest' notice.
--
-- IDEMPOTENT: DROP POLICY IF EXISTS before CREATE; CREATE OR REPLACE FUNCTION.
-- Single transaction. Safe to re-run. The existing trigger binding
-- (trg_intro_request_inserted) is unchanged — CREATE OR REPLACE FUNCTION keeps it
-- pointed at the same function, so the trigger is not recreated here.
-- =============================================================

BEGIN;

-- ---- 1. SELECT policy: a student may read intro requests addressed to them -----
-- student_id = auth.uid() (intro_requests.student_id = students.id = profiles.id =
-- auth.users.id). Sits alongside the existing owner/coordinator SELECT policy;
-- Postgres ORs multiple permissive SELECT policies, so employers and coordinators
-- retain their existing access and students gain read of their own rows.
DROP POLICY IF EXISTS intro_requests_select_student ON public.intro_requests;
CREATE POLICY intro_requests_select_student
  ON public.intro_requests FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- ---- 2. Extend the insert trigger to also notify the targeted student ----------
-- Preserves the existing function body EXACTLY (same DECLARE block, same student/
-- employer lookups, same _notify_coordinators() call) and adds ONE _notify() call
-- addressed to NEW.student_id. Keeps SECURITY DEFINER + SET search_path = public.
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

  -- NEW: notify the targeted student directly (single-recipient, definer-only).
  -- Distinct type ('introRequestReceived') so the frontend can tell the student's
  -- notice apart from the coordinator 'introRequest' fan-out by type + payload shape.
  PERFORM public._notify(NEW.student_id, 'introRequestReceived',
    jsonb_build_object('introRequestId', NEW.id, 'companyName', v_company, 'note', NEW.note));

  RETURN NEW;
END;
$$;

COMMIT;

-- =============================================================
-- NOTES / FOLLOW-UPS (NOT applied here)
--   * Frontend reader (separate change): dashboard-student.html needs a query +
--     renderer over the student's own intro_requests rows (now readable via the
--     new SELECT policy), and/or an 'introRequest' notification renderer.
--   * Coordinator and student now receive DISTINCT notification types:
--     coordinator 'introRequest' (firstName/school/student context) and student
--     'introRequestReceived' (companyName/note). Renderers key off the type.
-- =============================================================
-- END
-- =============================================================
