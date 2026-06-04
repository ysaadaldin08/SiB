-- =============================================================
-- SiB — Path A: restore EXECUTE on the RLS helper functions
-- Migration: 20260603040000_pathA_grant_execute.sql
-- Run AFTER 20260603030000_pathA_fix_rls_recursion.sql.
--
-- WHY THIS EXISTS
--   Recreating is_coordinator() in 030 carried over a restrictive ACL, leaving
--   the `authenticated` role without EXECUTE on it. Because almost every RLS
--   policy calls is_coordinator() (and the new helpers), reads/writes failed with
--     ERROR: permission denied for function is_coordinator
--   This restores EXECUTE for `authenticated` on all 8 functions the policies use.
--
-- ROLE SCOPE — authenticated only, NOT anon (verified, not assumed)
--   The public job board reads the `postings_public` VIEW, which is a DEFINER
--   view (no security_invoker): anon runs it as the view owner and bypasses the
--   base-table RLS, so anon never evaluates a policy that calls these helpers.
--   anon has no grants on the base tables and does not call any of these
--   functions, so no anon EXECUTE grant is needed (avoids over-granting).
--
-- Idempotent: GRANT EXECUTE is a no-op if already granted. Wrapped in one
-- transaction. Web-editor-safe (plain GRANT statements; no functions, no $$).
-- =============================================================

BEGIN;

GRANT EXECUTE ON FUNCTION public.is_coordinator()                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_owns_posting(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_student()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.posting_is_active(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_accepted_application(uuid, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_applied_to_employer(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_accepted_for_posting(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_employer_approved()          TO authenticated;

COMMIT;

-- =============================================================
-- END
-- =============================================================
