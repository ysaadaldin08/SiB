-- =============================================================
-- SiB (Students in Business) — Complete Schema Migration
-- Target: fresh Supabase project (PostgreSQL 15+)
-- Run once from the SQL Editor; no existing tables assumed.
-- Supersedes: 001_rls_policies.sql, 002_audit_log.sql, 003_rate_limiting.sql
-- =============================================================


-- =============================================================
-- SECTION 1: UTILITY FUNCTIONS
-- =============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- =============================================================
-- SECTION 2: TABLES (dependency order)
-- =============================================================

-- 2.1 profiles ------------------------------------------------
CREATE TABLE profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT        NOT NULL UNIQUE,
  role       TEXT        NOT NULL CHECK (role IN ('student', 'employer', 'coordinator')),
  full_name  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2 students ------------------------------------------------
CREATE TABLE students (
  id             UUID        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  school         TEXT,
  grade          TEXT,
  is_minor       BOOLEAN     NOT NULL DEFAULT false,
  account_status TEXT        NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'pending_parental_consent', 'suspended')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.3 employers -----------------------------------------------
CREATE TABLE employers (
  id                          UUID        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  company_name                TEXT        NOT NULL,
  contact_name                TEXT,
  phone                       TEXT,
  website                     TEXT,
  domain_verified             BOOLEAN     NOT NULL DEFAULT false,
  coordinator_approved        BOOLEAN     NOT NULL DEFAULT false,
  verification_status         TEXT        NOT NULL DEFAULT 'pending_verification'
    CHECK (verification_status IN ('pending_verification', 'verified', 'rejected')),
  ontario_business_reg        TEXT,
  obligations_acknowledged_at TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4 postings ------------------------------------------------
CREATE TABLE postings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id      UUID        NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  track            TEXT,
  work_mode        TEXT                 DEFAULT 'On-site',
  hours_per_week   INTEGER              DEFAULT 20,
  location         TEXT                 DEFAULT 'Ottawa',
  start_date       DATE,
  deadline         DATE,
  description      TEXT,
  responsibilities TEXT,
  requirements     TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.5 applications --------------------------------------------
CREATE TABLE applications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id UUID        NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
  student_id UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  cover_note TEXT,
  resume_url TEXT,
  status     TEXT        NOT NULL DEFAULT 'Applied'
    CHECK (status IN ('Applied', 'Under Review', 'Interview', 'Rejected', 'Accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (posting_id, student_id)
);

-- 2.6 notifications -------------------------------------------
CREATE TABLE notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  payload    JSONB       NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.7 message_threads -----------------------------------------
CREATE TABLE message_threads (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID        NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  employer_id       UUID        NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  listing_id        UUID        REFERENCES postings(id)      ON DELETE SET NULL,
  application_id    UUID        REFERENCES applications(id)  ON DELETE SET NULL,
  participant_names JSONB       NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'flagged')),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  coordinator_note  TEXT,
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.8 messages ------------------------------------------------
CREATE TABLE messages (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id               UUID        NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id               UUID        NOT NULL REFERENCES profiles(id)        ON DELETE CASCADE,
  sender_role             TEXT        NOT NULL
    CHECK (sender_role IN ('student', 'employer', 'coordinator')),
  body                    TEXT        NOT NULL,
  flagged                 BOOLEAN     NOT NULL DEFAULT false,
  flag_reasons            JSONB       NOT NULL DEFAULT '[]',
  reviewed_by_coordinator BOOLEAN     NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.9 audit_logs ----------------------------------------------
CREATE TABLE audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role  TEXT,
  action_type TEXT        NOT NULL,
  target_id   TEXT,
  ip_address  TEXT,
  metadata    JSONB       NOT NULL DEFAULT '{}'
);

-- 2.10 age_verification_consents ------------------------------
CREATE TABLE age_verification_consents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_email TEXT        NOT NULL,
  consent_token  TEXT        NOT NULL UNIQUE,
  confirmed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.11 rate_limit_log -----------------------------------------
CREATE TABLE rate_limit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================
-- SECTION 3: HELPER FUNCTIONS (defined after tables they query)
-- =============================================================

-- is_coordinator() is SECURITY DEFINER so it runs as the function
-- owner (postgres) and bypasses RLS on profiles — prevents recursion.
CREATE OR REPLACE FUNCTION is_coordinator()
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'coordinator'
  );
$$;


