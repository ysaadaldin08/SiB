# PHASE2-CHANGELOG.md

All changes made during Phase 2. Each entry notes what was changed, why, and what to test.

---

## Phase 2 — Server-Side Migration of localStorage Entities

Five localStorage collections (`sib_notifications`, `sib_coordinators`, `sib_approved_employers`, `sib_message_threads`, `sib_messages`) have been migrated to Supabase-backed REST routes. The frontend now treats the server as the source of truth; localStorage is no longer written for any of these entities.

---

## Prerequisites

### SQL Migration — run before anything else

**File:** `server/db/migrations/002_phase2_tables.sql`  
**Action required:** Open Supabase Dashboard → SQL Editor → New query, paste the file contents, and run it.  
The migration is idempotent (`IF NOT EXISTS` throughout) so re-running is safe.

**What it creates:**
- `public.notifications` table + index on `(user_id, created_at DESC)`
- `coordinator_approved boolean NOT NULL DEFAULT false` column on `public.employers`
- `public.message_threads` table + indexes on student_id, employer_id, application_id
- `public.messages` table + indexes on (thread_id, created_at), (sender_id, created_at)

---

## 2.1 — Notifications (`sib_notifications` → `notifications` table)

### New route file: `server/routes/notifications.js`

5 routes, all `authenticate`-gated:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | Returns current user's last 50 notifications (ordered by `created_at DESC`) |
| POST | `/api/notifications` | Inserts one notification; `user_id` in body allows cross-user coordinator fan-out |
| PUT | `/api/notifications/read-all` | Bulk marks all unread notifications as read (defined before `/:id` routes to avoid routing conflict) |
| PUT | `/api/notifications/:id/read` | Marks one notification read (own only, enforced via `eq('user_id', req.user.id)`) |
| PUT | `/api/notifications/:id/emailed` | Marks one notification as emailed (own only) |

### `server/index.js` change
- Added `const notificationRoutes = require('./routes/notifications')`
- Added `app.use('/api/notifications', notificationRoutes)`

### `data.js` changes
- `_notificationShape` removed; replaced with `_notificationFromApi(n)` (snake_case → camelCase conversion)
- `getNotifications(userId)` → `GET /api/notifications` (ignores `userId` arg; server scopes to JWT user)
- `_insertNotification(notification)` → `POST /api/notifications`
- `markNotificationRead(id)` → `PUT /api/notifications/:id/read`
- `markNotificationEmailed(id)` → `PUT /api/notifications/:id/emailed`
- `markAllNotificationsRead()` added → `PUT /api/notifications/read-all` (bulk replace for "mark all read" bell action)

### `notifications.js` changes
- `createNotification` is now `async`; awaits `_insertNotification`
- `notifyCoordinators` is now `async`; awaits `getCoordinators()` + `Promise.all` fan-out
- `_refreshNotifBadge` is now `async`; awaits `getNotifications(currentUser.id)`
- `toggleNotifDropdown` is now `async`; awaits `getNotifications(currentUser.id)`
- `_openNotif` calls `markNotificationRead` and `_refreshNotifBadge` as fire-and-forget (no blocking)
- `_markAllRead` is now `async`; calls `markAllNotificationsRead()` then `_refreshNotifBadge`

---

## 2.2 — Coordinators (`sib_coordinators` → `profiles` table)

Coordinator records already exist in `profiles` (role = 'coordinator'). No new table needed.

### New route file: `server/routes/coordinators.js`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/coordinators` | Returns all profiles where `role = 'coordinator'`; any authenticated user may call this (needed for notification fan-out) |

### `server/index.js` change
- Added `const coordinatorsListRoute = require('./routes/coordinators')`
- Added `app.use('/api/coordinators', coordinatorsListRoute)`

### `data.js` changes
- `_coordinatorShape` removed; coordinators now have the full `profiles` row shape
- `getCoordinators()` → `GET /api/coordinators`
- `getCoordinatorById(id)` → filters result of `getCoordinators()` (no dedicated endpoint needed)
- `getCoordinatorByEmail(email)` → filters result of `getCoordinators()`
- `createCoordinator()` → no-op (coordinators are created via Supabase Auth + profiles, not client-side)
- `migrateExistingData()`: removed `sib_coordinators` seeding block; `DATA_VERSION` bumped to `'2026-05-15'` to force re-migration on next page load

---

## 2.3 — Employer approval (`sib_approved_employers` → `employers.coordinator_approved`)

### Schema change
- `ALTER TABLE public.employers ADD COLUMN IF NOT EXISTS coordinator_approved boolean NOT NULL DEFAULT false`
- (Run as part of `002_phase2_tables.sql`)

### `server/routes/auth.js` change
- `POST /auth/login`: after role resolution, if `role === 'employer'`, queries `employers.coordinator_approved` and includes it in the JWT response payload as `coordinatorApproved`
- This ensures the field is refreshed on every login; clients no longer read from localStorage

