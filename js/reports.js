// ---------------------------------------------------------------------------
// Reports & Statistics page controller.
//
// UI only: rendering, filters, and export actions. All report math lives
// in reports-data.js (pure, no DOM) — nothing in this file computes a
// statistic itself, it only calls into that module and renders what
// comes back. This is a read-only page: no create/update/delete logic
// exists here or is reachable from here.
//
// Data: reuses the same subscribeToHearings()/subscribeToCases() live
// listeners hearings.js and home.js already use — no new Firestore
// listener types are introduced for this page. v0.9.3: subscribes with
// { includeArchived: true } so archived hearings are available in memory
// for the "Include Archived" checkbox — reportHearings() below is the
// one place that decides which of them are actually in scope, reusing
// the same isActiveHearing() filter every other active-only view uses.
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { subscribeToHearings, subscribeToCases, isActiveHearing } from "./hearings-data.js?v=1.0.0";
import { exportCourtCalendarForDate, exportCourtCalendarForWeek, exportCourtCalendarForMonth } from "./docx-export.js?v=1.0.0";
import { exportCourtCalendarForDatePdf, exportCourtCalendarForWeekPdf, exportCourtCalendarForMonthPdf } from "./pdf-export.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { can, PERMISSIONS } from "./permissions.js?v=1.0.0";
import { showNotice, clearNotice } from "./notify.js?v=1.0.0";
import {
  getHearingsForDate,
  getHearingsForWeek,
  getHearingsForMonth,
  getHearingsForDateRange,
  filterByStatus,
  filterBySection,
  getDistinctStatuses,
  groupByDay,
  computeStatusReport,
  computeHearingTypeReport,
  computeSummaryStats,
  buildCsv,
  hearingsToCsvRows,
  CSV_HEADERS,
} from "./reports-data.js?v=1.0.0";
import { SECTIONS } from "./constants.js?v=1.0.0";
import { escapeHtml as esc } from "./dom-utils.js?v=1.0.0";

let hearings = [];
let cases = [];
let currentRole = null;

// "today" | "week" | "month" | "custom" — mirrors the exact semantics
// hearings.js's Export Calendar dropdown already uses for week/month
// ("the current week/month", not a picked one), so this page's filters
// behave the same way the Clerk already expects from Hearings.
let scope = "today";
let customStart = "";
let customEnd = "";
let statusFilter = "All";
let sectionFilter = "All";
// v0.9.3 (Archive & Case Lifecycle Management): OFF by default — Reports
// excludes archived hearings unless explicitly requested via the
// "Include Archived" checkbox. hearings[] itself now holds every
// non-deleted hearing (active AND archived; see init()'s
// { includeArchived: true } subscription below) so toggling this needs
// no re-subscription, just a different in-memory filter.
let includeArchived = false;

