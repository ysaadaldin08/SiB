# SiB Security, Legal Compliance & Operational Resilience Audit

**Platform:** Students in Business (SiB) — Ottawa co-op placement platform  
**Audit date:** 2026-05-25  
**Status:** In-progress hardening pass — Phase 8 items listed under DEFERRED

---

## Quick Reference — Severity Legend

| Label | Meaning |
|-------|---------|
| **CRITICAL** | Must be resolved before any public access or school board submission |
| **HIGH** | Must be resolved before launch; significant legal or security exposure |
| **MEDIUM** | Should be resolved in Phase 8; reduces risk meaningfully |
| **LOW** | Best-practice hardening; low immediate risk |
| **DEFERRED** | Acknowledged, not actionable in current architecture; flagged for Phase 8 |

---

## PART 1 — PRE-AUDIT FINDINGS (PAF)

### PAF-1 — Hardcoded Coordinator Password — CRITICAL

**Status:** Comments added; password NOT removed (see constraint below)  
**File:** `server/routes/dev.js:13` — `COORD_PASSWORD = '***REMOVED***'`  
**Also documented in:** `CLAUDE.md` (documentation only, not runtime code)  
**Also present in:** Git history (see Git History Remediation section below)

**What was done in this audit:**
- Added `// CRITICAL: HARDCODED CREDENTIAL — see PAF-1 in SECURITY.md` comment at `server/routes/dev.js:13`
- Added `// TODO: SECURITY PAF-3` comment referencing migration plan

**What MUST be done before any push to GitHub or school board submission:**
1. Rotate the coordinator password in Supabase Dashboard → Authentication → Users → find coordinator account → Reset password
2. Run BFG Repo Cleaner to purge the password from Git history (see Git History Remediation section)
3. Complete Phase 8 coordinator invite flow (see DEFERRED: Coordinator Auth Migration)

**Why this is CRITICAL:**
- The password is in Git history and will persist even after file deletion
- `server/routes/dev.js` sets this password on the real Supabase Auth user each time the dev/seed endpoint is called
- If the GitHub repository is ever made public, this is an immediate account takeover risk for the coordinator account

---

### PAF-2 — Supabase Key Verification — CRITICAL (Action Required)

**Status:** Verification comment added to `config.js`  
**File:** `config.js:12` — `SUPABASE_KEY = 'sb_publishable_r01EPV8S5X-7dGEIim4Aag_lTdoKwI5'`

**ACTION REQUIRED before production:**
1. Log in to https://supabase.com/dashboard
2. Select your project → Settings → API
3. Confirm the key in `config.js` matches **"anon public"** — NOT "service_role"
4. Service role keys start with `eyJ` (JWT base64). If this key ever starts with `eyJ`, treat it as a CRITICAL security incident and rotate immediately.

**Checklist item:** Verify config.js key matches Supabase anon key (not service_role). If any doubt exists, rotate the key immediately in the Supabase dashboard — rotation is free and instant.

**Scan for service_role exposure:**
No `eyJ`-prefixed keys were found in any frontend file during this audit. If you add any new JS file, search it:
```
grep -r "eyJ" --include="*.js" --include="*.html" .
```
If found in any file outside `server/` or `supabase/functions/`, treat as **CRITICAL — SERVICE ROLE KEY EXPOSURE**.

---

### PAF-3 — Coordinator Auth Migration — DEFERRED — HIGH PRIORITY

**Status:** TODO comments added to `coordinator-login.html`, `auth.js`  
**Current state:** Coordinator login uses the Node.js API server (`/api/auth/login`) which calls Supabase Auth with the seeded password. This works on localhost but fails silently on GitHub Pages (API_BASE resolves to a non-existent endpoint).

**What coordinator login currently does:**
1. `coordinator-login.html` → `fetch(API_BASE + '/auth/login', ...)` → Node.js server → `supabase.auth.signInWithPassword()`
2. Returns a real Supabase JWT if successful
3. Sets `sib_token` in localStorage with the JWT

