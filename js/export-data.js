// ---------------------------------------------------------------------------
// Export data-preparation layer.
//
// Pure functions only: no Firestore, no docx, no DOM. Everything here
// takes already-loaded `hearings`/`cases` arrays (the same live data
// hearings.js already holds in memory) and returns a plain, renderer-
// agnostic dataset shape. This is the layer a future PDF exporter would
// import too — it has no idea "docx" exists, so nothing about the output
// format leaks in here.
//
// Shape produced by prepareExportDataset():
//   [
//     { section: "TRIAL", items: [ { hearing, cases }, { hearing, cases }, ... ] },
//     { section: "MOTIONS", items: [ ... ] },
//     ...
//   ]
// — sections in canonical order, only sections with at least one matching
// hearing included, hearings within a section sorted chronologically.
// ---------------------------------------------------------------------------

import { SECTIONS } from "./hearings.js";

function atMidnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfWeek(date) {
  const d = atMidnight(date);
  return addDays(d, -d.getDay()); // Sunday = 0
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDateOnly(hearingDateStr) {
  return hearingDateStr ? new Date(hearingDateStr + "T00:00:00") : null;
}

/** Hearings scheduled on exactly one calendar date (YYYY-MM-DD). */
export function getHearingsForDate(hearings, dateStr) {
  return hearings.filter((h) => h.hearingDate === dateStr);
}

/** Hearings falling within the Sun–Sat week containing anchorDate. */
export function getHearingsForWeek(hearings, anchorDate = new Date()) {
  const start = startOfWeek(atMidnight(anchorDate));
  const end = addDays(start, 7);
  return hearings.filter((h) => {
    const d = toDateOnly(h.hearingDate);
    return d && d >= start && d < end;
  });
}

/** Hearings falling within the calendar month containing anchorDate. */
export function getHearingsForMonth(hearings, anchorDate = new Date()) {
  const start = startOfMonth(atMidnight(anchorDate));
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return hearings.filter((h) => {
    const d = toDateOnly(h.hearingDate);
    return d && d >= start && d < end;
  });
}

/**
 * Pairs each hearing with its own case list, filtered from the full
 * already-loaded cases array — same hearingId-matching logic already
 * trusted elsewhere in the app (hearings.js's casesForHearing).
 */
function attachCases(hearingsArray, allCases) {
  return hearingsArray.map((hearing) => ({
    hearing,
    cases: allCases.filter((c) => c.hearingId === hearing.id),
  }));
}

/**
 * Groups {hearing, cases} pairs by section, in the app's canonical
 * section order, dropping empty sections, and sorting each section's
 * hearings chronologically (date, then time-of-day via hearingDateTime
 * if present).
 */
function groupBySection(hearingsWithCases) {
  const bySection = {};
  hearingsWithCases.forEach((item) => {
    const key = item.hearing.section || "OTHER";
    (bySection[key] = bySection[key] || []).push(item);
  });

  Object.values(bySection).forEach((items) => {
    items.sort((a, b) => {
      const aKey = a.hearing.hearingDate || "";
      const bKey = b.hearing.hearingDate || "";
      if (aKey !== bKey) return aKey.localeCompare(bKey);
      return (a.hearing.hearingTime || "").localeCompare(b.hearing.hearingTime || "");
    });
  });

  const orderedSectionNames = [...SECTIONS, "OTHER"];
  return orderedSectionNames
    .filter((name) => bySection[name] && bySection[name].length)
    .map((name) => ({ section: name, items: bySection[name] }));
}

/**
 * The single entry point every export mode uses: takes a list of hearings
 * (already filtered for the desired date/week/month/single-hearing scope)
 * plus the full cases array, and returns the section-grouped dataset
 * shape described at the top of this file.
 */
export function prepareExportDataset(hearingsArray, allCases) {
  return groupBySection(attachCases(hearingsArray, allCases));
}
