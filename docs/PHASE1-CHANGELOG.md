# PHASE1-CHANGELOG.md

All changes made during Phase 1. Each entry notes what was changed, why, and what was tested.

---

## Phase 0 — Discovery

**Files created:** `PHASE1-DISCOVERY.md`  
**Summary:** Mapped backend location, Supabase schema, all API endpoints, localStorage write/read sites for the five migrated entities, demo seeder dependencies, and test plan. Confirmed `profiles` table schema via live Supabase query. Identified three blockers (coordinator auth, demo persona tokens, rate-limit localStorage read) and documented them before starting Phase 1.

---

## Phase 1 — Functional Fixes

### Fix 1 — `config.js`: environment-based `API_BASE`
**File:** `config.js`  
**Change:** Replaced hardcoded `http://localhost:3001/api` with an IIFE that returns the local URL on localhost/127.0.0.1 and derives from `location.origin` on other hosts.  
**TODO:** Confirm production API URL before launch (documented in PHASE1-FINDINGS.md T-1).  
**Tested:** Verified `config.js` loads without errors on localhost; `API_BASE` evaluates to `http://localhost:3001/api`.

---

### Fix 2 — Dead code: `listings.html` redirected, `students` array removed
**Files:** `listings.html`, `app.js`  
**Change:**  
- `listings.html` body replaced with a `<meta http-equiv="refresh">` + script redirect to `job-listings.html`. No inbound links to `listings.html` exist in production code (confirmed via grep — only self-reference in the legacy nav).  
- Removed the 6-element `students` array (lines 1–9 of original `app.js`) and the 5-key `tagClass` map (line 10).  
- `showEDashSection('browse')` previously called `renderStudents(students)`; changed to `renderStudents([])` to show the empty-state UI until real API data is wired up (see PHASE1-FINDINGS.md B-3).  
**Tested:** `job-listings.html` loads correctly. `listings.html` redirects immediately. Employer dashboard Browse Candidates tab shows empty state.

---

### Fix 3 — Dual track config: `tagClass` removed, all references updated to `TRACK_CLASS`
**Files:** `app.js`  
**Change:** Removed `tagClass` map (done as part of Fix 2). Updated the two `tagClass[t]||'tt-biz'` references in `renderStudents` and `openSProfile` to use `TRACK_CLASS[t]||'tt-biz'`. `TRACK_CLASS` is defined in `data.js` which loads before `app.js`.  
**Tested:** No `tagClass` references remain (confirmed). `TRACK_CLASS` exists at runtime.

---

### Fix 4 — `msReportThread`: replaced `confirm()` with custom modal
**File:** `messaging.js`  
**Change:** Replaced the native `window.confirm()` call at line ~328 with a promise-less custom dialog matching the style and behaviour of `_msConfirmSend`. The dialog has "Cancel" and "Report →" buttons; clicking outside or Cancel dismisses without reporting.  
**Tested:** Report button in thread view opens the custom modal. Cancel dismisses. Report button calls `updateMessageThreadStatus` and `notifyCoordinators` as before.

---

### Fix 5 — `URL.createObjectURL` memory leaks fixed
**File:** `app.js`  
**Change:** Three `URL.createObjectURL()` calls now revoke the object URL after 60 seconds via `setTimeout(() => URL.revokeObjectURL(url), 60_000)`:  
- `viewResume()` (inline resume preview)  
- `dashViewOrReplace()` (stored resume from sessionStorage)  
- `dashReplaceResume()` (newly uploaded resume)  
**Tested:** Object URLs are created and subsequently revoked in all three paths.

---

### Fix 6 — `screenshot.mjs` Windows path
**File:** `screenshot.mjs`  
**Change:** No change needed — `screenshot.mjs` already uses `import puppeteer from 'puppeteer'` with no `executablePath`. The CLAUDE.md reference to `C:/Users/nateh/AppData/...` was stale. `puppeteer` is listed in the root `package.json` dependencies.

---

### Fix 7 — Name typo in `SiB-Safety-Privacy-Overview.md`
**File:** `SiB-Safety-Privacy-Overview.md`  
**Change:** §10 ("Contact"), line 241: "Youssef Saad" → "Yousef Saadaldin", matching every other document.  
**Tested:** Confirmed grep shows no remaining "Youssef Saad" instances.

---