**Why this is not yet production-safe:**
- Depends on a Node.js server that GitHub Pages cannot serve
- Coordinator password is hardcoded (see PAF-1)
- No invite-only flow — anyone who knows the password can log in

**Migration plan for Phase 8:**
1. Create coordinator accounts in Supabase Auth via the dashboard (manual or invite-only endpoint)
2. Deploy a Supabase Edge Function `/functions/v1/coordinator-auth` that:
   - Accepts email + password
   - Calls `supabase.auth.signInWithPassword()` using service_role
   - Verifies `profiles.role = 'coordinator'` before returning a JWT
   - Enforces login rate limiting (max 5 attempts per 15 min — see Pillar 1.5)
3. Update `coordinator-login.html` to call the Edge Function instead of `API_BASE`
4. Remove `COORD_PASSWORD` from `server/routes/dev.js`
5. Remove the `sib_coordinators[]` localStorage fallback entirely
6. Enforce coordinator RLS policies (see `supabase/migrations/001_rls_policies.sql`)

**Unblocking condition:** Phase 8 backend milestone

---

### PAF-4 — Debug Functions sibDump / sibVerifyUser — RESOLVED

**Status:** Both functions were removed in the Phase 7 production hardening pass (commit `1a06ea3`). No action required.

**Verification:**
```
grep -r "sibDump\|sibVerifyUser" --include="*.js" --include="*.html" .
# Expected: no matches in app.js, data.js, or any HTML file
```

---

### PAF-5 — API_BASE Points to Non-Existent Server on GitHub Pages — DEFERRED — HIGH PRIORITY

**Status:** Explanatory comments added to `config.js` and `data.js`  
**Impact:** Every API call (auth, postings, applications, notifications, messaging, coordinator) fails silently in production on GitHub Pages.

**Files containing API_BASE fetch calls (must be migrated to Supabase Edge Functions):**

| File | Call sites |
|------|-----------|
| `data.js` | All via `_get()`, `_post()`, `_put()`, `_del()` helpers |
| `auth.js` | `/auth/login`, `/auth/register`, `/auth/logout` |
| `coordinator-login.html` | `/auth/login` |

**Migration plan for Phase 8:**
- Replace the Node.js Express server (`server/`) with Supabase Edge Functions
- Priority order: auth → postings → applications → messaging → coordinator
- Each Edge Function call replaces a `fetch(API_BASE + '/...')` with `fetch(SUPABASE_URL + '/functions/v1/...')`
- The audit-log Edge Function (`supabase/functions/audit-log/index.ts`) is the model pattern

**Unblocking condition:** Phase 8 Edge Function milestone

---

## PART 2 — PILLAR 1: CYBERSECURITY HARDENING

### 1.1 — Secrets & Environment Variables

**Status:** Review complete

| Finding | Severity | Status |
|---------|---------|--------|
| `***REMOVED***` in `server/routes/dev.js` | CRITICAL | PAF-1 — commented, rotation required |
| `SUPABASE_KEY` in `config.js` | Review required | PAF-2 — verification comment added |
| No `eyJ` service role key found in frontend files | — | PASS |
| No `.env` file found in repository root | — | PASS |
| Root `.gitignore` created to block `.env` files | — | DONE |

**Git history audit instructions:** See "Git History Remediation" section below.

---

### 1.2 — Supabase Row Level Security (RLS)

**Status:** SQL migration files created — NOT YET APPLIED

**Files created:**
- `supabase/migrations/001_rls_policies.sql` — RLS policies for all tables
- `supabase/migrations/002_audit_log.sql` — Audit log table + age verification columns

**Policy summary:**

