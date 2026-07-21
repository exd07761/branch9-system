// ---------------------------------------------------------------------------
// Dashboard "live" computation — Current Session, Next Hearing, Today's
// Summary, and Timeline status classification.
//
// Pure functions only: no Firestore, no DOM, no setInterval. Everything
// here takes the already-loaded, already-today-filtered/sorted hearings
// array that getTodaysHearingsSorted() (dashboard-stats.js) already
// produces — reused, not duplicated — plus a referenceDate ("now"),
// parameterized so this stays testable without mocking the system clock.
// home.js is the only place that calls new Date() and re-renders on a
// timer; this file just answers "given this data and this moment in
// time, what's true right now".
//
// Schema note: the hearings/hearingCases collections have no notion of a
// hearing's "duration" or a completion flag — "status" on a hearing is
// actually its stage/purpose (e.g. "Pre-Trial Conference"), not a
// scheduling state. Rather than add a schema field, "current" / "next" /
// "completed" are derived entirely from hearingDateTime (already a
// derived field, added back in Milestone 3) plus an assumed hearing
// length, DEFAULT_HEARING_DURATION_MINUTES below. A hearing is treated
// as "current" for that many minutes after its scheduled start, then as
// "completed". This is a reasonable client-side approximation, not a
// literal end time the Clerk ever entered.
// ---------------------------------------------------------------------------

export const DEFAULT_HEARING_DURATION_MINUTES = 30;

function hearingStart(hearing) {
  if (hearing.hearingDateTime && typeof hearing.hearingDateTime.toDate === "function") {
    return hearing.hearingDateTime.toDate();
  }
  return null; // hearingTime not set — no reliable start time to compute against
}

function hearingEnd(hearing, durationMinutes) {
  const start = hearingStart(hearing);
  if (!start) return null;
  return new Date(start.getTime() + durationMinutes * 60000);
}

/**
 * The hearing whose assumed [start, start + duration) window contains
 * referenceDate, or null if none does (before the first hearing of the
 * day, in a gap between hearings, or after the last one's window ends).
 *
 * @param {Array} todaysHearingsSorted - from getTodaysHearingsSorted()
 * @param {Date} [referenceDate]
 * @param {number} [durationMinutes]
 */
export function getCurrentHearing(todaysHearingsSorted, referenceDate = new Date(), durationMinutes = DEFAULT_HEARING_DURATION_MINUTES) {
  const now = referenceDate.getTime();
  return (
    (todaysHearingsSorted || []).find((h) => {
      const start = hearingStart(h);
      const end = hearingEnd(h, durationMinutes);
      return start && end && now >= start.getTime() && now < end.getTime();
    }) || null
  );
}

/**
 * The earliest hearing today that hasn't started yet, regardless of
 * whether some other hearing is currently active. home.js only shows
 * this as the "Next Hearing" card when there's no active hearing, but
 * the Timeline highlights it either way.
 */
export function getNextUpcomingHearing(todaysHearingsSorted, referenceDate = new Date()) {
  const now = referenceDate.getTime();
  return (
    (todaysHearingsSorted || []).find((h) => {
      const start = hearingStart(h);
      return start && start.getTime() > now;
    }) || null
  );
}

/** Minutes from now until a hearing's scheduled start (never negative). */
export function minutesUntil(hearing, referenceDate = new Date()) {
  const start = hearingStart(hearing);
  if (!start) return null;
  return Math.max(0, Math.round((start.getTime() - referenceDate.getTime()) / 60000));
}

/**
 * Today's Summary — Scheduled / Completed / Remaining, computed entirely
 * from today's already-loaded hearings. A hearing with no hearingTime set
 * can't be judged "completed" (no start time to compare), so it only
 * ever counts toward Scheduled/Remaining, never Completed.
 */
export function getTodaysSummary(todaysHearingsSorted, referenceDate = new Date(), durationMinutes = DEFAULT_HEARING_DURATION_MINUTES) {
  const now = referenceDate.getTime();
  let completed = 0;
  (todaysHearingsSorted || []).forEach((h) => {
    const end = hearingEnd(h, durationMinutes);
    if (end && end.getTime() <= now) completed++;
  });
  const scheduled = (todaysHearingsSorted || []).length;
  return { scheduled, completed, remaining: scheduled - completed };
}

/**
 * Annotates each of today's hearings with a Timeline status for the
 * status badge / row highlight: "now" (the active hearing), "next" (the
 * very next one to start), "completed" (window already ended), or
 * "upcoming" (later today, but not the immediate next one).
 */
export function annotateTimelineStatuses(todaysHearingsSorted, referenceDate = new Date(), durationMinutes = DEFAULT_HEARING_DURATION_MINUTES) {
  const current = getCurrentHearing(todaysHearingsSorted, referenceDate, durationMinutes);
  const next = getNextUpcomingHearing(todaysHearingsSorted, referenceDate);

  return (todaysHearingsSorted || []).map((hearing) => {
    let status = "upcoming";
    if (current && hearing.id === current.id) {
      status = "now";
    } else if (next && hearing.id === next.id) {
      status = "next";
    } else {
      const end = hearingEnd(hearing, durationMinutes);
      if (end && end.getTime() <= referenceDate.getTime()) status = "completed";
    }
    return { hearing, status };
  });
}
