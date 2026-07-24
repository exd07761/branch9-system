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

# v0.8.1: Dashboard UX Polish

A UI/UX refinement pass on the v0.8.0 dashboard — no data, computation,
or logic changes. Today's Hearings is now the dashboard's visual
centerpiece; the smaller cards around it (Now Hearing, Next Hearing,
Today's Summary, Quick Actions) sit in a sidebar and stay compact when
they have nothing to show.

## 1. What changed

- Today's Hearings moved into a wide main column with more breathing
  room per row; the rest of the dashboard now lives in a sidebar next
  to it.
- Now Hearing and Next Hearing are separate cards (previously one card
  that toggled between them), each collapsing to a single line when
  empty instead of reserving full card height.
- Today's Summary is now a horizontal Scheduled / Completed / Remaining
  row instead of stacked numbers.
- The empty Timeline message now points the Clerk toward Add Hearing or
  the Calendar instead of just saying nothing's scheduled.
- Section headings now carry a small icon (Lucide, already in use
  elsewhere in the app).

Nothing about how hearings are loaded, filtered, sorted, or computed
changed — see `CHANGELOG.md` for exactly which files were touched vs.
left untouched.

## 2. Testing Checklist

- [ ] Today's Hearings reads as the largest, most prominent section on
      Home
- [ ] Now Hearing shows hearing details during an active hearing, and
      collapses to a single compact line ("No active hearing.") otherwise
- [ ] Next Hearing shows the next hearing and countdown when one exists
      today, and collapses to a single compact line ("No upcoming
      hearings today.") otherwise — independently of whether Now Hearing
      is active
- [ ] Today's Summary shows Scheduled / Completed / Remaining side by
      side
- [ ] An empty day shows the new "No hearings scheduled" message with
      a pointer to Add Hearing / Calendar
- [ ] Clicking a hearing on the timeline still opens the same Quick View
      modal as before
- [ ] Quick Actions (Add Hearing, Open Calendar, Export Today's Calendar)
      all still work exactly as in v0.8.0
- [ ] Calendar's `?openHearing=<id>` links still open the edit form as
      before
- [ ] Global search on the Hearings page and both Word export modes
      still work exactly as before
- [ ] On a narrow/phone-width screen, the dashboard still stacks
      sensibly (Today's Hearings first, sidebar cards below)

# v0.8.2: Responsive Dashboard & Productivity Polish

Makes the Home dashboard from v0.8.0/v0.8.1 comfortable to use on
tablets and phones, with a few remaining whitespace/accessibility
touches. No data, computation, or logic changes.

## 1. What changed

- Today's Hearings and the sidebar (Now Hearing, Next Hearing, Today's
  Summary, Quick Actions) now stack to one column starting at 1024px
  (previously only at 768px), so tablets get the same clean single-
  column reading order as phones. Desktop above 1024px is untouched.
- The navigation bar's wrap-safety (so it never scrolls horizontally)
  now also starts at 1024px instead of 768px.
- Quick Actions becomes a 2-column grid on phones instead of a tall
  single column.
- Now Hearing, Next Hearing, and Today's Hearings all shrink a little
  further when they have nothing to show, without ever using a fixed
  height — they still grow to fit real content exactly as before.
- The Timeline got more breathing room, a stronger connector line,
  slightly larger status badges, and a clearer highlight on the current
  hearing.
- Buttons, nav links, and Timeline rows now show a visible focus outline
  when navigating by keyboard, and Timeline rows can now be reached and
  activated with Tab + Enter/Space, not just a mouse click.

See `CHANGELOG.md` for the full file-by-file breakdown.

## 2. Testing Checklist

- [ ] Desktop widths (1920, 1440, 1280): dashboard layout matches
      v0.8.1 exactly — two columns, Timeline on the left
- [ ] Tablet widths (1024, 768): dashboard stacks to one column,
      Today's Hearings first; nav doesn't overflow or scroll
      horizontally at either width
- [ ] Phone widths (430, 390, 375, 320): no horizontal scrolling
      anywhere on the page; Quick Actions shows as a 2-column grid;
      nav brand stays visible, email truncates, Logout stays reachable
- [ ] An empty day: Now Hearing, Next Hearing, and Today's Hearings all
      visibly take up less vertical space than when hearings exist
- [ ] Tabbing through the page reaches Timeline rows in their visual
      order, and Enter/Space on a focused row opens the same Quick View
      modal a click would
- [ ] Focus outlines are visible when tabbing through nav links, the
      Logout button, and Quick Actions buttons
- [ ] Clicking a Timeline row, Quick Actions, Calendar links, global
      search, and both Word export modes all still work exactly as in
      v0.8.1

---

# Milestone 9: Audit Trail & Activity Log

Adds accountability logging: who did what, and when. Not a redesign, not
a Firestore migration, not a schema rewrite for any existing collection
— everything working in v0.8.2 continues to work exactly as before.

## 1. Updated Firestore Security Rules (required)

This adds a rule for the new `activityLogs` collection only. The rules
for `systemStatus`, `hearings`, and `hearingCases` are copied over
unchanged from Milestone 3 — nothing about them is modified:

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
    match /activityLogs/{logId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Same "signed in is the entire authorization check" reasoning as the
existing collections — there's still only one user account in V1.

## 2. What's new

- **`activityLogs` collection.** Each document is a lightweight audit
  entry: `timestamp`, `userEmail`, `action`, `module`, `entityId`,
  `entityType`, `description`, and optional `oldValue`/`newValue`. Full
  hearing objects are never stored here.
- **`js/activity-data.js`** — the only file that touches the
  `activityLogs` collection. `logActivity(...)` is fire-and-forget by
  design: it never throws, so a logging failure can never block or
  interrupt the action it's describing (a console warning is printed
  instead). `subscribeToActivityLogs()` is a live listener capped at the
  500 most recent entries.
- **`js/activity.js` + `activity.html`** — the new Activity Log page,
  linked from the nav on Home, Hearings, and Calendar. Shows Time, User,
  Action, Module, and Description, newest first, with live search and a
  category filter (All / CRUD / Export / Authentication / Other). Reuses
  existing card/table/toolbar styling — no new design language.
- **Logging calls added** (behavior otherwise unchanged) to
  `js/login.js` (Login), `js/nav-auth.js` (Logout — the one shared
  handler used by Home/Hearings/Calendar), `js/hearings.js` (Create/
  Edit/Delete Hearing, Export Hearing Order, and all three Court
  Calendar export modes), and `js/home.js` (the Export Today's Calendar
  Quick Action). `js/docx-export.js` was intentionally left untouched —
  it's documented as strictly isolated from Firestore/auth, so the
  export logging calls live at the existing call sites in
  `hearings.js`/`home.js` instead, which already have the data needed
  for a useful log entry.

See `CHANGELOG.md` for the full file-by-file breakdown.

## 3. Testing Checklist

- [ ] Logging in records a `Login` entry with the signed-in email
- [ ] Logging out records a `Logout` entry before the redirect to the
      login page
- [ ] Creating, editing, and deleting a hearing each record the
      corresponding entry, and the hearing itself still saves/deletes
      exactly as before
- [ ] Exporting a hearing order, and each of the three Court Calendar
      export modes on the Hearings page, all still download the correct
      `.docx` file and each records one Activity Log entry
- [ ] The Home page's "Export Today's Calendar" Quick Action still
      exports correctly and records one Activity Log entry
- [ ] Activity Log page shows entries newest-first; search filters by
      user/action/description; the category dropdown filters correctly
- [ ] Disconnecting the network (or otherwise forcing a logging failure)
      does not block or interrupt the underlying action — only a console
      warning appears
- [ ] Dashboard, Live Dashboard, Timeline, Search, Calendar, Hearings
      CRUD, Quick View/Lightbox, Word Export content, and responsive
      layout all behave exactly as in v0.8.2
- [ ] No duplicate Firestore listeners were introduced, and every other
      `.js`/`.html` file not listed above is byte-identical to v0.8.2

---

# Milestone 10: Reports & Statistics

A read-only Reports module for the Branch Clerk of Court. No CRUD
behavior changes, no new Firestore listeners or reads beyond what
`subscribeToHearings()`/`subscribeToCases()` already provide elsewhere,
no schema changes, no new Security Rules needed.

## 1. What's new

- **`js/reports-data.js`** — pure computation only. Report calculations,
  filtering, and statistics; no Firestore, no DOM. Reuses
  `getHearingsForDate/Week/Month` (`export-data.js`),
  `computeDashboardStats()` (`dashboard-stats.js`), and
  `DEFAULT_HEARING_DURATION_MINUTES` (`dashboard-live.js`) rather than
  recomputing any of them a second way.
- **`js/reports.js` + `reports.html`** — the new Reports & Statistics
  page, linked from the nav on Home, Hearings, Calendar, and Activity
  Log. Six summary cards (reusing the Home dashboard's stat-card grid
  verbatim), a unified Daily/Weekly/Monthly Hearing Report whose
  granularity follows the Range filter, a Hearing Status Report, a
  Hearing Type Report, and CSV/Word export — all client-side over
  already-loaded data.

## 2. Architecture notes worth knowing

- **`hearing.status` is a stage/purpose label, not a lifecycle state.**
  There is no Pending/Completed/Postponed/Cancelled field in Firestore
  (this was already documented in `dashboard-live.js` back in Milestone
  8). The Hearing Status Report counts whatever status values are
  actually in the data; the Pending/Completed summary cards are derived
  from `hearingDateTime` the same way the Home dashboard's Timeline
  already derives "completed," just applied across all hearings instead
  of only today's.
- **The Hearing Type Report groups by `section`, not the free-text
  `hearingType` field.** `hearingType` holds sentences like "Cross
  Examination of Prosecution's Witness AAA" — grouping by it verbatim
  wouldn't produce a report, just a long tail of one-off buckets.
  `section` is the fixed, small set (Arraignment and Pre-Trial
  Conference, Trial, Promulgation, Motions, ...) this milestone's report
  examples actually describe.
- **Word export is scope-limited on purpose.** It reuses
  `exportCourtCalendarForDate/Week/Month` verbatim — no second docx
  builder was written. Those functions re-derive their own date scope
  from the full hearings/cases arrays internally, so they can only
  guarantee an accurate match to what's on screen when Status and
  Hearing Type are both "All" and the range is Today/Week/Month; the
  Word button is disabled otherwise, and CSV (built entirely by
  `reports-data.js`, so it always respects every active filter) is the
  export path for anything more specific.
- **No new Firestore listeners.** The page reuses
  `subscribeToHearings()`/`subscribeToCases()` (`hearings-data.js`,
  unchanged) exactly as Hearings and Home already do — same
  per-page-subscribe convention already established, not a new pattern.
- **Report exports are logged.** Both CSV and Word exports on this page
  call the existing `logActivity()` helper from Milestone 8's Audit
  Trail unchanged — that milestone explicitly designed the logger so
  "Reports" could be logged later without a redesign; this is that.

## 3. Testing Checklist

- [ ] Total Hearings, Active Cases, Hearings This Month, Hearings This
      Year, Pending Hearings, and Completed Hearings all show correct
      counts and do not change when the page's filters change
- [ ] Range = Today shows a flat list for today; This Week and This
      Month show the same week/month Hearings' Export Calendar dropdown
      already uses, grouped by day
- [ ] Custom Date Range with the same start/end date shows a flat
      single-day list; with different dates, groups by day
- [ ] Status and Hearing Type filters narrow the main Hearing Report as
      expected, and each breakdown report (Status / Type) still shows a
      full breakdown when the other filter is narrowed
- [ ] Export CSV downloads a file reflecting every active filter
- [ ] Export Word is enabled only for Today/Week/Month with Status and
      Hearing Type both "All," reuses the same Word export already used
      on Hearings, and is disabled the rest of the time
- [ ] Both export actions appear on the Activity Log page afterward
- [ ] Dashboard, Live Dashboard, Timeline, Search, Calendar, Hearings
      CRUD, Quick View/Lightbox, Activity Log, Word Export content, and
      responsive layout all behave exactly as in v0.9.0
- [ ] No new Firestore listener types were introduced, and every file
      not listed above is byte-identical to v0.9.0

---

# Milestone 12: Role-Based Access Control (RBAC)

Four built-in roles, a centralized permission helper, a new User
Management page, and the Firestore Security Rules required to actually
enforce all of it — UI hiding alone is never the security boundary.

## 1. Roles and the permission matrix

If a `users/{uid}` document has no `role` field yet (or doesn't exist
yet), the app treats that account as **Branch Clerk** — the same
day-to-day access every account already effectively had before this
milestone — so existing deployments keep working with no migration
step.

| Permission | Administrator | Branch Clerk | Encoder | Read Only |
|---|:---:|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Hearings — view / search / Quick View | ✅ | ✅ | ✅ | ✅ |
| Hearings — create | ✅ | ✅ | ✅ | ❌ |
| Hearings — edit | ✅ | ✅ | ✅ | ❌ |
| Hearings — delete | ✅ | ✅ | ❌ | ❌ |
| Calendar | ✅ | ✅ | ✅ | ✅ |
| Reports | ✅ | ✅ | ❌ | ✅ |
| Export (Word/CSV, Hearings + Reports) | ✅ | ✅ | ❌ | ❌ |
| Activity Log | ✅ | ✅ | ❌ | ❌ |
| User Management | ✅ | ❌ | ❌ | ❌ |
| Archive / Restore Hearings | ✅ | ✅ | ❌ | ❌ |
| Backup / Restore (system-wide) | ✅ | ❌ | ❌ | ❌ |

This table is `ROLE_PERMISSIONS` in `js/permissions.js`, restated for
reference — that file is the actual source of truth; if the two ever
disagree, the code wins and this table needs updating.

## 2. User Management

- **Accounts appear once they've signed in — there's no "add user"
  step.** This app only has Firebase Authentication (client-side) to
  work with, not the Admin SDK, so it cannot enumerate or create
  Authentication accounts directly. Instead, the first time any account
  signs in, `getOrCreateUserRole()` creates its `users/{uid}` document
  with the default role. User Management lists that collection, not
  Authentication directly — an account that has never signed in won't
  appear yet, by design. The "Add User" button is a disabled
  placeholder for this reason.
- **An Administrator can't change their own role from this screen.**
  Simple guardrail against accidentally locking out the only admin
  account — not a Firestore-enforced rule, just a UI safeguard on top
  of the real one below.
- **Role changes are logged.** Every change calls the existing
  `logActivity()` with action `Change User Role` — visible on the
  Activity Log page like any other action, no new logging code.

## 3. Firestore Security Rules for RBAC

**UI permissions are not the security boundary.** Hiding a button stops
someone from clicking it; it does not stop a direct API call. The rules
below are what actually enforces this milestone — deploy them, don't
just rely on the app's own hidden buttons.

**One important nuance:** "Delete Hearing" in this app is a **soft
delete** — `deleteHearing()` in `hearings-data.js` sets `isDeleted:
true` via an `update`, it never issues a Firestore `delete`. That means
Firestore's native `delete` permission can't be used to restrict who
can "delete" a hearing — an Encoder flipping `isDeleted` to `true` is,
to Firestore, indistinguishable from any other field edit unless the
rule itself inspects that specific field transition. The `isSoftDelete()`
helper below does exactly that. The flip side: Encoder editing a hearing
*can* legitimately trigger a real Firestore `delete` on `hearingCases` —
removing a case row during a routine edit deletes that case document
(see `saveHearing()`) even though Encoder can never soft-delete the
hearing itself. So `hearingCases` delete follows the same permission as
`hearingCases` create/update, not the hearing-level delete permission.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }

    function myRole() {
      return signedIn() && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        ? get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role
        : 'branch_clerk';
    }

    function isAdmin()            { return signedIn() && myRole() == 'administrator'; }
    function canEditHearings()    { return signedIn() && myRole() in ['administrator', 'branch_clerk', 'encoder']; }
    function canDeleteHearings()  { return signedIn() && myRole() in ['administrator', 'branch_clerk']; }
    function canArchiveHearings() { return signedIn() && myRole() in ['administrator', 'branch_clerk']; }
    function canViewActivityLog() { return signedIn() && myRole() in ['administrator', 'branch_clerk']; }

    // Distinguishes deleteHearing()'s soft-delete update (isDeleted
    // false -> true) from a routine field edit — see the note above.
    function isSoftDelete() {
      return request.resource.data.isDeleted == true && resource.data.isDeleted != true;
    }

    // Same idea as isSoftDelete() above, for the v0.9.3 Archive/Restore
    // toggle: true if this update changes isArchived in either
    // direction (archiveHearing() flips it to true, restoreHearing()
    // flips it back to false). A routine field edit that leaves
    // isArchived alone is not affected by this rule.
    function isArchiveChange() {
      return request.resource.data.isArchived != resource.data.isArchived;
    }

    match /systemStatus/{docId} {
      allow read: if true;
      allow write: if false;
    }

    match /hearings/{hearingId} {
      allow read: if signedIn();
      allow create: if canEditHearings();
      allow update: if canEditHearings()
                    && (!isSoftDelete() || canDeleteHearings())
                    && (!isArchiveChange() || canArchiveHearings());
      allow delete: if false; // the app never issues a hard delete here
    }

    match /hearingCases/{caseId} {
      allow read: if signedIn();
      // Encoder can remove a case row as a routine part of editing a
      // hearing — a real Firestore delete on this collection even
      // though Encoder can't soft-delete the hearing above. Follows
      // canEditHearings(), not canDeleteHearings() — see the note above.
      allow create, update, delete: if canEditHearings();
    }

    match /activityLogs/{logId} {
      // Narrower than v0.9.0's rule (which allowed any signed-in user
      // to read) now that Activity Log has its own view permission.
      allow read: if canViewActivityLog();
      allow create: if signedIn(); // every role's actions get logged
      allow update, delete: if false;
    }

    match /users/{userId} {
      allow read: if signedIn() && (request.auth.uid == userId || isAdmin());
      // A user may create only their OWN document, and only with the
      // default role — this is what stops someone from granting
      // themselves administrator by writing their own users/{uid} doc.
      // v0.9.4: Administrator may ALSO create any user's doc from
      // scratch — needed for Backup & Restore's disaster-recovery/
      // cross-project-migration scenario, where the destination project
      // has no matching users/{uid} docs yet. This does not weaken the
      // self-service path above; it only adds a second, admin-only way
      // to create a user document.
      allow create: if (signedIn() && request.auth.uid == userId
                     && request.resource.data.role == 'branch_clerk')
                     || isAdmin();
      allow update: if isAdmin();
      allow delete: if false;
    }
  }
}
```

This replaces the `hearings`/`hearingCases`/`activityLogs` rules
documented in earlier milestones — those previously allowed any
signed-in user full read/write; this narrows write access to match the
roles above. `systemStatus` is unchanged. **v0.9.3 update:** the
`hearings` collection's `update` rule gained the `isArchiveChange()`
guard described above — this is the only Firestore Rules change
required for Archive & Case Lifecycle Management; `hearingCases`,
`activityLogs`, `users`, and `systemStatus` rules are unchanged from
v0.9.2. **v0.9.4 update:** the `users` collection's `create` rule gained
the Administrator branch described above — this is the only Firestore
Rules change required for Backup & Restore; `hearings`, `hearingCases`,
`activityLogs`, and `systemStatus` rules are unchanged from v0.9.3 (see
Milestone 14 below for why `activityLogs`' restrictive `update: false`
rule did NOT need to change).

## 4. Testing Checklist

- [ ] A brand-new account's first sign-in creates a `users/{uid}`
      document with role `branch_clerk`, and that account has exactly
      Branch Clerk's access
- [ ] An existing account with no `role` field (or no document at all)
      behaves exactly as Branch Clerk — no migration needed
- [ ] Administrator sees every nav link and every action on every page
- [ ] Branch Clerk: same as before this milestone, minus the Users nav
      link and page
- [ ] Encoder: Add/Edit Hearing work; no Delete button on any row; no
      Export Calendar dropdown; Reports and Activity Log nav links are
      hidden, and navigating to `reports.html`/`activity.html` directly
      redirects to Home
- [ ] Read Only: no Add Hearing button, no Edit/Delete buttons anywhere
      (including inside Quick View), no Export Calendar dropdown; Search
      and Quick View still work; Reports page shows data but Export
      CSV/Word buttons are hidden; Activity Log and Users links are
      hidden and both pages redirect away
- [ ] Calendar's "Details" link opens the edit form for roles that can
      edit, and the read-only Quick View for roles that can't — Calendar
      itself needed no code changes for this
- [ ] User Management (Administrator only): lists every account that has
      signed in, role changes save and appear immediately, an admin
      cannot change their own role, "Add User" is visibly disabled
- [ ] Changing a role records a `Change User Role` entry on the Activity
      Log
- [ ] Signing in and out, Dashboard, Calendar, Hearings CRUD (for roles
      that have it), Reports, Activity Log, and Word/CSV export content
      all behave exactly as in v0.9.1 for whichever role is testing them
- [ ] No duplicate Firestore listeners were introduced (role loading is
      a one-time read per page load, not a listener), and every file not
      listed in the Changelog as added/modified is byte-identical to
      v0.9.1
---

# Milestone 13: Archive & Case Lifecycle Management

A proper Archive workflow, completely separate from the existing
soft-delete. **This is not deletion** — an archived hearing's document
(and its cases) are never touched beyond four new fields, nothing is
ever moved or duplicated into a second collection, and every archived
hearing can be restored to active operations at any time.

## 1. Schema

Both fields live directly on the existing `hearings` documents — no new
collection:

```
isArchived:    true | false
archivedAt:    Timestamp | null
archivedBy:    UID | null
archiveReason: ""
```

`hearingCases` is completely untouched by archiving — a hearing's case
rows stay exactly where they are, archived or not.

## 2. Centralized filtering — one function, not a scattered check

`isActiveHearing(h)` in `js/hearings-data.js` is the single place "is
this hearing in active operations" is decided:

```js
export function isActiveHearing(h) {
  return h.isDeleted !== true && h.isArchived !== true;
}
```

`subscribeToHearings()` applies it by default, so every existing
consumer — Home Dashboard, Today's Timeline, Search, Active Hearings,
Quick Actions — automatically stopped showing archived hearings with
**zero call-site changes**. `calendar-data.js`'s
`subscribeToHearingsInRange()` now imports and reuses this same helper
instead of its own inline `isDeleted` check (a small pre-existing
duplication, fixed in the same pass rather than left to duplicate
further). Reports opts into seeing archived hearings via
`{ includeArchived: true }` on `subscribeToHearings()`, then applies
`isActiveHearing()` itself in a local `reportHearings()` helper —
toggled by the "Include Archived" checkbox — so the same filter
function is reused a third time rather than reimplemented.

## 3. Archive / Restore

- `archiveHearing(hearingId, reason)` and `restoreHearing(hearingId)` in
  `js/hearings-data.js` mirror the existing `deleteHearing()` pattern
  exactly: a `writeBatch` that `set(..., { merge: true })`s the state
  fields — never a Firestore `delete`, never a document move.
- On Hearings, the row action that used to be "Delete" (soft-delete) is
  now "Archive" — gated by `PERMISSIONS.ARCHIVE_MANAGE` instead of
  `PERMISSIONS.HEARINGS_DELETE`. `deleteHearing()` itself is untouched
  and still callable; this milestone only changes what that one button
  calls. Confirmation copy: *"Archive this hearing? It will disappear
  from active operations but remain available in Archived Hearings. This
  action can be restored later."*
- The new Archived Hearings page (`archived.html`/`js/archived.js`)
  lists only `isArchived == true` hearings via the new
  `subscribeToArchivedHearings()`, reusing the existing hearings table
  styling and the existing Quick View modal's CSS/layout for its own
  read-only View action (plus the archive-specific Archived On/By/Reason
  fields). Restore simply resets `isArchived` to `false` and leaves
  `archivedAt`/`archivedBy`/`archiveReason` in place as historical
  record. **No editing happens on this page at all.**

## 4. Reports

"Include Archived" — a checkbox, **default OFF**. Reports excludes
archived hearings unless explicitly requested. When checked, every
report (Hearing Report, Status Report, Hearing Type Report, summary
cards) and the CSV export include archived hearings, all routed through
the same `reportHearings()`/`isActiveHearing()` filter described above —
no second copy of the archived/active distinction anywhere in
`reports.js` or `reports-data.js`. **Word export is explicitly
unaffected by this checkbox** — it always covers active hearings only,
per this milestone's requirement that the DOCX generator
(`docx-export.js`) stay completely untouched; `reports.js` simply
filters with `isActiveHearing()` before calling the existing
`exportCourtCalendarFor*()` functions, regardless of the checkbox.

## 5. RBAC

No new role. `PERMISSIONS.ARCHIVE_MANAGE` — reserved back in v0.9.2
specifically for this milestone — now gates the Archive/Restore row
actions and the entire Archived Hearings page. **Bug fix found and
corrected in this same pass:** Branch Clerk's permission list in
`js/permissions.js` was missing `ARCHIVE_MANAGE` even though v0.9.2's own
permission-matrix table already documented Branch Clerk as having
Archive/Backup access reserved for later — added, matching
Administrator. Encoder and Read Only remain without it, matching the
milestone brief (❌ for both).

See the updated permission matrix in Milestone 12 above, and "Firestore
Security Rules for RBAC" for the corresponding `canArchiveHearings()` /
`isArchiveChange()` rule additions — UI hiding alone is never the
security boundary.

## 6. Testing Checklist

- [ ] Administrator and Branch Clerk see an "Archive" button on every
      Hearings row (in place of the old "Delete"); Encoder and Read Only
      do not
- [ ] Archiving a hearing shows the exact confirmation copy above, then
      the hearing immediately disappears from: Home Dashboard (stat
      cards + Today's Timeline), Calendar (all three views), Hearings'
      list + Search, and Reports (with "Include Archived" unchecked) —
      but the record itself is untouched in Firestore (verify via the
      Archived Hearings page)
- [ ] The hearing's case rows in `hearingCases` are completely
      unaffected by archiving (still attached, still editable if the
      hearing were restored)
- [ ] Archived Hearings page (Administrator/Branch Clerk only — direct
      navigation by Encoder/Read Only redirects to Home, and their nav
      bar never shows the "Archived" link): lists every archived
      hearing, search works the same as Hearings' search, View opens a
      read-only modal with Archived On/By/Reason, no Edit option appears
      anywhere on this page
- [ ] Restore returns a hearing to every active view listed above, and
      the record is removed from the Archived Hearings list
- [ ] Both actions record `Archived Hearing`/`Restored Hearing` on the
      Activity Log, filed under the existing "CRUD" category
- [ ] Reports: "Include Archived" is unchecked by default; checking it
      adds archived hearings to the Hearing Report, both breakdown
      reports, the summary cards, and the CSV export; Word export stays
      active-only regardless of the checkbox's state
- [ ] Dashboard, Timeline, Calendar, Search, Quick View/Lightbox, Hearing
      CRUD (for roles that have it), RBAC nav-hiding, Activity Log, and
      Word/CSV export content all behave exactly as in v0.9.2 aside from
      the changes documented above
- [ ] No new Firestore collection was introduced; no document was ever
      moved or duplicated; no duplicated Firestore listener, dashboard
      computation, filtering check, or archive-logic copy was introduced
      — every active-only view reuses the one `isActiveHearing()`
      function; every file not listed in the Changelog as added/modified
      is byte-identical to v0.9.2
---

# Milestone 14: Backup & Restore

A system-wide Backup & Restore module for Administrators — manual
backups, disaster recovery, migration between Firebase projects, and
recovering from accidental data loss. No new Firestore collection; no
schema changes to any existing collection.

## 1. What gets backed up

A single JSON file containing every document from:

```
hearings, hearingCases, activityLogs, users, systemStatus
```

**A note on "systemConfig":** this app has no collection by that name.
Its only system-level collection is `systemStatus` — a lightweight,
read-only connectivity probe used by `app.js`/`diagnostics.js`, holding
no real configuration. That is what's backed up here, under its real
name. It's included for completeness but is **never restored** — see
below.

Document IDs are preserved (`{ id, ...fields }`, the same shape used
throughout this app). Firestore Timestamp fields (`hearingDateTime`,
`createdAt`, `updatedAt`, `archivedAt`, `deletedAt`, the activity log's
`timestamp`, etc.) are preserved too — serialized to
`{ __type: "timestamp", seconds, nanoseconds }` on export and
reconstructed as real `Timestamp` instances on restore, so fields
Calendar's range queries depend on keep working correctly after a
restore rather than silently becoming plain strings.

Backup metadata:

```json
{
  "backupVersion": "1.0",
  "systemVersion": "0.9.4",
  "createdAt": "2026-07-23T10:15:00.000Z",
  "collections": { "hearings": [...], "hearingCases": [...], "activityLogs": [...], "users": [...], "systemStatus": [...] }
}
```

Suggested filename: `branch9-backup-YYYY-MM-DD-HHMM.json` (local time).

## 2. Restore behavior

Restore rules, exactly as specified: **update** any document whose ID
already exists at the destination, **create** any that's missing,
**never delete** anything already in the system, **skip** malformed
records, and **continue** past recoverable errors instead of aborting
the whole restore.

Per-collection policy (see `RESTORE_POLICY` in `js/backup-data.js`):

- **hearings, hearingCases, users** — "upsert": every well-formed record
  is written via `set(doc, data, { merge: true })`, whether or not it
  already exists.
- **activityLogs** — "create-missing": **only** entries that do NOT
  already exist at the destination are written; an existing log entry
  is left completely untouched. `activityLogs`' own Firestore rule is
  intentionally `update, delete: if false` (an immutable audit trail) —
  restoring must not fight that design, so this collection never
  attempts an update, only fills in genuinely missing history. One bulk
  read of existing IDs decides this, not one read per record.
- **systemStatus** — "skip": exported for reference only, never written
  back. Its rule is `write: if false` for every role, and it holds
  nothing meaningful to restore.

A record is **malformed** (and skipped) if it isn't an object, or its
`id` isn't a non-empty string. Malformed records are filtered out
*before* anything is batched, so one bad record can never take an
otherwise-good batch of 400 down with it. If a batch's `commit()` itself
fails (a **recoverable error** — e.g. a transient network blip), that
batch's records are counted as failed and the restore continues with
the next batch/collection rather than stopping.

Before any write happens, the selected file is validated
(`validateBackupFile()` in `js/backup-data.js` — pure, no Firestore
access) and a confirmation dialog shows exactly what's about to happen —
per-collection record counts, the backup's creation date, and the exact
update/create/never-delete behavior — before the Administrator can
proceed.

## 3. Progress & batching

Writes are chunked at 400 documents per `writeBatch` (Firestore's own
limit is 500 — this keeps headroom), with a yield back to the browser's
event loop between chunks (`setTimeout(resolve, 0)`) so a large restore
never freezes the tab. `js/backup.js` renders a progress bar driven by an
`onProgress({ collection, processed, total })` callback passed into
`restoreFromBackup()` — no Firestore logic lives in `backup.js` itself.

## 4. RBAC — Administrator only

No new role. `PERMISSIONS.BACKUP_MANAGE` (reserved back in v0.9.2
specifically for this milestone) now gates the entire `backup.html`
page via `requirePermission()` — the same page-level gate
`archived.html` and `users.html` already use. No other role has this
permission; the "Backup" nav link (`data-permission="backup.manage"`) is
hidden from everyone else the same way Users/Archived already are.

**One real Firestore Rules change was required:** the `users`
collection's `create` rule previously only allowed a signed-in user to
create *their own* document. Restoring to a brand-new Firebase project
(an explicitly stated goal — migration between projects) would then be
unable to recreate *other* users' role documents. The rule now also
allows Administrator to create any user's document from scratch — see
"Firestore Security Rules for RBAC" above. No other collection's rules
needed to change (`activityLogs`' restrictive rule is deliberately left
alone — see "create-missing" above).

## 5. Activity Log

Reuses the existing `logActivity()` helper — no duplicated logging
logic. Records: `Backup Created`, `Restore Started`, `Restore
Completed`, `Restore Failed`.

## 6. Limitations

- This is a **client-side** backup/restore — very large collections
  (tens of thousands of documents or more) will be slow to export/import
  through the browser; there's no server-side/Admin SDK batch job.
- Restore cannot distinguish "created" from "updated" without an extra
  read per document (not worth it for a disaster-recovery tool at this
  system's scale), so the summary reports `written` as one combined
  count per collection, plus `skippedExisting` (activityLogs only),
  `skippedMalformed`, and `failed`.
- A failed batch is retried by nothing automatically — if the summary
  shows failures, re-running the restore is safe (upsert is idempotent,
  and activityLogs' create-missing check re-evaluates what's already
  present) but is a manual step.
- Restoring `users` documents restores **role assignments**, not
  Firebase Authentication accounts themselves — this app has no Admin
  SDK access, so it cannot recreate sign-in credentials. An account must
  still sign in at least once (creating its own `users/{uid}` doc via
  the existing self-service path) before a restored role document for
  that UID has any effect, unless a matching UID already exists from the
  original project.
- `systemStatus` is exported for completeness only; it is never
  restored (see above).

## 7. Testing Checklist

- [ ] Only Administrator sees the "Backup" nav link and can reach
      `backup.html` directly; every other role is redirected to Home
- [ ] "Download Backup" produces a JSON file named
      `branch9-backup-YYYY-MM-DD-HHMM.json` containing all five
      collections, with Timestamp fields serialized (not plain strings)
- [ ] Selecting a valid backup file shows accurate per-collection record
      counts and creation metadata before enabling "Restore"
- [ ] Selecting an invalid/corrupted/non-JSON file shows specific
      validation errors and keeps "Restore" disabled
- [ ] The restore confirmation dialog states update/create/never-delete
      behavior and per-collection counts before anything is written
- [ ] Restoring a backup: existing hearings/cases/users are updated,
      missing ones are created, nothing already present is deleted
- [ ] Restoring an activityLogs entry whose ID already exists at the
      destination leaves that entry completely unchanged; only
      genuinely missing entries are created
- [ ] A large backup (hundreds+ of records) shows a moving progress bar
      and the browser tab stays responsive throughout
- [ ] `Backup Created` / `Restore Started` / `Restore Completed` /
      `Restore Failed` all appear correctly on the Activity Log
- [ ] Dashboard, Calendar, Search, Reports, Word/CSV export, Archive &
      Restore (hearings), and RBAC nav-hiding all behave exactly as in
      v0.9.3 — no duplicated Firestore listener, filtering, or dashboard
      computation was introduced by this milestone
- [ ] No new Firestore collection was introduced; every file not listed
      in the Changelog as added/modified is byte-identical to v0.9.3
---

# Milestone 15: Hardening, QA & Release Preparation

Feature freeze. This milestone made no CRUD changes, no Firestore schema
changes, no new collections, and no redesign — it is a full audit of
everything built in Milestones 1–14, fixing what it found with the
smallest possible change. See CHANGELOG.md's v0.9.5 entry for the
itemized list of fixes; this section is the reusable reference material
that comes out of that audit — the checklists and procedures you'll want
for every future deployment, not just this one.

## 1. Deployment Checklist

Run through this every time a new version is deployed to GitHub Pages
(or wherever this app is hosted next):

- [ ] `js/firebase-config.js` points at the intended Firebase project
      (not a dev/test project)
- [ ] Firestore Security Rules in the Firebase Console match
      "Firestore Security Rules for RBAC" below exactly — copy-paste the
      whole block, don't hand-edit around it
- [ ] `VERSION` file matches the release you're deploying
- [ ] Every `?v=` cache-busting query string (in all `*.html` files'
      `css/styles.css`/`<script type="module">` references, and every
      local `import ... from "./*.js"` in every file under `js/`) matches
      the new `VERSION` — a single find-and-replace of the old version
      string with the new one across `*.html` and `js/*.js` is
      sufficient (see Milestone 16 below for why every file needs it)
- [ ] CHANGELOG.md has an entry for this version
- [ ] A fresh backup was taken (see "Backup Procedure" below) before
      deploying, in case anything needs to be rolled back
- [ ] Test sign-in with at least one account per role (Administrator,
      Branch Clerk, Encoder, Read Only) after deploying — not just
      Administrator
- [ ] Open the browser console on Home, Hearings, and Calendar after
      deploying and confirm there are no errors
- [ ] Click through every nav link once per role to confirm the
      permission-based hide/show behavior still matches the matrix below

## 2. Production Checklist

Functional confirmation before calling a build production-ready:

- [ ] Authentication — sign in, sign out, session persists across a
      page reload, redirected to Login when signed out
- [ ] RBAC — all 4 roles see exactly the nav links/buttons/pages their
      row in the permission matrix says they should
- [ ] Dashboard — stat cards and Today's Hearings Timeline reflect
      current data, excluding archived hearings
- [ ] Timeline — Now/Next highlighting and the 30-second live refresh
      both work
- [ ] Calendar — Month/Week/Day views all load, all exclude archived
      hearings, clicking a hearing opens it in Hearings
- [ ] Search — Hearings' and Archived Hearings' search both filter
      correctly across case number/plaintiff/accused/charge/date/status
- [ ] Reports — every scope (Today/Week/Month/Custom), the Status and
      Hearing Type breakdowns, and the "Include Archived" checkbox all
      produce correct results
- [ ] Activity Log — every logged action type appears with the correct
      category and timestamp
- [ ] Archive — archiving and restoring both work, and archived hearings
      correctly disappear from/reappear in every active view
- [ ] Backup — downloads a complete, correctly-named JSON file
- [ ] Restore — validates a file, shows an accurate confirmation, and
      correctly updates/creates/never-deletes
- [ ] Word Export — every mode (This Hearing/Date/Week/Month) produces a
      correctly formatted .docx, active hearings only
- [ ] CSV Export — matches the current Reports filters/scope
- [ ] Mobile — every page usable at a phone width (see "Recommended
      Browser Support" below for what's actually been tested)
- [ ] Desktop — every page usable at a standard desktop width
- [ ] Firestore Rules — deployed rules match README exactly (see
      Deployment Checklist above)
- [ ] No console errors on any page, for any role
- [ ] No broken internal links (nav, quick actions, calendar-to-hearing
      deep links)
- [ ] No missing imports (`node --check` passes on every file in `js/`)

## 3. Backup Procedure

1. Sign in as Administrator and open **Backup** from the nav.
2. Click **Download Backup**. A file named
   `branch9-backup-YYYY-MM-DD-HHMM.json` downloads — save it somewhere
   durable (not just the Downloads folder of one machine).
3. Confirm the on-page status line reports all 5 collections with
   non-zero counts you'd expect (skip this check only for a genuinely
   empty system).
4. A `Backup Created` entry appears on the Activity Log.
5. **Recommended cadence:** before every deployment (see Deployment
   Checklist), and on whatever regular schedule your court's data-loss
   tolerance calls for — this app has no automatic/scheduled backup, only
   the manual one described here (see "Known Limitations").

## 4. Restore Procedure

1. Sign in as Administrator and open **Backup**.
2. Under "Restore from Backup," select a previously downloaded backup
   file. The page shows per-collection record counts and the backup's
   creation date — check these look right before continuing.
3. Click **Restore**. Read the confirmation dialog — it states exactly
   what's about to happen (update existing, create missing, never
   delete) — then confirm.
4. Watch the progress bar; do not close the tab while it's running.
5. Read the summary: `written` / `already present (kept as-is)` /
   `malformed (skipped)` / `failed` per collection. If anything shows as
   `failed`, re-running the restore with the same file is safe (see
   "Limitations" in Milestone 14 above) — upserts are idempotent and the
   activityLogs check re-evaluates what's already present.
6. `Restore Started` and `Restore Completed`/`Restore Failed` entries
   appear on the Activity Log.
7. **Migrating to a new Firebase project:** create the new project,
   paste its config into `js/firebase-config.js`, deploy the Firestore
   Security Rules (Section on Firestore Rules above), sign in once with
   an Administrator account (creating that account's own `users/{uid}`
   doc), then restore the most recent backup into it.

## 5. Recommended Browser Support

Built and manually verified against:

- Chrome/Edge (current — Chromium-based), desktop and Android
- Safari (current), desktop and iOS
- Firefox (current), desktop

No IE11 or legacy-Edge support — the app uses the Firebase Modular SDK
(ES modules, native `<script type="module">`), which those don't
support. No specific minimum version pinning is done beyond "a current
release of one of the above" — this is a small internal court tool, not
a public-facing site, so browser-matrix testing is scoped accordingly.

## 6. Known Limitations

- **No pagination.** Hearings, Archived Hearings, Activity Log (capped
  at its existing `limit()`), and Users all load their full result set
  into the browser via a live listener. Fine at a single RTC branch's
  realistic data volume; would need real work (cursor-based pagination)
  before this could serve a much larger docket.
- **Backup & Restore is client-side.** Very large collections (tens of
  thousands of documents+) would be slow to export/import through the
  browser — there's no server-side/Admin SDK batch job. See Milestone 14
  for the rest of Backup & Restore's specific limitations (role
  restoration vs. Auth account recreation, `systemStatus` never being
  restored, etc.).
- **No automatic/scheduled backups.** Backup is a manual,
  Administrator-triggered action only (see "Backup Procedure" above).
- **`hearingsToCsvRows()` and similar per-hearing case lookups are
  O(n·m)** (filtering the full cases array per hearing rather than
  pre-grouping once) — see the CHANGELOG's v0.9.5 entry, "Identified,
  deliberately not changed."
- **Single Firebase project, no environment separation.** There's no
  built-in staging/production split; deploying to a different
  environment means swapping `js/firebase-config.js` and redeploying.
- **GitHub Pages hosting.** Fine for this app's current needs (static
  files, no server-side rendering), but note for future planning: GitHub
  Pages doesn't support server-side secrets or private repos serving
  content without extra tooling — worth revisiting if this repository
  is made private post-v1.0.0.
---

# Milestone 16: UI Polish & Visual Consistency

Final milestone before v1.0.0. Not a redesign — a visual polish,
consistency, and cache-busting pass across all 9 pages (Login, Home,
Hearings, Calendar, Reports, Activity Log, Archived Hearings, Users,
Backup & Restore). No Firestore schema changes, no new collections, no
business-logic or RBAC changes, no layout redesigns.

## 1. Visual consistency audit

Every page was compared against every other for cards, buttons, forms,
tables, typography, icons, and color tokens, checking specifically
whether the existing token system (`var(--space-N)`, `var(--text-N)`,
the shared `.btn-primary`/`.btn-secondary`/`.btn-small` base rule,
`.card`, `.data-table`, `.empty-row`, and the `eyebrow`/`h1`/`sub` header
pattern used identically on all 9 pages) was actually being applied
consistently, rather than introducing anything new. It was, almost
everywhere — a testament to building each milestone by reusing existing
classes rather than writing page-specific CSS. Three real
inconsistencies were found and fixed (see CHANGELOG's v0.9.6 entry for
the itemized list): two standalone Backup & Restore buttons that were
accidentally full-width instead of content-sized, one table's loading
row missing a `colspan` its column count needed, and disabled-button
styling that existed for `.btn-primary` but not `.btn-secondary`/
`.btn-small` (both of which do have disabled buttons elsewhere in the
app).

## 2. Responsive review

Re-checked all 9 pages at desktop, tablet (≤ 1024px), and phone
(≤ 768px) widths. No new breakpoints or layout changes were needed —
Archived Hearings and Backup & Restore (the two newest pages, added in
v0.9.3/v0.9.4) both reuse existing fluid `.card`/`.wrap-wide`/
`.data-table`/`.hearings-search` classes rather than introducing
page-specific ones, so they already inherit the nav-wrapping and
table-header-collapse rules tuned for phone/tablet in earlier
milestones (v0.6.1, v0.8.2).

## 3. Accessibility review

Re-verified (not re-implemented) v0.9.5's keyboard-navigation, focus-
visible, dialog-role, and form-label work is intact and consistent
across every page. No new gaps found this pass.

## 4. Cache busting

**The problem:** browsers (and GitHub Pages' CDN, which sets a
`max-age` on served files) cache static assets by URL. Without any
versioning, a deploy that changes `css/styles.css` or any file under
`js/` can leave returning visitors' browsers serving the *previous*
version of that file for a while after deployment, even on a hard
navigation — this was observed after earlier releases in this project.

**The fix:** every internal asset reference now carries a `?v=0.9.6`
query string tied to the current `VERSION` — a different URL for every
release, which every browser treats as a cache miss:

- `css/styles.css` in all 11 HTML files
- each page's own `<script type="module" src="js/*.js">` entry point
- every local `import ... from "./*.js"` statement across all 23 files
  under `js/` (not just the HTML entry points) — ES modules are cached
  by browsers per-file, independent of which page loaded them, so a
  shared dependency like `hearings-data.js` needed its own versioned
  URL too, not just the page controller that imports it

This is a static, no-build-step approach, consistent with the rest of
this project's architecture (plain files, no bundler, no build
pipeline) — the version string is just a query parameter added to
existing URLs, nothing about how the files are served or loaded
changes. External CDN scripts (the Firebase SDK, `docx@8.0.4`,
`lucide@latest`) are untouched — they're independently versioned by
their own URLs already, and aren't this app's assets to cache-bust.

**Why every file needed the same version string:** several files (most
notably `firebase-init.js`, importing the shared `auth`/`db` instances
into 8+ other files) are imported from many places. ES modules are
deduplicated by their *resolved URL* — if two importers referenced
`firebase-init.js` with different (or missing) version query strings,
the browser would load two separate module instances, meaning two
separate Firebase app instances sharing nothing. Every import in this
codebase uses the identical `?v=0.9.6` suffix, so every reference to a
given file resolves to the exact same URL and thus the same single
module instance — verified by grep across every importer of
`firebase-init.js` before shipping this.

**Keeping it lightweight for future releases:** there's no build step
that does this automatically. The process is a single find-and-replace
of the old version string with the new one across `*.html` and
`js/*.js` (now a step in the Deployment Checklist above) — mechanical,
but simple enough not to need new tooling for a project this size.

## 5. Files modified vs. byte-identical

Because cache-busting touches an asset reference or import line in
nearly every file, "byte-identical" isn't the most useful lens for this
particular milestone — instead, every changed file was diffed against
the v0.9.5 baseline with the `?v=0.9.6` strings stripped back out, to
confirm exactly what (if anything) changed *beyond* the version string:

- **32 files** changed *only* by the `?v=0.9.6` addition (11 HTML files,
  21 JS files with at least one local import) — zero other bytes differ
  from v0.9.5
- **3 files** also received a real fix: `backup.html` (button classes),
  `reports.html` (loading-row colspan), `css/styles.css` (disabled-state
  rule + the button/table fixes' supporting styles)
- **9 files** are fully untouched: `CHANGELOG.md`, `CNAME`, `README.md`,
  `VERSION`, `js/constants.js`, `js/dashboard-live.js`,
  `js/dashboard-stats.js`, `js/firebase-config.js`, `js/permissions.js`
  (these have no local imports and aren't referenced as a `<script>`
  entry point by any HTML file, so nothing in them needed a version
  string)

## 6. Final Visual Readiness Assessment

Every page uses the same design tokens, the same component classes, and
the same interaction patterns (buttons, tables, empty/loading states,
dialogs, keyboard access) — confirmed by direct comparison across all 9
pages rather than assumed. The three inconsistencies this pass found
were genuinely minor (two oversized buttons, one missing `colspan`, one
missing disabled-state rule) — not signs of a fragmented design system,
but normal drift from building 16 milestones' worth of pages by hand.
Cache busting is in place and verified not to have introduced duplicate
module instances. This project has not been visually reviewed in an
actual browser as part of this milestone (all review here was
static-analysis and cross-file comparison) — a final look in a real
browser, across the desktop/tablet/phone widths this document lists, is
worth doing before v1.0.0 ships, alongside the fresh-Firebase-project
test already planned for that stage.
