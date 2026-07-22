# Changelog

All notable changes to this project are documented here, grouped by
milestone. Versions follow `MAJOR.MINOR.PATCH` loosely tied to milestone
completion during V1 development.

## [0.8.2] — Responsive Dashboard & Productivity Polish

UI/UX milestone only — no Firestore, auth, CRUD, Calendar, Word Export,
Search, dashboard-computation, or listener changes.

**Changed**
- **New tablet breakpoint at ≤1024px** (previously the only breakpoint
  was ≤768px). Home's two-column layout (`.dashboard-main-row`) now
  collapses to one column starting at 1024px instead of 768px, so
  Today's Hearings still reads clearly on a tablet, not just a phone —
  it's still first in DOM order, so it still renders before the sidebar
  cards. Nav wrap-safety (wrapping, brand truncation, email ellipsis,
  logout staying reachable) was promoted from the ≤768px tier to this
  new ≤1024px tier, since at the old threshold a nav with a full-length
  brand + 3 links + email + logout could overflow horizontally on
  tablet-width screens between 769–1024px. The ≤768px tier now only
  holds its remaining phone-specific deltas (smaller nav text/padding,
  34vw email truncation, 2x2 stat grid, the sticky-header workaround).
  **Desktop (>1024px) is completely unchanged** — none of this applies
  above 1024px.
- **Quick Actions is now a 2-column grid on phones** (≤768px) instead of
  a single stacked column, with the odd button (Export) spanning the
  full width of its own row; desktop/tablet keep the existing single-row
  layout. Buttons also gained `height: auto` + wrapping on phones so a
  longer label (e.g. "Export Today's Calendar") can't get clipped in a
  narrow column. Same buttons, same click handlers — no logic touched.
- **Now Hearing / Next Hearing / Today's Hearings shrink a bit further
  when empty.** `.session-card--compact`'s padding was tightened again,
  and a new `.dashboard-timeline-card--empty` modifier (toggled by
  `home.js` alongside the existing empty-state check — no new
  computation, just a class toggle) trims the Timeline card's own
  padding when there's nothing to show. No fixed heights were
  introduced anywhere; cards still grow to fit real content exactly as
  before.
- **Timeline visual polish**: more vertical spacing and a larger
  clickable area per row (bigger padding, no change to which element is
  clickable or where it navigates), a thicker higher-contrast connector
  line (`var(--line-strong)`, up from `var(--line)`), slightly larger
  status badges, a smoother hover transition, and the current hearing
  now gets an inset accent border (`var(--green)`) plus a larger dot for
  a clearer highlight. All existing color tokens — no new ones.
- **Keyboard accessibility**: Timeline rows are now focusable
  (`tabindex="0"`, `role="button"`, a descriptive `aria-label`) and
  Enter/Space trigger the same navigation a click does — previously
  they were mouse-only. Visible `:focus-visible` outlines added to
  buttons (`.btn-primary`/`.btn-secondary`/`.btn-small`), nav links, the
  Logout button, and Timeline rows, all reusing existing
  `--brass`/`--brass-dark` tokens. Tab order is unchanged (elements were
  simply made reachable at their existing DOM position, not reordered).
  Smoother hover transitions added to nav links and the Logout button to
  match the buttons' existing transition.

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, Calendar (page, `calendar.js`, or `calendar-data.js`),
Word Export document builder, Court Calendar Export logic, Search, the
Quick View/Lightbox implementation in `hearings.js`, or any function in
`dashboard-stats.js`/`dashboard-live.js`. No new Firestore listeners.
Confirmed by checksum: `hearings-data.js`, `calendar-data.js`,
`calendar.js`, `calendar.html`, `hearings.html`, `hearings.js`,
`nav-auth.js`, `firebase-init.js`, `firebase-config.js`, `auth-guard.js`,
`diagnostics.js`, `diagnostics.html`, `login.js`, `login.html`, `index.js`,
`index.html`, `docx-export.js`, `export-data.js`, `constants.js`,
`dashboard-stats.js`, and `dashboard-live.js` are all byte-identical to
v0.8.1 — only `home.html`, `js/home.js`, and `css/styles.css` were
modified; no files were added.

## [0.8.1] — Dashboard UX Polish

