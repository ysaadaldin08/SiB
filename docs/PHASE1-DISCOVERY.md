# PHASE1-DISCOVERY.md

Generated: 2026-05-13  
Status: **READY FOR REVIEW** — stop here and wait for approval before Phase 1 begins.

> **Historical note (demo removal):** This discovery doc maps the demo seeder (`demo.js`, `_seedAll()`), demo personas (DEMO_STUDENT/EMPLOYER/COORDINATOR, "Alex Thompson", "Shopify Ottawa"), the demo panel, and `/api/dev/seed` options. All demo functionality has since been fully removed from the project. The contents below are retained for historical accuracy only and no longer describe any code that exists.

---

## 1. Backend Location

The Node API server lives **inside this repo** at `SiB/server/`. It is not a sibling directory or separate repo.

```
server/
  index.js              Express app entrypoint, PORT 3001
  package.json          express ^5.2.1, @supabase/supabase-js ^2, cors, dotenv, nodemon
  .env                  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, PORT, CORS_ORIGIN
  middleware/
    auth.js             authenticate() middleware — validates Supabase JWT, exposes supabase client
  routes/
    auth.js             /api/auth/* (register, login, logout, session, setup-profile)
    students.js         /api/students/* (me GET/PUT)
    employers.js        /api/employers/* (me GET/PUT)
    postings.js         /api/postings/* (CRUD)
    applications.js     /api/applications/* (submit, mine, posting/:id, status update)
    coordinator.js      /api/coordinator/* (postings, applications, users)
  db/
    schema.sql          Table definitions for: students, employers, postings, applications
  node_modules/
```

**Framework:** Express.js v5 (express-router style).  
**Database client:** `@supabase/supabase-js` v2, initialized in `middleware/auth.js` with the service-role key, which bypasses all RLS policies.  
**Supabase initialization:** Single shared client in `middleware/auth.js`; imported by every route file via `require('../middleware/auth')`.

---

## 2. Existing Supabase Schema

From `server/db/schema.sql` (tables confirmed to exist server-side):

| Table | Key Columns |
|-------|-------------|
| `students` | `id uuid pk (→ auth.users)`, `full_name text`, `email text`, `school text`, `grade int`, `program text`, `bio text`, `skills text[]`, `created_at timestamptz` |
| `employers` | `id uuid pk (→ auth.users)`, `company_name text`, `contact_name text`, `email text`, `industry text`, `website text`, `description text`, `created_at timestamptz` |
| `postings` | `id uuid pk`, `employer_id uuid (→ employers)`, `title`, `description`, `responsibilities`, `requirements`, `track`, `work_mode`, `hours_per_week int`, `location`, `start_date`, `deadline`, `is_active bool`, `created_at`, `updated_at` |
| `applications` | `id uuid pk`, `student_id uuid (→ students)`, `posting_id uuid (→ postings)`, `status text`, `cover_note text`, `resume_url text`, `created_at`, `updated_at`, `UNIQUE(student_id, posting_id)` |

**Not in schema.sql but referenced by route code — confirmed schema:**  
`profiles` — confirmed via live Supabase query on 2026-05-14:

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` | `uuid` | NO | — (references auth.users) |
| `email` | `text` | YES | — |
| `role` | `text` | YES | `'student'` |
| `created_at` | `timestamptz` | YES | `now()` |

Note: **no `full_name` column**. The `GET /coordinator/users` route selects `full_name` from `profiles`, which will error — this is a pre-existing bug documented in PHASE1-FINDINGS.md.  
the SiB coordinator (`ysaadaldin08@gmail.com`) already has a row with `role = 'coordinator'` and a corresponding `auth.users` row (UUID: `419dca7c-b9a6-4d5a-a7fe-ce91e0781c05`). The auth user was created via Google OAuth and had no password until the dev seed endpoint set one.

**Tables that do NOT yet exist (needed for Phase 2):**
- `notifications`
- `message_threads`
- `messages`

**Columns that do NOT yet exist (needed for Phase 2):**
- `employers.coordinator_approved boolean` (for `sib_approved_employers` migration)

---

## 3. Existing API Endpoints

### Auth — `/api/auth` (public)

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| POST | `/api/auth/register` | none | `{ token, user }` — creates student/employer in Supabase Auth + profile row |
| POST | `/api/auth/login` | none | `{ token, user }` — returns JWT; checks `profiles` table for role override |
| POST | `/api/auth/logout` | optional token | `{ success: true }` |
| GET | `/api/auth/session` | Bearer token | `{ needsRoleSetup, user }` — profile + role detection |
| POST | `/api/auth/setup-profile` | Bearer token | `{ user }` — for Google OAuth role selection |

### Students — `/api/students` (auth required)

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/students/me` | Student profile row |
| PUT | `/api/students/me` | Updated student profile |