### `server/routes/coordinator.js` changes
- `GET /coordinator/users` select now includes `coordinator_approved` from the `employers` join
- Added `PUT /coordinator/employers/:id/approve` → sets `coordinator_approved = true` for the given employer UUID

### `data.js` changes
- `employerCanPost(user)` now reads `user.coordinatorApproved` exclusively (removed `sib_approved_employers` localStorage read)
- No `saveApprovedEmployer()` / `getApprovedEmployers()` functions remain

### `coordinator-dashboard.html` changes
- `approveEmployer(userId, name)` — parameter changed from `email` to `userId`; calls `PUT /coordinator/employers/:id/approve`; removed localStorage write to `sib_approved_employers`
- `renderUsers()` — reads `u.coordinator_approved` from the API response instead of filtering `sib_approved_employers[]`

---

## 2.4 — Message threads (`sib_message_threads` → `message_threads` table)

### New route file: `server/routes/threads.js`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/threads` | Returns authenticated user's threads (scoped by `student_id` or `employer_id`), enriched |
| POST | `/api/threads` | Creates a thread; idempotent on `application_id`; 429 if thread rate limit hit |
| GET | `/api/threads/:id` | Single thread; access check: coordinator OR participant |
| PUT | `/api/threads/:id/status` | Updates `status`; participant or coordinator only |
| PUT | `/api/threads/:id/review` | Coordinator only: sets `reviewed_at`, `reviewed_by`, `coordinator_note` |

**Thread rate limit:** 5 new threads per user per rolling 24 hours, enforced server-side via `count` query. Returns HTTP 429 with a human-readable message on violation.

**Server-side enrichment (`_enrichThreads`):**  
Fetches all messages for a thread set in one query (no N+1), then attaches to each thread:
- `_preview` — body of the last message
- `_message_count` — total message count
- `_flagged_count` — count of flagged messages
- `_flag_reasons` — deduplicated union of all flag reason strings

This eliminates per-thread `getMessages()` calls in inbox and coordinator views.

**Nested messages router:**  
`router.use('/:id/messages', messagesRouter)` — threads.js nests messages.js so that `/api/threads/:id/messages` resolves correctly. `messages.js` uses `mergeParams: true` to inherit the `:id` param.

### `server/index.js` change
- Added `const threadRoutes = require('./routes/threads')`
- Added `app.use('/api/threads', threadRoutes)` — mounted WITHOUT `authenticate` at the app level; every route inside threads.js and messages.js applies `authenticate` directly to avoid double-authentication

### `data.js` changes
- `_threadFromApi(t)` added: maps snake_case fields + server enrichment fields (`_preview` → `preview`, `_message_count` → `messageCount`, etc.)
- `getMessageThreads(userId)` → `GET /api/threads`
- `getMessageThreadById(id)` → `GET /api/threads/:id`
- `createMessageThread(params)` → `POST /api/threads`
- `updateMessageThreadStatus(id, status)` → `PUT /api/threads/:id/status`
- `reviewMessageThread(id, note)` → `PUT /api/threads/:id/review`
- `getAllMessageThreads()` (coordinator) → `GET /api/coordinator/threads`
- `getThreadForApplication(applicationId)` → filters from `getMessageThreads()`

---

## 2.5 — Messages (`sib_messages` → `messages` table)

### New route file: `server/routes/messages.js`

