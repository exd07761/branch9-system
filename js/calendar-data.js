// ---------------------------------------------------------------------------
// Firestore data access layer for Calendar views.
//
// This is the ONLY file that reads Firestore for calendar.html. It is
// STRICTLY READ-ONLY — no create/update/delete logic lives here or
// anywhere else in the Calendar feature. All writes still go exclusively
// through hearings-data.js, reached only by navigating to hearings.html.
//
// Query strategy: every view queries a date RANGE on hearingDateTime
// (the derived Timestamp field added in Milestone 3) rather than loading
// the whole "hearings" collection — see subscribeToHearingsInRange().
// Month/Week views never touch "hearingCases" at all (they use the
// existing caseCount field for counts). Day View loads hearingCases for
// a specific hearing only on demand, via fetchCasesForHearing() — see
// calendar.js for when that's called.
// ---------------------------------------------------------------------------

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { isActiveHearing } from "./hearings-data.js";

const hearingsCol = collection(db, "hearings");
const hearingCasesCol = collection(db, "hearingCases");

/**
 * Subscribe to hearings whose hearingDateTime falls within
 * [rangeStart, rangeEnd). Used by all three views (Month/Week/Day) — only
 * the range passed in differs. Filtered client-side via the same
 * isActiveHearing() helper hearings-data.js's subscribeToHearings() uses
 * (soft-deleted AND, as of v0.9.3, archived hearings are excluded — not a
 * second copy of that check), so no composite index is required (a
 * single range + orderBy on the same field only needs Firestore's
 * automatic single-field index).
 *
 * Returns an unsubscribe function.
 */
export function subscribeToHearingsInRange(rangeStart, rangeEnd, onChange) {
  const q = query(
    hearingsCol,
    where("hearingDateTime", ">=", Timestamp.fromDate(rangeStart)),
    where("hearingDateTime", "<", Timestamp.fromDate(rangeEnd)),
    orderBy("hearingDateTime", "asc")
  );
  return onSnapshot(q, (snapshot) => {
    const hearings = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(isActiveHearing);
    onChange(hearings);
  });
}

/**
 * One-time fetch of the case documents attached to a single hearing.
 * Called only when the Clerk expands that specific hearing in Day View —
 * never preloaded for a whole day's hearings up front. Not a live
 * listener: Day View doesn't need real-time updates on case details for
 * an on-demand expand, and a plain fetch keeps this cheap and simple.
 */
export async function fetchCasesForHearing(hearingId) {
  const q = query(hearingCasesCol, where("hearingId", "==", hearingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}