### Fix 8 — `migrateExistingData` write throttle
**File:** `data.js`  
**Change:** Added `DATA_VERSION = '2026-05-14'` constant. `migrateExistingData()` returns early if `localStorage.sib_data_version` already matches. Sets `sib_data_version` at the end of a successful migration run. Bump `DATA_VERSION` whenever migration logic changes.  
**Tested:** First page load runs migration and writes version. Subsequent loads return early (confirmed via console log timing).

---

### Fix 9 — Demo seeder activation gate
**File:** `demo.js`  
**Change:** The IIFE guard now activates on three conditions (OR logic):  
1. `location.hostname` is `localhost` or `127.0.0.1` (unchanged)  
2. `location.search` contains `?demo=1`  
3. A `<meta name="sib-demo" content="true">` tag exists in the page  
**Tested:** Demo panel appears on localhost. Adding `?demo=1` to any page URL on a non-localhost host would also activate it (not tested on live URL, confirmed logic is correct).

---

### Blocker 1 — Coordinator login: localStorage → real Supabase API
**File:** `coordinator-login.html`  
**Change:** `doCoordinatorLogin()` converted from sync to `async`. Now POSTs to `API_BASE + '/auth/login'` (the existing route already reads `profiles.role` and returns it in the token payload). Checks that the returned role is `'coordinator'` before proceeding. Falls back to a user-friendly error toast on network failure.  
**Prerequisite:** Mr. Caap's Supabase Auth user (`419dca7c...`) must have a password set — this is done by the `/api/dev/seed` endpoint on first demo run (see Blocker 2). The coordinator UUID and `profiles.role = 'coordinator'` row were confirmed to already exist.  
**Known issue:** The `GET /coordinator/users` route selects a non-existent `full_name` column from `profiles` and will error — tracked as PHASE1-FINDINGS.md B-1, fixed in Phase 2.2.  
**Tested:** After running `demoAsCoordinator()` once (which calls `/api/dev/seed` to set the password), coordinator login via `coordinator-login.html` returns a real JWT and redirects to the dashboard.

---

### Blocker 2 — `/api/dev/seed` endpoint + demo.js server-first seeding
**Files:** `server/routes/dev.js` (new), `server/index.js`, `server/.env`, `demo.js`  
**Change:**  
- New `server/routes/dev.js`: `POST /api/dev/seed` — gates on `NODE_ENV=development`, upserts the three demo personas in Supabase Auth + `profiles` + `students`/`employers` tables, creates a demo posting + accepted application, returns `{ student_token, employer_token, coordinator_token, *_id fields }`.  
- `server/index.js`: registers `/api/dev/seed` only when `NODE_ENV=development`.  
- `server/.env`: added `NODE_ENV=development`.  
- `demo.js`: `demoAsStudent/Employer/Coordinator` are now `async`. They call `_seedServer()` first; if it succeeds, real tokens are stored via `saveToken()` and user IDs are updated to match real Supabase UUIDs. localStorage seeding (`_seedLocalStorage()`) always runs as a layer underneath (for threads/messages/notifications which aren't server-backed yet).  
**Fallback:** If `/api/dev/seed` fails (server down, production 403), the demo falls back to empty tokens and fake IDs — same as the previous behaviour, silently.  
**Tested:** `demoAsCoordinator()` on localhost calls the seed endpoint, sets coordinator password, returns tokens. Coordinator login then succeeds via the real API.

---

### Bug fix B-1 — `GET /coordinator/users` selects non-existent `full_name` column
**File:** `server/routes/coordinator.js`  
**Change:** Removed `full_name` from the `profiles` select (column doesn't exist — confirmed via Supabase query). Extended the parallel data fetch to also query `students(id, full_name)` so that each profile row in the response includes a `full_name` field synthesised from the corresponding students or employers table row. Employer entries now use `contact_name` as `full_name` fallback.  
**Why now:** This would have caused a PostgREST error and completely broken the coordinator Users tab immediately after coordinator login was enabled.  
**Tested:** Coordinator dashboard Users tab loads without error.

---

## Blockers status

| Blocker | Status |
|---------|--------|
| B1 — Coordinator has no real Supabase user | ✓ Resolved — password set via seed endpoint; login uses real API |
| B2 — Demo personas will 401 after migration | ✓ Resolved — seed endpoint creates real users + tokens; localStorage fallback remains |
| B3 — Rate limit reads localStorage | Deferred to Phase 2.5 (documented in PHASE1-FINDINGS.md S-3) |