UI/UX refinement only — no Firestore, auth, CRUD, Calendar, Word Export,
Search, Quick View implementation, or dashboard computation changes.

**Changed**
- **Today's Hearings is now the dashboard's visual centerpiece.** `home.html`
  is restructured into a wide main column (the Timeline) alongside a
  narrower sidebar (Now Hearing, Next Hearing, Today's Summary, Quick
  Actions) — `.dashboard-main-row` / `.dashboard-main-col` /
  `.dashboard-side-col`, replacing v0.8.0's equal-width
  `.dashboard-live-row`. The Timeline's heading is larger, and each row
  gets more padding/spacing for easier scanning. Click-to-Lightbox
  behavior (`?previewHearing=<id>` → the existing Quick View modal) is
  completely unchanged.
- **Now Hearing and Next Hearing are now two independent cards** instead
  of one card that toggled between them. A Clerk mid-hearing can now
  still see what's coming up next. Each has its own compact empty state
  (`.session-card--compact`, less padding) so an idle card doesn't
  reserve the same space as one showing real hearing details: "No active
  hearing." for Now Hearing, "No upcoming hearings today." for Next
  Hearing (previously both cases just showed "No active hearing.").
  Still built from the exact same `getCurrentHearing()` /
  `getNextUpcomingHearing()` / `minutesUntil()` in `dashboard-live.js` —
  that file is untouched.
- **Today's Summary redesigned as a horizontal row** (Scheduled /
  Completed / Remaining side by side) instead of v0.8.0's stacked rows —
  same `getTodaysSummary()`, same `.summary-value`/`.summary-label`
  typography, just a `.summary-columns` grid instead of `.summary-row`
  stack.
- **More professional empty state** for an empty Timeline: "No hearings
  scheduled for today. Use Add Hearing or open the Calendar to schedule
  one." replaces v0.8.0's "Enjoy the quiet day." New `.timeline-empty`
  class (kept separate from the shared `.empty-row`, which other pages'
  JS depends on, so it was safe to leave completely alone).
- **Icons added to section headings** (Today's Hearings, Quick Actions,
  Now Hearing, Next Hearing, Today's Summary) using Lucide, the same
  library already loaded on every page — no new icon library, no new
  colors.
- Timeline status badges (Now/Next/Completed/Upcoming) get slightly more
  breathing room to match the timeline's larger scale; same
  `--green`/`--blue`/`--gray-bg`/`--amber` tokens as v0.8.0, no new color
  variables.
- Mobile (≤768px): the new `.dashboard-main-row` and `.summary-columns`
  stack to one column, same pattern as v0.8.0's now-removed
  `.dashboard-live-row` override. No broader responsive redesign, as
  requested — that's planned for after v1.0.

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, Calendar (page, `calendar.js`, or `calendar-data.js`),
Word Export document builder, Court Calendar Export logic, Search, the
Quick View/Lightbox implementation in `hearings.js`, or any function in
`dashboard-stats.js`/`dashboard-live.js`. Confirmed by checksum:
`hearings-data.js`, `calendar-data.js`, `calendar.js`, `calendar.html`,
`hearings.html`, `hearings.js`, `nav-auth.js`, `firebase-init.js`,
`firebase-config.js`, `auth-guard.js`, `diagnostics.js`, `diagnostics.html`,
`login.js`, `login.html`, `index.js`, `index.html`, `docx-export.js`,
`export-data.js`, `constants.js`, `dashboard-stats.js`, and
`dashboard-live.js` are all byte-identical to v0.8.0 — only `home.html`,
`js/home.js`, and `css/styles.css` were modified; no files were added.

## [0.8.0] — Branch Clerk Productivity Dashboard

**Added**
- **Today's Hearings Timeline** (replaces v0.7.2's simple list): a vertical
  timeline on `home.html` with a connecting rail/dot per hearing, a status
  badge (Now / Next / Completed / Upcoming), and a highlighted background
  for the current and next hearings. Still sorted chronologically, still
  today's hearings only, still built entirely from the same already-loaded
  `hearings` array via the existing `getTodaysHearingsSorted()` — zero new
  Firestore reads. Shows "No hearings scheduled today. Enjoy the quiet
  day." when empty.
