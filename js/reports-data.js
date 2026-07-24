// ---------------------------------------------------------------------------
// Reports & Statistics — pure computation only.
//
// No Firestore, no DOM. Takes the already-loaded hearings/cases arrays
// (the exact same live data subscribeToHearings()/subscribeToCases()
// already provide elsewhere — reports.js reuses those listeners, it does
// not open new ones) and returns plain data for reports.js to render.
//
// Reuses rather than re-implements what already exists:
//   - Today / This Week / This Month scoping: getHearingsForDate/Week/
//     Month from export-data.js — the exact same functions every Word
//     export mode already uses for date-range filtering.
//   - Active Cases: computeDashboardStats() from dashboard-stats.js —
//     same caseCount-sum logic the Home dashboard card already uses.
//   - The 30-minute assumed hearing duration: DEFAULT_HEARING_DURATION_
//     MINUTES from dashboard-live.js, so "Completed" here uses the same
//     assumption the Home dashboard's Timeline already uses, instead of
//     a second hardcoded number.
//   - Section categories: SECTIONS from constants.js.
//
// Schema notes (carried over from dashboard-live.js, which documented
// this first): hearing.status is a stage/purpose label (e.g. "Pre-Trial
// Conference"), not a lifecycle state — Firestore has no Pending/
// Completed/Postponed/Cancelled field. Two deliberate decisions follow:
//   1. The Hearing Status Report groups by the actual status VALUES
//      present in the data, rather than inventing a Pending/Completed/
//      Postponed/Cancelled vocabulary the schema doesn't have.
//   2. "Pending"/"Completed" on the summary cards are derived from
//      hearingDateTime, the same way the Home dashboard's Timeline
//      already derives "completed" for today's hearings (isCompleted()
//      below) — just applied across all hearings, not only today's.
//
// hearing.hearingType is free text (e.g. "Cross Examination of
// Prosecution's Witness AAA") — grouping by it verbatim would produce a
// long tail of one-off buckets, not a report. hearing.section, however,
// is exactly the small fixed set this milestone's Hearing Type Report
// examples describe (Arraignment, Trial, Promulgation, Pre-Trial...).
// The Hearing Type Report below groups by section for that reason — see
// the Architecture Note in README.md.
// ---------------------------------------------------------------------------

import { getHearingsForDate, getHearingsForWeek, getHearingsForMonth } from "./export-data.js?v=0.9.6";
import { computeDashboardStats } from "./dashboard-stats.js?v=0.9.6";
import { DEFAULT_HEARING_DURATION_MINUTES } from "./dashboard-live.js?v=0.9.6";
import { SECTIONS } from "./constants.js?v=0.9.6";

export { getHearingsForDate, getHearingsForWeek, getHearingsForMonth };

function atMidnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateOnly(hearingDateStr) {
  return hearingDateStr ? new Date(hearingDateStr + "T00:00:00") : null;
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function hearingStart(hearing) {
  if (hearing.hearingDateTime && typeof hearing.hearingDateTime.toDate === "function") {
    return hearing.hearingDateTime.toDate();
  }
  return null;
}

function sortByHearingDateTime(hearingsArray) {
  return [...hearingsArray].sort((a, b) => {
    const aTime = hearingStart(a) ? hearingStart(a).getTime() : 0;
    const bTime = hearingStart(b) ? hearingStart(b).getTime() : 0;
    return aTime - bTime;
  });
}

// --- Date-range filtering (Today/Week/Month reuse export-data.js above;
// Year and Custom Range are report-specific, added here) -----------------

/** Hearings falling within the calendar year containing anchorDate. */
export function getHearingsForYear(hearings, anchorDate = new Date()) {
  const start = startOfYear(atMidnight(anchorDate));
  const end = new Date(start.getFullYear() + 1, 0, 1);
  return hearings.filter((h) => {
    const d = toDateOnly(h.hearingDate);
    return d && d >= start && d < end;
  });
}

/** Hearings whose hearingDate falls within [startStr, endStr], inclusive. */
export function getHearingsForDateRange(hearings, startStr, endStr) {
  if (!startStr || !endStr) return [];
  const start = toDateOnly(startStr);
  const end = toDateOnly(endStr);
  return hearings.filter((h) => {
    const d = toDateOnly(h.hearingDate);
    return d && d >= start && d <= end;
  });
}

// --- Status / Section filtering ------------------------------------------

export function filterByStatus(hearings, status) {
  if (!status || status === "All") return hearings;
  return hearings.filter((h) => (h.status || "") === status);
}

export function filterBySection(hearings, section) {
  if (!section || section === "All") return hearings;
  return hearings.filter((h) => (h.section || "") === section);
}

/** Distinct status values actually present in the data, for the Status
 * filter dropdown — not a hardcoded list, so it never drifts from what's
 * really in Firestore. */
export function getDistinctStatuses(hearings) {
  const set = new Set();
  hearings.forEach((h) => {
    if (h.status) set.add(h.status);
  });
  return [...set].sort();
}

// --- Grouping --------------------------------------------------------------

/** Groups hearings by hearingDate, each group's hearings sorted by time,
 * groups sorted chronologically. Used by the Weekly and Monthly reports. */
export function groupByDay(hearings) {
  const byDate = {};
  hearings.forEach((h) => {
    const key = h.hearingDate || "";
    (byDate[key] = byDate[key] || []).push(h);
  });
  return Object.keys(byDate)
    .sort()
    .map((date) => ({ date, hearings: sortByHearingDateTime(byDate[date]) }));
}

// --- Reports -----------------------------------------------------------

/** Hearing Status Report: counts per actual status value present in the
 * data (see the schema note at the top of this file), most-common first. */
export function computeStatusReport(hearings) {
  const counts = {};
  hearings.forEach((h) => {
    const key = h.status || "(not set)";
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

/** Hearing Type Report: counts per section, in the app's canonical
 * section order (see the schema note at the top of this file for why
 * this groups by section rather than the free-text hearingType field). */
export function computeHearingTypeReport(hearings) {
  const counts = {};
  hearings.forEach((h) => {
    const key = h.section || "(not set)";
    counts[key] = (counts[key] || 0) + 1;
  });
  const orderedNames = [...SECTIONS, "(not set)"];
  return orderedNames
    .filter((name) => counts[name])
    .map((section) => ({ section, count: counts[section] }));
}

// --- Summary statistics ------------------------------------------------

/** Same derivation dashboard-live.js's Timeline already uses for
 * "completed" — a hearing is completed once its assumed
 * [start, start + duration) window has passed. Generalized here to any
 * hearing, not just today's. */
function isHearingCompleted(hearing, referenceDate, durationMinutes) {
  const start = hearingStart(hearing);
  if (!start) return false;
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return end.getTime() <= referenceDate.getTime();
}

/**
 * The six Reports summary cards. Always computed over the full
 * already-loaded hearings array (not the on-page filters) — same "global
 * overview" behavior as the Home dashboard's stat cards.
 */
export function computeSummaryStats(hearings, referenceDate = new Date()) {
  const { activeCases } = computeDashboardStats(hearings, referenceDate);
  const hearingsThisMonth = getHearingsForMonth(hearings, referenceDate).length;
  const hearingsThisYear = getHearingsForYear(hearings, referenceDate).length;

  let completedHearings = 0;
  hearings.forEach((h) => {
    if (isHearingCompleted(h, referenceDate, DEFAULT_HEARING_DURATION_MINUTES)) completedHearings++;
  });

  return {
    totalHearings: hearings.length,
    activeCases,
    hearingsThisMonth,
    hearingsThisYear,
    pendingHearings: hearings.length - completedHearings,
    completedHearings,
  };
}

// --- CSV -----------------------------------------------------------------

function csvEscape(value) {
  const s = (value === null || value === undefined ? "" : String(value));
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Pure CSV string builder — no DOM, no download. reports.js handles
 * turning the returned string into a downloaded file, the same way
 * docx-export.js handles turning a docx Document into one. */
export function buildCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(","));
  return lines.join("\r\n");
}

/**
 * Row data for a CSV export of a hearings list: one row per hearing,
 * cases summarized into a single semicolon-joined cell (same "Case No(s)."
 * summarizing already used in hearings.js's list view / docx export,
 * not a new formatting convention).
 */
export function hearingsToCsvRows(hearingsArray, allCases) {
  return hearingsArray.map((h) => {
    const hearingCases = allCases.filter((c) => c.hearingId === h.id);
    const caseNos = hearingCases.map((c) => `${c.caseType || ""}. ${c.caseNo || ""}`).join("; ");
    return [
      h.hearingDate || "",
      h.hearingTime || "",
      h.section || "",
      h.status || "",
      h.hearingType || "",
      caseNos,
      h.plaintiff || "",
      (h.accused || []).join(", "),
    ];
  });
}

export const CSV_HEADERS = ["Date", "Time", "Section", "Status", "Hearing Type", "Case No(s).", "Plaintiff", "Accused"];