### Employers — `/api/employers` (auth required)

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/employers/me` | Employer profile row |
| PUT | `/api/employers/me` | Updated employer profile |

### Postings — `/api/postings`

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| GET | `/api/postings` | none | All active postings + employer info |
| GET | `/api/postings/mine` | Bearer | Employer's own postings |
| GET | `/api/postings/:id` | none | Single posting |
| POST | `/api/postings` | Bearer (employer) | Created posting |
| PUT | `/api/postings/:id` | Bearer (owner) | Updated posting |
| DELETE | `/api/postings/:id` | Bearer (owner) | `{ success: true }` |

### Applications — `/api/applications` (auth required)

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| POST | `/api/applications` | Bearer (student) | Created application |
| GET | `/api/applications/mine` | Bearer (student) | Student's applications |
| GET | `/api/applications/posting/:id` | Bearer (employer/owner) | Applicants for a posting |
| PUT | `/api/applications/:id` | Bearer (employer/owner) | Updated application status |

### Coordinator — `/api/coordinator` (auth + coordinator role via `profiles`)

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/coordinator/postings` | All postings + employer + applicant count |
| GET | `/api/coordinator/applications` | All applications + student + posting info |
| PUT | `/api/coordinator/applications/:id` | Updated application status |
| PUT | `/api/coordinator/postings/:id` | Updated posting (any field) |
| DELETE | `/api/coordinator/postings/:id` | Deletes posting + its applications |
| GET | `/api/coordinator/users` | All profiles + company + app/posting counts |

### Health

| Method | Path |
|--------|------|
| GET | `/health` | `{ status: 'ok' }` |

### Cross-reference: frontend calls vs. existing endpoints

All calls made from `data.js`, `auth.js`, and page-level scripts are satisfied by the above routes **except**:

| Called from | Endpoint needed | Exists? |
|-------------|----------------|---------|
| `coordinator-login.html doCoordinatorLogin()` | `POST /api/auth/coordinator-login` (or unified login) | ❌ — coordinator login is localStorage-only; the regular `/api/auth/login` could serve this if the SiB coordinator has a real Supabase user with `profiles.role = 'coordinator'` |
| `coordinator-dashboard.html approveEmployer()` | `PUT /api/coordinator/employers/:id/approve` | ❌ |
| `coordinator-dashboard.html manualVerifyUser()` | `PUT /api/coordinator/users/:id` | ❌ — CLAUDE.md documents this but the route doesn't exist |
| Phase 2 notification CRUD | `/api/notifications/*` | ❌ |
| Phase 2 thread CRUD | `/api/threads/*` | ❌ |
| Phase 2 message CRUD | `/api/threads/:id/messages`, `/api/messages/:id/review` | ❌ |
| Phase 2 coordinator list | `GET /api/coordinators` | ❌ |

---

## 4. localStorage-only Entities — Current Read/Write Sites

### `sib_notifications`

| Operation | File | Function |
|-----------|------|----------|
| Read | `data.js:440` | `getNotifications(userId)` |
| Write | `data.js:445` | `_insertNotification(data)` |
| Write | `data.js:453` | `markNotificationRead(id)` |
| Write | `data.js:460` | `markNotificationEmailed(id)` |
| Write | `demo.js:228` | `_seedAll()` (replaces demo-user notifications) |
| Read | `data.js:653` | `sibDump()` (debug snapshot) |
| Indirect | `notifications.js:130-160` | `createNotification()` → calls `_insertNotification`, `markNotificationEmailed` |
| Indirect | `notifications.js:166-173` | `notifyCoordinators()` → calls `_insertNotification` |
| Indirect | `notifications.js:188` | `_unreadCount()` → calls `getNotifications()` |
| Indirect | `notifications.js:208` | `toggleNotifDropdown()` → calls `getNotifications()` |
| Indirect | `notifications.js:282` | `_markAllRead()` → calls `getNotifications()`, `markNotificationRead()` |

