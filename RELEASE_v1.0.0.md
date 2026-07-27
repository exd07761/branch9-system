# Branch9 Docket Management System — v1.0.0 Stable Release

## Introduction

Branch9 Docket Management System is a web-based application built for
the Branch Clerk of Court of a Philippine Regional Trial Court (RTC)
branch, to schedule and track court hearings and the criminal cases
attached to them. It replaces manual/paper-based docket tracking with a
single system covering scheduling, a calendar, case-number tracking,
reporting, an audit trail, backup/restore, and role-based access for
the different people who work with a branch's docket day to day.

This is the first stable release. Development proceeded through 18
incremental milestones — each one shipped as a complete, working,
deployable system before the next began — culminating in a dedicated
hardening pass, a final acceptance-testing QA pass, and a production-
readiness review. Nothing in this release is experimental; every
feature listed below has been in continuous use through several rounds
of review before this tag.

## Highlights

- A complete hearing-and-case workflow: schedule, edit, search, archive
  (and restore), all from one Hearings page
- A live Dashboard with a real-time Today's Hearings Timeline
- Month/Week/Day Calendar views
- Word (.docx) export that replicates the branch's actual official
  Court Calendar document format
- Reports with CSV export, date scoping, and status/type breakdowns
- A complete audit trail (Activity Log) of every significant action
- Full Backup & Restore — manual backups, disaster recovery, and
  cross-Firebase-project migration
- Four-role Role-Based Access Control, enforced both in the UI and in
  Firestore's own Security Rules — not just hidden buttons
- Responsive design (desktop, tablet, phone) and accessibility
  (keyboard navigation, focus-visible states, dialog semantics, form
  labels) reviewed across every page
- Zero external backend beyond Firebase — no server to maintain, no
  build step to run

## Major Features

### Hearings & Case Management
Create and edit hearings, each with one or more attached criminal case
numbers. Duplicate case-number detection warns before saving. Deleting
a hearing is a soft delete — the record is never destroyed, only
hidden from active views, and its cases stay attached.

### Dashboard
At-a-glance stat cards (active cases, hearings today, next 7/30 days),
a live Today's Hearings Timeline with Now/Next status highlighting and
a 30-second auto-refresh, a Now Hearing / Next Hearing pair of cards,
and Quick Actions (Add Hearing, Open Calendar, Export Today's Calendar).

### Calendar
Read-only Month, Week, and Day views. Clicking any hearing deep-links
into Hearings to edit it — Calendar never duplicates the edit form or
its validation logic.

### Reports
Date-scoped (Today/Week/Month/Custom Range) hearing reports, with
Status and Hearing Type breakdowns and CSV export. An "Include
Archived" checkbox (off by default) lets a report include archived
hearings when needed; Word export always covers active hearings only,
regardless of that checkbox.

### Word (DOCX) Export
Generates a Court Calendar document — the branch's real letterhead,
judge, personnel list, and the exact shaded table layout of the
reference document Branch 9 actually uses — in four modes: This
Hearing, a specific Date, a Week, or a Month.

### Activity Log
Every significant action (create/edit hearing, archive/restore,
backup/restore, login/logout, exports) is logged with a timestamp,
user, action, module, and description — visible to Administrator and
Branch Clerk roles.

### Archive & Case Lifecycle Management
A dedicated Archived Hearings page. Archiving is a soft state change,
completely separate from delete — an archived hearing's document (and
its cases) are untouched beyond four new fields, and it is always fully
restorable. Archived hearings are excluded from the Dashboard, Calendar,
Search, Active Hearings, and Reports by default.

### Backup & Restore
Administrator-only. Exports every collection (hearings, hearingCases,
activityLogs, users, and the system status collection) into a single
JSON file, with Firestore Timestamps preserved through a reversible
serialization. Restoring updates existing documents, creates missing
ones, and never deletes anything already present — with a validated
file, an explicit confirmation dialog, a progress bar, and a completion
summary.

