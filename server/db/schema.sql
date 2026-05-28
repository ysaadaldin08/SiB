-- ⚠️  LEGACY FILE — DO NOT USE FOR NEW DEPLOYMENTS
-- This file is superseded by:
--   supabase/migrations/20260526000000_initial_schema.sql
-- Running this file on a fresh project will produce an incomplete,
-- insecure schema missing RLS, audit_logs, age_verification_consents,
-- and rate_limit_log tables.
-- This file is kept for historical reference only and will be deleted in Phase 8.

-- SiB Database Schema
-- Run this in the Supabase SQL editor to set up all tables.

-- ── STUDENTS ──────────────────────────────────────────────────────────────────
create table if not exists public.students (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  school      text,
  grade       int,
  program     text,
  bio         text,
  skills      text[] default '{}',
  created_at  timestamptz default now()
);

-- ── EMPLOYERS ─────────────────────────────────────────────────────────────────
create table if not exists public.employers (
  id            uuid primary key references auth.users(id) on delete cascade,
  company_name  text not null default '',
  contact_name  text,
  email         text not null,
  industry      text,
  website       text,
  description   text,
  created_at    timestamptz default now()
);

-- ── POSTINGS ──────────────────────────────────────────────────────────────────
create table if not exists public.postings (
  id              uuid primary key default gen_random_uuid(),
  employer_id     uuid not null references public.employers(id) on delete cascade,
  title           text not null,
  description     text,
  responsibilities text,
  requirements    text,
  track           text,
  work_mode       text default 'On-site',
  hours_per_week  int default 20,
  location        text default 'Ottawa',
  start_date      text,
  deadline        text,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz
);

-- ── APPLICATIONS ──────────────────────────────────────────────────────────────
create table if not exists public.applications (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  posting_id  uuid not null references public.postings(id) on delete cascade,
  status      text default 'Applied',
  cover_note  text,
  resume_url  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz,
  unique (student_id, posting_id)
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────────
-- The Express server uses the service role key, which bypasses RLS entirely.
-- RLS is enabled as a safety net for any direct client access.

alter table public.students     enable row level security;
alter table public.employers    enable row level security;
alter table public.postings     enable row level security;
alter table public.applications enable row level security;

-- Service-role key bypasses these policies automatically.
-- Grant read access to postings/employers for anonymous browsing:
create policy "public can view active postings"
  on public.postings for select using (is_active = true);

create policy "public can view employers"
  on public.employers for select using (true);
