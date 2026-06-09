# CLAUDE.md — Frontend Website Rules

# Project Context

**What this is:** Students in Business (SiB) — a real HR / co-op management platform. Think Indeed, but built specifically for high school co-op programs: connecting Grade 10–12 co-op students with employers willing to host placements, and giving co-op coordinators the tools to review and approve both sides.

**Roles:** students (co-op applicants), employers (hosts), and coordinators (school board staff who oversee placements).

**Stack:** static front-end (HTML/CSS/vanilla JS) hosted on GitHub Pages at the /SiB/ subpath, with Supabase for auth (email/password + Google OAuth) and backend, accessed **directly from the browser (Path A)** — the `server/` Express app is retired and is NOT the data path. Note the /SiB/ subpath matters — URLs must not assume the site lives at the domain root.

**Workflow:** Edited and run through Claude Code in VS Code, pushed to GitHub from there. Prefer concrete, applyable edits. This is a production app handling real student/employer PII (PIPEDA applies), not a demo.

## Always Do First
- **Invoke the `frontend-design` skill** before writing any frontend code, every session, no exceptions.

## Reference Images
- If a reference image is provided: match layout, spacing, typography, and color exactly. Swap in placeholder content (images via `https://placehold.co/`, generic copy). Do not improve or add to the design.
- If no reference image: design from scratch with high craft (see guardrails below).

## Local Server
- Start the dev server: `node serve.mjs` (serves the project root at `http://localhost:3000`)
- `serve.mjs` lives in the project root. Use it to preview the site locally in a browser.
- If the server is already running, do not start a second instance.

## Output Defaults
- Single `index.html` file, all styles inline, unless user says otherwise
- Tailwind CSS via CDN: `<script src="https://cdn.tailwindcss.com"></script>`
- Placeholder images: `https://placehold.co/WIDTHxHEIGHT`
- Mobile-first responsive

## Brand Assets
- Always check the `brand_assets/` folder before designing. It may contain logos, color guides, style guides, or images.
- If assets exist there, use them. Do not use placeholders where real assets are available.
- If a logo is present, use it. If a color palette is defined, use those exact values — do not invent brand colors.

## Anti-Generic Guardrails
- **Colors:** Never use default Tailwind palette (indigo-500, blue-600, etc.). Pick a custom brand color and derive from it.
- **Shadows:** Never use flat `shadow-md`. Use layered, color-tinted shadows with low opacity.
- **Typography:** Never use the same font for headings and body. Pair a display/serif with a clean sans. Apply tight tracking (`-0.03em`) on large headings, generous line-height (`1.7`) on body.
- **Gradients:** Layer multiple radial gradients. Add grain/texture via SVG noise filter for depth.
- **Animations:** Only animate `transform` and `opacity`. Never `transition-all`. Use spring-style easing.
- **Interactive states:** Every clickable element needs hover, focus-visible, and active states. No exceptions.
- **Images:** Add a gradient overlay (`bg-gradient-to-t from-black/60`) and a color treatment layer with `mix-blend-multiply`.
- **Spacing:** Use intentional, consistent spacing tokens — not random Tailwind steps.
- **Depth:** Surfaces should have a layering system (base → elevated → floating), not all sit at the same z-plane.

## Data Model

**Architecture: Path A — direct Supabase.** The browser talks to Supabase directly via `window._supabase` (created in `config.js`); there is **no Node API** (the `server/` folder is retired — see `server/README.md`). All entities — postings, applications, notifications, message_threads, messages, profiles/students/employers — live in Supabase and are accessed through the async wrappers in `data.js`. Security is enforced by Postgres **Row Level Security**; treat it as load-bearing.

RLS, grants, locks, triggers, and RPCs are defined in `supabase/migrations/` (run in order):
- `20260526000000_initial_schema.sql` — tables, base RLS, auth trigger
- `20260603000000_pathA_grants_rls.sql` — role GRANTs, full RLS policy set, privilege-escalation column locks, `postings_public` view
- `20260603010000_pathA_onboarding.sql` — per-role signup trigger + `students.profile` jsonb
- `20260603020000_pathA_rpcs_triggers.sql` — `claim_role()` / `notify_coordinators()` RPCs + cross-user notification triggers

