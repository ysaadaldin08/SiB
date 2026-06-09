-- =============================================================
-- SiB — Path A: pin search_path on the four advisor-flagged functions
-- Migration: 20260609010000_pin_function_search_path.sql
-- Run AFTER 20260609000000_students_public_browse.sql.
--
-- WHY THIS EXISTS
--   The Supabase database linter flags `function_search_path_mutable` on four
--   functions whose search_path is not pinned. A mutable search_path lets the
--   caller's session search_path influence how unqualified names resolve inside
--   the function — a hardening gap, and higher-risk for the SECURITY DEFINER one
--   (set_posting_company_name, which runs as its owner). We pin search_path =
--   public on each so name resolution is deterministic.
--
--   Flagged functions (all zero-arg; verified live before writing this):
--     - public.set_posting_company_name()    SECURITY DEFINER (BEFORE-trigger)
--     - public.is_privileged_caller()         SECURITY INVOKER
--     - public.enforce_locked_columns()       SECURITY INVOKER (BEFORE-trigger)
--     - public.enforce_message_immutable()    SECURITY INVOKER (BEFORE-trigger)
--
-- APPROACH
--   ALTER FUNCTION ... SET search_path = public is a metadata-only change: it does
--   NOT redefine the function body and does NOT touch privileges/ACLs, so no
--   EXECUTE grant is reset (unlike CREATE OR REPLACE — cf. the 030 -> 040 incident
--   where recreating a function stripped its grant). Idempotent: re-running sets
--   the same value. Schema-qualified. Single transaction.
--
-- HOW TO RUN (you, not the agent)
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Safe to run more than once.
-- =============================================================

BEGIN;

ALTER FUNCTION public.set_posting_company_name()  SET search_path = public;
ALTER FUNCTION public.is_privileged_caller()      SET search_path = public;
ALTER FUNCTION public.enforce_locked_columns()    SET search_path = public;
ALTER FUNCTION public.enforce_message_immutable() SET search_path = public;

COMMIT;

-- =============================================================
-- END
-- =============================================================