-- =============================================================
-- SECTION 4: AUTH TRIGGER — auto-insert profile on signup
-- =============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'student')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- =============================================================
-- SECTION 5: INDEXES
-- =============================================================

-- postings
CREATE INDEX idx_postings_employer_id  ON postings(employer_id);
CREATE INDEX idx_postings_is_active    ON postings(is_active);

-- applications
CREATE INDEX idx_applications_posting_id ON applications(posting_id);
CREATE INDEX idx_applications_student_id ON applications(student_id);

-- notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read_at ON notifications(read_at);

-- messages
CREATE INDEX idx_messages_thread_id ON messages(thread_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_flagged    ON messages(flagged);

-- message_threads
CREATE INDEX idx_message_threads_student_id  ON message_threads(student_id);
CREATE INDEX idx_message_threads_employer_id ON message_threads(employer_id);
CREATE INDEX idx_message_threads_status      ON message_threads(status);

-- audit_logs
CREATE INDEX idx_audit_logs_actor_id    ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_timestamp   ON audit_logs(timestamp DESC);

-- rate_limit_log
CREATE INDEX idx_rate_limit_log_user_id    ON rate_limit_log(user_id);
CREATE INDEX idx_rate_limit_log_action     ON rate_limit_log(action);
CREATE INDEX idx_rate_limit_log_created_at ON rate_limit_log(created_at);


-- =============================================================
-- SECTION 6: UPDATED_AT TRIGGERS
-- =============================================================

CREATE TRIGGER trg_postings_updated_at
  BEFORE UPDATE ON postings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================
-- SECTION 7: ROW LEVEL SECURITY — enable on every table
-- =============================================================

ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE students                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE employers                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE postings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_threads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE age_verification_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_log            ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- SECTION 8: RLS POLICIES
-- =============================================================

-- -------------------------------------------------------------
-- profiles
-- -------------------------------------------------------------

CREATE POLICY "profiles: own select"
  ON profiles FOR SELECT
  USING (auth.uid() = id OR is_coordinator());

CREATE POLICY "profiles: own update"
  ON profiles FOR UPDATE
  USING  (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- -------------------------------------------------------------
-- students
-- -------------------------------------------------------------

CREATE POLICY "students: own select"
  ON students FOR SELECT
  USING (auth.uid() = id OR is_coordinator());

CREATE POLICY "students: own update"
  ON students FOR UPDATE
  USING  (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- -------------------------------------------------------------
-- employers
-- -------------------------------------------------------------

CREATE POLICY "employers: own or coordinator select"
  ON employers FOR SELECT
  USING (auth.uid() = id OR is_coordinator());

CREATE POLICY "employers: own update"
  ON employers FOR UPDATE
  USING  (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "employers: coordinator update"
  ON employers FOR UPDATE
  USING  (is_coordinator())
  WITH CHECK (is_coordinator());


-- -------------------------------------------------------------
-- postings
-- -------------------------------------------------------------

-- Any authenticated user sees active postings (public job board)
CREATE POLICY "postings: authenticated select active"
  ON postings FOR SELECT
  USING (is_active = true AND auth.uid() IS NOT NULL);

-- Employer sees their own postings (including inactive, for management)
CREATE POLICY "postings: employer select own"
  ON postings FOR SELECT
  USING (employer_id = auth.uid());

-- Coordinator sees all postings
CREATE POLICY "postings: coordinator select all"
  ON postings FOR SELECT
  USING (is_coordinator());

-- Employer may insert only if domain-verified or coordinator-approved
CREATE POLICY "postings: employer insert"
  ON postings FOR INSERT
  WITH CHECK (
    employer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM employers
      WHERE id = auth.uid()
        AND (coordinator_approved = true OR domain_verified = true)
    )
  );

CREATE POLICY "postings: employer update own"
  ON postings FOR UPDATE
  USING  (employer_id = auth.uid())
  WITH CHECK (employer_id = auth.uid());

CREATE POLICY "postings: coordinator update all"
  ON postings FOR UPDATE
  USING  (is_coordinator())
  WITH CHECK (is_coordinator());

CREATE POLICY "postings: employer delete own"
  ON postings FOR DELETE
  USING (employer_id = auth.uid());

CREATE POLICY "postings: coordinator delete all"
  ON postings FOR DELETE
  USING (is_coordinator());


-- -------------------------------------------------------------
-- applications
-- -------------------------------------------------------------

CREATE POLICY "applications: student insert own"
  ON applications FOR INSERT
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (SELECT 1 FROM students WHERE id = auth.uid())
  );

CREATE POLICY "applications: student select own"
  ON applications FOR SELECT
  USING (student_id = auth.uid());

-- Employer reads applications for their own postings
CREATE POLICY "applications: employer select their postings"
  ON applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM postings
      WHERE postings.id = applications.posting_id
        AND postings.employer_id = auth.uid()
    )
  );

