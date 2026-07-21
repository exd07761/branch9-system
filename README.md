# Docket Management System — Milestone 1: Project Setup

This milestone only proves the foundation works: Firebase connects, Firestore
accepts reads/writes, and the site deploys on GitHub Pages. No login, no
hearings, no cases yet — that starts in Milestone 2 onward.

---

## 1. Create the Firebase Project

1. Go to https://console.firebase.google.com and click **Add project**.
2. Give it a name (e.g. `branch9-docket` or similar — this becomes part of
   your project ID, so pick something you're fine seeing in URLs).
3. You can disable Google Analytics for this project — it isn't needed.
4. Once the project is created, go to **Build → Firestore Database** and
   click **Create database**. Choose a region close to the Philippines
   (e.g. `asia-southeast1`). Start in **production mode** — we'll set real
   security rules in Milestone 2 alongside Authentication.
5. Go to **Build → Authentication** and click **Get started**. Enable the
   **Email/Password** sign-in method. (You won't use it yet — that's
   Milestone 2 — but enabling it now means it's ready.)

## 2. Get Your Firebase Web Config

1. In the Firebase Console, click the gear icon → **Project settings**.
2. Under **Your apps**, click the web icon (`</>`) to register a new web app.
3. Give it a nickname (e.g. `docket-web`). You do **not** need Firebase
   Hosting — you're using GitHub Pages instead.
4. Firebase will show you a `firebaseConfig` object. Copy it.
5. Open `js/firebase-config.js` in this project and replace every
   `REPLACE_WITH_...` placeholder with your actual values.

## 3. Set Temporary Firestore Rules (for this milestone only)

Since Authentication isn't wired into the app until Milestone 2, use these
**temporary, read-only rules** just to confirm the connection works. Go to
**Firestore Database → Rules** and set:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /systemStatus/{docId} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

This only opens up **read** access to the `systemStatus` collection used by
this milestone's connection check — no writes are allowed, and none are
attempted, so no test documents ever get created. Milestone 2 will replace
this with rules that require a logged-in user.

## 4. A Note on the Modular SDK and Local Testing

This project uses the Firebase v9+ **modular SDK** via ES module imports
(`import { ... } from ".../firebase-app.js"`) rather than the older compat
scripts. This means:

- `diagnostics.html` loads `js/diagnostics.js` with `type="module"`, and
  the imports cascade from there (`diagnostics.js` → `firebase-init.js` →
  `firebase-config.js`). As of v0.4.1, `index.html` is the real
  application entry point (it redirects to `login.html`/`home.html`) — the
  developer connection-check page described in this section now lives at
  `diagnostics.html` instead.
- Browsers block ES module imports over the `file://` protocol, so opening
  any page here by double-clicking it will show a blank page with console
  errors. To test locally before pushing to GitHub, serve the folder over
  HTTP — e.g. `npx serve .` or `python3 -m http.server` from inside the
  project folder, then open `http://localhost:<port>`.
- GitHub Pages serves everything over HTTPS by default, so no special
  configuration is needed there — this only matters for local testing.

## 5. Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `docket-management-system`) and push
   this folder's contents to it.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, pick your default
   branch (e.g. `main`), and folder `/ (root)`.
4. Save. GitHub will give you a URL like:
   `https://<your-username>.github.io/docket-management-system/`
5. Wait 1–2 minutes for the first deploy, then open that URL.

## 6. Testing Checklist

Open `diagnostics.html` at your deployed URL (e.g.
`https://<your-username>.github.io/docket-management-system/diagnostics.html`)
and confirm:

- [ ] Page loads with no visible errors (open browser DevTools → Console
      to check for red errors too)
- [ ] **Firebase config loaded** shows a green dot and your project ID
- [ ] **Firebase app initialized** shows a green dot
- [ ] **Firestore connection test (read-only)** shows a green dot with a
      response time (e.g. "Responded in 120ms (0 docs found, no data
      written)")
- [ ] The banner at the bottom reads: *"All checks passed. Firebase and
      Firestore are working correctly."*
- [ ] In the Firebase Console, go to **Firestore Database → Data** and
      confirm the database is still empty — no `systemStatus` collection
      or any other document should have been created by this check.

If any check fails, the detail text next to that check explains why —
most commonly it's either a placeholder value left in
`js/firebase-config.js`, or the Firestore rules from step 3 not yet saved.

## 7. Expected Results After Deployment

`diagnostics.html` shows a simple status page with three green
checkmarks — and a Firestore database that remains completely empty,
since this check only reads and never writes. This confirms the full chain
(GitHub Pages → your browser → Firebase Authentication config → Firestore)
is wired correctly before any real docket data or features are built on
top of it. As of v0.4.1, `diagnostics.html` is a standalone developer tool
— it is not part of the Clerk-facing flow, and nothing links to it from
`index.html`, `login.html`, or `home.html`.

---

**Next milestone (do not start yet):** Milestone 2 — Authentication. This
will replace this status page with a real login screen and tighten the
Firestore rules above to require a logged-in user.

---

# Milestone 2: Authentication

Adds `login.html` and `home.html`, both wired to Firebase Authentication
(v9+ modular SDK). `index.html` (the Milestone 1 status page) is untouched
at this point in the project's history — see the v0.4.1 entry in
`CHANGELOG.md` for where that changed later.

`home.html` is deliberately minimal — system title, the signed-in user's
email, a welcome message, and a logout button. It exists only to prove the
authentication flow works end-to-end. No dashboard widgets, hearing
summaries, statistics, or navigation belong here — that's Milestone 5.

## 1. Create the Admin (Branch Clerk) Account

This system has no public sign-up page — the one V1 user is provisioned
manually:

1. In the Firebase Console, go to **Authentication → Users**.
2. Click **Add user**.
3. Enter the Clerk's email and a password.
4. Save. That's the only account this system will use for now.

## 2. Firestore Rules

No changes from Milestone 1 — see the rules above. Nothing new is read or
written to Firestore in this milestone.

## 3. Deploy to GitHub Pages

Same process as Milestone 1 — push the updated folder to your existing
repo's default branch. GitHub Pages will pick up the new `login.html`,
`home.html`, and `js/` files automatically; no Pages settings need to
change.

## 4. Testing Checklist

- [ ] Visiting `login.html` directly while logged out shows the login form
      (no flash of home page content first)
- [ ] Submitting the form with an empty email/password shows the browser's
      built-in "required field" validation (no network request is made)
- [ ] Submitting with a wrong password shows **"Incorrect email or
      password."** — not a raw Firebase error
- [ ] While a login request is in flight, the button reads **"Signing
      in…"** and is disabled (can't double-submit)
- [ ] Logging in with the correct credentials redirects to `home.html`
- [ ] `home.html` shows the signed-in user's email and nothing else
      (no widgets, summaries, or navigation)
- [ ] Clicking **Log out** redirects back to `login.html`
- [ ] After logging out, manually navigating to `home.html` redirects
      back to `login.html` (no access without a session)
- [ ] After logging in, manually navigating to `login.html` redirects
      straight to `home.html` (no re-showing the form to a logged-in
      user)
- [ ] Closing the browser tab and reopening `home.html` later keeps
      the Clerk logged in (session persistence) until they explicitly log
      out

## 5. Expected Behavior After Deployment

The Clerk visits the site, is shown a clean login form, signs in once, and
stays signed in across browser sessions until they log out. Any attempt to
reach the home page without being signed in bounces back to the login
page; any attempt to revisit the login page while already signed in
bounces forward to the home page. The home page itself shows nothing more
than the system title, the Clerk's email, a welcome line, and a logout
button — real dashboard content is built in Milestone 5.

**Next milestone (do not start yet):** Milestone 3 — Core Hearing
Management.

---

# Milestone 3: Core Hearing Management

Adds `hearings.html` for creating, editing, deleting, and listing hearings,
each with one or more attached case numbers.

## 1. Updated Firestore Security Rules (required)

Replace your rules with the version below — this adds real access control
for the `hearings` and `hearingCases` collections (previously unused):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /systemStatus/{docId} {
      allow read: if true;
      allow write: if false;
    }
    match /hearings/{hearingId} {
      allow read, write: if request.auth != null;
    }
    match /hearingCases/{caseId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Since there's only one user account in V1, "signed in" is the entire
authorization check for now — this is intentionally simple, not a
placeholder for something more complex.

## 2. Deploy to GitHub Pages

Same process as before — push the updated folder to your repo's default
branch. No Pages settings need to change.

## 3. Testing Checklist

- [ ] Visiting `hearings.html` while logged out redirects to `login.html`
- [ ] From `home.html`, the "Go to Hearings" link opens `hearings.html`
- [ ] "+ Add Hearing" opens a form with one blank case-number row
- [ ] Clicking "Save Hearing" with required fields empty shows a message
      naming exactly what's missing (hearing type, accused, hearing date,
      at least one case number) — nothing is saved
- [ ] Filling in all required fields and saving adds a new row to the
      hearings list, showing the correct date, section, status, case
      number(s), and accused
- [ ] Adding a second case number via "+ Add another case number" and
      saving shows both case numbers in the list's "Case No(s)." column
- [ ] Entering a case number (type + number) that already exists on a
      different hearing shows a confirm dialog before saving; canceling
      it does not save, confirming it does
- [ ] Clicking "Edit" on a hearing pre-fills the form, including all of
      its existing case rows
- [ ] Removing a case row during edit and saving actually deletes that
      case document (won't reappear if you edit again)
- [ ] Clicking "Delete" on a hearing asks for confirmation, mentioning
      that the record stays recoverable; confirming removes the hearing
      from the visible list
- [ ] After deleting a hearing, check the Firebase Console directly
      (**Firestore Database → Data → hearings**) and confirm the document
      still exists, now with `isDeleted: true`, a `deletedAt` timestamp,
      and `deletedBy` set to your account's email — it was hidden from the
      list, not removed from the database
- [ ] In the Firebase Console, confirm any saved hearing document has
      `createdAt`, `updatedAt`, `createdBy`, and `updatedBy` fields, and
      that `createdBy`/`updatedBy` show your logged-in email rather than
      being blank
- [ ] Confirm a saved hearing's `caseCount` field matches the number of
      case rows you actually saved on it, and that the "# Cases" column in
      the list shows that same number
- [ ] In the Firebase Console, confirm a saved hearing document has a
      `hearingDateTime` field of type **Timestamp**, and that its date and
      time match the `hearingDate`/`hearingTime` you entered (e.g. a
      hearing dated `2026-08-05` at "1:30 in the Afternoon" should show a
      timestamp for that date at 13:30)
- [ ] Confirm `hearingDateTime` is not shown or editable anywhere in the
      form — it's derived automatically, not entered by the Clerk
- [ ] Refreshing the page preserves all saved data (confirms Firestore
      persistence, not just in-memory state)
- [ ] Opening the same URL in two browser tabs and adding a hearing in one
      tab shows it appear in the other tab without a manual refresh
      (confirms the live Firestore listener works)

## 4. Expected Behavior After Deployment

The Clerk can now log in, reach the Hearings page, and handle real daily
work: scheduling a hearing with one or more case numbers attached, editing
details later, and deleting a hearing when it's no longer needed — deletion
hides it from the list but never destroys the underlying record, since
"Delete" is a soft delete under the hood. Every save is stamped with who
made it and when, and carries a computed `hearingDateTime` ready for later
milestones to sort and query on. Duplicate case numbers are flagged but
not silently blocked, so legitimate edge cases (e.g. correcting a typo)
aren't locked out. No calendar, dashboard, search, or printing exists yet
— those are still ahead.

**Milestone 3 is now frozen permanently (v0.3.3).** A validation pass after
freezing found and fixed one bug: the duplicate case-number check now
correctly ignores case numbers belonging to soft-deleted hearings. See
`CHANGELOG.md` for details. No further changes without a discovered bug.

**Next milestone (do not start yet):** Milestone 4 — Calendar Views.

---

# Milestone 4: Calendar Views

Adds `calendar.html` — Month, Week, and Day views over the existing
`hearings` data. Strictly read-only: nothing here writes to Firestore, and
selecting a hearing navigates to the existing `hearings.html` edit form
rather than duplicating any of that logic.

## 1. Firestore Rules / Indexes

**No changes.** Calendar only performs range reads on `hearings`
(`where hearingDateTime >= ... < ...`, `orderBy hearingDateTime`) and,
on-demand in Day View, an equality read on `hearingCases`
(`where hearingId == ...`). Both are covered by Firestore's automatic
single-field indexing — no composite index needs to be created in the
Firebase Console.

## 2. Deploy to GitHub Pages

Same process as before — push the updated folder to your repo's default
branch. No Pages settings need to change.

## 3. Testing Checklist

- [ ] Visiting `calendar.html` while logged out redirects to `login.html`
- [ ] From `home.html`, "Go to Calendar" opens `calendar.html`
- [ ] Month view shows a 7-column grid with today's date highlighted, and
      any hearings on a given day appear as compact entries on that date
- [ ] A day with more than 3 hearings shows "+N more" rather than
      overflowing the cell
- [ ] Clicking a hearing entry in Month view navigates directly to
      `hearings.html` with that hearing's edit form already open
- [ ] Clicking a date number (not a specific entry) in Month view switches
      to Day View for that date
- [ ] Week view shows 7 columns (Sun–Sat) with that week's hearings
      listed under the correct day, showing time/section/accused/case
      count
- [ ] Day view lists that day's hearings with a "Show cases (N)" button
      per hearing, collapsed by default
- [ ] Clicking "Show cases" on a hearing shows a brief "Loading cases…"
      message, then the actual case numbers — confirms cases are fetched
      only on demand, not preloaded
- [ ] Clicking "Show cases" again on the same hearing (after collapsing)
      shows the cases instantly with no second "Loading" flash (confirms
      the per-session cache works)
- [ ] Clicking "Details" on a Day View card navigates to
      `hearings.html` with that hearing's edit form already open
- [ ] Prev / Next correctly move by month, week, or day depending on the
      active view; Today returns to the current date in any view
- [ ] Switching between Month / Week / Day preserves a sensible date
      (doesn't jump to an unrelated period)
- [ ] A soft-deleted hearing (per Milestone 3) never appears anywhere in
      Calendar

## 4. Expected Behavior After Deployment

The Clerk can view scheduled hearings by month, week, or day, drill from a
busy month into a single day, and open any hearing's full details without
Calendar ever loading more than the currently visible date range — Month
and Week views never touch case data at all, and Day View only fetches a
hearing's case numbers the moment the Clerk asks to see them. Editing,
deleting, or adding a hearing still happens exclusively on the Hearings
page; Calendar is purely a way to find and open the right one.

**Next milestone:** paused, per your request — this system should be
deployed and used with real or test data for a while before any further
feature milestones begin.

---

# v0.4.1: Production Readiness Fixes

Three fixes from a production-readiness review, applied after Milestone 4.
No new features, no changes to the authentication architecture.

## 1. What changed

- **`index.html` is now the real entry point.** It immediately redirects:
  signed-in users → `home.html`, signed-out users → `login.html`. It
  contains no visible content of its own beyond a brief loading message.
- **The old Milestone 1 diagnostics screen moved to `diagnostics.html`**
  (script renamed to `js/diagnostics.js`). Its functionality is completely
  unchanged — same three checks, same read-only Firestore probe — it's
  simply no longer at the site's root, and nothing in the Clerk-facing app
  links to it.
- **`login.html` no longer has `novalidate` on its form.** Required-field
  validation works again: submitting with an empty email or password now
  shows the browser's native validation instead of silently sending a
  request to Firebase. `js/login.js` also has a small additional check so
  this holds even if the submit event is triggered some other way.
- **Every page that depends on Firebase now handles initialization
  failure gracefully.** If Firebase can't initialize (bad config, blocked
  network), `index.html`, `login.html`, `home.html`, `hearings.html`, and
  `calendar.html` all show a clear "Unable to connect" message instead of
  a blank page. This lives in one place — `js/auth-guard.js` — so it
  didn't require touching each page individually, and it doesn't change
  the two functions (`requireAuth`, `redirectIfAuthenticated`) any page
  already calls.

## 2. Firestore Rules

No changes. None of these fixes touch what's read or written.

## 3. Deploy to GitHub Pages

Same process as before. Note that `js/app.js` no longer exists (renamed to
`js/diagnostics.js`) and there's a new `diagnostics.html` — make sure your
push includes both the new files and the removal of the old ones.

## 4. Testing Checklist

- [ ] Visiting your site's root URL while logged out lands on `login.html`
      (not a diagnostics/status page)
- [ ] Visiting the root URL while logged in lands on `home.html`
- [ ] `diagnostics.html` still works exactly as before (three checks, all
      passing against a correctly configured Firebase project)
- [ ] Nothing on `index.html`, `login.html`, `home.html`, `hearings.html`,
      or `calendar.html` links to `diagnostics.html`
- [ ] On `login.html`, clicking "Log in" with both fields empty shows the
      browser's native "please fill in this field" validation — no
      network request is made (check the Network tab in DevTools)
- [ ] Logging in with a wrong password still shows **"Incorrect email or
      password"** exactly as before
- [ ] Logging in with correct credentials still works and still lands on
      `home.html`
- [ ] To test the fatal-error path: temporarily set `apiKey` in
      `js/firebase-config.js` to an obviously invalid value, reload
      `login.html` (or any page), and confirm you see a clear "Unable to
      connect" card instead of a blank page or console-only error. Revert
      the config value afterward.
- [ ] After reverting the config, confirm every page still works normally

## 5. Expected Behavior After Deployment

Visiting the site behaves like a real application from the first click —
the root URL takes you straight to login or home depending on whether
you're signed in, with no detour through a developer diagnostics screen.
The diagnostics page still exists for troubleshooting a Firebase
connection issue, just at its own URL. Login correctly refuses to submit
with missing fields. And if Firebase itself is ever unreachable, the
Clerk sees an explanation instead of a page that appears to simply do
nothing.

# v0.8.0: Branch Clerk Productivity Dashboard

Turns `home.html` into an operational dashboard the Clerk can actually
work from at the start of the day, instead of just a landing page.

## 1. What's new

- **Today's Hearings Timeline** — every hearing scheduled today, in
  order, with a status badge (Now / Next / Completed / Upcoming) and a
  highlighted background for the current and next hearing. Click any
  hearing to open the same read-only Quick View modal already used on
  the Hearings page.
- **Current Session / Next Hearing card** — shows what's happening right
  now, or a live "Starts in N minutes" countdown to the next one if
  nothing's active. Updates automatically every 30 seconds.
- **Today's Summary** — Scheduled / Completed / Remaining counts for
  today.
- **Quick Actions** — Add Hearing, Open Calendar, and Export Today's
  Calendar, right from Home.

Nothing here changes the Firestore schema, security rules, login flow,
Calendar, or either Word export mode — see `CHANGELOG.md` for the full
technical breakdown of what was reused vs. added.

## 2. A note on "Now" / "Completed"

The hearings schema doesn't record how long a hearing lasts or whether
it's finished — a hearing's `status` field is its stage (e.g. "Pre-Trial
Conference"), not a scheduling state. So "current" and "completed" are
computed client-side, assuming each hearing runs for 30 minutes from its
scheduled start. That assumption lives in one place
(`DEFAULT_HEARING_DURATION_MINUTES` in `js/dashboard-live.js`) if it
ever needs adjusting for how this branch actually runs its calendar.

## 3. Deploy to GitHub Pages

Same process as before — push the updated files. No new Firebase
configuration, security rules, or indexes are needed for this release.

## 4. Testing Checklist

- [ ] Home shows a "Now Hearing" card during a hearing's scheduled
      30-minute window, and "No active hearing." otherwise
- [ ] When there's no active hearing, a "Next Hearing" card appears with
      a "Starts in N minutes" countdown that counts down as time passes
      (no page refresh needed)
- [ ] Today's Summary shows correct Scheduled / Completed / Remaining
      counts for today's hearings
- [ ] The Today's Hearings timeline lists today's hearings in
      chronological order, each with a status badge, and highlights the
      current/next hearing
- [ ] Clicking a hearing on the timeline opens the same Quick View modal
      used on the Hearings page (not the edit form)
- [ ] "Add Hearing" quick action opens the Hearings page with the Add
      form already open
- [ ] "Open Calendar" quick action goes to `calendar.html`, unchanged
- [ ] "Export Today's Calendar" downloads a `.docx` matching today's
      hearings
- [ ] Calendar's existing links to `hearings.html?openHearing=<id>` still
      open the edit form exactly as before (unaffected by the new
      `?previewHearing`/`?action=add` params)
- [ ] Global search on the Hearings page, both Word export modes, and the
      4 original dashboard stat cards all still work exactly as before

## 5. Expected Behavior After Deployment

Opening Home at the start of the day tells the Clerk, at a glance, what's
happening now, what's next, how the day is progressing, and gives one-
click access to the day's most common actions — without needing to open
Hearings or Calendar first.
