# Changelog

All notable changes to this project are documented here, grouped by
milestone. Versions follow `MAJOR.MINOR.PATCH` loosely tied to milestone
completion during V1 development.

## [0.5.0] — UI Foundation Redesign

HTML/CSS only. No JavaScript file was modified — verified by checksum
before and after. No backend logic, Firestore schema, CRUD behavior,
security rules, or authentication flow changed.

**Added — Design system (`css/styles.css`, full rewrite)**
- Color tokens (navy ink, brass/gold primary action color, sparing maroon
  accent, warm paper background), a two-role type scale (Source Serif 4
  for headings, Inter for everything else), consistent spacing/radius/
  shadow scales
- Persistent top navigation bar (new, on `home.html`/`hearings.html`/
  `calendar.html`) with active-page highlighting and a signature
  navy-to-brass-to-maroon hairline beneath it
- Redesigned buttons, form inputs, cards, and the Firebase fatal-error
  overlay, all using the new tokens
- Tables optimized for daily use: sticky header (stays visible while
  scrolling a long hearings list), zebra striping, row hover, tabular
  figures for aligned dates/case numbers, comfortable padding
- Lightweight icons via Lucide (CDN): real `<i data-lucide>` icons on
  static nav/toolbar elements (rendered once via `lucide.createIcons()`
  on page load); CSS-only mask-image icons (in Lucide's visual style) on
  every dynamically-rendered element from `hearings.js`/`calendar.js`/
  `diagnostics.js` — since `createIcons()` only runs once at load and
  never against content those scripts generate afterward, embedding a
  real `<i>` tag there would silently never become an icon

**Fixed one self-inflicted risk before it shipped:** the login submit
button's icon was initially added as a real child element, then corrected
to a CSS `::before` pseudo-element instead, because `login.js` sets that
button's `.textContent` directly during sign-in — a real child element
would have been wiped out by that on first use. Pseudo-elements aren't
part of the DOM `.textContent` touches, so this survives untouched, with
zero changes to `login.js`.

**Known, deliberate limitation:** only `home.js` wires up `logoutBtn`'s
click handler and populates `userEmail` — `hearings.js` and `calendar.js`
do neither. Adding those same elements to the Hearings/Calendar nav bars
would have created a non-functional button. Their nav bars therefore
include Home/Hearings/Calendar links only; logging out requires returning
to Home first.

**Files touched:** `css/styles.css`, `index.html`, `login.html`,
`home.html`, `hearings.html`, `calendar.html`. `diagnostics.html` needed
no changes — it already used classes the new stylesheet restyles
automatically. **No `.js` file was touched** (verified by checksum).

**Frozen:** No further changes without a discovered bug.

## [0.4.1] — Production readiness fixes

Fixes three issues found during a production-readiness review of v0.4.0.
No new features; no changes to the authentication architecture.

**Fixed**
- **Real entry point restored.** `index.html` (the site's root page) no
  longer shows the Milestone 1 developer diagnostics screen. It now
  immediately redirects: signed-in users → `home.html`, signed-out users →
  `login.html`. The diagnostics screen still exists — moved to
  `diagnostics.html` (script renamed to `js/diagnostics.js`) — but is no
  longer linked from anywhere in the Clerk-facing app. `js/index.js` reuses
  the existing `requireAuth()` from `auth-guard.js` rather than adding any
  new auth logic.
- **Login form validation restored.** Removed the `novalidate` attribute
  from `login.html`, which had been silently disabling the browser's
  native required-field checks despite both inputs being marked
  `required`. Also added a small defensive check in `js/login.js` so an
  empty email or password can never reach Firebase even if the submit
  event fires some other way. Friendly error messages for actual bad
  credentials are unchanged.
- **Graceful Firebase initialization failure handling.** `js/auth-guard.js`
  now checks for `firebaseInitError` (from `firebase-init.js`) before
  calling `onAuthStateChanged`. If Firebase failed to initialize, every
  page that depends on it — `index.html`, `login.html`, `home.html`,
  `hearings.html`, `calendar.html` — now shows a clear, user-facing
  "Unable to connect" overlay instead of a blank page or an uncaught
  exception. `diagnostics.html` already had its own equivalent handling
  from Milestone 1 and needed no change. This is the same two guard
  functions as before (`requireAuth`, `redirectIfAuthenticated`) with a
  guarded early return — no new authentication flow was introduced.

**Not changed:** everything else found in the production review (Firestore
query patterns, duplicated helper functions, stale comments, session
re-validation mid-session, etc.) — those were reported but explicitly not
authorized for this fix batch.

## [0.4.0] — Milestone 4: Calendar Views

**Added**
- `calendar.html` + `js/calendar.js` — Month, Week, and Day views with
  Prev/Next/Today navigation, toggled within a single page
- `js/calendar-data.js` — strictly read-only Firestore access layer for
  Calendar; queries `hearings` by date range on `hearingDateTime`
  (added in Milestone 3), never loads the full collection
- Month and Week views use the existing `caseCount` field for counts —
  neither ever queries `hearingCases`
- Day View loads only hearing documents up front; a specific hearing's
  case numbers are fetched from `hearingCases` only when the Clerk clicks
  "Show cases" on that hearing, and cached per-session so re-expanding
  doesn't refetch
- Clicking a hearing anywhere in Calendar (Month entry, Week entry, or a
  Day card's "Details" link) navigates to `hearings.html?openHearing=<id>`,
  which reuses the existing edit form there — Calendar itself contains no
  form, validation, save, or delete logic
- Clicking a Month cell's date (not a specific entry) drills into Day View
  for that date
- Navigation link to Calendar added on `home.html`, alongside the existing
  Hearings link

**Not included (by design, scoped to later milestones)**
- Color coding, filters, drag-and-drop scheduling, printable calendar
  views — the implementation is structured (pure date helpers, one render
  function per view, isolated data layer) so these can be added later
  without rewriting the core calendar
- No schema changes, no new collections, no composite indexes required

**Frozen:** No further changes without a discovered bug.

## [0.3.3] — Milestone 3 bugfix: Duplicate check now ignores deleted hearings

**Fixed**
- The duplicate case-number check previously scanned all `hearingCases`
  documents regardless of whether their parent hearing was soft-deleted,
  so a case number that existed only on a deleted hearing would still
  (incorrectly) trigger the "already exists" warning. `isDuplicateCaseNumber()`
  now accepts the set of currently active (non-deleted) hearing IDs and
  skips cases belonging to any hearing outside that set.

**Scope of change:** `js/hearings-data.js` (function signature) and
`js/hearings.js` (its one call site) only. No other function, file, schema
field, CRUD behavior, soft-delete mechanics, audit fields, `caseCount`, or
`hearingDateTime` logic was touched. No UI changes.

**Frozen permanently.** Milestone 3 validated and production-ready. No
further changes without a discovered bug.

## [0.3.2] — Milestone 3 revision: Computed hearingDateTime

**Added**
- `hearingDateTime` — a derived Firestore Timestamp on each hearing
  document, computed from the existing `hearingDate` and `hearingTime`
  fields on every save. Nobody edits it directly; `hearingDate` and
  `hearingTime` remain the source of truth. Added to simplify future
  Calendar, Dashboard, Search, and sorting features that need a single
  sortable/queryable timestamp instead of two separate string fields.

**Not changed:** `hearingDate` and `hearingTime` fields, existing
functionality, schema shape (still two flat collections, no new
collections).

**Frozen permanently.** Milestone 3 is complete. No further changes without
a discovered bug.

## [0.3.1] — Milestone 3 revision: Soft Delete, Audit Fields, Case Count

**Changed**
- Hearing deletion is now a **soft delete**: `deleteHearing()` sets
  `isDeleted`, `deletedAt`, and `deletedBy` on the hearing document instead
  of removing it. The UI still shows a "Delete" button and the hearing
  disappears from the list (the list query filters out `isDeleted` hearings),
  but the record — and its attached cases — remain in Firestore,
  recoverable. Removing an individual case row during an edit (not
  deleting the whole hearing) is still a real delete, since that's a
  routine data correction rather than the case this revision protects
  against.
- Both `hearings` and `hearingCases` documents now carry full audit
  fields: `createdAt`, `updatedAt`, `createdBy`, `updatedBy` (the last two
  populated from the signed-in user's email).
- Each hearing document now stores `caseCount` (recomputed on every save),
  so future screens can show the number of linked cases without querying
  and counting `hearingCases` documents.

**Not changed:** schema stays two flat collections — no new collections,
no normalization.

**Frozen:** No further changes without a discovered bug.

## [0.3.0] — Milestone 3: Core Hearing Management

**Added**
- `hearings.html` + `js/hearings.js` — list of all hearings, add/edit form
  with dynamic case-number rows, delete
- `js/hearings-data.js` — Firestore data access layer for the `hearings`
  and `hearingCases` collections (the only file that reads/writes them)
- Required-field validation (hearing type, accused, hearing date, at least
  one case number)
- Duplicate case-number warning (checks case type + case number across all
  hearings, with a confirm-to-proceed override)
- Firestore Security Rules updated: `hearings` and `hearingCases` now
  require `request.auth != null` for read and write
- Small navigation link from `home.html` to `hearings.html` (plain link,
  not a dashboard widget)

**Not included (by design, scoped to later milestones)**
- Calendar, Dashboard, Search, Printing, Reports, User Management, Roles,
  Notifications, Analytics

**Frozen:** No further changes without a discovered bug.

## [0.2.0] — Milestone 2: Authentication

**Added**
- Firebase Authentication (Email/Password) wired in via the v9+ modular SDK
- `login.html` — login form with client-side required-field validation
- `home.html` — minimal authenticated placeholder page (system title,
  signed-in user's email, welcome message, logout button only — no
  dashboard content)
- `js/auth-guard.js` — shared `requireAuth()` / `redirectIfAuthenticated()`
  route-guarding module, structured so future role/permission checks can be
  added without changing how pages call it
- `js/login.js` — sign-in logic, friendly error messages for common
  Firebase Auth error codes, disabled/loading button state during sign-in
- `js/home.js` — auth guard + logout wiring for the home page
- Session persistence via `browserLocalPersistence`

**Not included (by design, scoped to later milestones)**
- Dashboard content (Milestone 5)
- Roles/permissions (not in V1 scope)
- Any Firestore reads/writes beyond Milestone 1's read-only status check

**Frozen:** No further changes without a discovered bug.

## [0.1.0] — Milestone 1: Project Setup

**Added**
- Project folder structure (`css/`, `js/`)
- Firebase v9+ modular SDK wiring (`js/firebase-config.js`,
  `js/firebase-init.js`)
- `index.html` — status page confirming Firebase config, app
  initialization, and a read-only Firestore connectivity check (no test
  documents written)
- GitHub Pages deployment process documented in `README.md`

**Frozen:** No further changes without a discovered bug.
