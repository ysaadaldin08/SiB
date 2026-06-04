-- =============================================================
-- SiB — Path A: RPCs + cross-user notification triggers
-- Migration: 20260603020000_pathA_rpcs_triggers.sql
-- Run AFTER 20260603010000_pathA_onboarding.sql.
--
-- WHY THIS EXISTS
--   In Path A the browser only inserts notifications addressed to ITSELF
--   (notifications_insert_self_only). Anything that must notify ANOTHER user
--   (employer told of a new applicant, student told of a status change, a
--   coordinator told of a flag/placement) is generated inside the database by
--   SECURITY DEFINER triggers/RPCs, so no client can forge a notification to
--   someone else. This migration also adds claim_role() for the OAuth/no-role
--   onboarding moment.
--
-- Idempotent: CREATE OR REPLACE everywhere, DROP TRIGGER/POLICY IF EXISTS.
-- =============================================================


-- =============================================================
-- SECTION 0 — allow a definer RPC to bypass the column locks
-- A definer function signals "I authorized this privileged change" by setting a
-- transaction-local GUC; the lock guard honours it. (Used by claim_role to flip
-- profiles.role for OAuth users.)
-- =============================================================

CREATE OR REPLACE FUNCTION public.is_privileged_caller()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (auth.uid() IS NULL)
      OR COALESCE(current_setting('sib.privileged', true) = 'on', false)
      OR public.is_coordinator();
$$;


-- =============================================================
-- SECTION 1 — internal notification writers (definer; NOT client-callable)
-- =============================================================

