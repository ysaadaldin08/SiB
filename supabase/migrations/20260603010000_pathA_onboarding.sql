-- =============================================================
-- SiB — Path A: per-role onboarding at signup
-- Migration: 20260603010000_pathA_onboarding.sql
-- Run AFTER 20260603000000_pathA_grants_rls.sql.
--
-- WHAT THIS DOES
--   1. Adds students.profile (jsonb) to hold the rich onboarding answers the
--      student-apply form collects (tracks, hours, short answers, etc.).
--   2. Replaces handle_new_user() so the signup trigger reads user_metadata.role
--      and creates the correct domain row:
--        - role = 'student'  -> profiles + students row
--        - role = 'employer' -> profiles + employers row (company_name = '')
--        - role missing/invalid (e.g. Google OAuth, or tampering) -> profiles
--          only, with a 'student' placeholder role and NO domain row. The user
--          picks a role later via claim_role() (wired in Step 3). 'coordinator'
--          can NEVER be self-assigned at signup.
--   3. Backfills domain rows for any existing accounts, matched to profiles.role.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS,
-- INSERT ... ON CONFLICT DO NOTHING. Safe to run more than once.
-- =============================================================


-- =============================================================
-- SECTION 1 — students.profile (flexible onboarding payload)
-- school + grade stay as typed columns; everything else the apply form
-- collects lands here as structured JSON, protected by the same students RLS.
-- (Parental consent + co-op-teacher verification will graduate to dedicated
--  handling in a later phase; for now we simply stop losing the data.)
-- =============================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;


-- =============================================================
-- SECTION 2 — signup trigger: create the right row per role
-- =============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta  jsonb   := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_role  text    := NULLIF(v_meta ->> 'role', '');
  v_full  text    := NULLIF(v_meta ->> 'full_name', '');
  -- 'coordinator' is assigned manually by an admin — NEVER through signup.
  v_valid boolean := v_role IN ('student', 'employer');
BEGIN
  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN v_valid THEN v_role ELSE 'student' END,  -- placeholder when role absent/invalid
    v_full
  )
  ON CONFLICT (id) DO NOTHING;

  -- Only create a domain row when an explicit, valid self-serve role was given.
  -- OAuth signups (no role yet) get theirs via claim_role() after they choose.
  IF v_valid AND v_role = 'employer' THEN
    INSERT INTO public.employers (id, company_name, contact_name)
    VALUES (NEW.id, '', v_full)
    ON CONFLICT (id) DO NOTHING;
  ELSIF v_valid AND v_role = 'student' THEN
    INSERT INTO public.students (id)
    VALUES (NEW.id)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================
-- SECTION 3 — backfill existing accounts (matched to profiles.role)
-- Existing rows today: a couple of test accounts. New signups are handled by
-- the trigger above; this just makes already-created accounts consistent.
-- =============================================================

INSERT INTO public.students (id)
SELECT p.id FROM public.profiles p
WHERE p.role = 'student'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.employers (id, company_name)
SELECT p.id, '' FROM public.profiles p
WHERE p.role = 'employer'
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- END
-- =============================================================
