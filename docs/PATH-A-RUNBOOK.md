# SiB — Path A Go-Live Run-Book

This is the checklist of things **you** have to do by hand to turn on the new
"Path A" setup (browser talks straight to Supabase, protected by database
security rules). Follow it top to bottom. You don't need to write any code —
just copy/paste and click.

Estimated time: ~30 minutes.

What you'll need:
- Login to your **Supabase dashboard** (the SiB project: `StudentsinBusiness`).
- This repository open so you can copy the SQL files.

> **Safety note:** the database starts in a "deny everything" state for browsers.
> The SQL below *grants* the minimum access and then locks it down with rules.
> If you stop halfway, the worst case is that the app can't read/write yet — your
> data is never exposed. The SQL files are safe to run more than once.

---

## Part 1 — Run the database SQL (in this exact order)

Your database **already has the tables** from the original build, so you do
**not** re-run the big `20260526000000_initial_schema.sql` file. You only run the
**three new files** below.

**How to run each file (same steps every time):**
1. In the Supabase dashboard, click **SQL Editor** in the left sidebar.
2. Click **+ New query**.
3. Open the file from the repo, copy **all** of it, paste into the editor.
4. Click **Run** (bottom right).
5. Check the result (see "✅ Success looks like" below).

Run them in this order:

### 1. `supabase/migrations/20260603000000_pathA_grants_rls.sql`
**What it does, in one sentence:** gives the browser the exact read/write access
each table needs, locks the rest behind per-user security rules, blocks anyone
from editing privileged fields (like making themselves a coordinator), and
creates the public job-board view that hides supervisors' names from logged-out
visitors.

✅ **Success looks like:** a green **"Success. No rows returned"** message.
❌ **Something's wrong if:** you see a red error mentioning a missing table or
column — stop and tell me which one; it means the base schema differs from what
we expect.

### 2. `supabase/migrations/20260603010000_pathA_onboarding.sql`
**What it does, in one sentence:** makes sure that when someone signs up, the
right kind of profile row is created automatically (a student row for students, a
company row for employers), and adds a place to store the student application
answers.

✅ **Success looks like:** **"Success. No rows returned."**

### 3. `supabase/migrations/20260603020000_pathA_rpcs_triggers.sql`
**What it does, in one sentence:** turns on the automatic notifications (employer
told of a new applicant, student told of a status change, coordinators told of
flags/placements) and the helper that lets Google sign-ups choose "student or
employer."

✅ **Success looks like:** **"Success. No rows returned."**

> If you ever need to re-run these, it's safe — they're written to be repeatable.

---

## Part 2 — Flip these Supabase dashboard switches

### A. Tell Supabase where the live site lives (REQUIRED — login/email links break without it)
1. Left sidebar → **Authentication** → **URL Configuration**.
2. Set **Site URL** to:
   `https://ysaadaldin08.github.io/SiB/`
3. Under **Redirect URLs**, click **Add URL** and add **both** of these:
   - `https://ysaadaldin08.github.io/SiB/auth-callback.html`
   - `http://localhost:3000/auth-callback.html`  *(so local testing works too)*
4. Click **Save**.

✅ **Success looks like:** the two redirect URLs are listed and saved.
❌ **If you skip this:** email-confirmation and Google sign-in links will bounce
to the wrong page or show an error.

### B. Make sure email confirmation is ON
1. **Authentication** → **Providers** (or **Sign In / Up**) → **Email**.
2. Confirm **"Confirm email"** is **enabled**.
3. Save if you changed anything.

### C. Turn on leaked-password protection (the security advisor flagged this)
1. **Authentication** → look for **Attack Protection** (some accounts label it
   **Password security** under Authentication settings).