CREATE OR REPLACE FUNCTION public._notify(p_user_id uuid, p_type text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (p_user_id, p_type, COALESCE(p_payload, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public._notify_coordinators(p_type text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM public.profiles WHERE role = 'coordinator' LOOP
    INSERT INTO public.notifications (user_id, type, payload)
    VALUES (c.id, p_type, COALESCE(p_payload, '{}'::jsonb));
  END LOOP;
END;
$$;

-- These helpers bypass the self-only INSERT rule, so clients must NEVER call them.
REVOKE ALL ON FUNCTION public._notify(uuid, text, jsonb)        FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_coordinators(text, jsonb) FROM public, anon, authenticated;


-- =============================================================
-- SECTION 2 — application notifications
-- =============================================================

-- New application -> notify the employer + confirm to the student.
CREATE OR REPLACE FUNCTION public.tg_application_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title text; v_company text; v_employer uuid; v_student text;
BEGIN
  SELECT p.title, p.company_name, p.employer_id
    INTO v_title, v_company, v_employer
  FROM public.postings p WHERE p.id = NEW.posting_id;

  SELECT COALESCE(pr.full_name, 'A student') INTO v_student
  FROM public.profiles pr WHERE pr.id = NEW.student_id;

  PERFORM public._notify(v_employer, 'newApplication',
    jsonb_build_object('studentName', v_student, 'postingTitle', v_title, 'postingId', NEW.posting_id));

  PERFORM public._notify(NEW.student_id, 'applicationSubmitted',
    jsonb_build_object('postingTitle', v_title, 'companyName', v_company));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_inserted ON public.applications;
CREATE TRIGGER trg_application_inserted
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_application_inserted();

-- Status change -> notify the student; on Accepted also notify all coordinators.
CREATE OR REPLACE FUNCTION public.tg_application_status_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title text; v_company text; v_school text; v_student text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT p.title, p.company_name INTO v_title, v_company
  FROM public.postings p WHERE p.id = NEW.posting_id;
  SELECT COALESCE(pr.full_name, 'there') INTO v_student
  FROM public.profiles pr WHERE pr.id = NEW.student_id;
  SELECT s.school INTO v_school FROM public.students s WHERE s.id = NEW.student_id;

  PERFORM public._notify(NEW.student_id, 'applicationStatus',
    jsonb_build_object('status', NEW.status, 'postingTitle', v_title,
                       'companyName', v_company, 'firstName', split_part(v_student, ' ', 1)));

  IF NEW.status = 'Accepted' THEN
    PERFORM public._notify_coordinators('newPlacement',
      jsonb_build_object('studentName', v_student, 'school', v_school, 'postingTitle', v_title,
                         'companyName', v_company, 'postingId', NEW.posting_id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_status_changed ON public.applications;
CREATE TRIGGER trg_application_status_changed
  AFTER UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_application_status_changed();


-- =============================================================
-- SECTION 3 — message notifications + thread bookkeeping
-- One trigger keeps last_message_at fresh, flips the thread to 'flagged' when a
-- flagged message lands, notifies the other participant, and notifies all
-- coordinators on a flag. (last_message_at/status are NOT locked columns, so the
-- participant-context update passes the thread column-lock.)
-- =============================================================

CREATE OR REPLACE FUNCTION public.tg_message_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_thread record; v_recipient uuid; v_sender text; v_preview text;
BEGIN
  SELECT * INTO v_thread FROM public.message_threads WHERE id = NEW.thread_id;

  UPDATE public.message_threads
     SET last_message_at = now(),
         status = CASE WHEN NEW.flagged THEN 'flagged' ELSE status END
   WHERE id = NEW.thread_id;

  v_preview := left(NEW.body, 80);
  v_recipient := CASE WHEN NEW.sender_id = v_thread.student_id
                      THEN v_thread.employer_id ELSE v_thread.student_id END;

  SELECT COALESCE(pr.full_name, 'your co-op contact') INTO v_sender
  FROM public.profiles pr WHERE pr.id = NEW.sender_id;

  PERFORM public._notify(v_recipient, 'newMessage',
    jsonb_build_object('preview', v_preview, 'senderName', v_sender,
                       'senderRole', NEW.sender_role, 'threadId', NEW.thread_id));

  IF NEW.flagged THEN
    PERFORM public._notify_coordinators('messageFlagged',
      jsonb_build_object('threadId', NEW.thread_id, 'reasons', to_jsonb(NEW.flag_reasons),
                         'messagePreview', v_preview, 'senderRole', NEW.sender_role, 'senderName', v_sender));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_inserted ON public.messages;
CREATE TRIGGER trg_message_inserted
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_message_inserted();


-- =============================================================
-- SECTION 4 — employer approval notification
-- =============================================================

CREATE OR REPLACE FUNCTION public.tg_employer_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.coordinator_approved = true AND COALESCE(OLD.coordinator_approved, false) = false THEN
    PERFORM public._notify(NEW.id, 'employerApproved',
      jsonb_build_object('companyName', NEW.company_name));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employer_approved ON public.employers;
CREATE TRIGGER trg_employer_approved
  AFTER UPDATE OF coordinator_approved ON public.employers
  FOR EACH ROW EXECUTE FUNCTION public.tg_employer_approved();


-- =============================================================
-- SECTION 5 — claim_role(): OAuth / no-role onboarding moment
-- The auth-callback role picker calls this once. It sets the user's role and
-- creates the matching domain row. Guards: must be signed in; student/employer
-- only; coordinator is never reachable here; idempotent once onboarded.
-- =============================================================

CREATE OR REPLACE FUNCTION public.claim_role(p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_full text; v_current text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_role NOT IN ('student', 'employer') THEN RAISE EXCEPTION 'Role must be student or employer'; END IF;

  SELECT role, full_name INTO v_current, v_full FROM public.profiles WHERE id = v_uid;
  IF v_current = 'coordinator' THEN RAISE EXCEPTION 'Coordinator role cannot be changed here'; END IF;

  -- Already onboarded into a domain? Do nothing (idempotent; no role flip-flop).
  IF EXISTS (SELECT 1 FROM public.students  WHERE id = v_uid)
     OR EXISTS (SELECT 1 FROM public.employers WHERE id = v_uid) THEN
    RETURN;
  END IF;

  -- Authorize the profiles.role change past the column lock for this txn only.
  PERFORM set_config('sib.privileged', 'on', true);
  UPDATE public.profiles SET role = p_role WHERE id = v_uid;

  IF p_role = 'employer' THEN
    INSERT INTO public.employers (id, company_name, contact_name)
    VALUES (v_uid, '', v_full) ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.students (id) VALUES (v_uid) ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_role(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_role(text) TO authenticated;


-- =============================================================
-- SECTION 6 — notify_coordinators(): client-callable, whitelisted
-- Used by signup (non-board student / unknown employer), the "report a concern"
-- modal, and a user-initiated thread report. The type is whitelisted and the
-- payload is opaque text, so the worst case is a low-value informational notice.
-- =============================================================

CREATE OR REPLACE FUNCTION public.notify_coordinators(p_type text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_type NOT IN ('newUserReview', 'employerPendingApproval', 'concernReport', 'messageFlagged') THEN
    RAISE EXCEPTION 'Unsupported coordinator notification type: %', p_type;
  END IF;
  PERFORM public._notify_coordinators(p_type, COALESCE(p_payload, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.notify_coordinators(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.notify_coordinators(text, jsonb) TO anon, authenticated;

-- =============================================================
-- END
-- =============================================================