- **Current Session card**: shows the hearing considered "in progress"
  right now, or "No active hearing." if none is. **Next Hearing card**:
  shown instead whenever there's no active hearing, with a live "Starts in
  N minutes" countdown. Both are pure client-side computation, re-rendered
  on a 30-second timer so they stay accurate as time passes with no new
  Firestore activity.
- **Today's Summary card**: Scheduled / Completed / Remaining counts for
  today, computed the same way.
- **Quick Actions**: Add Hearing, Open Calendar, and Export Today's
  Calendar buttons. Add Hearing and Export Today's Calendar reuse existing
  logic unchanged (see below); Open Calendar is a plain link — Calendar
  itself is completely untouched.
- New `js/dashboard-live.js` — pure computation only (no Firestore/DOM),
  alongside `dashboard-stats.js` rather than inside it: `getCurrentHearing`,
  `getNextUpcomingHearing`, `getTodaysSummary`, `minutesUntil`, and
  `annotateTimelineStatuses`. Since the hearings schema has no duration or
  completion field ("status" is actually the hearing's stage, e.g.
  "Pre-Trial Conference," not a workflow state), "current"/"completed" are
  derived from the existing `hearingDateTime` field plus an assumed
  30-minute hearing length (`DEFAULT_HEARING_DURATION_MINUTES`) — a
  documented client-side approximation, not a new schema field.

**Changed (minimal, additive, reuses existing functions)**
- `hearings.js` now recognizes two more URL entry points alongside the
  existing, unchanged `?openHearing=<id>` (which Calendar still uses
  as-is): `?previewHearing=<id>` calls the existing `openPreview()`
  (the Quick View / "Lightbox" modal from v0.7.1) instead of the edit
  form — this is what the new Timeline and Session cards link to, so
  clicking a hearing on Home opens the same Lightbox rather than
  navigating to the edit form. `?action=add` calls the existing
  `openAddForm()` — this is what the new "Add Hearing" quick action uses.
  No form, validation, save, delete, or preview logic was duplicated;
  both are thin new checks in the existing `maybeAutoOpenFromUrl()`/`init()`
  functions.
