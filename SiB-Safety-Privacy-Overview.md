# SiB Safety and Privacy Overview

**Students in Business — Co-op Placement Platform**  
Prepared for: the SiB coordinator, the school board Co-op Office, employer partners  
Last updated: May 12, 2026

---

## Purpose

This document summarises every safety and privacy control implemented in the SiB platform. It is intended for review by co-op teachers, school board administrators, and employer partners.

SiB connects Ottawa-area secondary school students with local employers for co-op placements. Because the platform involves adult employers communicating with minor students, safety was designed as the foundational requirement — not an afterthought.

---

## 1. Email Verification

Every new account must verify their email address before accessing protected features (dashboards, applications, messaging).

| Detail | Implementation |
|--------|---------------|
| Verification method | One-time link emailed to the registered address; expires in 24 hours |
| Unverified users | Redirected to a verification-pending screen; cannot apply, post, or message |
| Resend rate limit | Once per 60 seconds to prevent email abuse |
| Board email filtering | School board email addresses may be filtered by the school board's mail systems. Students are warned to check spam, and coordinators can manually verify accounts |
| Manual verification | Coordinator can verify any account through the coordinator dashboard (API call) or via console command fallback (`sibVerifyUser("email@domain.com")`) |
| Existing accounts | Backfilled as verified on first load so live sessions are not disrupted during rollout |

---

## 2. School Board Domain Trust

SiB distinguishes between board-issued and external email addresses at signup.

**Trusted student domains** (configured in `data.js`):
- School board student and staff email domains, configured per deployment

Students signing up with one of these addresses receive a **"✓ Verified school account"** badge and are automatically trusted. Students using personal or other email addresses can still sign up, but:

- Their accounts are **flagged for coordinator review** on signup
- The coordinator receives an immediate in-app and email notification
- Their accounts remain functional but are visible to coordinators for review

**Trusted employer domains** (configured in `data.js`, initially empty):
- Intended for known partner company domains
- Employers on this list bypass the coordinator approval gate automatically
- List is populated by the SiB administrator — not publicly editable

**Employer posting approval:**
- By default, employers with unrecognised domains cannot publish listings until a coordinator explicitly approves their account
- The coordinator dashboard shows a **"Approve to Post →"** button per employer
- Approval is stored in `sib_approved_employers[]` and takes effect immediately
- Employers are notified when approved

---

## 3. Messaging Safeguards

Messaging is the highest-risk feature on SiB. The following ten safeguards are implemented:

### 3.1 Gated access
The **"Message" button appears only after an employer has formally accepted a student's application.** Neither party can initiate contact with a stranger. Co-op placement must already be confirmed before any messages are exchanged.

### 3.2 Permanent message logging
Every message is stored permanently in the SiB database and cannot be deleted by either party. The full conversation history is always accessible to registered coordinators.

### 3.3 Non-dismissable on-screen notice
A permanent amber notice is rendered at the top of every conversation:

> *"All messages are logged and may be reviewed by your co-op coordinator. Do not share personal contact information or arrange to communicate off this platform."*

This notice cannot be hidden or dismissed. Both the student and employer see it on every page load.

### 3.4 Automated content scanning
Every outbound message is scanned before delivery for:
- **Phone numbers** — 5 regex patterns covering North American formats
- **Personal email addresses** — gmail, hotmail, yahoo, outlook, and 10+ other common domains
- **Website URLs** — http://, https://, and www. prefixes
- **Social media** — platform names (Instagram, Snapchat, Discord, Telegram, WhatsApp, TikTok) and @handle patterns
- **Off-platform phrases** — 30+ phrases including "text me", "call me", "WhatsApp me", "find me on", "outside of this platform", etc.

Scanning runs entirely client-side on every message before it is stored.

### 3.5 Pre-send warning modal
If a message triggers any flag, the sender is shown a modal listing **exactly which flags were triggered** before the message can be sent. They must click **"Send anyway"** to proceed. They cannot claim ignorance of the flagged content.

### 3.6 Coordinator notification on flagged message
Every flagged message immediately creates an in-app notification for **all registered coordinators**, linking directly to the conversation. Coordinators can review the full thread from the coordinator dashboard.

### 3.7 Report button
Either party (student or employer) can click **"Report this conversation"** at any time. This:
- Sets the thread status to `flagged`
- Creates an immediate notification for all coordinators
- Shows the user a confirmation toast
- Replaces the report button with "Reported" text so it cannot be clicked again

### 3.8 Message rate limits
Senders are capped at:
- **20 messages per hour** per sender
- **5 new conversations per 24-hour period** per sender

Limits are enforced before any message is stored or displayed. Users see a clear error if they hit a limit.

### 3.9 No file attachments
Only plain text messages are permitted in v1. There is no file input. No images, documents, or links can be sent as file attachments.

### 3.10 Coordinator accounts
All registered school board co-op teachers are listed in `sib_coordinators[]`. They receive all flagged-message and placement notifications, and can read every thread on the platform regardless of which students or employers are involved.

---

## 4. Coordinator Oversight

Coordinators have read access to everything on the platform and receive proactive alerts for events that require review.