// The one place this page decides which hearings are in scope for
// everything below (summary cards, date-range filters, breakdown
// reports, CSV export) — reuses the same centralized isActiveHearing()
// helper hearings-data.js's default subscribeToHearings() behavior (and
// calendar-data.js) already use, rather than a second copy of that
// check.
function reportHearings() {
  return includeArchived ? hearings : hearings.filter(isActiveHearing);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function todayDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Same case-summarizing convention hearings.js's list view already uses
// (kept local rather than imported — page-controller-local formatting
// helpers, same pattern as hearings.js/home.js not sharing theirs).
function caseSummary(hearingId) {
  const list = cases.filter((c) => c.hearingId === hearingId);
  if (!list.length) return "\u2014";
  return list.map((c) => `${c.caseType || ""}. ${c.caseNo || ""}`).join("; ");
}

function caseCountFor(hearing) {
  return typeof hearing.caseCount === "number" ? hearing.caseCount : cases.filter((c) => c.hearingId === hearing.id).length;
}

// --- Scoped dataset --------------------------------------------------------
// The date-range scope (Today/Week/Month/Custom), independent of the
// Status/Hearing Type filters — computed once per render and reused by
// the hearing-list table, the two breakdown reports, and both exports,
// so the date logic is never duplicated within this file.

function dateScopedHearings(inScope) {
  const scoped = inScope || reportHearings();
  if (scope === "today") return getHearingsForDate(scoped, todayDateStr());
  if (scope === "week") return getHearingsForWeek(scoped, new Date());
  if (scope === "month") return getHearingsForMonth(scoped, new Date());
  if (scope === "custom") return getHearingsForDateRange(scoped, customStart, customEnd);
  return scoped;
}

function scopeLabel() {
  if (scope === "today") return `Today (${fmtDate(todayDateStr())})`;
  if (scope === "week") return "This Week";
  if (scope === "month") return "This Month";
  if (scope === "custom") {
    if (!customStart || !customEnd) return "Custom Range";
    return customStart === customEnd ? fmtDate(customStart) : `${fmtDate(customStart)} \u2013 ${fmtDate(customEnd)}`;
  }
  return "";
}

// --- Rendering: summary cards ---------------------------------------------
// Always the full already-loaded dataset, same "global overview" behavior
// as the Home dashboard's stat cards — not affected by the filters below.

function renderSummary(inScope) {
  const stats = computeSummaryStats(inScope || reportHearings());
  document.getElementById("statTotalHearings").textContent = stats.totalHearings;
  document.getElementById("statActiveCases").textContent = stats.activeCases;
  document.getElementById("statHearingsThisMonth").textContent = stats.hearingsThisMonth;
  document.getElementById("statHearingsThisYear").textContent = stats.hearingsThisYear;
  document.getElementById("statPendingHearings").textContent = stats.pendingHearings;
  document.getElementById("statCompletedHearings").textContent = stats.completedHearings;
}

// --- Rendering: hearing list (Daily / Weekly / Monthly Hearing Report) ---
// Which shape renders depends only on scope: a single day (Today, or a
// Custom Range collapsed to one day) is a flat list; a week, month, or
// multi-day Custom Range is grouped by day. Same underlying columns
// hearings.js's list view already uses, minus the Actions column — this
// page is read-only.

function hearingRow(h, includeDate) {
  return `
    <tr>
      ${includeDate ? `<td>${h.hearingDate ? esc(fmtDate(h.hearingDate)) : '<span class="muted">Not set</span>'}</td>` : ""}
      <td>${esc(h.hearingTime) || '<span class="muted">&mdash;</span>'}</td>
      <td>${esc(h.section)}</td>
      <td>${esc(h.status)}</td>
      <td>${caseCountFor(h)}</td>
      <td>${esc(caseSummary(h.id))}</td>
      <td>${esc((h.accused || []).join(", "))}</td>
    </tr>
  `;
}

// Differentiates "there is nothing on the docket at all" from "the
// current filters happen to exclude everything" — see Phase 9 report
// empty-state requirements. `hasAnyData` is reportHearings().length > 0,
// i.e. whether ANY hearing exists in scope before the date/status/section
// filters below are applied.
function emptyStateMessage(hasAnyData) {
  return hasAnyData
    ? 'No hearings match the selected filters. <button type="button" class="btn-link-reset" data-reset-filters>Reset filters</button>'
    : "No hearing data exists yet.";
}

function renderHearingList(scopedHearings, hasAnyData) {
  const thead = document.getElementById("reportListHead");
  const tbody = document.getElementById("reportListBody");
  const singleDay = scope !== "week" && scope !== "month" && !(scope === "custom" && customStart !== customEnd);

  const baseCols = ["Time", "Section", "Status", "# Cases", "Case No(s).", "Accused"];
  const cols = singleDay ? ["Date", ...baseCols] : baseCols;
  thead.innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;

  if (!scopedHearings.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" class="empty-row">${emptyStateMessage(hasAnyData)}</td></tr>`;
    wireResetFiltersLinks(tbody);
    return;
  }

  if (singleDay) {
    tbody.innerHTML = scopedHearings.map((h) => hearingRow(h, true)).join("");
    return;
  }

  const days = groupByDay(scopedHearings);
  tbody.innerHTML = days
    .map(
      (day) => `
        <tr><td colspan="${cols.length}" class="report-day-divider">${esc(fmtDate(day.date))}</td></tr>
        ${day.hearings.map((h) => hearingRow(h, false)).join("")}
      `
    )
    .join("");
}

// --- Rendering: Hearing Status Report / Hearing Type Report ---------------
// Each excludes its own facet from the filter it's built from, so
// filtering by Status still shows a full Hearing Type breakdown (and
// vice versa) instead of the trivial single-row result filtering by the
// same facet you're viewing would otherwise produce.

function renderStatusReport(rows, hasAnyData) {
  const tbody = document.getElementById("statusReportBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="empty-row">${emptyStateMessage(hasAnyData)}</td></tr>`;
    wireResetFiltersLinks(tbody);
    return;
  }
  tbody.innerHTML = rows.map((r) => `<tr><td>${esc(r.status)}</td><td>${r.count}</td></tr>`).join("");
}

function renderTypeReport(rows, hasAnyData) {
  const tbody = document.getElementById("typeReportBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="empty-row">${emptyStateMessage(hasAnyData)}</td></tr>`;
    wireResetFiltersLinks(tbody);
    return;
  }
  tbody.innerHTML = rows.map((r) => `<tr><td>${esc(r.section)}</td><td>${r.count}</td></tr>`).join("");
}

// Wires the "Reset filters" link injected into an empty-state row by
// emptyStateMessage() above — same resetFilters() the toolbar's own
// "Reset Filters" button (wireFilters()) calls.
function wireResetFiltersLinks(root) {
  root.querySelectorAll("[data-reset-filters]").forEach((btn) => {
    btn.addEventListener("click", resetFilters);
  });
}

// --- Export ------------------------------------------------------------
// CSV always reflects every active filter (scope + status + section) —
// this file builds it in full via reports-data.js's pure helpers.
//
// Word reuses the existing exportCourtCalendarForDate/Week/Month
// functions verbatim rather than writing a second docx builder that
// accepts a pre-filtered subset. Those functions re-derive their own
// date scope internally from the full hearings/cases arrays, so they
// only produce an accurate match to what's on screen when Status and
// Hearing Type are both "All" and the scope is Today/Week/Month — Custom
// Range and any active Status/Hearing Type filter disable the Word
// button below rather than silently exporting something wider than the
// filtered view.

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Shared by both the Word and PDF export buttons — both reuse the same
// exportCourtCalendarFor*() family of functions (one per renderer), which
// re-derive their own date scope internally from the full hearings/cases
// arrays; see the comment above handleExportWord() for why Custom Range
// and an active Status/Hearing Type filter disable both buttons rather
// than silently exporting something wider than the filtered view.
function calendarExportAvailable() {
  return (
    can(currentRole, PERMISSIONS.EXPORT) &&
    (scope === "today" || scope === "week" || scope === "month") &&
    statusFilter === "All" &&
    sectionFilter === "All"
  );
}

async function handleExportCsv() {
  if (!can(currentRole, PERMISSIONS.EXPORT)) return;
  const scoped = filterBySection(filterByStatus(dateScopedHearings(), statusFilter), sectionFilter);
  const csv = buildCsv(CSV_HEADERS, hearingsToCsvRows(scoped, cases));
  // Leading UTF-8 BOM: without it, Excel (the primary CSV consumer here)
  // mis-detects the encoding and garbles non-ASCII characters (accented
  // names, etc.) even though the file itself is correctly encoded UTF-8.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `hearing-report-${todayDateStr()}.csv`);
  logActivity({
    action: "Export Report (CSV)",
    module: "Reports",
    entityId: null,
    entityType: "report",
    description: `Exported CSV report for ${scopeLabel()}${statusFilter !== "All" ? `, status: ${statusFilter}` : ""}${sectionFilter !== "All" ? `, type: ${sectionFilter}` : ""}${includeArchived ? ", including archived" : ""}`,
  });
}

async function handleExportWord() {
  if (!calendarExportAvailable()) return;
  const btn = document.getElementById("exportWordBtn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Exporting\u2026";
  // Word export always covers active hearings only, even when "Include
  // Archived" is checked — this milestone leaves the DOCX generator and
  // its exportCourtCalendarFor*() call sites untouched (see CHANGELOG).
  const activeHearings = hearings.filter(isActiveHearing);
  try {
    if (scope === "today") await exportCourtCalendarForDate(activeHearings, cases, todayDateStr());
    else if (scope === "week") await exportCourtCalendarForWeek(activeHearings, cases, new Date());
    else if (scope === "month") await exportCourtCalendarForMonth(activeHearings, cases, new Date());
    logActivity({
      action: "Export Report (Word)",
      module: "Reports",
      entityId: null,
      entityType: "report",
      description: `Exported Word calendar report for ${scopeLabel()}`,
    });
  } catch (err) {
    document.getElementById("reportExportStatus").textContent = `Could not export: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

// PDF sibling to handleExportWord() above — same availability rule, same
// "always active hearings only" scoping, same shared exportCourtCalendarFor*
// family (this time the *Pdf variants from pdf-export.js), same
// try/catch/logActivity shape. Kept as a close mirror rather than a
// shared helper so each renderer's wrapper stays simple to read on its
// own, matching how docx-export.js and pdf-export.js themselves are kept
// as parallel siblings rather than merged.
async function handleExportPdf() {
  if (!calendarExportAvailable()) return;
  const btn = document.getElementById("exportPdfBtn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Exporting\u2026";
  const activeHearings = hearings.filter(isActiveHearing);
  try {
    if (scope === "today") await exportCourtCalendarForDatePdf(activeHearings, cases, todayDateStr());
    else if (scope === "week") await exportCourtCalendarForWeekPdf(activeHearings, cases, new Date());
    else if (scope === "month") await exportCourtCalendarForMonthPdf(activeHearings, cases, new Date());
    logActivity({
      action: "Export Report (PDF)",
      module: "Reports",
      entityId: null,
      entityType: "report",
      description: `Exported PDF calendar report for ${scopeLabel()}`,
    });
  } catch (err) {
    document.getElementById("reportExportStatus").textContent = `Could not export: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

// --- Full render ---------------------------------------------------------

function render() {
  const inScope = reportHearings();
  const hasAnyData = inScope.length > 0;
  renderSummary(inScope);

  const scoped = dateScopedHearings(inScope);
  const mainList = filterBySection(filterByStatus(scoped, statusFilter), sectionFilter);
  renderHearingList(mainList, hasAnyData);
  renderStatusReport(computeStatusReport(filterBySection(scoped, sectionFilter)), hasAnyData);
  renderTypeReport(computeHearingTypeReport(filterByStatus(scoped, statusFilter)), hasAnyData);

  document.getElementById("reportScopeSummary").textContent = scopeLabel();
  document.getElementById("exportWordBtn").disabled = !calendarExportAvailable();
  document.getElementById("exportPdfBtn").disabled = !calendarExportAvailable();
  // Read Only has reports.view but not export — the buttons don't just
  // disable for them, they're not shown at all ("do not show actions the
  // user cannot perform").
  const canExport = can(currentRole, PERMISSIONS.EXPORT);
  document.getElementById("exportCsvBtn").hidden = !canExport;
  document.getElementById("exportWordBtn").hidden = !canExport;
  document.getElementById("exportPdfBtn").hidden = !canExport;
}

// Resets every report filter back to its default and re-renders — the
// toolbar's "Reset Filters" button, and the same handler the empty
// state's inline "Reset filters" link (wireResetFiltersLinks() above)
// calls, so both entry points behave identically.
function resetFilters() {
  scope = "today";
  statusFilter = "All";
  sectionFilter = "All";
  includeArchived = false;

  document.getElementById("reportScopeSelect").value = "today";
  document.getElementById("reportCustomRangeRow").hidden = true;
  document.getElementById("reportSectionSelect").value = "All";
  document.getElementById("reportIncludeArchived").checked = false;
  refreshStatusOptions();
  render();
}

// --- Filter wiring ---------------------------------------------------------

function wireFilters() {
  const scopeSelect = document.getElementById("reportScopeSelect");
  const customRow = document.getElementById("reportCustomRangeRow");
  const startInput = document.getElementById("reportRangeStart");
  const endInput = document.getElementById("reportRangeEnd");
  const statusSelect = document.getElementById("reportStatusSelect");
  const sectionSelect = document.getElementById("reportSectionSelect");

  scopeSelect.addEventListener("change", () => {
    scope = scopeSelect.value;
    customRow.hidden = scope !== "custom";
    render();
  });

  startInput.addEventListener("change", () => {
    customStart = startInput.value;
    if (endInput.value && customStart > endInput.value) endInput.value = customStart;
    customEnd = endInput.value;
    render();
  });

  endInput.addEventListener("change", () => {
    customEnd = endInput.value;
    render();
  });

  statusSelect.addEventListener("change", () => {
    statusFilter = statusSelect.value;
    render();
  });

  sectionSelect.addEventListener("change", () => {
    sectionFilter = sectionSelect.value;
    render();
  });

  const includeArchivedCheckbox = document.getElementById("reportIncludeArchived");
  includeArchivedCheckbox.addEventListener("change", () => {
    includeArchived = includeArchivedCheckbox.checked;
    refreshStatusOptions();
    render();
  });

  document.getElementById("exportCsvBtn").addEventListener("click", handleExportCsv);
  document.getElementById("exportWordBtn").addEventListener("click", handleExportWord);
  document.getElementById("exportPdfBtn").addEventListener("click", handleExportPdf);
  document.getElementById("resetFiltersBtn").addEventListener("click", resetFilters);
}

function populateSectionOptions() {
  const select = document.getElementById("reportSectionSelect");
  select.innerHTML = `<option value="All">All</option>${SECTIONS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}`;
}

// Status options come from the data itself (see getDistinctStatuses in
// reports-data.js), not a hardcoded list — rebuilt on every data update
// so a newly-used status appears without a page reload, while the
// current selection is preserved if it's still valid.
function refreshStatusOptions() {
  const select = document.getElementById("reportStatusSelect");
  const current = select.value || "All";
  const statuses = getDistinctStatuses(reportHearings());
  select.innerHTML = `<option value="All">All</option>${statuses.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}`;
  select.value = statuses.includes(current) || current === "All" ? current : "All";
  statusFilter = select.value;
}

// --- Error states ----------------------------------------------------------
//
// subscribeToHearings()/subscribeToCases() (hearings-data.js) accept an
// optional onError callback — the same additive contract home.js's
// dashboard already wires for its own two live listeners. Wired here so a
// Firestore failure (offline, permission-denied, etc.) is shown to the
// user instead of leaving every stat card and table stuck on "Loading…"
// forever.

function renderHearingsError(err) {
  console.error("Reports: hearings listener failed", err);
  const noticeHost = document.getElementById("reportsLoadError");
  showNotice(noticeHost, "Could not load hearing data. Check your connection and try again.", "error");
  const closeBtn = noticeHost.querySelector(".inline-notice-close");
  if (closeBtn) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "inline-notice-retry";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", startHearingsSubscription);
    noticeHost.querySelector(".inline-notice")?.insertBefore(retryBtn, closeBtn);
  }
  ["statTotalHearings", "statActiveCases", "statHearingsThisMonth", "statHearingsThisYear", "statPendingHearings", "statCompletedHearings"].forEach((id) => {
    document.getElementById(id).textContent = "\u2014";
  });
  document.getElementById("reportListBody").innerHTML = `<tr><td colspan="7" class="empty-row">Unavailable.</td></tr>`;
  document.getElementById("statusReportBody").innerHTML = `<tr><td colspan="2" class="empty-row">Unavailable.</td></tr>`;
  document.getElementById("typeReportBody").innerHTML = `<tr><td colspan="2" class="empty-row">Unavailable.</td></tr>`;
}

function renderCasesError(err) {
  // Cases only affect the "Active Cases" stat and the Case No(s). column —
  // a less severe failure than the hearings listener above, so this
  // doesn't blank the whole page, just notes it inline the same way.
  console.error("Reports: cases listener failed", err);
  showNotice(document.getElementById("reportsLoadError"), "Could not load case data — case numbers may be incomplete.", "warning");
}

let unsubscribeHearings = null;

function startHearingsSubscription() {
  if (typeof unsubscribeHearings === "function") unsubscribeHearings();
  clearNotice(document.getElementById("reportsLoadError"));
  unsubscribeHearings = subscribeToHearings(
    (data) => {
      hearings = data;
      clearNotice(document.getElementById("reportsLoadError"));
      refreshStatusOptions();
      render();
    },
    { includeArchived: true },
    renderHearingsError
  );
}

// --- Init ---------------------------------------------------------------

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.REPORTS_VIEW, { redirectTo: "home.html" })) return;

  currentRole = user.role;
  wireNavAuth(user);
  populateSectionOptions();
  wireFilters();

  const today = todayDateStr();
  document.getElementById("reportRangeStart").value = today;
  document.getElementById("reportRangeEnd").value = today;
  customStart = today;
  customEnd = today;

  startHearingsSubscription();
  subscribeToCases((data) => {
    cases = data;
    render();
  }, renderCasesError);
}

init();
