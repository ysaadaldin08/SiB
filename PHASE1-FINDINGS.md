# PHASE1-FINDINGS.md

Items discovered during Phase 1 that are out of scope for this phase. Each is noted for the security pass or a future phase.

---

## Security Phase (planned)

### S-1 — Coordinator password is plaintext in localStorage (pre-existing)
`data.js:migrateExistingData()` seeds Mr. Caap with `password: '***REMOVED***'` in plaintext in localStorage. After Phase 1, coordinator login goes through the Supabase Auth API, so this localStorage record is no longer consulted for actual authentication. The localStorage seed is kept for fallback compatibility but the field is unused. Confirm removal once Phase 6 replaces the seed with an invite flow.

### S-2 — Service-role key bypasses all Supabase RLS
`server/middleware/auth.js` initializes the Supabase client with `SUPABASE_SERVICE_KEY`. Every new route added in Phase 2 (notifications, threads, messages) must include the `authenticate` middleware — authorization is enforced entirely in Express. The security review must audit every Phase 2 route for missing auth middleware.

### S-3 — Rate limit check reads localStorage (not server)
`data.js:checkMessageRateLimit()` counts messages and threads from `sib_messages` and `sib_message_threads` in localStorage. After Phase 2.5 (messages migrated to server), this check will be ineffective — a user can clear localStorage and bypass limits. **Fix during Phase 2.5**: rewrite to count rows in the `messages` table via `GET /api/threads/:threadId/messages` or a dedicated endpoint that returns sender stats.

### S-4 — Client-side moderation only
`moderation.js:analyzeMessage()` runs entirely client-side before `msSendMessage()`. A motivated user can bypass it by calling `createMessage()` directly. The security review should add server-side re-enforcement on `POST /api/threads/:threadId/messages` (Phase 2.5 adds this endpoint). Until then, document in server code that the `flagged` + `flagReasons` values are client-supplied and unverified.

### S-5 — XSS via `_htmlEsc` coverage
Not audited this phase. Flag for the security review: confirm all dynamic HTML insertions use `_htmlEsc` or equivalent sanitization, especially in `messaging.js` message rendering and `notifications.js` dropdown.

---

## Bug fixes (pre-existing, non-critical)

### B-1 — `GET /coordinator/users` selects non-existent `full_name` column
`server/routes/coordinator.js` line 121 selects `'id, email, role, full_name, created_at'` from `profiles`, but the `profiles` table has no `full_name` column (confirmed 2026-05-14). This causes a PostgREST error and the coordinator Users tab shows an error state. **Fix in Phase 2.2** when updating the coordinator route: remove `full_name` from the select, or add the column to `profiles`.

### B-2 — `PUT /coordinator/users/:id` endpoint missing
CLAUDE.md documents a `PUT /coordinator/users/:id { email_verified: true }` endpoint for the coordinator dashboard's "Verify →" button, but the route does not exist. The UI's fallback (clipboard copy of `sibVerifyUser()`) is the current code path. Add this endpoint in Phase 2.

### B-3 — Browse Candidates tab shows empty state after dead-code removal
`showEDashSection('browse')` in `app.js` previously called `renderStudents(students)` with the hardcoded array. That array is now removed; the call was changed to `renderStudents([])`, which shows the empty-state UI. The Browse Candidates feature needs real API data (query students who have applied to this employer's postings, or a coordinator-scoped student list). Track for Phase 2 or later.

---

## TODO items carried forward

### T-1 — Production API_BASE URL
`config.js` derives a fallback from `location.origin + ':3001/api'` for non-localhost. This is a guess — confirm the actual production deployment pattern (same domain, subdomain, different port?) and update the fallback before launch.

### T-2 — CORS_ORIGIN in production
`server/index.js` reads `CORS_ORIGIN` from `.env`, currently `http://localhost:3000`. Update for each deployment environment.

### T-3 — screenshot.mjs executablePath
Already resolved — `screenshot.mjs` uses the `puppeteer` npm package directly with no hardcoded path. No action needed.

### T-4 — Daily notification digest (Phase 5)
`notifications.js` comment: `TODO (Phase 5): implement daily-digest delivery`. Out of scope until Phase 5.

### T-5 — schema.sql missing `profiles` table definition
`server/db/schema.sql` does not document the `profiles` table. Add a `CREATE TABLE IF NOT EXISTS public.profiles ...` statement to keep the schema file in sync with the live database.
