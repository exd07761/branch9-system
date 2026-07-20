// ---------------------------------------------------------------------------
// Dashboard statistics — pure computation only.
//
// No Firestore, no DOM. Takes an already-loaded hearings array (the same
// live data subscribeToHearings() already provides, which already filters
// out soft-deleted hearings) and returns the four Home dashboard numbers.
// Kept separate from home.js so the math is independently reusable and
// testable, and so home.js itself stays a thin wiring layer.
//
// "Active Cases" = the sum of each hearing's own caseCount field (added
// back in Milestone 3 specifically so nothing has to re-count hearingCases
// documents to answer this). No new Firestore read is needed for this
// number at all.
// ---------------------------------------------------------------------------

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

function toDateOnly(hearingDateStr) {
  return hearingDateStr ? new Date(hearingDateStr + "T00:00:00") : null;
}

/**
 * @param {Array} hearings - already-loaded, already non-deleted-filtered
 *   hearing documents (exactly what subscribeToHearings() provides)
 * @param {Date} [referenceDate] - defaults to now; parameterized so this
 *   stays testable without mocking the system clock
 */
export function computeDashboardStats(hearings, referenceDate = new Date()) {
  const today = atMidnight(referenceDate);
  const in7 = addDays(today, 7);
  const in30 = addDays(today, 30);

  let activeCases = 0;
  let hearingsToday = 0;
  let hearingsNext7 = 0;
  let hearingsNext30 = 0;

  (hearings || []).forEach((h) => {
    activeCases += typeof h.caseCount === "number" ? h.caseCount : 0;

    const d = toDateOnly(h.hearingDate);
    if (!d) return;
    if (d.getTime() === today.getTime()) hearingsToday++;
    if (d >= today && d <= in7) hearingsNext7++;
    if (d >= today && d <= in30) hearingsNext30++;
  });

  return { activeCases, hearingsToday, hearingsNext7, hearingsNext30 };
}