### Client-side storage (the ONLY things not in Supabase)
| Key | Store | Type | Description |
|-----|-------|------|-------------|
| `sib_user` | localStorage | object | Cached authenticated user (display/role convenience; the Supabase session is the source of truth) |
| `sib_token` | localStorage | string | Cached Supabase access token |
| `sib_student_app` | sessionStorage | object | Student onboarding form state + résumé data URL (résumé file storage is a follow-up) |
| `sib_emp_data` | sessionStorage | object | Employer registration form state |

> The former localStorage collections (`sib_notifications`, `sib_message_threads`, `sib_messages`, `sib_coordinators`, `sib_approved_employers`) no longer exist — they are Supabase tables (`notifications`, `message_threads`, `messages`, and `profiles`/`employers.coordinator_approved`). The object shapes documented below are the camelCase forms returned by `data.js` converters.

### User object (`sib_user`)
```js
{
  id: string,
  name: string,                         // full display name
  first: string,
  email: string,
  role: 'student' | 'employer' | 'coordinator',
  emailVerified: boolean,               // false for new signups until Phase 2 flow
  emailVerificationToken: string | null,
  emailVerificationExpiresAt: string | null,  // ISO timestamp
  notificationPreferences: {
    signupConfirm:     'immediate' | 'daily' | 'off',
    newApplication:    'immediate' | 'daily' | 'off',
    applicationStatus: 'immediate' | 'daily' | 'off',
    newListing:        'immediate' | 'daily' | 'off',
    newMessage:        'immediate' | 'daily' | 'off'
  },
  createdAt: string  // ISO timestamp
}
```
> **Migration note:** `migrateExistingData()` backfills all new fields on every page load. Existing accounts get `emailVerified: true` so dev sessions are unaffected. New signups receive `false`.

### Posting object (API → camelCase via `_postingFromApi`)
```js
{ id, employerId, companyName, supervisorName, title, track, workMode,
  hoursPerWeek, location, startDate, deadline, description,
  responsibilities, requirements, isActive, createdAt, updatedAt }
```

### Application object (API → camelCase via `_appFromApi`)
```js
{ id, postingId, studentId, studentName, school, grade,
  coverNote, resumeUrl,
  status: 'Applied' | 'Under Review' | 'Interview' | 'Rejected' | 'Accepted',
  appliedAt, updatedAt, _posting, _student }
```

### Notification object (`sib_notifications[]`)
```js
{ id: string, userId: string, type: string,
  payload: object,           // varies by type
  createdAt: string,         // ISO
  readAt: string | null,
  emailedAt: string | null }
```

### MessageThread object (`sib_message_threads[]`)
```js
{ id: string, studentId: string, employerId: string,
  listingId: string | null, applicationId: string | null,
  createdAt: string, lastMessageAt: string,
  status: 'open' | 'closed' | 'flagged' }
```

### Message object (`sib_messages[]`)
```js
{ id: string, threadId: string, senderId: string,
  senderRole: 'student' | 'employer' | 'coordinator',
  body: string, createdAt: string,
  flagged: boolean, flagReasons: string[],
  reviewedByCoordinator: boolean }
```

### Coordinator object (`sib_coordinators[]`)
```js
{ id: string, name: string, email: string,
  schoolBoard: string, createdAt: string }
```

### flaggedTerms config (`data.js`)
```js
{
  phoneNumbers:       RegExp[],  // matched against message body
  emails:             RegExp[],
  socialHandles:      RegExp[],
  urls:               RegExp[],
  profanity:          string[],  // substring match, case-insensitive
  offPlatformPhrases: string[]
}
```
> All arrays are empty until Phase 4.

### Email verification flow (`auth.js` + `email.js`)

**Token lifecycle:**
- On signup: `emailVerified: false`, `emailVerificationToken` = 64-char hex (crypto.getRandomValues), `emailVerificationExpiresAt` = now + 24 h
- On click of `index.html#verify?token=<token>`: DOMContentLoaded handler calls `_handleVerificationToken()`, which validates token + expiry, sets `emailVerified: true`, clears token fields
- Existing/migrated accounts: `emailVerified: true` (set by `migrateExistingData()`)
- Login on same device: `_mergeVerificationState()` preserves the stored `emailVerified` value
- Login on new/different device: defaults to `true` (production will read from DB)

