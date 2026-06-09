-- =============================================================
-- SiB — Path A: concern_reports table (footer "Report a concern")
-- Migration: 20260609020000_concern_reports.sql
-- Run AFTER 20260609010000_pin_function_search_path.sql.
--
-- *** DRAFT — NOT YET APPLIED. Pending review. ***
--
-- WHY THIS EXISTS
--   Concern reports (the footer "Report a concern" button, visible on PUBLIC
--   pages) currently fan out as `notifications` rows via notify_coordinators(),
--   so the coordinator dashboard "Reports" tab — which reads flagged
--   message_threads — never shows them. This gives reports a real home: a
--   dedicated table the Reports tab can read directly. (The submit -> table and
--   Reports tab -> table wiring, plus the silent-success fix, is a SEPARATE
--   follow-up; this migration only creates the table + RLS.)
--
-- FIELD MAPPING (from app.js submitReportConcern() payload):
--   senderName   -> reporter_name   (form "Your name", OPTIONAL; the client sends
--                                     'Anonymous' when left blank)
--   senderEmail  -> reporter_email  (form "Your email", OPTIONAL)
--   type         -> report_type     (the <select> VALUE code, e.g.
--                                     'inappropriate_message', 'unsafe_employer',
--                                     'student_concern', 'technical_issue', 'other')
--   detail       -> detail          (required free text)
--   (status)     -> status          ('open' default; coordinator triage:
--                                     open / reviewed / resolved)
--
-- SECURITY MODEL
--   * INSERT: anon AND authenticated. Anonymous safety reporting from public
--     pages is a DELIBERATE requirement (the footer button appears on public
--     pages). Insert-only — the reporter never reads back. WITH CHECK
--     (status = 'open') stops an inserter pre-setting a triage status to bury a
--     report.
--   * SELECT: coordinators only, via the existing is_coordinator() helper.
--     No student / employer / anon read — reports can contain third-party info.
--   * UPDATE: coordinators only (to advance `status` during triage).
--   * No DELETE policy: reports are a permanent record (like notifications /
--     messages). The service role can still manage rows out-of-band.
--
--   Reuses the existing SECURITY DEFINER is_coordinator() helper (pinned
--   search_path = public). This migration adds NO new function.
--
-- NOTE — ABUSE SURFACE (rate-limiting deferred, same posture as notify_coordinators):
--   anon INSERT is spammable, exactly like the anon-executable notify_coordinators
--   RPC. Do NOT revoke anon — that would break anonymous child-safety reporting.
--   Server-side rate-limiting should be added alongside the planned messaging
--   rate-limits — see the "Post-audit backlog (June 2026)" section in CLAUDE.md.
--   It is intentionally NOT added in this migration.
--
-- HOW TO RUN (you, not the agent)
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS before each
--   CREATE, idempotent ENABLE RLS / GRANTs. Single transaction. Safe to re-run.
-- =============================================================

BEGIN;

-- ---- Table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.concern_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  reporter_name  text,                                  -- optional ('Anonymous' if blank)
  reporter_email text,                                  -- optional
  report_type    text        NOT NULL,                  -- <select> value code
  detail         text        NOT NULL,                  -- required free text
  status         text        NOT NULL DEFAULT 'open'    -- open | reviewed | resolved
);

-- ---- RLS --------------------------------------------------------------------
ALTER TABLE public.concern_reports ENABLE ROW LEVEL SECURITY;

-- Table-level grants (Path A: a role needs the verb, then RLS scopes the rows).
-- anon: INSERT only. authenticated: INSERT + (coordinator-scoped) SELECT/UPDATE.
GRANT INSERT         ON public.concern_reports TO anon, authenticated;
GRANT SELECT, UPDATE ON public.concern_reports TO authenticated;   -- no DELETE

-- INSERT — anyone may file a report (anonymous reporting from public pages).
-- WITH CHECK pins the new row to status='open' so it can't be inserted pre-triaged.
DROP POLICY IF EXISTS concern_reports_insert_anyone ON public.concern_reports;
CREATE POLICY concern_reports_insert_anyone
  ON public.concern_reports FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'open');

-- SELECT — coordinators only.
DROP POLICY IF EXISTS concern_reports_select_coordinator ON public.concern_reports;
CREATE POLICY concern_reports_select_coordinator
  ON public.concern_reports FOR SELECT TO authenticated
  USING (public.is_coordinator());

-- UPDATE — coordinators only (triage: advance status).
DROP POLICY IF EXISTS concern_reports_update_coordinator ON public.concern_reports;
CREATE POLICY concern_reports_update_coordinator
  ON public.concern_reports FOR UPDATE TO authenticated
  USING  (public.is_coordinator())
  WITH CHECK (public.is_coordinator());

COMMIT;

-- =============================================================
-- END
-- =============================================================