- `home.js` now also calls `subscribeToCases()` from `hearings-data.js` —
  the exact same function `hearings.js` already uses — solely so "Export
  Today's Calendar" has case data to include. No new Firestore access code
  was written; this is the same reusable subscription helper called a
  second time, the same pattern already used for `subscribeToHearings()`
  across Home/Hearings/Calendar. "Export Today's Calendar" itself calls
  the existing `exportCourtCalendarForDate()` from `docx-export.js` (the
  same function the Hearings page's date-export already uses) with
  today's date — no export logic duplicated. `docx@8.0.4` script tag
  added to `home.html` (same version already used on `hearings.html`).

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, Calendar (page, `calendar.js`, or `calendar-data.js`),
Word Export document builder, Court Calendar Export logic, or Search.
Calendar's own `?openHearing=<id>` linking behavior is untouched.
Confirmed by checksum: `hearings-data.js`, `calendar-data.js`, `calendar.js`,
`nav-auth.js`, `firebase-init.js`, `firebase-config.js`, `auth-guard.js`,
`diagnostics.js`, `login.js`, `index.js`, `docx-export.js`,
`export-data.js`, `constants.js`, and `dashboard-stats.js` are all
byte-identical to v0.7.2 — only `home.html`, `js/home.js`, `js/hearings.js`,
and `css/styles.css` were modified, plus the new `js/dashboard-live.js`.

## [0.7.2] — Today's Hearings Panel

**Added**
- A read-only "Today's Hearings" card on `home.html`, below the dashboard
  summary cards. Lists every hearing scheduled for today, sorted
  chronologically, each showing time, "Plaintiff vs. Accused", and the
  hearing's stage/status.
- `getTodaysHearingsSorted()` (new, in `dashboard-stats.js`) — pure
  function, no Firestore/DOM. Filters to today's date and sorts by the
  existing `hearingDateTime` field (the derived Timestamp added in
  Milestone 3 specifically for sorting), rather than parsing the
  `hearingTime` label string.
- Reuses the **same** `subscribeToHearings()` call already added for the
  dashboard in v0.7.0 — one listener now drives both the stat cards and
  this new panel, not two.
- Displayed time is formatted from `hearingDateTime` (e.g. "8:30 AM")
  rather than the stored descriptive label ("8:30 in the Morning"), to
  match the requested display format — still derived entirely from
  existing data, no schema change.
- Clicking a hearing navigates to `hearings.html?openHearing=<id>` — the
  exact same mechanism Calendar already uses. Deliberately **not**
  changed to open the newer Quick View modal (from v0.7.1) instead: that
  URL parameter is shared with Calendar, and changing what it does would
  be a behavior change to Calendar, which this milestone requires to stay
  unchanged. Documented here in case a lightbox-on-click behavior is
  wanted later via a separate mechanism.
- Shows "No hearings scheduled today." when empty.

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, Calendar, Export, Search, or the Hearing Quick View.
Confirmed by checksum: `hearings-data.js`, `calendar-data.js`,
`calendar.js`, `hearings.js`, `nav-auth.js`, `firebase-init.js`,
`firebase-config.js`, `auth-guard.js`, `diagnostics.js`, `login.js`,
`index.js`, `docx-export.js`, `export-data.js`, and `constants.js` are
all byte-identical to before this release — only `home.html`, `js/home.js`,
`js/dashboard-stats.js`, and `css/styles.css` were touched.

**Frozen:** No further changes without a discovered bug.

## [0.7.1] — Hearing Quick View

**Added**
- Clicking anywhere on a hearing's row (outside its Edit/Delete buttons)
  opens a read-only quick-view modal showing every hearing field and its
  linked cases — reusing the already-loaded `hearings`/`cases` state via
  the existing `casesForHearing()` helper. No new Firestore read happens
  to open it.
- Closes via the X button, an outside click on the backdrop, or Escape.
- A convenience "Edit This Hearing" button in the modal closes the
  preview and calls the existing `openEditForm()` unchanged — no
  save/validation/delete logic is duplicated.
- Visually matches the existing design system (same tokens as the
  Firebase fatal-error overlay's card/overlay pattern) and adapts
  automatically to dark mode, since no new colors were introduced —
  every rule uses existing CSS custom properties.

**How it avoids double-triggering with existing row actions:** the row's
click handler checks `e.target.closest('[data-action]')` and bails out
before opening the preview, so the Edit and Delete buttons — unchanged —
keep working exactly as before.

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, Calendar, Export, Dashboard, or Search. Confirmed by
checksum: `hearings-data.js`, `calendar-data.js`, `calendar.js`,
`home.js`, `nav-auth.js`, `firebase-init.js`, `firebase-config.js`,
`auth-guard.js`, `diagnostics.js`, `login.js`, `index.js`,
`docx-export.js`, `export-data.js`, `constants.js`, and
`dashboard-stats.js` are all byte-identical to before this release —
only `hearings.js`, `hearings.html`, and `css/styles.css` were touched.

**Frozen:** No further changes without a discovered bug.

## [0.7.0] — Dashboard and Global Search

**Added — Dashboard (`home.html`)**
- Four read-only summary cards: Active Cases, Hearings Today, Hearings in
  Next 7 Days, Hearings in Next 30 Days.
- `js/dashboard-stats.js` (new) — pure computation only, no Firestore or
  DOM. Takes an already-loaded hearings array and returns the four
  numbers. "Active Cases" sums each hearing's existing `caseCount` field
  (added in Milestone 3 for exactly this purpose) — no new read of the
  `hearingCases` collection is needed for any of the four stats.
- `js/home.js` now calls `subscribeToHearings()` — the same function
  `hearings.js` already uses from `hearings-data.js` — rather than
  writing a second, duplicate Firestore query. Updates live whenever
  Firestore changes, same as every other consumer of that function.
- `home.html` widened from `wrap-narrow` to the existing `wrap-wide`
  container (already used on Hearings/Calendar) to fit the new grid; no
  new colors, fonts, or component styles were introduced.

**Added — Global Search (`hearings.html`)**
- A search bar filtering the Hearings table live as you type, across
  case number, plaintiff, accused, charge, hearing date, and status.
- Case-insensitive substring match against the already-loaded `hearings`/
  `cases` arrays in memory — filters client-side on every keystroke, with
  zero new Firestore queries. Reuses the existing `casesForHearing()`
  helper rather than duplicating any case-lookup logic.
- Search state is independent of Calendar and Export — neither was
  touched, and both continue reading the same underlying data untouched.

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, Calendar, or Export. Confirmed by checksum:
`hearings-data.js`, `calendar-data.js`, `calendar.js`, `nav-auth.js`,
`firebase-init.js`, `firebase-config.js`, `auth-guard.js`,
`diagnostics.js`, `login.js`, `index.js`, `docx-export.js`,
`export-data.js`, and `constants.js` are all byte-identical to before
this release.

**Frozen:** No further changes without a discovered bug.

## [0.6.3] — Export Dropdown + Circular Import Fix

**Fixed**
- **Circular import**, likely the actual cause of the export buttons not
  working: `hearings.js` imports `docx-export.js`, which imports
  `export-data.js`, which imported `SECTIONS` back from `hearings.js` —
  a cycle. New `js/constants.js` (no dependencies of its own) now holds
  `SECTIONS`; both `hearings.js` and `export-data.js` import it from
  there instead, so the graph is a clean, one-directional chain with no
  cycle.

**Changed**
- The three toolbar export controls (Export Date / Week / Month) are now
  a single "Export Calendar" dropdown button instead of three separate
  buttons + a bare date input, for a cleaner toolbar. All underlying IDs
  (`exportDateInput`, `exportDateBtn`, `exportWeekBtn`, `exportMonthBtn`)
  and their click handlers are unchanged — only the surrounding markup
  and a new open/close toggle were added. The menu closes automatically
  on a successful export, on Escape, or on an outside click.

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, Calendar, or the document-generation logic itself
(same shared builder from v0.6.2). Confirmed by checksum:
`hearings-data.js`, `calendar-data.js`, `calendar.js`, `home.js`,
`nav-auth.js`, `firebase-init.js`, `firebase-config.js`, `auth-guard.js`,
`diagnostics.js`, `login.js`, and `index.js` are all byte-identical to
before this release.

**Frozen:** No further changes without a discovered bug.

## [0.6.2] — Court Calendar Export System

Generalizes Word export from a single-hearing-only feature into a proper
multi-mode export service, matching the previous Branch system's actual
Court Calendar export behavior.

**Added**
- `js/export-data.js` (new) — pure data-preparation layer. No Firestore,
  no docx, no DOM. Filters the already-loaded `hearings`/`cases` arrays by
  date/week/month, attaches each hearing's own cases, and groups the
  result by section (canonical order, from `hearings.js`'s now-exported
  `SECTIONS` constant) — the exact renderer-agnostic shape a future PDF
  exporter could also consume.
- Three new export modes in the Hearings toolbar: **Export Date** (date
  picker + button), **Export Week**, **Export Month** — all reuse the
  page's already-loaded `hearings`/`cases` state; none trigger a new
  Firestore read.
- `js/docx-export.js` — reorganized around **one shared builder**
  (`buildCourtCalendarChildren`) that every export mode calls, differing
  only in which hearings are in the dataset. "Export This Hearing" is now
  a thin wrapper that prepares a one-item dataset and calls the same
  builder as the other three modes — no document-generation logic is
  duplicated between modes.
- Document title is now "COURT CALENDAR" for every mode (matching the
  real reference document exactly), with a mode-specific subtitle
  ("Hearing on...", "For...", "Week of...", "Month of...").

**Changed**
- `hearings.js` now exports `SECTIONS` (was a local `const`) so
  `export-data.js` can reuse the canonical section order instead of
  duplicating it.
- Removed all temporary `[docx-diagnostic]` console logging and the
  `window.__docxDiagnosticTest()` helper added during the earlier blank-
  export investigation — that issue is resolved (see the `docx@8.0.4` +
  `defer` fixes below), so this cleanup keeps the file focused on the new
  feature rather than leftover debugging scaffolding.
- **Fixed a real bug caught before shipping:** the new toolbar export
  buttons have icon children, and the button-state helper was initially
  written using `textContent` to save/restore their label during
  "Exporting…" — which would have silently deleted the icon after the
  first click (`textContent` only sees text nodes, not the `<i>` icon
  element). Corrected to use `innerHTML`, the same safe pattern already
  used elsewhere in this codebase for icon-bearing buttons.

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, or Calendar. Confirmed by checksum: `hearings-data.js`,
`calendar-data.js`, `calendar.js`, `home.js`, `nav-auth.js`,
`firebase-init.js`, `firebase-config.js`, `auth-guard.js`, `diagnostics.js`,
`login.js`, and `index.js` are all byte-identical to before this release.

**Frozen:** No further changes without a discovered bug.

## [0.6.1] — Mobile Header & Branding (No Feature Changes)

UI-only polish. No `.js` file was modified — verified by checksum before
and after. No backend logic, Firestore schema, CRUD behavior, security
rules, Calendar logic, or Word export/formatting changed.

**Fixed**
- Nav bar is now fully responsive below ~768px, CSS-only (`css/styles.css`
  only — no HTML changed for this part, and no ID/class was renamed):
  - Below 768px, the nav wraps onto two rows: brand + email + Logout on
    row one, nav links on their own full-width row below (wrapping
    internally too, if ever needed).
  - The brand name uses `flex: 1 1 auto` + `min-width: 0` + ellipsis, so
    it shrinks and truncates to fit whatever space remains — deliberately
    avoiding fixed-width/viewport-unit math that would need retuning for
    every screen size.
  - The signed-in email gets a `max-width` + ellipsis, so it truncates
    rather than overflowing or pushing Logout off-screen.
  - The Logout button reserves its own space (`flex-shrink: 0`) and
    always stays fully visible and tappable.
  - The Hearings table's sticky header (tuned for the desktop nav's fixed
    height) switches to normal, non-sticky positioning below 768px, since
    the mobile nav's height is no longer fixed — this avoids the table
    header sticking at the wrong offset or overlapping the wrapped nav.
  - Desktop layout (>768px) is completely unaffected — every change lives
    inside a single `@media (max-width: 768px)` block.

**Added**
- "Created by Jordan Panganiban" — a small, muted footer line at the
  bottom of the main content on Home, Hearings, and Calendar. Uses
  existing color/spacing tokens (`--ink-3`, `--text-xs`, `--space-8`).
  New `.app-footer` class only; sits outside every dynamically-rendered
  container (`#calendarContent`, `#hearingsTableBody`, `#formPanel`), so
  it's never touched or overwritten by any existing re-render logic.

**Not changed:** Firestore schema, security rules, CRUD logic,
authentication flow, Calendar logic, Word export, or export formatting.
All 11 `.js` files confirmed byte-identical to before this release by
checksum. Only `css/styles.css`, `home.html`, `hearings.html`, and
`calendar.html` were touched.

**Frozen:** No further changes without a discovered bug.

## [0.6.0] — Hearing Order (.docx) Export

**Added**
- One "Export to Word" button, shown only when editing an existing
  hearing on `hearings.html`. Generates a real, Word-editable `.docx` file
  for that single hearing and downloads it immediately.
- `js/docx-export.js` — new, fully isolated document-generation module.
  No Firestore or auth imports; its only inputs are the hearing object
  and case list already loaded in `hearings.js`'s own state (via the
  existing `casesForHearing()` helper) — no new Firestore query is made
  to produce an export.
