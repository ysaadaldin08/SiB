-- Phase 2: Server-side migration of localStorage entities
-- Run once in Supabase SQL editor (Dashboard → SQL Editor → New query).
-- All statements use IF NOT EXISTS / IF NOT EXISTS so re-running is safe.

-- ── 2.1 Notifications ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text        NOT NULL,
  type       text        NOT NULL,
  payload    jsonb       NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

-- ── 2.3 Coordinator-approval flag on employers ────────────────────────────────
ALTER TABLE public.employers
  ADD COLUMN IF NOT EXISTS coordinator_approved boolean NOT NULL DEFAULT false;

-- ── 2.4 Message threads ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_threads (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        text        NOT NULL,
  employer_id       text        NOT NULL,
  listing_id        uuid        REFERENCES public.postings(id) ON DELETE SET NULL,
  application_id    uuid        REFERENCES public.applications(id) ON DELETE SET NULL,
  created_by        text,
  status            text        NOT NULL DEFAULT 'open',
  reviewed_at       timestamptz,
  reviewed_by       text,
  coordinator_note  text,
  participant_names jsonb       NOT NULL DEFAULT '{}',
  last_message_at   timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_threads_student     ON public.message_threads (student_id);
CREATE INDEX IF NOT EXISTS idx_threads_employer    ON public.message_threads (employer_id);
CREATE INDEX IF NOT EXISTS idx_threads_application ON public.message_threads (application_id);

-- ── 2.5 Messages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id               uuid        NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  sender_id               text        NOT NULL,
  sender_role             text        NOT NULL,
  body                    text        NOT NULL,
  flagged                 boolean     NOT NULL DEFAULT false,
  flag_reasons            jsonb       NOT NULL DEFAULT '[]',
  reviewed_by_coordinator boolean     NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON public.messages (thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages (sender_id, created_at DESC);