| Table | anon | student | employer | coordinator |
|-------|------|---------|----------|------------|
| profiles | ❌ | own row | own row | ALL |
| students | ❌ | own row | accepted-placement rows only | ALL |
| employers | ❌ | posting-applied rows | own row | ALL |
| postings | ❌ | active listings | own listings | ALL |
| applications | ❌ | own | own posting's | ALL |
| notifications | ❌ | own | own | ALL |
| message_threads | ❌ | participant | participant | ALL |
| messages | ❌ | participant | participant | ALL |
| audit_logs | ❌ | own actor_id | own actor_id | ALL |

**ACTION REQUIRED:** Paste each migration file into Supabase SQL Editor and execute. Verify the anon-role check query at the bottom of `001_rls_policies.sql` returns 0 rows.

---

### 1.3 — Authentication Security

**Status:** Partial — full implementation requires Phase 8 Edge Functions

**Completed in this audit:**
- XSS fix in `auth.js:314` — `currentUser.name` was rendered unescaped in nav; fixed with `_htmlEsc(currentUser.name)`

**Remaining items:**

| Item | Severity | Notes |
|------|---------|-------|
| Email verification server-side enforcement | HIGH | Supabase Dashboard → Auth → Email Confirmations → Enable. Currently client-side only. |
| Login rate limiting | HIGH | Supabase Dashboard → Auth → Rate Limits → configure (5 attempts / 15 min). Also see `003_rate_limiting.sql`. |
| `sib_token` in localStorage | MEDIUM | Acknowledged; httpOnly cookies require a server session layer not available on GitHub Pages. Document in Privacy Policy. |
| Coordinator password rotation | CRITICAL | See PAF-1 |

**Supabase Auth rate limit configuration:**
1. Dashboard → Project → Authentication → Settings
2. Set "Max login attempts before lockout" to 5
3. Set "Lockout duration" to 900 seconds (15 minutes)

---

### 1.4 — Input Validation & XSS Prevention

**Status:** Partial — critical XSS fixes applied

**Fixes applied in this audit:**

| Location | Issue | Fix |
|----------|-------|-----|
| `auth.js:314` `updateNavForAuth()` | `currentUser.name` rendered unescaped in `innerHTML` | Wrapped with `_htmlEsc()` |
| `app.js` `renderStudents()` | `s.name`, `s.school`, `s.grade`, `s.skills`, `s.availability` unescaped | All wrapped with `_htmlEsc()` |
| `app.js` `openSProfile()` | Same fields unescaped in modal innerHTML | All wrapped with `_htmlEsc()` |

**Already correctly escaped (confirmed in this audit):**
- `messaging.js` — all user content (`m.body`, `otherName`, `preview`, `listing`) already use `_htmlEsc()`
- `notifications.js:235` — `_htmlEsc(label)` already applied to notification labels

**Remaining TODO — input length limits:**

The following length limits should be added server-side (in Edge Functions) when PAF-5 is resolved. For now, add `maxlength` attributes to HTML form fields as client-side defence-in-depth:

| Field | Recommended limit |
|-------|-----------------|
| Name fields | 100 characters |
| Email | 254 characters (RFC 5321) |
| Message body | 2000 characters |
| Cover note | 2000 characters |
| Resume URL | 500 characters |
| Job description | 10000 characters |
| Company bio | 5000 characters |

