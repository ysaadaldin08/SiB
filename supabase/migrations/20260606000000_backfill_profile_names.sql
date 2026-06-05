-- =============================================================
-- SiB — Path A: backfill profiles.full_name for existing accounts
-- Migration: 20260606000000_backfill_profile_names.sql
-- Run AFTER 20260603010000_pathA_onboarding.sql.
--
-- WHY THIS EXISTS
--   The coordinator dashboard (and any cross-user name display) can only read
--   public.profiles / public.students / public.employers — it CANNOT read
--   auth.users.raw_user_meta_data. New signups already land a name in
--   profiles.full_name via the handle_new_user() trigger (from
--   user_metadata.full_name = first + ' ' + last). But accounts created before
--   that trigger populated full_name — or OAuth/edge-case signups where the
--   metadata key was absent — have profiles.full_name = NULL, so the dashboard
--   falls back to the email handle (e.g. "turtlpee").
--
--   This migration persists those names INTO profiles.full_name from the best
--   available source, so the real name shows everywhere. It only ever FILLS an
--   empty value; it never overwrites a name a user actually typed.
--
-- IDEMPOTENT: every UPDATE is guarded on (full_name IS NULL OR trim = '') and a
-- non-empty source, so re-running changes nothing once names are present.
--
-- DO NOT APPLY BLINDLY — review, then run in the Supabase SQL editor.
-- =============================================================


-- 1) Primary source: auth.users metadata.
--    Tries full_name, then name (Google OAuth), then first_name + last_name.
UPDATE public.profiles p
SET    full_name = NULLIF(TRIM(COALESCE(
         u.raw_user_meta_data ->> 'full_name',
         u.raw_user_meta_data ->> 'name',
         CONCAT_WS(' ', u.raw_user_meta_data ->> 'first_name',
                        u.raw_user_meta_data ->> 'last_name')
       )), '')
FROM   auth.users u
WHERE  u.id = p.id
  AND  (p.full_name IS NULL OR TRIM(p.full_name) = '')
  AND  NULLIF(TRIM(COALESCE(
         u.raw_user_meta_data ->> 'full_name',
         u.raw_user_meta_data ->> 'name',
         CONCAT_WS(' ', u.raw_user_meta_data ->> 'first_name',
                        u.raw_user_meta_data ->> 'last_name')
       )), '') IS NOT NULL;


-- 2) Secondary source (students): the first/last captured at onboarding,
--    stored in students.profile (jsonb).
UPDATE public.profiles p
SET    full_name = NULLIF(TRIM(CONCAT_WS(' ',
         s.profile ->> 'first',
         s.profile ->> 'last'
       )), '')
FROM   public.students s
WHERE  s.id = p.id
  AND  (p.full_name IS NULL OR TRIM(p.full_name) = '')
  AND  NULLIF(TRIM(CONCAT_WS(' ', s.profile ->> 'first', s.profile ->> 'last')), '') IS NOT NULL;


-- 3) Tertiary source (employers): the contact name on the employer row.
UPDATE public.profiles p
SET    full_name = e.contact_name
FROM   public.employers e
WHERE  e.id = p.id
  AND  (p.full_name IS NULL OR TRIM(p.full_name) = '')
  AND  NULLIF(TRIM(e.contact_name), '') IS NOT NULL;

-- =============================================================
-- END
-- =============================================================
