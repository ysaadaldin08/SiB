-- ============================================================
-- SiB — Audit Log Table + RLS
-- Migration: 002_audit_log.sql
-- Paste into: Supabase Dashboard → SQL Editor
--
-- Legal basis: PIPEDA Principle 1 (accountability), MFIPPA s.36
-- Security basis: Pillar 1.7 — append-only audit trail
--
-- Satisfies PIPEDA accountability requirement: every sensitive action
-- involving personal information must be logged with actor and timestamp.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- When the action occurred (always UTC)
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The authenticated user who performed the action (NULL for system/anonymous)
  actor_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Role of the actor at the time of the action
  actor_role  TEXT NOT NULL CHECK (actor_role IN ('student','employer','coordinator','system','anonymous')),
  -- Type of action — use snake_case verb_noun format
  -- e.g. user_signup, coordinator_approve_employer, message_flagged, login_failed
  action_type TEXT NOT NULL,
  -- ID of the primary entity affected (posting_id, application_id, user_id, thread_id, etc.)
  target_id   TEXT,
  -- IP address of the request origin (populated by Edge Function from request headers)
  -- Stored as TEXT to support both IPv4 and IPv6.
  -- Note: IP is personal information under PIPEDA — retain only as long as necessary.
  ip_address  TEXT,
  -- Flexible JSON blob for action-specific metadata (never log passwords or full PII)
  -- Examples:
  --   login_failed:          { "email_domain": "gmail.com" }
  --   coordinator_approve:   { "employer_id": "uuid", "company": "Shopify" }
  --   message_flagged:       { "thread_id": "uuid", "reasons": ["phone_number"] }
  --   rate_limit_hit:        { "limit_type": "message", "window": "1h" }
  metadata    JSONB DEFAULT '{}'::jsonb
);

-- Indexes for coordinator dashboard queries
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx    ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_type_idx ON public.audit_logs(action_type);
CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx   ON public.audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_id_idx   ON public.audit_logs(target_id);

-- ============================================================
-- RLS — APPEND-ONLY: no role (including coordinators) may UPDATE or DELETE
-- ============================================================

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Coordinators read all audit logs (oversight role)
CREATE POLICY "audit_logs: coordinator read"
  ON public.audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- Actors can read their own log entries (transparency — PIPEDA access right)
CREATE POLICY "audit_logs: actor read own"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() = actor_id);

-- INSERT is allowed only from the audit-log Edge Function (service_role).
-- No client-side INSERT policy is created — authenticated role cannot insert.
-- The Edge Function validates the caller's JWT before inserting.

-- CRITICAL: No UPDATE policy — audit logs are append-only.
-- CRITICAL: No DELETE policy — audit logs must never be deleted.
-- If retention cleanup is needed, it MUST be done via a scheduled Edge Function
-- that retains summary entries and deletes only old IP addresses to comply with
-- PIPEDA data minimization after the retention period expires.


-- ============================================================
-- TABLE: age_verification_consents
-- Legal basis: Ontario MFIPPA; under-18 students require guardian consent
-- Pillar 2.1 — parental/guardian consent flow
-- ============================================================

CREATE TABLE IF NOT EXISTS public.age_verification_consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The student account awaiting activation
  student_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Guardian email address provided at registration
  guardian_email    TEXT NOT NULL,
  -- One-time consent token (64-char hex, generated server-side)
  consent_token     TEXT NOT NULL,
  -- Token expiry (48 hours from generation)
  expires_at        TIMESTAMPTZ NOT NULL,
  -- Whether the guardian has confirmed consent
  consented         BOOLEAN NOT NULL DEFAULT false,
  -- When consent was confirmed
  consented_at      TIMESTAMPTZ,
  -- IP address of the guardian at consent time
  guardian_ip       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS age_consents_student_idx ON public.age_verification_consents(student_id);
CREATE INDEX IF NOT EXISTS age_consents_token_idx   ON public.age_verification_consents(consent_token);

ALTER TABLE public.age_verification_consents ENABLE ROW LEVEL SECURITY;

-- Students read their own consent record (to show pending-consent banner)
CREATE POLICY "age_consents: student read own"
  ON public.age_verification_consents FOR SELECT
  USING (auth.uid() = student_id);

-- Coordinators read all (oversight)
CREATE POLICY "age_consents: coordinator read all"
  ON public.age_verification_consents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'coordinator'
    )
  );

-- INSERT and UPDATE handled by Edge Functions (service_role) only.


-- ============================================================
-- COLUMN ADDITIONS for age verification on students table
-- (Add these columns if they don't already exist)
-- ============================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS is_minor              BOOLEAN DEFAULT false,
  -- 'active' | 'pending_parental_consent' | 'suspended'
  ADD COLUMN IF NOT EXISTS account_status        TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active','pending_parental_consent','suspended')),
  ADD COLUMN IF NOT EXISTS date_of_birth         DATE,          -- optional; used only to set is_minor
  ADD COLUMN IF NOT EXISTS consent_record_id     UUID REFERENCES public.age_verification_consents(id);

-- Employer approval columns (Pillar 2.4)
ALTER TABLE public.employers
  ADD COLUMN IF NOT EXISTS coordinator_approved  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS domain_verified       BOOLEAN NOT NULL DEFAULT false,
  -- 'pending_verification' | 'verified' | 'rejected'
  ADD COLUMN IF NOT EXISTS verification_status   TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (verification_status IN ('pending_verification','verified','rejected')),
  -- Ontario Business Registry number (required for verification — Pillar 2.4)
  ADD COLUMN IF NOT EXISTS ontario_business_reg  TEXT,
  -- Employer obligations acknowledgment (Ontario Human Rights Code + OHSA)
  ADD COLUMN IF NOT EXISTS obligations_acknowledged_at TIMESTAMPTZ;