### `sib_message_threads`

| Operation | File | Function |
|-----------|------|----------|
| Read | `data.js:469` | `getMessageThreads(userId, role)` |
| Read | `data.js:475` | `getMessageThreadById(id)` |
| Write | `data.js:480` | `createMessageThread(data)` |
| Write | `data.js:489` | `updateMessageThreadStatus(id, status)` |
| Read | `data.js:497` | `getAllMessageThreads()` |
| Write | `data.js:502` | `coordinatorReviewThread(threadId, {note, reviewedBy})` |
| Read | `data.js:548` | `getThreadForApplication(applicationId)` |
| Read | `data.js:567` | `checkMessageRateLimit()` — counts new threads per day |
| Write | `data.js:525` | `createMessage()` — updates `lastMessageAt` on the parent thread |
| Write | `demo.js:213-216` | `_seedAll()` |
| Read | `data.js:654` | `sibDump()` |
| Indirect | `messaging.js:65` | `msOpenOrCreate()` → calls `getThreadForApplication`, `createMessageThread` |
| Indirect | `messaging.js:185` | `msRenderInbox()` → calls `getMessageThreads` |
| Indirect | `messaging.js:267` | `msSendMessage()` → calls `updateMessageThreadStatus`, `getMessageThreadById` |
| Indirect | `messaging.js:328` | `msReportThread()` → calls `updateMessageThreadStatus` |
| Indirect | `coordinator-dashboard.html` | Renders thread list via `getAllMessageThreads()` |

### `sib_messages`

| Operation | File | Function |
|-----------|------|----------|
| Read | `data.js:516` | `getMessages(threadId)` |
| Write | `data.js:520` | `createMessage(data)` |
| Write | `data.js:532` | `flagMessage(id, reasons)` |
| Write | `data.js:539` | `markMessageReviewed(id)` |
| Read | `data.js:559` | `checkMessageRateLimit()` — counts messages per hour |
| Write | `demo.js:219-222` | `_seedAll()` |
| Read | `data.js:655` | `sibDump()` |
| Indirect | `messaging.js:148` | `_msRenderMessages()` → calls `getMessages` |
| Indirect | `messaging.js:211` | `msRenderInbox()` → calls `getMessages` for last-message preview |
| Indirect | `messaging.js:257` | `msSendMessage()` → calls `createMessage`, `flagMessage` |
| Indirect | `coordinator-dashboard.html` | Renders message content via `getMessages()` |

### `sib_coordinators`

| Operation | File | Function |
|-----------|------|----------|
| Read | `data.js:578` | `getCoordinators()` |
| Read | `data.js:581` | `getCoordinatorById(id)` |
| Read | `data.js:587` | `getCoordinatorByEmail(email)` |
| Write | `data.js:592` | `createCoordinator(data)` |
| Write | `data.js:634-643` | `migrateExistingData()` — seeds the SiB coordinator if list is empty |
| Read | `data.js:656` | `sibDump()` |
| Read | `coordinator-login.html:179` | `doCoordinatorLogin()` → calls `getCoordinatorByEmail()` |
| Read | `notifications.js:167` | `notifyCoordinators()` → calls `getCoordinators()` |

### `sib_approved_employers`

| Operation | File | Function |
|-----------|------|----------|
| Read | `data.js:353` | `employerCanPost(user)` |
| Write | `demo.js:231-235` | `_seedAll()` |
| Read | `coordinator-dashboard.html:524` | `renderUsers()` — inline read to show approval badge |
| Write | `coordinator-dashboard.html:594-598` | `approveEmployer(email, name)` — inline write |

---

## 5. Demo Seeder Dependencies

`demo.js` writes to the following localStorage keys:

| Key | Demo content | Server-backed after Phase 2? |
|-----|-------------|------------------------------|
| `sib_user` | DEMO_STUDENT / DEMO_EMPLOYER / DEMO_COORDINATOR persona objects | No — demo users are not real Supabase users; they have fake IDs and empty tokens |
| `sib_token` | Always set to `''` | N/A |
| `sib_message_threads` | 2 threads (normal + flagged) | Must become real server records |
| `sib_messages` | 6 messages across 2 threads | Must become real server records |
| `sib_notifications` | 12 notifications (3 recipients) | Must become real server records |
| `sib_approved_employers` | Shopify Ottawa email | Must become real `coordinator_approved` flag |
| `sib_student_app` (sessionStorage) | Student onboarding form state | Stays client-side (form draft) |
| `sib_emp_data` (sessionStorage) | Employer registration form state | Stays client-side (form draft) |

**Critical constraint:** The demo personas (Alex Thompson, Shopify Ottawa, the SiB coordinator) use fake IDs (`demo-student-1`, `demo-employer-1`, `coord-seed-1`) and empty JWTs. After Phase 2, the server won't recognise these IDs. Two acceptable paths forward:

- **Option A (recommended):** Add a `/api/dev/seed` endpoint (localhost-only gate, e.g. `if (process.env.NODE_ENV !== 'development') return 403`) that creates the three demo users in Supabase Auth + profile tables and seeds all threads, messages, and notifications server-side. The demo personas then log in via real JWTs. The `demoAsStudent/Employer/Coordinator` functions call this endpoint before setting `sib_user`.
- **Option B:** Keep the demo as a pure localStorage layer. After Phase 2, the demo seeder populates localStorage with the same fake data it does now; the server-backed functions are never called from demo sessions (fake users get 401s from every API call). This is simpler but means the coordinator demo still shows only local data — which defeats the cross-device goal.

**Recommendation:** Option A. Document it as the chosen path in PHASE1-CHANGELOG.md.

---

## 6. Test Plan

The following test cases will be run after each sub-migration. All cross-device tests use Browser A (normal) + Browser B (incognito, fresh localStorage).

### After Phase 1 (functional fixes)
- [ ] All pages load without console errors: `index.html`, `job-listings.html`, `posting.html`, `dashboard-student.html`, `dashboard-employer.html`, `coordinator-dashboard.html`, `coordinator-login.html`
- [ ] Demo panel appears on localhost and all three personas load successfully
- [ ] `config.js` uses `http://localhost:3001/api` on localhost and a derived URL on other origins
- [ ] `listings.html` is removed or redirects; no broken nav links
- [ ] `TRACK_CLASS` in `data.js` is the only track-class map; `tagClass` in `app.js` is gone
- [ ] Flagging a message uses the custom modal (not `confirm()`)
- [ ] `screenshot.mjs` runs without an explicit executablePath

### After Sub-migration 2.1 — Notifications
- [ ] **Cross-device test:** Browser A: log in as Shopify Ottawa, accept Alex's application in `applicants.html`. Browser B: log in as Alex (student), open notification bell — the `applicationStatus` notification must appear without any localStorage.
- [ ] **Coordinator test:** Browser A: log in as the SiB coordinator; coordinator dashboard Reports tab shows the `newPlacement` notification fired in the previous step — without having been on that device.
- [ ] Bell badge count is accurate for each persona.
- [ ] `markNotificationRead` persists across browser reload.

### After Sub-migration 2.2 — Coordinators
- [ ] Browser B (fresh incognito): navigate to `coordinator-login.html`, sign in as the SiB coordinator with email `ysaadaldin08@gmail.com` / `[redacted — see SECURITY.md PAF-1]`. Dashboard loads with coordinator content from the API.
- [ ] the SiB coordinator's coordinator token grants access to `GET /api/coordinator/users` and `GET /api/coordinator/postings`.
- [ ] `notifyCoordinators()` writes to the correct user IDs (now Supabase UUIDs, not `coord-seed-1`).

### After Sub-migration 2.3 — Approved Employers
- [ ] Sign up a new employer with a Gmail address → posting blocked ("pending approval" toast).
- [ ] Log in as the SiB coordinator → approve that employer via the coordinator dashboard "Approve to Post →" button (which now calls `PUT /api/coordinator/employers/:id/approve`).
- [ ] Sign back in as the employer (same session, no re-login) → posting is now permitted. (The `currentUser.coordinatorApproved` field should be read from the server on each login.)