**Auth gates:**
- `goDashboard()` — shows `_showVerifyPending()` if unverified
- `requireAuth(page)` — same gate
- `requireAuthForUrl(url)` — same gate
- `requireVerified(callback)` — use for any action that needs a verified account (post listing, apply, send message)

**Resend:** `resendVerificationEmail()` — rate-limited to once per 60 s via `sessionStorage.sib_resend_at`; regenerates token + resets expiry

**Coordinator escape hatch:**
- `coordinatorManualVerify(userId)` — JS function, works only for the currently logged-in user (Phase 5 will replace with API call)
- `sibVerifyUser(emailOrId)` — browser console command, works for the stored user on this device

**Email transport (`email.js`):**
- `sendEmail({ to, subject, body, type })` — single entry point; swap transport by replacing the body only
- Dev mock: logs to console + shows a persistent `#_devEmailToast` with a clickable verify link
- `TODO` comment marks the swap point for Resend/Postmark

**Script load order (every page):**
`config.js` → `data.js`* → `email.js` → `notifications.js` → `moderation.js` → `messaging.js`* → `auth.js` → `app.js`
(*data.js and messaging.js omitted on pages that don't need them)

### Notification system (`notifications.js`)

**Entry point:** `createNotification({ userId, type, payload, userEmail })`
- Always writes an in-app record via `_insertNotification` (data.js)
- Sends email immediately if recipient's preference for that type is `'immediate'` AND `userEmail` is passed
- **Cross-user notifications** (employer notified of an applicant, student of a status change, coordinators of flags/placements) are created by **`SECURITY DEFINER` database triggers**, NOT by the client — `createNotification`/`_insertNotification` can only write a notification addressed to the current user (RLS `notifications_insert_self_only`). Coordinator-targeted client notices (non-board signup, unknown employer, concern report, manual thread report) go through the `notify_coordinators()` RPC.
- Refreshes the bell badge automatically if the recipient is the current user

**Notification types and where they're fired:**
| Type | Fired from | Recipient |
|------|-----------|-----------|
| `signupConfirm` | `auth.js doSignup()` | new user (student or employer) |
| `newListing` | `dashboard-employer.html savePosting()` | employer (posting confirmation) |
| `applicationSubmitted` | `posting.html submitApplication()` | student |
| `newApplication` | `posting.html submitApplication()` | employer (in-app only) |
| `applicationStatus` | `applicants.html changeStatus()` | student (in-app only) |

**Preference values:** `'immediate'` | `'daily'` | `'off'`
- `immediate` → email sent right away
- `daily` → stored, batched into digest (TODO Phase 5)
- `off` → in-app record only, never emailed

**Bell UI:** `initNotifBell()` — call once in each dashboard's DOMContentLoaded. Injects a bell button into `.sidebar-bottom`; dropdown shows last 12 notifications.

**Preference page:** `buildNotifPrefsHtml(role)` — renders the settings card. Called when user navigates to the Settings section in either dashboard.

**TODO Phase 5 items:**
- Daily digest delivery (query unread, batch per user, set `emailedAt`)
- Pass employer/student email server-side for cross-user immediate email
- Notify coordinator when application status = `'Accepted'` (see `TODO` in `applicants.html changeStatus`)
- Send `listingDigest` to students with matching track interests on new listing post

### Debug
Open the browser console on any page and run:
```js
sibDump()          // snapshot of all localStorage collections + flaggedTerms
sibVerifyUser('user@email.com')  // coordinator/dev escape hatch — marks user as verified
```

### Messaging system (`messaging.js` + `moderation.js`)

Messaging is gated exclusively on accepted applications. This is the highest-safety-priority feature in SiB because it involves adult employers communicating with minor students.

**Access rules:**
- Message button appears ONLY on applications where `status === 'Accepted'` — no cold messaging
- Employers initiate from applicants.html or their dashboard Applications tab
- Students initiate from their dashboard Applications tab
- `msOpenOrCreate(params)` is idempotent: one thread per `applicationId`, never duplicated

**Rate limits (`data.js checkMessageRateLimit`):**
- 20 messages per sender per rolling hour
- 5 new threads per sender per rolling 24-hour day
- Friendly error surfaced in UI on limit hit; no silent failure

**Content moderation (`moderation.js analyzeMessage`):**
- Runs on every outbound message before delivery
- Detects: phone numbers (5 regex patterns), personal email domains (gmail/hotmail/yahoo/etc.), URLs (http and www forms), social media platform names + @handles, off-platform phrases (20+ phrases: "text me", "call me", "WhatsApp", etc.)
- Does NOT block delivery — flagging is for coordinator review only, consistent with school board policy
- If flagged: sender sees a pre-flight warning modal listing each reason; they must explicitly confirm before the message sends
- Flagged message stored with `flagged: true`, `flagReasons: string[]`; thread `status` set to `'flagged'`; coordinator notified via `_notifyCoordinators()`

**Permanent audit trail:**
- Every message stored in `sib_messages[]` with threadId, senderId, senderRole, body, createdAt, flagged, flagReasons, reviewedByCoordinator
- Messages are never deleted; coordinators can review full thread history
- Thread view shows persistent amber notice: *"All messages are logged and reviewed by the SiB coordinator. Keep all communication professional and on-platform."*
- Notice is rendered on every thread render, not dismissable

**Coordinator visibility:**
- `_notifyCoordinators()` writes a `messageFlagged` notification to every coordinator in `sib_coordinators[]`
- Coordinator dashboard links directly to flagged thread
- TODO Phase 6: coordinator-reviewed attachments (no file upload in v1)

**Report button:**
- Every thread view has a "Report this conversation" button (`msReportThread`)
- Sets thread `status: 'flagged'`, writes a `messageFlagged` notification to all coordinators
- User sees confirmation toast; button replaced with "Reported" text after use

**No attachments:** Text-only in v1. No file input exists. TODO comment in send area for Phase 6 coordinator-reviewed attachment flow.

**Notification on new message:** `createNotification({ type: 'newMessage', ... })` — respects recipient's `newMessage` preference; notification links to correct dashboard (role-aware).

## Messaging Safeguards — School Board Review Summary

The following is the complete list of safety controls implemented for the minor-adult messaging feature. This section is written for co-op teacher / school board review.

1. **Gated access**: Messaging is only available after an employer has explicitly accepted a student's application. Neither party can initiate contact with a stranger — the co-op placement must already be confirmed.
2. **Permanent logging**: Every message is stored permanently and cannot be deleted by either party. The full conversation history is always available to coordinators.
3. **On-screen notice**: A non-dismissable amber warning is displayed inside every conversation reminding both parties that messages are logged and reviewed by the SiB coordinator.
4. **Automated content scanning**: Every outbound message is analyzed before delivery for phone numbers, personal email addresses, website URLs, social media handles/platform names, and off-platform phrases. Detection is keyword/regex based and runs entirely client-side.
5. **Pre-send warning**: If a message triggers a flag, the sender is shown a warning dialog listing exactly why it was flagged. They must click "Send anyway" to proceed — they cannot claim ignorance.
6. **Coordinator notification**: Flagged messages automatically notify every registered coordinator with a link to the conversation. Coordinators can review the full thread.
7. **Report button**: Either party can report a conversation at any time. This flags the thread and immediately notifies all coordinators.
8. **Rate limiting**: Senders are capped at 20 messages per hour and 5 new conversations per day to prevent harassment or spam campaigns.
9. **No file attachments**: Only plain text is allowed in v1. No images, documents, or links can be sent as files.
10. **Coordinator accounts**: The `sib_coordinators[]` store allows registering one or more school board coordinators who receive all flagged-message notifications.

## Coordinator Role (`coordinator-login.html` + `coordinator-dashboard.html`)

Coordinators are co-op teachers who oversee placements. There is no public coordinator signup — accounts are seeded in `data.js` and manually managed.

**Login:** `coordinator-login.html` — signs in with **Supabase Auth** (`signInWithPassword`), then reads `profiles.role` and proceeds only if it is `'coordinator'`; otherwise it signs back out. A real Supabase session/JWT is issued, and the dashboard reads all data directly from Supabase scoped by the coordinator RLS policies (`is_coordinator()` grants read oversight on every table).

**Coordinator accounts** are real Supabase Auth users whose `profiles.role` is set to `'coordinator'` **manually** in the Supabase SQL editor. There is no public coordinator signup, and the signup trigger can never assign the coordinator role (it coerces anything that isn't `student`/`employer` to `student`). To promote someone: create/locate their auth user, then `UPDATE public.profiles SET role='coordinator' WHERE id='<uuid>';`.
TODO (post-launch): email-based coordinator invite-and-activate flow.

**Coordinator dashboard sections** (all data is read directly from Supabase via the `cGet/cPut/cDel` dispatchers in `coordinator-dashboard.html`, scoped by coordinator RLS — the "API `/coordinator/*`" and "localStorage" labels below are historical):
| Section | Source | Description |
|---------|--------|-------------|
| Overview | API + localStorage | Stat cards: students, employers, listings, applications, placements, flagged threads |
| Users | API `/coordinator/users` | Students + employers with verified badge; Verify button calls API or shows console fallback |
| Placements | API `/coordinator/applications` (Accepted only) | Co-op credit tracking — student, school, grade → employer, role, start date |
| Messages | localStorage `getAllMessageThreads()` | Read-only thread viewer; flag reasons shown prominently; always available offline |
| Reports | localStorage (flagged threads) | Flagged + unreviewed threads with one-click "Review thread →" |
| Listings | API `/coordinator/postings` | Archive / reactivate / delete postings; links to applicants.html |
| Applications | API `/coordinator/applications` | Full cross-listing application list with status filter |

**Coordinator thread review (`coordinatorReviewThread`):**
- Coordinator can mark a thread as "reviewed" and leave an internal note (stored in `thread.coordinatorNote`)
- Note is only rendered in coordinator-dashboard.html — students and employers never see it
- After review, the thread shows a green "✓ Reviewed by [name]" indicator in both coordinator dashboard AND in student/employer messaging UI (`messaging.js` `_msRenderThreadHeader`)
- Coordinator can also "Close thread" (sets `status: 'closed'`)
- Coordinator cannot send messages — the dashboard has no send UI

**`newPlacement` notification:**
- Fired in `applicants.html changeStatus()` when an employer sets status → "Accepted"
- Calls `notifyCoordinators('newPlacement', { ... })` from `notifications.js`
- Creates in-app record for each coordinator in `sib_coordinators[]`
- Tab count badge on Reports tab turns red when unreviewed flagged threads exist

**`notifyCoordinators(type, payload)` (in `notifications.js`):**
- Public helper — writes `_insertNotification` for every coordinator in `sib_coordinators[]`
- Called by: `applicants.html` (newPlacement), `messaging.js` (messageFlagged via `_notifyCoordinators` delegate)
- Sentinel record written to `userId: 'sib_coordinator'` if no coordinators are registered

**Manual user verification:**
- "Verify →" button on each user card in coordinator Users tab
- Tries `PUT /coordinator/users/:id { email_verified: true }` first
- Falls back to clipboard copy of `sibVerifyUser("email@domain.com")` console command if API fails
- TODO Phase 6: proper coordinator-triggered API verification without requiring same-device access

## Privacy and Compliance (`data.js`, `auth.js`, `app.js`, `privacy.html`, `terms.html`)

### Domain trust system (`data.js`)

`domainConfig` object controls trust policy:
```js
const domainConfig = {
  trustedStudentDomains:   [],  // school board student/staff domains — populate when confirmed
  trustedEmployerDomains:  [],  // partner company domains — populate when confirmed
  flagNonBoardStudents:    true,
  requireEmployerApproval: true
};
```

**Helper functions:**
- `getDomainFromEmail(email)` — extracts domain suffix
- `isStudentTrustedDomain(email)` — true for recognised school board addresses
- `isEmployerTrustedDomain(email)` — true for partner company domains
- `employerCanPost(user)` — returns true if employer can create listings (trusted domain OR coordinator-approved OR in `sib_approved_employers[]`)

**User shape additions** (backfilled with `true` for existing accounts in `migrateExistingData()`):
- `domainVerified: boolean` — set at signup based on email domain
- `coordinatorApproved: boolean` — set to same value as domainVerified at signup; can be overridden by coordinator approval flow

**`sib_approved_employers` (localStorage key):**
- Array of lowercase email strings approved by coordinator via the coordinator dashboard
- Read by `employerCanPost()` at runtime — works without the user logging out and back in

### Signup flow changes (`auth.js`)

1. **Terms checkbox**: Injected before the signup submit button via DOMContentLoaded. Blocks signup if unchecked.
2. **Domain check**: After API registration, sets `domainVerified` and `coordinatorApproved` based on email domain.
3. **Coordinator notifications**: 
   - Non-board student signup → `notifyCoordinators('newUserReview', { email, name })`
   - Unknown employer domain signup → `notifyCoordinators('employerPendingApproval', { email, companyName, userId })`

### Posting gate (`dashboard-employer.html`)

`savePosting()` calls `employerCanPost(currentUser)` at the top and shows a pending-approval toast if the result is false.

### Coordinator approval UI (`coordinator-dashboard.html`)

`renderUsers()` reads `sib_approved_employers[]` and shows per-employer:
- "✓ Posting Approved" badge for already-approved employers
- "Approve to Post →" button for unapproved employers

`approveEmployer(email, name)` — adds email to `sib_approved_employers[]`, shows toast, re-renders.

### Footer and concern reporting (`app.js`)

Injected via DOMContentLoaded into every `.footer-inner`:
- Privacy Policy link → `privacy.html`
- Terms of Use link → `terms.html`
- "Report a concern" button → opens modal

**Report concern modal** — `openReportConcernModal()` / `closeReportConcernModal()` / `submitReportConcern()`:
- Collects name, email, concern type, and detail text
- Calls `notifyCoordinators('concernReport', payload)` on submit

### Legal pages

- **`privacy.html`** — full Privacy Policy (11 sections): data collected, school board compliance, messaging monitoring, storage, email, rights, cookies, contact
- **`terms.html`** — full Terms of Use (12 sections): eligibility, accounts, acceptable use, messaging rules, employer responsibilities, coordinator oversight, disclaimer, contact

Both pages use shared styles from `style.css` and load the full script stack (`config.js` → `data.js` → `email.js` → `notifications.js` → `auth.js` → `app.js`).

### Notification types added (`notifications.js`)

| Type | Fired from | Recipient |
|------|-----------|-----------|
| `newUserReview` | `auth.js doSignup()` | all coordinators |
| `employerPendingApproval` | `auth.js doSignup()` | all coordinators |
| `employerApproved` | (future — coordinator dashboard API call) | employer |
| `concernReport` | `app.js submitReportConcern()` | all coordinators |

## Final Architecture Summary

### Files (all in project root)

| File | Purpose |
|------|---------|
| `index.html` | Landing page + auth modal (signup/login) + email verification handler |
| `job-listings.html` | Browse active co-op listings with track/mode filters |
| `posting.html` | Individual listing detail + application flow |
| `student-apply.html` | SiB program application (student onboarding form) |
| `employer-register.html` | Employer company profile registration |
| `dashboard-student.html` | Student dashboard: Overview, Applications, Application form, Placement, Messages, Notifications, Settings |
| `dashboard-employer.html` | Employer dashboard: Overview, Postings (CRUD), Browse Candidates, My Company, Messages, Notifications, Settings |
| `applicants.html` | Employer view of applicants for a specific posting; status management |
| `coordinator-login.html` | Coordinator-only login (no public signup) |
| `coordinator-dashboard.html` | Coordinator dashboard: 7 sections (Overview, Users, Placements, Messages, Reports, Listings, Applications) |
| `privacy.html` | Full Privacy Policy (11 sections, school board-compliant) |
| `terms.html` | Full Terms of Use (12 sections) |
| `listings.html` | Legacy listings page (redirects to job-listings.html) |
| `resources.html` | Student career resources |
| `auth-callback.html` | OAuth callback handler (Google auth) |

### JS files

| File | Purpose | Loaded on |
|------|---------|-----------|
| `config.js` | SUPABASE_URL, SUPABASE_ANON_KEY, getToken(), Supabase client init (no API_BASE — Path A) | Every page |
| `data.js` | All data functions: direct Supabase queries, shape converters, domain config, migration | Every page |
| `email.js` | sendEmail() mock (console log + neutral toast) | Every page |
| `notifications.js` | createNotification(), notifyCoordinators(), initNotifBell(), buildNotifPrefsHtml() | Every page |
| `moderation.js` | analyzeMessage() — content scan for phone/email/URL/social/phrases | Dashboard + messaging pages |
| `messaging.js` | msInit(), msOpenOrCreate(), msSendMessage(), msRenderInbox() | Dashboard pages |
| `auth.js` | doLogin(), doSignup(), doSignOut(), verification flow, terms checkbox injection | Every page |
| `app.js` | showToast(), modals, nav, renderStudents(), footer injection, report-concern modal | Every page |

### Notification types (all in notifications.js)

| Type | Fired from | Recipient |
|------|-----------|-----------|
| `signupConfirm` | auth.js doSignup() | new user |
| `newListing` | dashboard-employer.html savePosting() | employer |
| `applicationSubmitted` | posting.html submitApplication() | student |
| `newApplication` | posting.html submitApplication() | employer (in-app) |
| `applicationStatus` | applicants.html changeStatus() | student (in-app) |
| `newMessage` | messaging.js msSendMessage() | recipient |
| `messageFlagged` | messaging.js, msReportThread() | all coordinators |
| `newPlacement` | applicants.html changeStatus() → Accepted | all coordinators |
| `newUserReview` | auth.js doSignup() non-board student | all coordinators |
| `employerPendingApproval` | auth.js doSignup() unknown employer | all coordinators |
| `employerApproved` | coordinator-dashboard.html approveEmployer() | employer (planned) |
| `concernReport` | app.js submitReportConcern() | all coordinators |

### Phase status

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Core listings, apply flow, dashboards, email mock | ✓ Complete |
| 2 | Email verification, notification preferences, resend flow | ✓ Complete |
| 3 | Messaging (gated, logged, moderated), coordinator notifications | ✓ Complete |
| 4 | Content moderation (scan + pre-send warning + flag) | ✓ Complete |
| 5 | Coordinator role + dashboard (7 sections), thread review, placement tracking | ✓ Complete |
| 6 | Privacy/compliance: domain trust, terms checkbox, employer approval, legal pages, concern reporting | ✓ Complete |
| 7 (planned) | Server-side email relay, coordinator invite flow, file attachments (coordinator-reviewed) | Planned |

### Demo removal

Demo functionality and screenshot tooling are fully removed. This is the production codebase.

## Post-audit backlog (June 2026)

A full **read-only site audit was completed June 2026** and every flow-breaking issue it surfaced was fixed (the missing-`await` data reads on posting/applicants/dashboards, the employer applicant-access UUID-vs-email mismatch, the unwired Browse Candidates gallery, the notification-email links that ignored the `/SiB/` subpath, and the dead `localhost:3001` CSP entry). The items below are the **deferred** carry-overs — intentionally parked, not lost:

- **`notify_coordinators` rate-limiting (NOT a revoke).** The RPC is intentionally left **`anon`-executable** because anonymous safety reporting — the footer "Report a concern" button on public pages — depends on it; revoking anon `EXECUTE` would *silently drop anonymous child-safety reports* (the client swallows the error and still shows "✓ submitted"). The spam surface is to be addressed by **server-side rate-limiting**, built alongside the planned messaging rate-limits — never by revoking anon.
- **BFG git-history purge.** Old demo/coordinator passwords still exist in **public git history**. They are already rotated/inert, so this is *not a live hole*. The purge rewrites history and force-pushes, so it needs **Yousef's explicit OK and a calm window** — deliberately NOT done near the presentation.
- **Deploy-signs-me-out quirk.** Pushing to GitHub Pages clears the session and signs out logged-in users. Harmless (no data loss), parked. Investigate the session-check-on-load path when convenient.
- **Supabase Auth leaked-password protection.** Currently **disabled** (flagged by the security advisor); a dashboard setting to enable when convenient.
- **Browse Candidates depth.** Live but minimal: only privacy-safe fields are shown, and the intro request is a **coordinator-mediated toast stub with no backend**. Deeper profile fields and a real intro-request flow are future work.
- **Other carry-overs:** coordinator email-verify Edge Function (manual verify needs `service_role`, unavailable client-side); accepted-student **supervisor display** on the confirmed placement; **résumé file storage** via a Supabase Storage bucket (currently a résumé URL only).

## Hard Rules
- Do not add sections, features, or content not in the reference
- Do not "improve" a reference design — match it
- Do not use `transition-all`
- Do not use default Tailwind blue/indigo as primary color
