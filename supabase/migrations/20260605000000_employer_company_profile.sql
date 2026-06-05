-- =============================================================
-- SiB — Employer company-profile fields
-- Migration: 20260605000000_employer_company_profile.sql
-- Run AFTER 20260603040000_pathA_grant_execute.sql.
--
-- WHY THIS EXISTS
--   The employer onboarding flow is being collapsed into a single one-time
--   "company profile" that persists every field to the employers table. The old
--   multi-step register form collected these company-level answers but had
--   nowhere to store them (they were dropped into sessionStorage and discarded):
--     - industry        e.g. "Software / Technology"
--     - office_address  street / city / province where the student reports
--     - contact_title   the primary contact's role, e.g. "HR Manager"
--
--   All three are ordinary, owner-editable profile fields. They are deliberately
--   NOT added to the employers column-lock guard
--     enforce_locked_columns('id','coordinator_approved','domain_verified','verification_status')
--   defined in 20260603000000_pathA_grants_rls.sql, so the existing
--   employers_insert_own / employers_update_own RLS policies (WITH CHECK
--   id = auth.uid()) already allow an employer to set them on their OWN row.
--   No GRANT or RLS-policy changes are required by this migration.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to run more than once.
-- =============================================================

ALTER TABLE public.employers
  ADD COLUMN IF NOT EXISTS industry       text,
  ADD COLUMN IF NOT EXISTS office_address text,
  ADD COLUMN IF NOT EXISTS contact_title  text;

COMMENT ON COLUMN public.employers.industry       IS 'Employer-reported industry/sector (preset option or free text).';
COMMENT ON COLUMN public.employers.office_address IS 'Primary work-site address where the placed student will report.';
COMMENT ON COLUMN public.employers.contact_title  IS 'Job title/role of the primary contact (e.g. "HR Manager").';

-- =============================================================
-- END
-- =============================================================
