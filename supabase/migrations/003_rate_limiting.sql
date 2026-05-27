-- ============================================================
-- SiB — Rate Limiting Functions (Database-side)
-- Migration: 003_rate_limiting.sql
-- Paste into: Supabase Dashboard → SQL Editor
--
-- Security basis: Pillar 1.5 — rate limiting at the DB layer
-- Since GitHub Pages + Supabase has no persistent Node.js server,
-- rate limits are enforced via database functions called from
-- Supabase Edge Functions.
--
-- The existing message rate limits (20/hr, 5 threads/day) in data.js
-- are preserved; these add registration, login, application, and
-- posting limits.
-- ============================================================

-- ============================================================
-- rate_limit_events: stores timestamped events for sliding-window counting
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identifies the subject being rate-limited: user UUID, IP address, or composite key
  subject     TEXT NOT NULL,
  -- What action was attempted (registration, login_attempt, application_submit, posting_create)
  event_type  TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_subject_type_idx ON public.rate_limit_events(subject, event_type);
CREATE INDEX IF NOT EXISTS rate_limit_occurred_idx     ON public.rate_limit_events(occurred_at DESC);

-- Auto-clean events older than 24 hours via a scheduled Edge Function (see daily-export)
-- For now, clean on each check to prevent unbounded growth.

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
-- No user-facing policies — accessed exclusively via Edge Functions (service_role)


-- ============================================================
-- Function: check_rate_limit
-- Returns: boolean — true if the action is ALLOWED, false if BLOCKED
--
-- Usage from Edge Function:
--   SELECT check_rate_limit('ip:1.2.3.4', 'registration', 3, '1 hour'::interval);
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_subject    TEXT,
  p_event_type TEXT,
  p_max_count  INTEGER,
  p_window     INTERVAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as the function owner (postgres), bypassing RLS on rate_limit_events
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM public.rate_limit_events
  WHERE subject     = p_subject
    AND event_type  = p_event_type
    AND occurred_at > now() - p_window;

  -- Clean up events outside window to prevent table growth
  DELETE FROM public.rate_limit_events
  WHERE subject    = p_subject
    AND event_type = p_event_type
    AND occurred_at < now() - p_window;

  RETURN v_count < p_max_count;
END;
$$;


-- ============================================================
-- Function: record_rate_limit_event
-- Records a new event for the subject+type.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_rate_limit_event(
  p_subject    TEXT,
  p_event_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.rate_limit_events(subject, event_type)
  VALUES (p_subject, p_event_type);
END;
$$;


-- ============================================================
-- Rate limit configuration — reference for Edge Functions
--
-- Limit                       Subject              Max   Window
-- -----------------------------------------------------------------
-- Account registration         IP address           3     1 hour
--   (prevents bulk fake-account creation)
-- Login attempts               IP + email           5     15 minutes
--   (prevents credential stuffing)
-- Application submissions      user UUID            5     1 day
--   (prevents spam applications)
-- Job posting creation         employer UUID        10    1 day
--   (prevents posting spam)
-- Message send                 user UUID            20    1 hour    (existing — preserved)
-- New thread creation          user UUID            5     1 day     (existing — preserved)
-- Email verification resend    user UUID            1     60 seconds (existing — preserved)
--
-- Graceful errors (never expose internal limits in user-facing messages):
--   Registration: "We couldn't create your account right now. Please try again later."
--   Login:        "Too many sign-in attempts. Please wait 15 minutes before trying again."
--   Application:  "You've reached the daily application limit. Try again tomorrow."
--   Posting:      "You've reached the daily listing limit. Contact a coordinator if you need more."
-- ============================================================