### Users & Role-Based Access Control
Four built-in roles — Administrator, Branch Clerk, Encoder, Read Only —
each with a specific, documented set of permissions. Enforcement exists
in two independent places: the UI (hiding/disabling what a role
shouldn't use) and Firestore's own Security Rules (so the real
enforcement doesn't depend on the UI at all).

## Technology Stack

- **Frontend:** plain HTML5, CSS3 (a single hand-maintained token-based
  stylesheet — no CSS framework), and vanilla JavaScript using native
  ES modules (`<script type="module">`, `import`/`export`) — no bundler,
  no build step, no transpiler
- **Backend:** Firebase Authentication (email/password) and Cloud
  Firestore, accessed via the Firebase Modular SDK (v10.7.1) directly
  from the browser
- **Hosting:** GitHub Pages — static files only, no server-side
  rendering or server-side code of any kind
- **External libraries (loaded via CDN, not bundled):** `docx@8.0.4`
  (pinned) for Word export, `lucide` (icon set — currently unpinned;
  see "Known Roadmap" and README's Deployment Checklist) for icons
- **Fonts:** Google Fonts (Source Serif 4 + Inter)

## Architecture Summary

- **28 JavaScript files** under `js/`, split consistently into a data
  layer and a UI layer per feature: e.g. `hearings-data.js` (the sole
  Firestore access point for hearings/cases) vs. `hearings.js` (the page
  controller — DOM rendering and event wiring only). No page controller
  talks to Firestore directly.
- **11 HTML pages** plus a custom `404.html`, each a thin shell that
  loads exactly one page-controller module and the shared stylesheet.
- **One shared stylesheet** (`css/styles.css`, ~1650 lines) built on a
  token system (spacing, typography, and color CSS custom properties)
  reused by every page — no page-specific CSS files.
- **Two Firestore collections hold all application data:** `hearings`
  and `hearingCases`, plus `activityLogs` and `users` for the audit
  trail and RBAC, and a small `systemStatus` collection used only as a
  read-only connectivity probe. No schema changes were made across the
  entire v0.x development history beyond additive fields on existing
  documents (e.g. `isArchived`/`archivedAt` added to `hearings` in
  v0.9.3) — never a new collection, never a breaking change to an
  existing field.
- **Centralized filtering:** a single `isActiveHearing()` function
  decides "is this hearing in active operations" (not soft-deleted, not
  archived) — every page that needs an active-only list uses it, rather
  than each page re-implementing the same check.
- **RBAC enforced twice, independently:** once in the UI
  (`js/permissions.js`'s `can()` helper, called before rendering or
  wiring any gated control) and once in Firestore Security Rules
  (mirroring the same role matrix) — so the real security boundary does
  not depend on the UI at all.
- **Cache-busting:** every internal CSS/JS asset reference (including
  every local `import` statement, not just HTML entry points) carries a
  `?v=<VERSION>` query string, so a version bump reliably invalidates
  every browser's cached copy of the whole dependency graph, not just
  the page that loaded first.

## Known Roadmap

**v1.0.x — patch releases only.** Bug fixes and security-rule
corrections if any are found in production use. No new features.

**v1.1.0 — candidate additive features** (not committed, to be
evaluated against real usage of v1.0.0 first):
- Pinning `lucide` to a specific tested version (carried over from
  v0.9.9, see README's Deployment Checklist)
- Confirming/correcting the `CNAME` domain for the actual deployment
  (carried over from v0.9.9)
- Minor UX refinements based on real Clerk feedback after v1.0.0 has
  been in use

**v2.0.0 — reserved for anything requiring architectural change**, for
example:
- Pagination, if a branch's docket volume grows large enough that
  loading full collections client-side stops being practical
- A move off GitHub Pages, if the project ever needs server-side
  capabilities GitHub Pages can't provide
- Any change to the two-collection Firestore schema that isn't purely
  additive

## Acknowledgements

Built for Branch 9 (Family Court, Third Judicial Region), City of San
Fernando, Pampanga. Created by Jordan Panganiban.