### What coordinators can see
| Section | Data |
|---------|------|
| Overview | Platform-wide stats: total students, employers, listings, applications, accepted placements, flagged threads |
| Users | All student and employer accounts with verification status; "Approve to Post" control per employer |
| Placements | All accepted co-op placements with student name, school, grade, employer, role, and start date |
| Messages | All message threads across all participants; full message history; flag reasons displayed prominently |
| Reports | Flagged and unreviewed threads with one-click "Review thread →" |
| Listings | All active and archived co-op postings; archive/reactivate/delete controls |
| Applications | Full cross-listing application list with status filter |

### Coordinator thread review
When a coordinator opens a flagged thread:
1. They see all messages, with flagged messages highlighted and flag reasons listed
2. They can leave an **internal coordinator note** (only visible in the coordinator dashboard — never to students or employers)
3. They can **mark the thread as reviewed** (shows a "✓ Reviewed by [name]" indicator to all parties in the conversation)
4. They can **close the thread** (sets status to `closed`)
5. Coordinators cannot send messages — the dashboard has no send interface

### Coordinator notifications
Coordinators receive immediate in-app notifications for:
- New co-op placements (employer accepts a student)
- Flagged messages (automated scan or manual report)
- Non-board student signups (for review)
- Unknown employer domain registrations (for approval)
- User-submitted concern reports

---

## 5. Reporting Mechanisms

### "Report a concern" (footer)
Every page on SiB includes a **"Report a concern"** link in the footer. Clicking it opens a modal where anyone (logged in or not) can submit:
- Their name and email (optional, for follow-up)
- Concern type (inappropriate message, unsafe employer, student wellbeing, technical issue, other)
- Free-text detail

All concern reports notify all registered coordinators immediately.

### In-thread report button
Every message thread has a "Report this conversation" button. See §3.7 above.

### Console verification command
For testing and coordinator use:
```js
sibVerifyUser("student@email.com")  // Marks the current logged-in user as verified
sibDump()                            // Prints a full snapshot of all localStorage data
```

---

## 6. Privacy Policy

A full Privacy Policy is available at `/privacy.html`. It covers 11 sections:

1. Who we are
2. Information we collect (from students, employers, coordinators, and automatically)
3. How we use your information
4. **Student data and school board compliance** — includes the explanation of domain trust, messaging logging, and coordinator access
5. Messaging and content moderation
6. Data storage and security (Supabase + localStorage)
7. Email communications (opt-in/out by type)
8. **Your rights** — access, correction, deletion, export
9. Cookies and local storage
10. Changes to this policy
11. Contact

The Privacy Policy is linked from the footer of every page and must be accepted (checkbox) during signup.

---

## 7. Terms of Use

A full Terms of Use is available at `/terms.html`. It covers 12 sections:

1. About SiB
2. **Eligibility** — school board verification for students; coordinator-approval requirement for employers
3. Accounts and security
4. **Acceptable use** — explicit prohibition on off-platform contact, harassment, and misrepresentation
5. **Messaging and communication** — consent to logging, flagging, and coordinator access
6. **Employer responsibilities** — ESA compliance, supervision, on-platform communication requirement
7. Content ownership
8. **Coordinator oversight** — authority to verify, approve, flag, and close
9. Privacy (reference to Privacy Policy)
10. Disclaimer and limitation of liability
11. Changes to terms
12. Contact and concerns

Users must check a "I have read and agree to SiB's Terms of Use and Privacy Policy" checkbox before creating an account. The checkbox is enforced client-side — signup is blocked if unchecked.

---

## 8. Data Architecture

| Data type | Storage | Access |
|-----------|---------|--------|
| User accounts, postings, applications | Supabase (PostgreSQL, encrypted at rest) | Via authenticated API with JWT bearer tokens |
| Message threads, messages | Browser localStorage + Supabase (future) | Coordinators: full read; Students/employers: own threads only |
| Notifications | Browser localStorage | Recipients only; coordinator sees all |
| Coordinator accounts | Browser localStorage (temp) | Coordinator dashboard only |
| Session state | Browser localStorage + sessionStorage | Current device only; cleared on sign-out |

Passwords are hashed before storage. No plain-text passwords are stored (coordinator shared password is a known TODO for Phase 6 invite flow).

---

## 9. Known Limitations (Planned Improvements)

| Limitation | Status |
|------------|--------|
| Coordinator auth uses a shared password instead of invite-based login | Planned — Phase 6 |
| Message logging is localStorage-only on the client; no server-side permanent store yet | Planned — Phase 5 |
| Cross-user email notifications (e.g. employer emailed when student applies) require server-side relay | Planned — Phase 5 |
| Coordinator manual verification requires same-device access if API is unavailable | Planned — Phase 6 |
| No file attachment support | By design — v1; Phase 6 will add coordinator-reviewed attachments |

---

## 10. Contact

For questions about this platform's safety design:

- **Platform developer:** Yousef Saadaldin — ysaadaldin08@gmail.com
- **Co-op coordinator:** the SiB coordinator, school board
- **Concern reporting:** Available at every page's footer ("Report a concern")
