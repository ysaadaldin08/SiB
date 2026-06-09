-- =============================================================
-- SiB — Path A: students_public browse gallery (approved-employer only)
-- Migration: 20260609000000_students_public_browse.sql
-- Run AFTER 20260603040000_pathA_grant_execute.sql.
--   Depends on the helper public.current_user_employer_approved() AND its
--   EXECUTE grant to `authenticated`, both established by earlier Path A
--   migrations. This file creates NO function, so that dependency must already
--   be present (it is, in the live DB and in 20260603000000 / 20260603040000).
--
-- WHY THIS EXISTS
--   The employer "Browse Candidates" gallery needs a privacy-safe way for an
--   APPROVED employer to see students who have submitted their application,
--   BEFORE any application is accepted. The base `students` table must NOT be
--   opened up for this. Its RLS only lets an employer read a student row after
--   an Accepted application (PII minimization), and any row-level grant would
--   expose EVERY column of the matched rows — including last name, phone,
--   guardian authorization, co-op teacher name/email, the free-text short
--   answers (goals / experience / scheduling), and the resume — all of which
--   live in the students.profile jsonb. Instead we expose a narrow VIEW that
--   selects ONLY the safe fields and is gated to approved employers.
--
--   EXPOSED (safe):  id, first name, grade, school, tracks, hours/week,
--                    start date / availability, commute.
--   NEVER EXPOSED:   last name, email, phone, guardian/parent contact,
--                    co-op teacher name/email, free-text short answers
--                    (goals / experience / schedulingNotes), resume.
--   (Confirmed against the live profile keys: last, phone, guardianAuth,
--    teacherName, teacherEmail, goals, experience, schedulingNotes, resumeName
--    all exist in the jsonb and are deliberately omitted below. The view
--    WHITELISTS columns — it never SELECTs * — so a future profile key cannot
--    leak through by accident.)
--
-- SECURITY MODEL
--   * students_public is a DEFINER view (security_invoker = false), exactly like
--     postings_public: it runs as its owner and so bypasses the base table's
--     RLS, exposing ONLY the whitelisted columns. A security_invoker view would
--     be useless here — a browsing employer has no RLS path to other students'
--     rows, so it would return nothing.
--   * Because a definer view bypasses RLS, the WHERE clause IS the access
--     control. Two conditions gate every row:
--       (a) the student has actually submitted   -> profile <> '{}'::jsonb
--           (the signup trigger seeds profile = '{}')
--       (b) the CURRENT user is an approved employer
--           -> public.current_user_employer_approved()
--     The helper reads auth.uid() (the live request's JWT, unaffected by view
--     ownership), so the gate is evaluated against the REAL caller. A
--     non-approved employer, a student, a coordinator, or anon gets zero rows.
--   * Granted to `authenticated` ONLY — never anon. This is gated, employer-only
--     data and must never reach the public job board.
--
-- WHY REUSE current_user_employer_approved() (not a new is_approved_employer())
--   It already encodes the exact gate we want — (coordinator_approved = true OR
--   domain_verified = true) for auth.uid() — the same gate that authorizes
--   posting creation (postings_insert_own_if_approved). It is SECURITY DEFINER
--   with a pinned `search_path = public` and already has EXECUTE granted to
--   `authenticated` (20260603040000). Re-declaring a SECURITY DEFINER helper
--   here would risk RESETTING its ACL — which is precisely what happened between
--   030 and 040 (a recreate stripped EXECUTE and 040 had to restore it). So we
--   REFERENCE the proven helper rather than redefine it. Consequently this
--   migration introduces NO new internal helper, so there is nothing new to
--   REVOKE EXECUTE on; we also do not touch the shared helper's intentional
--   grant. (Inlining the equivalent `EXISTS (SELECT 1 FROM employers ...)` would
--   also work, but reusing the named helper is clearer and avoids gate drift.)
--
-- HOW TO RUN (you, not the agent)
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: DROP VIEW IF EXISTS then CREATE; the REVOKE/GRANT are no-ops once
--   in the target state. Wrapped in one transaction. Safe to run more than once.
-- =============================================================

BEGIN;

-- ---- Privacy-safe browse view (definer; approved-employer gated) -----------
DROP VIEW IF EXISTS public.students_public;

CREATE VIEW public.students_public
  WITH (security_invoker = false)   -- DEFINER on purpose (same as postings_public):
                                    -- bypass students RLS, expose only the
                                    -- whitelisted columns below. See header.
AS
  SELECT
    s.id                       AS id,
    s.profile ->> 'first'      AS first_name,      -- first name ONLY (never 'last')
    s.grade                    AS grade,           -- typed column
    s.school                   AS school,          -- typed column
    s.profile ->  'tracks'     AS tracks,          -- jsonb array of track strings
    s.profile ->> 'hoursPerWeek' AS hours_per_week,-- text; UI formats
    s.profile ->> 'startDate'  AS start_date,      -- availability / preferred start
    s.profile ->> 'commute'    AS commute
  FROM public.students s
  WHERE
    -- (a) submitted only: the signup trigger seeds profile = '{}'
    s.profile <> '{}'::jsonb
    -- (b) active accounts only: suspended students must never appear
    AND s.account_status = 'active'
    -- (c) must have a first name, so the gallery never renders a blank card
    AND coalesce(s.profile ->> 'first', '') <> ''
    -- (d) caller must be an approved/verified employer
    --     (coordinator_approved OR domain_verified); auth.uid() resolves to the
    --     real request user even though this is a definer view.
    AND public.current_user_employer_approved();

-- ---- Grants: authenticated ONLY (gated employer data; never public) ---------
REVOKE ALL ON public.students_public FROM PUBLIC;
REVOKE ALL ON public.students_public FROM anon;          -- explicit: never public
GRANT  SELECT ON public.students_public TO authenticated;

COMMIT;

-- =============================================================
-- NOTES / FOLLOW-UPS (NOT applied here)
--   * The Supabase "security definer view" advisor (level ERROR) will flag
--     students_public, exactly as it already flags postings_public. That is
--     EXPECTED and acceptable: the definer view + in-WHERE approved-employer
--     gate + authenticated-only grant + whitelisted columns ARE the safety
--     model. Do NOT switch this to security_invoker (it would return zero rows
--     for employers and break the gallery).
--   * Row filters now applied (in addition to "submitted" = profile <> '{}'):
--       - s.account_status = 'active'                  -> hide suspended students;
--       - coalesce(s.profile ->> 'first','') <> ''     -> hide nameless partial
--         profiles so the gallery never renders a blank card.
--   * UI follow-up (separate change, not in this migration): add a data.js
--     reader (e.g. getBrowseCandidates()) that selects from students_public, and
--     wire dashboard-employer.html "Browse Candidates" to it, replacing the
--     hardcoded "Available Candidates" stat and the renderStudents([]) stub.
-- =============================================================
-- END
-- =============================================================
