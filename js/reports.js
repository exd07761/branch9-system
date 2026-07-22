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
// listener types are introduced for this page.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js";
import { wireNavAuth } from "./nav-auth.js";
import { subscribeToHearings, subscribeToCases } from "./hearings-data.js";
import { exportCourtCalendarForDate, exportCourtCalendarForWeek, exportCourtCalendarForMonth } from "./docx-export.js";
import { logActivity } from "./activity-data.js";
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
} from "./reports-data.js";
import { SECTIONS } from "./constants.js";

let hearings = [];
let cases = [];

// "today" | "week" | "month" | "custom" — mirrors the exact semantics
// hearings.js's Export Calendar dropdown already uses for week/month
// ("the current week/month", not a picked one), so this page's filters
// behave the same way the Clerk already expects from Hearings.
let scope = "today";
let customStart = "";
let customEnd = "";
let statusFilter = "All";
let sectionFilter = "All";

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
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

function dateScopedHearings() {
  if (scope === "today") return getHearingsForDate(hearings, todayDateStr());
  if (scope === "week") return getHearingsForWeek(hearings, new Date());
  if (scope === "month") return getHearingsForMonth(hearings, new Date());
  if (scope === "custom") return getHearingsForDateRange(hearings, customStart, customEnd);
  return hearings;
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

function renderSummary() {
  const stats = computeSummaryStats(hearings);
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

function renderHearingList(scopedHearings) {
  const thead = document.getElementById("reportListHead");
  const tbody = document.getElementById("reportListBody");
  const singleDay = scope !== "week" && scope !== "month" && !(scope === "custom" && customStart !== customEnd);

  const baseCols = ["Time", "Section", "Status", "# Cases", "Case No(s).", "Accused"];
  const cols = singleDay ? ["Date", ...baseCols] : baseCols;
  thead.innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;

  if (!scopedHearings.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" class="empty-row">No hearings in this range.</td></tr>`;
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

function renderStatusReport(rows) {
  const tbody = document.getElementById("statusReportBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="empty-row">No hearings in this range.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => `<tr><td>${esc(r.status)}</td><td>${r.count}</td></tr>`).join("");
}

function renderTypeReport(rows) {
  const tbody = document.getElementById("typeReportBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="empty-row">No hearings in this range.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => `<tr><td>${esc(r.section)}</td><td>${r.count}</td></tr>`).join("");
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

function wordExportAvailable() {
  return (scope === "today" || scope === "week" || scope === "month") && statusFilter === "All" && sectionFilter === "All";
}

async function handleExportCsv() {
  const scoped = filterBySection(filterByStatus(dateScopedHearings(), statusFilter), sectionFilter);
  const csv = buildCsv(CSV_HEADERS, hearingsToCsvRows(scoped, cases));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `hearing-report-${todayDateStr()}.csv`);
  logActivity({
    action: "Export Report (CSV)",
    module: "Reports",
    entityId: null,
    entityType: "report",
    description: `Exported CSV report for ${scopeLabel()}${statusFilter !== "All" ? `, status: ${statusFilter}` : ""}${sectionFilter !== "All" ? `, type: ${sectionFilter}` : ""}`,
  });
}

async function handleExportWord() {
  if (!wordExportAvailable()) return;
  const btn = document.getElementById("exportWordBtn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Exporting\u2026";
  try {
    if (scope === "today") await exportCourtCalendarForDate(hearings, cases, todayDateStr());
    else if (scope === "week") await exportCourtCalendarForWeek(hearings, cases, new Date());
    else if (scope === "month") await exportCourtCalendarForMonth(hearings, cases, new Date());
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

// --- Full render ---------------------------------------------------------

function render() {
  renderSummary();

  const scoped = dateScopedHearings();
  const mainList = filterBySection(filterByStatus(scoped, statusFilter), sectionFilter);
  renderHearingList(mainList);
  renderStatusReport(computeStatusReport(filterBySection(scoped, sectionFilter)));
  renderTypeReport(computeHearingTypeReport(filterByStatus(scoped, statusFilter)));

  document.getElementById("reportScopeSummary").textContent = scopeLabel();
  document.getElementById("exportWordBtn").disabled = !wordExportAvailable();
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

  document.getElementById("exportCsvBtn").addEventListener("click", handleExportCsv);
  document.getElementById("exportWordBtn").addEventListener("click", handleExportWord);
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
  const statuses = getDistinctStatuses(hearings);
  select.innerHTML = `<option value="All">All</option>${statuses.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}`;
  select.value = statuses.includes(current) || current === "All" ? current : "All";
  statusFilter = select.value;
}

// --- Init ---------------------------------------------------------------

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;

  wireNavAuth(user);
  populateSectionOptions();
  wireFilters();

  const today = todayDateStr();
  document.getElementById("reportRangeStart").value = today;
  document.getElementById("reportRangeEnd").value = today;
  customStart = today;
  customEnd = today;

  subscribeToHearings((data) => {
    hearings = data;
    refreshStatusOptions();
    render();
  });
  subscribeToCases((data) => {
    cases = data;
    render();
  });
}

init();