**File upload policy (resumes):**
- Current client-side validation: PDF only, 2MB limit (`app.js:66`)
- Server-side: enforce in Supabase Storage bucket policies (allow only `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
- Storage path must not include user-controlled values that could cause path traversal

---

### 1.5 — Rate Limiting

**Status:** Partial implementation — database functions created

**Existing rate limits (preserved, not modified):**
- Messages: 20/hour, 5 new threads/day (enforced server-side in Node.js API)
- Email verification resend: 1 per 60 seconds (enforced client-side in `auth.js`)

**New rate limit database functions created:**
- `supabase/migrations/003_rate_limiting.sql` — `check_rate_limit()` and `record_rate_limit_event()` functions

**Rate limits to enforce in Edge Functions (Phase 8):**

| Action | Limit | Window | Subject |
|--------|-------|--------|---------|
| Account registration | 3 | 1 hour | IP address |
| Login attempts | 5 | 15 min | IP + email hash |
| Application submit | 5 | 1 day | user UUID |
| Job posting create | 10 | 1 day | employer UUID |

**User-facing error messages (must not expose internal limits):**
- Registration: "We couldn't create your account right now. Please try again later."
- Login: "Too many sign-in attempts. Please wait 15 minutes before trying again."
- Application: "You've reached the daily application limit. Try again tomorrow."
- Posting: "You've reached the daily listing limit. Contact a coordinator if you need more."

---

### 1.6 — Content Security Policy & Transport Security

**Status:** DONE — CSP meta tags added to all 15 HTML pages

**Pages updated:** index.html, coordinator-login.html, coordinator-dashboard.html, job-listings.html, posting.html, dashboard-student.html, dashboard-employer.html, applicants.html, student-apply.html, employer-register.html, privacy.html, terms.html, resources.html, auth-callback.html

**CSP policy applied:**
```
default-src 'self';
script-src 'self' 'unsafe-inline' https://unpkg.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
img-src 'self' https://placehold.co https://mhauftulhvnguualcfw.supabase.co data: blob:;
connect-src 'self' https://mhauftulhvnguualcfw.supabase.co http://localhost:3001;
frame-ancestors 'none';
object-src 'none';
base-uri 'self';
```

**Known limitation — `'unsafe-inline'` in script-src:**  
The current architecture uses inline `<script>` blocks and `onclick=` attributes throughout all HTML files. Removing `'unsafe-inline'` would require migrating all inline event handlers to external `.js` files with `addEventListener()`. This is scheduled for Phase 8 when a build pipeline is introduced.

Despite `'unsafe-inline'`, the CSP still provides meaningful protection:
- `connect-src` prevents data exfiltration to unlisted hosts
- `frame-ancestors 'none'` prevents clickjacking (replaces X-Frame-Options)
- `object-src 'none'` blocks Flash/plugin attacks
- `base-uri 'self'` prevents base-URL hijacking

**Additional security headers added to all pages:**
- `X-Content-Type-Options: nosniff` — prevents MIME-sniffing attacks
- `Referrer-Policy: strict-origin-when-cross-origin` — limits Referer header leakage

**TODO Phase 8:** Migrate to nonce-based CSP once inline scripts are extracted.

**HTTP vs HTTPS:** All API calls in `config.js` use HTTPS in production (`https://mhauftulhvnguualcfw.supabase.co`). The `http://localhost:3001` in `connect-src` is intentional for local development only.

---

### 1.7 — Observability & Audit Logging

**Status:** Infrastructure created — NOT YET DEPLOYED

**Files created:**
- `supabase/migrations/002_audit_log.sql` — audit_logs table with append-only RLS
- `supabase/functions/audit-log/index.ts` — Edge Function (validate JWT + insert)

**Table design:**
```sql
audit_logs (
  id UUID, timestamp TIMESTAMPTZ, actor_id UUID,
  actor_role TEXT, action_type TEXT, target_id TEXT,
  ip_address TEXT, metadata JSONB
)
```

**Append-only enforcement:** No UPDATE or DELETE policy exists on `audit_logs` for any role. Only the Edge Function (running as service_role) can insert.

**Actions that MUST be logged (implement when Edge Functions are deployed):**
- Coordinator approving/rejecting an employer
- Any account creation or deletion
- Any message flagged by the system
- Any failed login attempt (without logging the attempted password)
- Rate limit hits on sensitive endpoints
- Coordinator reviewing/closing a thread
- Parental consent sent/confirmed

**Legal basis:** PIPEDA Principle 1 (accountability) — organizations must be accountable for personal information under their control.

---

### 1.8 — Database Backup

**Status:** Backup Edge Function created — NOT YET DEPLOYED

**File created:** `supabase/functions/daily-export/index.ts`

**Schedule:** Run at `0 3 * * *` (3:00 AM UTC daily) via Supabase Edge Function scheduler.

**CRITICAL RISK ITEM — Point-in-Time Recovery:**
Supabase Point-in-Time Recovery (PITR) is only available on the **Pro plan** (CA$28/mo). If the project is currently on the Free plan, PITR is unavailable and the nightly export Edge Function is the ONLY backup mechanism.

**Before school board IT submission:** Confirm the Supabase plan tier with IT. If on Free, document the backup gap and upgrade plan.

**Retention:** 30 days. Backup files older than 30 days are automatically deleted by the Edge Function. After retention, actual database rows are preserved; only the export snapshots are purged (PIPEDA data minimization for IP addresses in audit_logs).

---

## PART 3 — PILLAR 2: LEGAL COMPLIANCE

### 2.1 — Age Verification & Minor Protection — DEFERRED — HIGH PRIORITY

**Status:** Database schema created in `002_audit_log.sql`; UI flow not yet implemented

**What was added to the database:**
- `students.is_minor BOOLEAN` — flag set at registration
- `students.account_status` — `active | pending_parental_consent | suspended`
- `age_verification_consents` table — guardian email, consent token, confirmation timestamp

**What needs to be built in Phase 8:**
1. Add birth year field to student signup form (year only, not full DOB — PIPEDA data minimization)
2. If `year < 18`, set `account_status = 'pending_parental_consent'`
3. Generate 64-char hex consent token and email to guardian address
4. Create `index.html#consent?token=<token>` handler that confirms consent
5. Gate all dashboard access, job browsing, and application submission on `account_status = 'active'`
6. Minor flag (`is_minor`) gates employer visibility — employers cannot see or contact a minor student until coordinator-approved placement acceptance

**Legal basis:** MFIPPA applies because of the school board partnership. Ontario law requires parental consent for minors engaging in contracts. The Ontario Human Rights Code prohibits age-based discrimination but does not override minor-protective data practices.

---

### 2.2 — Data Minimization & Purpose Limitation

**Status:** Review complete — no SIN found

**Scan result:** No Social Insurance Number (SIN) field found in any form, database schema, or data model. If added in the future, SIN must NEVER be collected on this platform.

**Fields audited for necessity:**

| Field | Necessary? | Legal basis | Notes |
|-------|-----------|-------------|-------|
| student full name | Yes | PIPEDA — co-op matching | |
| student email | Yes | PIPEDA — account + notifications | |
| student school + grade | Yes | PIPEDA — co-op eligibility | |
| student phone (optional) | Borderline | Not used by platform | TODO: remove or make optional |
| student bio + skills | Yes | PIPEDA — employer matching | |
| employer Ontario Business Reg | Yes (Phase 8) | Pillar 2.4 — verification | Not yet collected |
| employer physical address | Needed | OHSA — workplace safety | Confirm collected at registration |
| message IP addresses | Minimal | Audit trail only | Purge after 30 days per PIPEDA |

**Purpose labels:** Add `// COLLECTED FOR: ... | LEGAL BASIS: ... | RETENTION: ... | SHARED WITH: ...` comments to database column definitions in migration files. The `002_audit_log.sql` file includes this pattern as a model.

---

### 2.3 — Messaging Safety (Minor-Specific)

**Status:** Existing safeguards preserved and verified

**Existing controls (not modified — confirmed production-ready):**
1. Post-acceptance-only messaging enforced in UI (Accepted status check in `messaging.js`)
2. Content moderation on every outbound message (`moderation.js analyzeMessage()`)
3. Pre-send warning modal before flagged messages are delivered
4. Permanent audit trail — messages never deleted
5. Non-dismissable safety notice on every thread
6. Coordinator notification on every flagged message
7. "Report this conversation" button on every thread

**RLS enforcement (Phase 8):** The `001_rls_policies.sql` migration enforces post-acceptance messaging at the database level, not just UI. Implement when RLS policies are applied.

**Report button:** A "Report this message" button visible on every message (per the individual message in `messaging.js _msRenderMessages`) was reviewed. Currently only thread-level reporting exists via `msReportThread()`. Adding per-message reporting is a Phase 8 enhancement.

---

### 2.4 — Employer Verification Gate — DEFERRED — HIGH PRIORITY

**Status:** Database columns added; full flow not yet implemented

**What was added to the database (`002_audit_log.sql`):**
- `employers.coordinator_approved BOOLEAN`
- `employers.domain_verified BOOLEAN`
- `employers.verification_status TEXT` — `pending_verification | verified | rejected`
- `employers.ontario_business_reg TEXT` — Ontario Business Registry number
- `employers.obligations_acknowledged_at TIMESTAMPTZ` — OHSA/OHRC acknowledgment timestamp

**What needs to be built in Phase 8:**
1. Add Ontario Business Registry number field to employer registration form
2. Add OHSA/OHRC obligations acknowledgment checkbox (with timestamp stored to DB)
3. Default all new employer accounts to `verification_status = 'pending_verification'`
4. Coordinator dashboard "Verify →" button updates `verification_status = 'verified'` via API
5. RLS policy blocks listing creation until `coordinator_approved = true` (already in `001_rls_policies.sql`)
6. Employer cannot contact any student until verified (enforced via RLS on messaging)

**Legal basis:** Ontario Human Rights Code (employers must acknowledge non-discrimination obligations); OHSA (workplace safety obligations for co-op placements).

---

### 2.5 — Student Data Rights — DEFERRED — MEDIUM PRIORITY

**Status:** TODO — not yet implemented

**Required for PIPEDA compliance (Principles 8–9 — access and correction):**
1. **Download my data** — JSON export of all student-related records
   - Implement as an Edge Function (`/functions/v1/student-data-export`)
   - Include: profile, applications, messages, notifications
   - Delivered as a downloadable file, not shown inline
2. **Delete my account** — soft-delete with 90-day anonymization grace period
   - Mark `account_status = 'suspended'`; retain records for 90 days (OCDSB audit requirement)
   - After 90 days: null all PII fields, retain anonymized application/placement records
3. **Correct my data** — coordinator-reviewed correction form
   - Student submits correction request (field + new value)
   - Coordinator approves or rejects in dashboard
   - Not self-serve: data in accepted placement records must be immutable

**Privacy Policy link:** The Privacy Policy is linked from every page footer (already implemented). Confirm it is also linked from the signup form (above or near the Terms checkbox).

---

## PART 4 — PILLAR 3: ERROR MESSAGES

**Status:** Partial — auth error messages improved; full pass deferred

**Current good practice (already implemented):**
- Auth failures show user-appropriate messages, not Supabase error codes
- `showToast()` is used for all user-facing errors
- Rate limit hits in messaging show friendly messages

**Remaining improvements for Phase 8:**

| Scenario | Current message | Recommended message |
|----------|----------------|-------------------|
| Wrong email/password | "Login failed." | "That email and password combination wasn't recognized. If you signed up recently, check that you've verified your email." |
| Server unreachable | "Could not reach the server. Is it running?" | "We're having trouble connecting right now. Please try again in a moment." |
| Rate limit (message) | "Too many messages" | "You've sent too many messages recently. Please wait [X minutes] before sending another." |
| Permission denied | Generic | "You don't have access to this section. If you think this is a mistake, contact your co-op coordinator." |

**Critical rule:** Never expose stack traces, SQL error messages, Supabase error codes, internal IDs, or file paths in user-facing error messages. Log full errors to audit_logs; show only sanitized messages to users.

---

## PART 5 — PILLAR 4: RESPONSIVE DESIGN

**Status:** Not addressed in this pass — deferred to design review

The responsive design audit (mobile 375/390px, tablet 768px, desktop 1280/1440px) requires visual testing in a browser. Changes to responsive layouts are out of scope for this security-focused pass.

**Constraint:** Do not change colours, fonts, or the existing design system. Only layout/breakpoint fixes are permitted.

**Specific areas to test:**
- Navigation hamburger menu on mobile
- Coordinator dashboard 7-tab bar on tablet
- Data tables in applicants.html and coordinator-dashboard.html
- Modal dialogs on iPhone SE (375px)
- Touch targets — minimum 44×44px per WCAG 2.1 AA

---

## PART 6 — GIT HISTORY REMEDIATION — CRITICAL

The coordinator password `***REMOVED***` was committed to Git history and persists even if removed from files. This MUST be purged before the repository is shared with the school board or made public.

### Step 1 — Confirm what's in history

```bash
git log -p -- server/routes/dev.js | grep -A2 -B2 "SiB-coord"
git log -p -- CLAUDE.md | grep -A2 -B2 "SiB-coord"
git log --all --full-history -- server/routes/dev.js
```

### Step 2 — Create a passwords.txt file for BFG

Create a file `passwords.txt` with one entry per line:
```
***REMOVED***
***REMOVED***
```

### Step 3 — Run BFG Repo Cleaner

```bash
# Download BFG: https://rtyley.github.io/bfg-repo-cleaner/
# Requires Java: java -version

# Clone a fresh mirror of your repository
git clone --mirror git@github.com:YOUR_ORG/sib.git sib.git

# Run BFG to replace all occurrences of the listed passwords
java -jar bfg.jar --replace-text passwords.txt sib.git

# Clean up refs
cd sib.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force-push the cleaned history
git push --force
```

### Step 4 — Rotate the credential

After purging Git history, rotate the coordinator password in Supabase Dashboard. The old password in history is now inaccessible, but rotation is still mandatory best practice.

### Step 5 — Revoke GitHub tokens if exposed

If the repository was ever public (even briefly), assume the password has been scraped by GitHub secret-scanning bots. Rotate immediately.

---

## PART 7 — BEFORE SCHOOL BOARD IT SUBMISSION

### Data Residency
- Supabase project is in **Canada (Central) — ca-central-1** ✓
- This satisfies MFIPPA requirement that Ontario student data remain in Canada
- Confirm this in Supabase Dashboard → Project Settings → General → Region

### Backup Policy
- Nightly export Edge Function created (`supabase/functions/daily-export/index.ts`) — NOT YET DEPLOYED
- Supabase PITR unavailable on Free plan — risk item (see 1.8)
- Recommended: upgrade to Supabase Pro before school board submission

### Breach Notification Process
Under PIPEDA, a breach of security safeguards affecting personal information must be reported to the Privacy Commissioner of Canada if it poses a **real risk of significant harm**. Under MFIPPA, breaches affecting municipally-partnered data must be reported to the Information and Privacy Commissioner of Ontario (IPC).

**Process to document before IT submission:**
1. Who is the designated Privacy Officer? (Name, contact)
2. What constitutes a reportable breach on this platform? (Database dump, credential exposure, unauthorized coordinator access)
3. How quickly will breaches be detected? (Currently: no automated alerting — add Supabase monitoring alerts in Phase 8)
4. What is the notification timeline? (PIPEDA: as soon as feasible; IPC: consult legal counsel)

### Parental Consent Mechanism
- Age verification UI flow: DEFERRED (see 2.1)
- Current state: no age verification in signup form
- **Risk:** Minor students can register without guardian consent
- **Mitigation until Phase 8:** Co-op teacher (coordinator) reviews every non-board student signup (coordinator notification triggered on signup)
- Document this manual process in the school board submission

### Coordinator Oversight Enforcement
- Coordinator can review all messages (RLS in migrations — requires application)
- Coordinator receives all flagged-message notifications (implemented in `messaging.js`)
- Coordinator receives all new-user, employer-approval, and concern-report notifications
- Coordinator can verify users, approve employers, close threads
- Coordinator dashboard: 7 sections covering all oversight functions

---

## PART 8 — BEFORE LEGAL REVIEW

The following clauses in `privacy.html` and `terms.html` require review by a lawyer familiar with PIPEDA, MFIPPA, and Ontario youth employment law before the platform is used with real students:

### Privacy Policy (`privacy.html`)
1. **Section 3 — How We Use Your Information**: The "improve our services" use case needs a specific lawful basis under PIPEDA. "Legitimate interest" alone may not be sufficient for minor student data.
2. **Section 5 — Data Retention**: Current language says "as long as necessary." Specify exact retention periods (e.g., student data: 7 years after placement per school board records policy, or as required by OCDSB).
3. **Section 6 — Your Rights**: The right to erasure language conflicts with the permanent audit trail requirement. Clarify that messaging records are retained for OCDSB oversight purposes even after account deletion.
4. **Section 7 — Messaging Monitoring**: Confirm this disclosure is sufficient under MFIPPA s.28 (notice of collection) and that the level of monitoring described is proportionate.
5. **Minor consent**: Current privacy policy does not address parental/guardian consent for under-18 users. Add a section before launch.

### Terms of Use (`terms.html`)
1. **Section 4 — Acceptable Use**: The prohibition on "off-platform contact information exchange" should cite the specific legal consequence (coordinator notification, account suspension) to be enforceable.
2. **Section 6 — Employer Responsibilities**: The statement that employers "comply with all applicable employment laws" is too broad. Enumerate specifically: Employment Standards Act, OHSA, Ontario Human Rights Code, youth worker age restrictions.
3. **Section 8 — Limitation of Liability**: The current indemnification gap — SiB disclaims liability for placement outcomes, but co-op placements may have duty-of-care implications under OHSA. Consult legal counsel.
4. **Section 12 — Contact**: Confirm this is a valid, monitored contact address. Auto-responder should acknowledge receipt within 24 hours.
5. **Jurisdiction**: Terms should specify Ontario law and courts explicitly.

---

## PART 9 — DEFERRED ITEMS SUMMARY

| Item | Priority | Unblocking condition |
|------|---------|---------------------|
| PAF-1: Coordinator password rotation | CRITICAL | Immediate — do before any push |
| PAF-2: Supabase anon key verification | CRITICAL | Immediate — verify in dashboard |
| PAF-3: Coordinator auth → Supabase Edge Function | HIGH | Phase 8 backend milestone |
| PAF-5: API_BASE → Supabase Edge Functions | HIGH | Phase 8 backend milestone |
| 1.2 RLS policies: apply migration files | HIGH | Apply in Supabase SQL Editor |
| 1.3 Auth: enable Supabase email confirmation server-side | HIGH | Dashboard toggle |
| 1.3 Auth: configure Supabase rate limiting | HIGH | Dashboard toggle |
| 1.5 Rate limiting: Edge Function integration | MEDIUM | Phase 8 |
| 1.7 Audit log: deploy Edge Function | MEDIUM | Phase 8 |
| 1.8 Backup: deploy daily-export Edge Function | MEDIUM | Phase 8 |
| 2.1 Age verification + parental consent UI | HIGH | Phase 8 |
| 2.4 Employer verification gate (full flow) | HIGH | Phase 8 |
| 2.5 Student data rights (download/delete/correct) | MEDIUM | Phase 8 |
| 1.6 CSP: migrate from unsafe-inline to nonces | LOW | Phase 8 build pipeline |
| 1.4 Input length limits server-side | MEDIUM | Phase 8 Edge Functions |
| PITR backup: Supabase Pro upgrade | HIGH | Before school board submission |
| Privacy Policy: legal review | HIGH | Before launch |
| Terms of Use: legal review | HIGH | Before launch |
| Breach notification process: document | HIGH | Before school board submission |
| Parental consent mechanism | HIGH | Phase 8 |
| Responsive design audit | LOW | Phase 8 design pass |

---

*Generated by security audit pass — 2026-05-25*
