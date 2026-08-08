// ---------------------------------------------------------------------------
// Case Detail page controller (IM-10: Case Activity & History).
//
// Read-only. Requires cases.view (same gate as cases.html). All Firestore
// access goes through cases-data.js/hearings-data.js/activity-data.js —
// nothing here calls Firestore directly, matching every other page
// controller in this project.
//
// The Activity/History timeline merges THREE existing, already-tested
// sources — no new collection, no new schema, nothing written:
//   1. Case-level activityLogs entries (Create Case/Edit Case/Archived
//      Case) — entityType "case", entityId = this case's id.
//   2. Derived case status history (hearings-data.js's
//      getCaseStatusHistory(), IM-6B/Decision 008) — a Case's status
//      changes, computed fresh from its linked Hearings' own `status`
//      field. This is domain data, not an audit log entry.
//   3. Hearing-level activityLogs entries (Create Hearing/Edit Hearing/
//      Archived Hearing/exports) for every Hearing linked to this Case
//      via hearingCases.caseId (hearings-data.js's
//      getHearingCaseRowsForCase()) — per the approved IM-10 scope
//      adjustment: hearing activity IS included in a case's history,
//      since hearings are already linked to cases and a Clerk wants the
//      complete picture, not just Case-document-level edits.
//
// Deliberately NOT included: any "Hearing rescheduled"/"Hearing
// cancelled" event type. The current data model has no such concept —
// a hearing only has a workflow `status` (the procedure being
// conducted), not an outcome/cancellation flag — so per IM-10's "do not
// fabricate activity records" rule, these are left out rather than
// guessed at from status changes.
//
// Permission note: activityLogs is the audit trail already gated behind
// PERMISSIONS.ACTIVITY_LOG_VIEW everywhere else in this app (activity.html).
// To avoid quietly exposing that same audit data to roles that can't see
// the Activity Log page (Encoder, Read Only — see permissions.js), items
// 1 and 3 above are only fetched/shown when the signed-in role has that
// permission. Item 2 (derived status history) is domain data drawn from
// Hearings/Cases the role can already see via cases.view/hearings.view,
// so it's always shown. A role without ACTIVITY_LOG_VIEW therefore still
// gets a real, useful timeline (status changes) — just not the
// audit-log-level entries an Administrator/Branch Clerk also sees.
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { getCase } from "./cases-data.js?v=1.0.0";
import { getCaseStatusHistory, getHearingCaseRowsForCase } from "./hearings-data.js?v=1.0.0";
import { getActivityForEntities } from "./activity-data.js?v=1.0.0";
import { can, PERMISSIONS } from "./permissions.js?v=1.0.0";

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Firestore Timestamp -> "Aug 11, 2026, 9:00 AM". Used for every timeline
// entry's displayed date, whatever source it came from (activityLogs'
// `timestamp`, a Hearing's `hearingDateTime`, or a Case's `createdAt`) —
// they're all Firestore Timestamps, so one helper covers all three.
function fmtTimestamp(ts) {
  if (!ts || typeof ts.toDate !== "function") return "Undated";
  return ts.toDate().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Sortable millisecond value for a Firestore Timestamp, or null if there
// isn't a usable one (matches getCaseStatusHistory()'s own "no usable
// date sorts last" convention, applied here across all merged sources).
function tsMillis(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
}

let caseId = null;

// --- Case info -------------------------------------------------------------

function renderCaseInfo(c) {
  document.getElementById("caseTitle").textContent = `${c.caseType || ""}. ${c.caseNo || ""}`.trim() || "Case Details";
  document.getElementById("caseSub").textContent = c.charge || "";

  const status = c.currentStatus ? esc(c.currentStatus) : "Not yet set";
  const since = c.currentStatusDate ? ` &middot; since ${fmtTimestamp(c.currentStatusDate)}` : "";

  document.getElementById("caseInfoBody").innerHTML = `
    <div class="field field-full">
      <label>Case</label>
      <p>${esc(c.caseType)}. ${esc(c.caseNo)}</p>
    </div>
    <div class="field field-full">
      <label>Charge</label>
      <p>${c.charge ? esc(c.charge) : '<span class="muted">&mdash;</span>'}</p>
    </div>
    <div class="field field-full">
      <label>Date filed</label>
      <p>${c.dateFiled ? esc(fmtDate(c.dateFiled)) : '<span class="muted">Not set</span>'}</p>
    </div>
    <div class="field field-full">
      <label>Current status</label>
      <p>${status}${since}</p>
    </div>
  `;
}

// --- Timeline ----------------------------------------------------------
//
// Every timeline entry is normalized to { millis, dateLabel, title, detail }
// before sorting, regardless of which of the three sources it came from —
// keeps render() below a single, source-agnostic loop.

function statusHistoryToEntries(history) {
  // history is ascending; order doesn't matter here since everything is
  // re-sorted together below.
  return history.map((h) => ({
    millis: tsMillis(h.hearingDateTime),
    dateLabel: fmtTimestamp(h.hearingDateTime),
    title: "Case status changed",
    detail: h.status || "(status not set)",
  }));
}

function activityLogsToEntries(entries) {
  return entries.map((e) => ({
    millis: tsMillis(e.timestamp),
    dateLabel: fmtTimestamp(e.timestamp),
    title: e.action || "Activity",
    detail: e.description || "",
  }));
}

function caseCreatedEntry(c) {
  // Always derived from the Case document's own createdAt — not from
  // activityLogs — so this entry still appears even for a role without
  // ACTIVITY_LOG_VIEW, and even if the original "Create Case" log write
  // ever failed (logActivity() is fire-and-forget by design; createdAt
  // is not). Omitted entirely (not fabricated with a placeholder date)
  // if createdAt genuinely isn't set.
  if (!c.createdAt) return null;
  return {
    millis: tsMillis(c.createdAt),
    dateLabel: fmtTimestamp(c.createdAt),
    title: "Case created",
    detail: `${c.caseType || ""}. ${c.caseNo || ""}`.trim(),
  };
}

function renderTimeline(entries) {
  const body = document.getElementById("activityBody");

  if (!entries.length) {
    body.innerHTML = `
      <div class="timeline-empty">
        <p class="timeline-empty-title">No activity recorded for this case yet.</p>
      </div>
    `;
    return;
  }

  // Newest first; entries with no usable date sort last (unknown, not
  // assumed-recent) — same convention getCaseStatusHistory() already uses,
  // just inverted for descending order.
  const sorted = [...entries].sort((a, b) => {
    if (a.millis === null && b.millis === null) return 0;
    if (a.millis === null) return 1;
    if (b.millis === null) return -1;
    return b.millis - a.millis;
  });

  body.innerHTML = `
    <ul class="timeline-list">
      ${sorted
        .map(
          (e) => `
        <li class="timeline-item">
          <span class="timeline-rail"><span class="timeline-dot"></span></span>
          <span class="timeline-content">
            <span class="timeline-time">${esc(e.dateLabel)}</span>
            <span class="timeline-case">${esc(e.title)}</span>
            ${e.detail ? `<span class="timeline-stage">${esc(e.detail)}</span>` : ""}
          </span>
        </li>
      `
        )
        .join("")}
    </ul>
  `;
}

async function loadAndRenderTimeline(role) {
  // Always available: derived status history (domain data, gated by
  // cases.view/hearings.view only — not an audit-log permission).
  const statusHistory = await getCaseStatusHistory(caseId);
  const entries = statusHistoryToEntries(statusHistory);

  const createdEntry = caseCreatedEntry(currentCase);
  if (createdEntry) entries.push(createdEntry);

  // Audit-log-derived entries: gated behind the same permission that
  // gates the standalone Activity Log page (see header comment).
  if (can(role, PERMISSIONS.ACTIVITY_LOG_VIEW)) {
    const caseActivity = await getActivityForEntities("case", [caseId]);
    entries.push(...activityLogsToEntries(caseActivity));

    const linkedRows = await getHearingCaseRowsForCase(caseId);
    const hearingIds = [...new Set(linkedRows.map((r) => r.hearingId).filter(Boolean))];
    const hearingActivity = await getActivityForEntities("hearing", hearingIds);
    entries.push(...activityLogsToEntries(hearingActivity));
  }

  renderTimeline(entries);
}

// --- Init ------------------------------------------------------------------

let currentCase = null;

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.CASES_VIEW, { redirectTo: "home.html" })) return;

  wireNavAuth(user);

  caseId = new URLSearchParams(window.location.search).get("id");
  if (!caseId) {
    document.getElementById("caseNotFound").hidden = false;
    document.getElementById("caseContent").hidden = true;
    return;
  }

  currentCase = await getCase(caseId);
  if (!currentCase) {
    document.getElementById("caseNotFound").hidden = false;
    document.getElementById("caseContent").hidden = true;
    return;
  }

  document.getElementById("caseContent").hidden = false;
  renderCaseInfo(currentCase);
  await loadAndRenderTimeline(user.role);
}

init();