- Uses the `docx` library (docx.js.org) loaded via CDN in `hearings.html`,
  pinned to v5.0.2 specifically — later major versions restructured
  their package around ES module exports and no longer reliably expose a
  plain `window.docx` global from a single `<script>` tag with no
  bundler, which this project requires.

**Replicates the Branch's real Hearing Order/Calendar document format**
(source: the uploaded reference file), not a generic report:
- Full letterhead — court name, branch, address, presiding judge, and the
  court personnel list, all hardcoded (this data has no home in Firestore;
  it's static institutional information, not per-hearing data)
- The same shaded, bordered 6-column table layout (`#`, `CASE NO(S). /
  DETAILS`, `TITLE / VICTIM(S)`, `FOR / CHARGE`, `COUNSEL`, `STATUS /
  HEARING`), populated with one row for the single exported hearing
  instead of a full multi-hearing calendar

**Two deliberate deviations from the original v0.6.0 brief**, both
because "replicate this document exactly" (given after the brief) is the
more specific, later instruction:
- Font is **Century Schoolbook** (the real document's font), not Times
  New Roman as originally specified.
- Page size is **Legal (8.5in × 14in)** with 1in/0.75in/1in/0.75in
  margins (top/right/bottom/left), matching the real document, rather
  than a generic "standard" Letter-size margin.

**Known gap:** the reference document includes per-case notification/
private-complainant status lines (e.g. "PCAAA C/O ..."). That data
(`pcInfo` / `accusedNotifiedStatus`) was a deliberate simplification
dropped from this system's schema back in Milestone 3 and doesn't exist
here — those lines are simply omitted from the export rather than
fabricated.

**Not changed:** Firestore schema, security rules, CRUD behavior,
authentication flow, Calendar, or any other UI. Confirmed by checksum:
`hearings-data.js`, `calendar-data.js`, `calendar.js`, `home.js`,
`nav-auth.js`, `firebase-init.js`, `firebase-config.js`, `auth-guard.js`,
`diagnostics.js`, `login.js`, and `index.js` are all byte-identical to
before this release. Only `hearings.html` and `js/hearings.js` were
modified, plus the new `js/docx-export.js`.

**Frozen:** No further changes without a discovered bug.

## [0.5.1] — Logout everywhere, Lucide hardening, automatic dark mode

**Added**
- `js/nav-auth.js` — new shared helper, `wireNavAuth(user)`. Does not
  duplicate authentication logic: `auth-guard.js`'s `requireAuth()` remains
  the only function that calls `onAuthStateChanged`, unchanged. This
  helper only wires the nav bar's email display and Logout button once a
  page already has the user object `requireAuth()` resolved — in one
  place instead of copy-pasted into every page.
- Automatic Dark Mode via `prefers-color-scheme: dark` — follows OS
  preference only, no manual toggle. All theme differences live entirely
  inside the single existing `@media (prefers-color-scheme: dark)` token
  block; no component rule was duplicated.

**Changed**
- `js/home.js` — refactored to call `wireNavAuth(user)` instead of its own
  inline email/logout wiring (same behavior, now shared).
- `js/hearings.js`, `js/calendar.js` — one import + one function call each
  (`wireNavAuth(user)`), added right after `requireAuth()` resolves.
- `hearings.html`, `calendar.html` — nav bar now includes the signed-in
  email and a working Logout button, matching `home.html`.
- Lucide init calls on `home.html`/`hearings.html`/`calendar.html` now
  guard against the CDN failing to load (`if (window.lucide) { ... }`),
  so a blocked network fails silently instead of throwing to the console.
  Verified every `data-lucide` element on every page appears before its
  page's Lucide script tag in document order, so `createIcons()` always
  finds them.
- **Fixed three dark-mode bugs found during implementation**, all in
  `css/styles.css`:
  - `.app-nav` and the nav's signature gradient hairline used `var(--ink)`
    for their background — since `--ink` flips to a *light* color in dark
    mode, this would have made the nav bar background light while its
    text stayed hardcoded white, i.e. invisible. Introduced `--nav-bg`
    (intentionally constant across both themes) and pointed the nav and
    `.cal-view-btn-active` (same bug) at it instead.
  - Table zebra-striping and row-hover tints were hardcoded dark-navy-
    and-brass rgba() values — invisible when layered on an
    already-dark card in dark mode. Replaced with `--zebra-tint`/
    `--row-hover-tint` tokens, each with a dark-mode override.
  - Status colors (`--green`/`--amber`/`--red`/`--blue`) and
    `--brass-dark` (used for links and hover text) are now brightened in
    dark mode for stronger contrast against the much darker backgrounds —
    override lives in the existing dark-mode token block only.

**Not changed:** Firestore schema, security rules, CRUD behavior, or the
authentication flow. Confirmed by checksum: `hearings-data.js`,
`calendar-data.js`, `firebase-init.js`, `firebase-config.js`,
`auth-guard.js`, `diagnostics.js`, `login.js`, and `index.js` are all
byte-identical to before this release.

**Frozen:** No further changes without a discovered bug.

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