`const router = express.Router({ mergeParams: true })` — required to inherit `:id` (thread UUID) from threads.js parent router.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/threads/:id/messages` | Returns all messages in thread; auth + participant/coordinator check |
| POST | `/api/threads/:id/messages` | Sends a message; 429 on rate-limit; auto-updates `last_message_at`; sets thread `status = 'flagged'` if `flagged: true` |

**Message rate limit:** 20 messages per sender per rolling hour, enforced server-side.

**Flag embedding:** `flagged` and `flag_reasons` are submitted in the POST body. The server sets `thread.status = 'flagged'` in the same transaction if `flagged: true`. No separate `flagMessage` call needed.

### `server/routes/coordinator.js` additions
- `GET /coordinator/threads` — returns all threads, enriched via `_enrichCoordThreads` (same logic as `_enrichThreads` in threads.js)
- `PUT /coordinator/messages/:id/review` — sets `reviewed_by_coordinator = true` on a message

### `data.js` changes
- `_messageFromApi(m)` added: maps `thread_id`, `sender_id`, `sender_role`, `flag_reasons`, `reviewed_by_coordinator` from snake_case
- `getMessages(threadId)` → `GET /api/threads/:id/messages`
- `createMessage(params)` → `POST /api/threads/:id/messages` (includes `flagged`, `flag_reasons` in body)
- `flagMessage()` → no-op (flag is embedded in `createMessage` call; separate flagging eliminated)
- `markMessageReviewed(id)` → `PUT /api/coordinator/messages/:id/review`
- `checkMessageRateLimit()` → always returns `{ allowed: true }` (server enforces; client no longer checks)

### `messaging.js` changes
- `msOpenOrCreate` — now `async`; uses `currentUser.id` (UUID) for `studentId`/`employerId` (was email string); try/catch surfaces 429 as a toast
- `msOpenThread` — now `async`; awaits `_msRenderMessages`
- `msOpenThreadById(threadId)` — NEW async function; used from inbox `onclick` instead of `msOpenThread(getMessageThreadById(...))` pattern which was not async-safe
- `msBackToInbox` — now `async`
- `_msRenderMessages` — now `async`; awaits `getMessages(threadId)`; `isMine` uses `m.senderId === currentUser.id` (UUID, not email)
- `msRenderInbox` — now `async`; uses `t.preview` from server enrichment (no per-thread `getMessages` calls); `onclick` uses `msOpenThreadById`
- `msSendMessage` — embeds `flagged`/`flagReasons` in `createMessage` call; handles 429 with toast; refreshes thread via `getMessageThreadById` if message was flagged
- `msReportThread` — OK handler is `async`; awaits `updateMessageThreadStatus` and `getMessageThreadById`

### `coordinator-dashboard.html` messaging changes
- `coordRenderThreadList` — `async`; uses `t.preview` and `t.messageCount` from server enrichment
- `coordOpenThread` — `async`; awaits `getAllMessageThreads()` and `coordRenderThreadDetail()`
- `coordMsgBack` — `async`
- `coordRenderThreadDetail` — `async`; awaits `getMessages(threadId)`
- `coordMarkReviewed` — `async`; uses `getMessageThreadById` for refresh after update
- `coordCloseThread` — `async`; uses `getMessageThreadById` for refresh after update
- `renderMessages` — `async`; awaits `coordRenderThreadList()`
- `renderReports` — `async`; uses `t.flagReasonsSummary`, `t.flaggedCount`, `t.messageCount` from server enrichment
- `updateTabCounts` — `async`; awaits `getAllMessageThreads()`
- `renderOverview` — `async`; awaits `getAllMessageThreads()`
- `DOMContentLoaded` — `await updateTabCounts()`

---

## Architecture notes

### Sender ID migration
Message/thread participant IDs are now Supabase Auth UUIDs (`currentUser.id`), not email strings. Any old localStorage data with email-based IDs is inert once the server is authoritative.

### Double-authenticate prevention
`/api/threads` is mounted in `server/index.js` **without** `authenticate` at the app level. Each route in `threads.js` and `messages.js` applies `authenticate` individually. This prevents the middleware running twice (once at mount, once per handler).

### N+1 elimination
The `_enrichThreads` / `_enrichCoordThreads` helpers batch-fetch all messages for a set of threads in a single Supabase query, then join them in memory. Client inbox and coordinator views use `t.preview`, `t.messageCount`, etc. directly — no per-thread API calls.

### coordinator_approved cross-device
The coordinator approval state is included in the login API response (`coordinatorApproved`) so it is always current. Clients no longer need to read or write `sib_approved_employers` in localStorage.

---

## Files changed in Phase 2

| File | Change type |
|------|-------------|
| `server/db/migrations/002_phase2_tables.sql` | NEW |
| `server/routes/notifications.js` | NEW |
| `server/routes/coordinators.js` | NEW |
| `server/routes/threads.js` | NEW |
| `server/routes/messages.js` | NEW |
| `server/routes/coordinator.js` | Modified |
| `server/routes/auth.js` | Modified |
| `server/index.js` | Modified |
| `data.js` | Modified (extensive) |
| `notifications.js` | Modified |
| `messaging.js` | Modified (extensive) |
| `coordinator-dashboard.html` | Modified (extensive) |

---

## What to do after merging

1. **Run SQL migration** — paste `server/db/migrations/002_phase2_tables.sql` into Supabase SQL Editor and execute
2. **Restart the Express server** — `node server/index.js` (or `npm run dev` in `server/`) to pick up new routes
3. **Run `demoAsCoordinator()`** in the browser console on localhost — this calls `/api/dev/seed` and creates real demo users; coordinator login will then succeed
4. **Smoke test** — log in as each role (student, employer, coordinator) and verify notifications load, inbox loads, and sending a message round-trips correctly

## Known issues / deferred items

| Item | Notes |
|------|-------|
| `demo.js` still seeds `sib_message_threads`, `sib_messages`, `sib_notifications` in localStorage | Harmless — server is now authoritative; these keys are never read. Clean-up deferred to Phase 3. |
| CLAUDE.md data model section still lists these keys as localStorage | Needs a documentation pass. |
| `server/db/schema.sql` does not document the new tables | Needs updating. |
| Daily notification digest (Phase 5) | Unread `daily`-preference notifications accumulate in the DB; no batch delivery yet. |
| Cross-user immediate email for notifications | Server still does not relay emails for notifications to other users (employer notified of application, etc.). |