2. Enable **"Leaked password protection"** (it checks new passwords against
   HaveIBeenPwned so people can't reuse known-breached passwords).
3. Save.

> Can't find the exact menu item? Use the dashboard search and type **"leaked"** —
> it'll jump you to the toggle. Reference:
> https://supabase.com/docs/guides/auth/password-security

---

## Part 3 — Promote YOUR account to coordinator

Coordinators are made by hand (there's no coordinator signup, and signups can
never make themselves coordinators — that's on purpose).

1. **First, sign up a normal account** on the live site with the email you want
   to be the coordinator (e.g. your `ysaadaldin08@gmail.com`) and confirm the
   email. This creates the underlying account.
2. Then go to **SQL Editor → New query**, paste this **one line** (change the
   email if needed), and **Run**:

```sql
UPDATE public.profiles
SET role = 'coordinator'
WHERE id = (SELECT id FROM auth.users WHERE email = 'ysaadaldin08@gmail.com');
```

3. Verify it worked — run this and check the role says `coordinator`:

```sql
SELECT p.email, p.role
FROM public.profiles p
WHERE p.email = 'ysaadaldin08@gmail.com';
```

✅ **Success looks like:** one row, `role = coordinator`.
4. Now sign in at **`coordinator-login.html`** with that email/password — you
   should land on the coordinator dashboard.

---

## Part 4 — Prove the privacy rules actually work (the important test)

This is a hands-on test to **prove** two promises:
- **A student can only ever see their own data.**
- **An employer cannot see an applicant's name/school until they Accept them.**

You'll create a few fake accounts and then check what each one can see. Use
throwaway emails you can receive (or the same inbox with `+tags`, e.g.
`you+studentA@gmail.com`).

### Set-up (about 10 minutes)
1. **Coordinator:** make sure you've done Part 3 (you're a coordinator).
2. **Student A:** on the live site, sign up as a **Student**, confirm the email,
   and complete the student application form.
3. **Student C:** sign up as a **second Student** (different email), confirm,
   complete the form. *(This is the "other student" whose data A must NOT see.)*
4. **Employer B:** sign up as an **Employer**, confirm, complete the company
   registration.
5. **Approve Employer B:** sign in as the **coordinator**, go to **Users**, find
   Employer B, click **"Approve to Post."**
6. **Post a job:** sign in as **Employer B** and create a listing.
7. **Apply:** sign in as **Student A** and apply to that listing.

### Test 1 — Employer sees "Applicant" until they Accept ✅
1. Sign in as **Employer B** → open the applicants for your listing.
2. **Before accepting:** you should see the application's **cover note**, but the
   applicant's name shows as **"Applicant"** — no real name, school, or grade.
   - ✅ **Safe:** name is hidden ("Applicant").
   - ❌ **FAILURE:** you can see Student A's real name/school before accepting —
     stop and tell me; the privacy rule isn't applied.
3. Change the application status to **"Accepted."** Refresh.
4. **After accepting:** the applicant's real name and school now appear.
   - ✅ **Safe:** details appear only after Accepting.

### Test 2 — A student can only see their own data ✅
You'll use the browser's built-in console. It sounds technical but it's just
copy/paste.

1. Sign in as **Student A** on the live site.
2. Press **F12** (or right-click → **Inspect**) and click the **Console** tab.
3. Paste this and press Enter:

```js
(async () => {
  const sb = window._supabase;
  const students = await sb.from('students').select('*');
  const profiles = await sb.from('profiles').select('*');
  const apps     = await sb.from('applications').select('*');
  console.log('students I can see:', students.data?.length);
  console.log('profiles I can see:', profiles.data?.length);
  console.log('applications I can see:', apps.data?.length);
})();
```

- ✅ **Safe:** `students I can see: 1` and `profiles I can see: 1` (just
  yourself), and `applications I can see` equals only **your own** applications —
  even though Student C and Employer B also exist in the database.
- ❌ **FAILURE:** any of those numbers is bigger than your own data (e.g.
  `students I can see: 2`). That would mean a student can read other people's
  records — stop and tell me immediately.

### Test 3 — A student can't promote themselves ✅
Still signed in as **Student A**, in the same console, paste:

```js
(async () => {
  const sb = window._supabase;
  const me = (await sb.auth.getUser()).data.user.id;
  const res = await sb.from('profiles').update({ role: 'coordinator' }).eq('id', me);
  console.log('escalation error (good if NOT null):', res.error);
})();
```

- ✅ **Safe:** it prints an **error object** (not `null`) — the attempt was
  blocked.
- ❌ **FAILURE:** it prints `error: null` and the update "worked." That would mean
  a student could make themselves a coordinator — stop and tell me immediately.

> When you're done testing, you can delete the fake accounts from
> **Authentication → Users** in the dashboard (deleting the auth user removes
> their data via cascade).

---

## Part 5 — Post-launch punch list (recorded so we don't lose it)

These are intentionally **not** built yet. Do them after launch, in this
priority order:

1. **Messaging rate limits (HIGH — do first after launch).** Re-add the limits
   that were enforced by the old server: **20 messages/hour** and **5 new
   conversations/day** per user. Because this is adult↔minor messaging, this is
   the top safety follow-up. Implement as a database function or a Supabase Edge
   Function.
2. **Coordinator "Verify email" button (MEDIUM).** Manually confirming a user's
   email needs admin privileges that the browser doesn't have, so the button
   currently fails gracefully with a message. Add a small Supabase **Edge
   Function** (using the service-role key) to do it properly.
3. **Accepted students seeing their supervisor's name (LOW).** The database
   already permits it; it just needs to be shown in the student's placement view
   in the UI.
4. **Résumé file storage (LOW).** Today the résumé lives only in the browser
   (session storage) and only the filename is saved. Add a **Supabase Storage**
   bucket (with its own access rules) to store the actual file.

---

## If something goes wrong

- The SQL files are **safe to re-run** — if a step half-finished, run it again.
- Nothing here deletes data. The locked-down default means a misstep makes the
  app *unable to read*, not *over-share*.
- If a browser test shows a ❌ FAILURE, **don't launch** — note exactly which test
  and what number/message you saw, and bring it back to me.