-- Employer updates status for their own postings' applications
CREATE POLICY "applications: employer update their postings"
  ON applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM postings
      WHERE postings.id = applications.posting_id
        AND postings.employer_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM postings
      WHERE postings.id = applications.posting_id
        AND postings.employer_id = auth.uid()
    )
  );

CREATE POLICY "applications: coordinator select all"
  ON applications FOR SELECT
  USING (is_coordinator());

CREATE POLICY "applications: coordinator update all"
  ON applications FOR UPDATE
  USING  (is_coordinator())
  WITH CHECK (is_coordinator());


-- -------------------------------------------------------------
-- notifications
-- User can read/update their own only.
-- INSERT is service_role only (Edge Functions) — no authenticated INSERT policy.
-- -------------------------------------------------------------

CREATE POLICY "notifications: own select"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notifications: own update"
  ON notifications FOR UPDATE
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- -------------------------------------------------------------
-- message_threads
-- Minor-adult communication — highest-sensitivity feature.
-- -------------------------------------------------------------

CREATE POLICY "message_threads: participant select"
  ON message_threads FOR SELECT
  USING (
    student_id  = auth.uid()
    OR employer_id = auth.uid()
    OR is_coordinator()
  );

CREATE POLICY "message_threads: authenticated insert"
  ON message_threads FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Participants update thread state (last_message_at, status on report);
-- coordinators update for review, notes, and close.
CREATE POLICY "message_threads: participant or coordinator update"
  ON message_threads FOR UPDATE
  USING (
    student_id  = auth.uid()
    OR employer_id = auth.uid()
    OR is_coordinator()
  )
  WITH CHECK (
    student_id  = auth.uid()
    OR employer_id = auth.uid()
    OR is_coordinator()
  );


-- -------------------------------------------------------------
-- messages
-- -------------------------------------------------------------

CREATE POLICY "messages: participant or coordinator select"
  ON messages FOR SELECT
  USING (
    is_coordinator()
    OR EXISTS (
      SELECT 1 FROM message_threads mt
      WHERE mt.id = messages.thread_id
        AND (mt.student_id = auth.uid() OR mt.employer_id = auth.uid())
    )
  );

-- Sender must be a participant and thread must not be closed
CREATE POLICY "messages: participant insert"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM message_threads mt
      WHERE mt.id = messages.thread_id
        AND (mt.student_id = auth.uid() OR mt.employer_id = auth.uid())
        AND mt.status != 'closed'
    )
  );

-- Coordinator may set reviewed_by_coordinator = true; body is immutable after send
CREATE POLICY "messages: coordinator update reviewed flag"
  ON messages FOR UPDATE
  USING  (is_coordinator())
  WITH CHECK (is_coordinator());


-- -------------------------------------------------------------
-- audit_logs — append-only; no UPDATE, no DELETE for any role.
-- Only service_role (bypasses RLS) may insert.
-- Coordinator may read (transparency / OCDSB oversight).
-- -------------------------------------------------------------

CREATE POLICY "audit_logs: coordinator select"
  ON audit_logs FOR SELECT
  USING (is_coordinator());

-- No INSERT policy for authenticated role.
-- No UPDATE policy for any role.
-- No DELETE policy for any role.


-- -------------------------------------------------------------
-- age_verification_consents
-- Student reads their own record; INSERT/UPDATE via service_role only.
-- -------------------------------------------------------------

CREATE POLICY "age_consent: student select own"
  ON age_verification_consents FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "age_consent: coordinator select all"
  ON age_verification_consents FOR SELECT
  USING (is_coordinator());

-- No authenticated INSERT/UPDATE policy — Edge Function (service_role) only.


-- -------------------------------------------------------------
-- rate_limit_log — service_role only.
-- No policies: RLS enabled means authenticated role has zero access.
-- Only service_role (which bypasses RLS) can read or write.
-- -------------------------------------------------------------
