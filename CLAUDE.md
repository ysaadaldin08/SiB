# CLAUDE.md — Frontend Website Rules

## Always Do First
- **Invoke the `frontend-design` skill** before writing any frontend code, every session, no exceptions.

## Reference Images
- If a reference image is provided: match layout, spacing, typography, and color exactly. Swap in placeholder content (images via `https://placehold.co/`, generic copy). Do not improve or add to the design.
- If no reference image: design from scratch with high craft (see guardrails below).
- Screenshot your output, compare against reference, fix mismatches, re-screenshot. Do at least 2 comparison rounds. Stop only when no visible differences remain or user says so.

## Local Server
- **Always serve on localhost** — never screenshot a `file:///` URL.
- Start the dev server: `node serve.mjs` (serves the project root at `http://localhost:3000`)
- `serve.mjs` lives in the project root. Start it in the background before taking any screenshots.
- If the server is already running, do not start a second instance.

## Screenshot Workflow
- Puppeteer is installed as a project dependency (`node_modules/puppeteer`). No custom path needed.
- **Always screenshot from localhost:** `node screenshot.mjs http://localhost:3000`
- Screenshots are saved automatically to `./temporary screenshots/screenshot-N.png` (auto-incremented, never overwritten).
- Optional label suffix: `node screenshot.mjs http://localhost:3000 label` → saves as `screenshot-N-label.png`
- `screenshot.mjs` lives in the project root. Use it as-is.
- After screenshotting, read the PNG from `temporary screenshots/` with the Read tool — Claude can see and analyze the image directly.
- When comparing, be specific: "heading is 32px but reference shows ~24px", "card gap is 16px but should be 24px"
- Check: spacing/padding, font size/weight/line-height, colors (exact hex), alignment, border-radius, shadows, image sizing

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

All API-backed entities (postings, applications) live in Supabase and are accessed via the `data.js` async API wrappers. The following entities are stored in **localStorage** until a backend endpoint is added.

### localStorage keys
| Key | Type | Description |
|-----|------|-------------|
| `sib_user` | object | Authenticated user (see shape below) |
| `sib_token` | string | JWT bearer token |
| `sib_notifications` | array | In-app + email notification queue |
| `sib_message_threads` | array | Conversation threads |
| `sib_messages` | array | Individual messages within threads |
| `sib_coordinators` | array | Coordinator accounts |
| `sib_student_app` | object | Student onboarding form state |
| `sib_emp_data` | object | Employer registration form state |

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
- Cross-user notifications (e.g. employer notified when student applies): in-app record only — `userEmail: null`. Server-side will handle email in Phase 5.
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
- Does NOT block delivery — flagging is for coordinator review only, consistent with OCDSB policy
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

## Messaging Safeguards — OCDSB Review Summary

The following is the complete list of safety controls implemented for the minor-adult messaging feature. This section is written for co-op teacher / OCDSB review.

1. **Gated access**: Messaging is only available after an employer has explicitly accepted a student's application. Neither party can initiate contact with a stranger — the co-op placement must already be confirmed.
2. **Permanent logging**: Every message is stored permanently and cannot be deleted by either party. The full conversation history is always available to coordinators.
3. **On-screen notice**: A non-dismissable amber warning is displayed inside every conversation reminding both parties that messages are logged and reviewed by the SiB coordinator.
4. **Automated content scanning**: Every outbound message is analyzed before delivery for phone numbers, personal email addresses, website URLs, social media handles/platform names, and off-platform phrases. Detection is keyword/regex based and runs entirely client-side.
5. **Pre-send warning**: If a message triggers a flag, the sender is shown a warning dialog listing exactly why it was flagged. They must click "Send anyway" to proceed — they cannot claim ignorance.
6. **Coordinator notification**: Flagged messages automatically notify every registered coordinator with a link to the conversation. Coordinators can review the full thread.
7. **Report button**: Either party can report a conversation at any time. This flags the thread and immediately notifies all coordinators.
8. **Rate limiting**: Senders are capped at 20 messages per hour and 5 new conversations per day to prevent harassment or spam campaigns.
9. **No file attachments**: Only plain text is allowed in v1. No images, documents, or links can be sent as files.
10. **Coordinator accounts**: The `sib_coordinators[]` store allows registering one or more OCDSB coordinators who receive all flagged-message notifications.

## Coordinator Role (`coordinator-login.html` + `coordinator-dashboard.html`)

Coordinators are co-op teachers (e.g. Mr. Caap, OCDSB) who oversee placements. There is no public coordinator signup — accounts are seeded in `data.js` and manually managed.

**Login:** `coordinator-login.html` — checks against `sib_coordinators[]` in localStorage. On success, sets `currentUser.role = 'coordinator'` and redirects to dashboard. No Supabase JWT is issued; API calls in the dashboard fail gracefully if the server is unreachable.

**Seeded account:** `ysaadaldin08@gmail.com` / `***REMOVED***` (seeded in `migrateExistingData()` if the list is empty).
TODO Phase 6: Replace shared password with an email-based invite-and-activate flow.

**Coordinator dashboard sections:**
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
  trustedStudentDomains:   ['ocdsb.ca', 'ocdsbstudents.ca', 'ocsb.ca'],
  trustedEmployerDomains:  [],  // KNBA-member domains — populate when confirmed
  flagNonBoardStudents:    true,
  requireEmployerApproval: true
};
```

**Helper functions:**
- `getDomainFromEmail(email)` — extracts domain suffix
- `isStudentTrustedDomain(email)` — true for OCDSB/OCSB board addresses
- `isEmployerTrustedDomain(email)` — true for KNBA-member company domains
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

- **`privacy.html`** — full Privacy Policy (11 sections): data collected, OCDSB compliance, messaging monitoring, storage, email, rights, cookies, contact
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
| `privacy.html` | Full Privacy Policy (11 sections, OCDSB-compliant) |
| `terms.html` | Full Terms of Use (12 sections) |
| `listings.html` | Legacy listings page (redirects to job-listings.html) |
| `resources.html` | Student career resources |
| `auth-callback.html` | OAuth callback handler (Google auth) |

### JS files

| File | Purpose | Loaded on |
|------|---------|-----------|
| `config.js` | API_BASE, SUPABASE_URL, getToken() | Every page |
| `data.js` | All data functions: API wrappers, localStorage CRUD, shapes, domain config, migration | Every page |
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

## Hard Rules
- Do not add sections, features, or content not in the reference
- Do not "improve" a reference design — match it
- Do not stop after one screenshot pass
- Do not use `transition-all`
- Do not use default Tailwind blue/indigo as primary color