### After Sub-migration 2.4 — Message Threads
- [ ] **Cross-device test:** Browser A: Shopify Ottawa initiates a thread with Alex from `applicants.html`. Browser B: Alex logs in → thread appears in the Messages section of the student dashboard.
- [ ] Browser C (the SiB coordinator, incognito): coordinator dashboard Messages section shows both demo threads — including the flagged TechCorp ↔ Maya thread.
- [ ] `msOpenOrCreate` correctly reuses an existing thread (does not duplicate).

### After Sub-migration 2.5 — Messages
- [ ] **End-to-end send test:** Browser A (Shopify Ottawa) sends "Hello!" in the thread with Alex. Browser B (Alex) reloads Messages — the message appears, persists across logout/login.
- [ ] **Flagged-message test:** Browser A sends a message containing "call me at 613-555-0192". Pre-flight warning dialog appears. After confirming "Send anyway", message arrives in thread with a flag indicator. the SiB coordinator (Browser C) receives a `messageFlagged` notification in the coordinator dashboard immediately.
- [ ] **Rate limit test:** Send 20 messages rapidly as one user — the 21st is blocked with a toast ("You've reached the limit of 20 messages per hour").
- [ ] Demo seeder produces the two pre-loaded threads with all 6 messages visible in the SiB coordinator's coordinator dashboard on a fresh browser.

### Final end-to-end (all phases complete)
Run `sibDump()` in the console — no migrated collection (notifications, threads, messages, coordinators, approved employers) should be the source of truth from localStorage alone; writes go to the server.

Run the full journey:
1. Student applies → employer reviews → employer accepts → student receives `applicationStatus` notification (cross-device)
2. Thread opens → message sent → message flagged → coordinator notified (cross-device) → coordinator marks reviewed (coordinator dashboard)
3. New non-board student signs up → coordinator receives `newUserReview` notification
4. New unknown-domain employer signs up → posting blocked → coordinator approves → posting enabled

---

## Key Findings and Risks

1. **Missing `profiles` table in schema.sql.** The `profiles` table (referenced by auth and coordinator routes) exists in Supabase but is absent from the local schema file. Before Phase 2, we need to add its `CREATE TABLE` statement to `schema.sql` so the migration history is complete.

2. **Coordinator login is entirely localStorage.** `coordinator-login.html` checks `sib_coordinators[]` in localStorage — there is no API call. the SiB coordinator has no Supabase Auth user. This means: (a) the coordinator gets an empty token, (b) all API coordinator endpoints return 401 for the coordinator persona today. Sub-migration 2.2 must fix this by creating a real Supabase user for the SiB coordinator with `profiles.role = 'coordinator'`.

3. **Missing server endpoints vs. CLAUDE.md spec.** `PUT /api/coordinator/users/:id` (for manual email verification) and `PUT /api/coordinator/employers/:id/approve` do not exist in the server yet. These need to be added in Phase 2.

4. **Demo personas use fake IDs and empty tokens.** After Phase 2, every API call from a demo session will return 401. The demo seeder must be reworked to use a `/api/dev/seed` endpoint that creates real (but ephemeral) Supabase users, or the demo must stay purely localStorage with an explicit notice that API features won't fire.

5. **`sib_approved_employers` is read inline in `coordinator-dashboard.html`.** Two reads at lines 524 and 594 access localStorage directly in page-level `<script>` tags, not via a `data.js` wrapper function. These will need to be updated as part of Sub-migration 2.3.

6. **`checkMessageRateLimit` reads from both `sib_messages` and `sib_message_threads`.** After Phase 2, this function must query the server, not localStorage, or the rate limit check will be ineffective.

7. **`tagClass` in `app.js` vs. `TRACK_CLASS` in `data.js`.** The 5-key `tagClass` map is used in `listings.html` and `app.js:renderStudents()` only. `listings.html` is legacy; `renderStudents()` is only called when `listings.html` loads. Safe to delete both together.

8. **No `PUT /api/coordinator/users/:id` endpoint.** The coordinator dashboard's "Verify →" button tries this endpoint first (CLAUDE.md says it should), then falls back to clipboard. Since the endpoint doesn't exist, it will always fall back. Should be added in Phase 2.
