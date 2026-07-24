// ---------------------------------------------------------------------------
// Firestore data access layer for Hearings and Cases.
//
// This is the ONLY file that reads or writes the "hearings" and
// "hearingCases" collections. hearings.js (the page controller) never talks
// to Firestore directly — it calls the functions below.
//
// Schema notes (kept simple, no normalization):
//   hearings:      ...existing fields..., isDeleted, deletedAt, deletedBy,
//                  isArchived, archivedAt, archivedBy, archiveReason,
//                  caseCount, hearingDateTime, createdAt, updatedAt,
//                  createdBy, updatedBy
//   hearingCases:  ...existing fields..., createdAt, updatedAt,
//                  createdBy, updatedBy
//
// hearingDateTime is a DERIVED Firestore Timestamp computed from
// hearingDate + hearingTime on every save (see computeHearingDateTime()
// below). It exists to simplify future Calendar/Dashboard/Search/sorting
// work — nothing in the UI edits it directly, and hearingDate/hearingTime
// remain the source of truth.
//
// "Delete" on a hearing is a SOFT delete: isDeleted/deletedAt/deletedBy are
// set, but the document (and its case documents) are never removed, so
// they remain recoverable. The list query filters deleted hearings out
// client-side — no restore UI exists yet (not in this milestone's scope).
//
// v0.9.3 (Archive & Case Lifecycle Management): "Archive" is a SEPARATE
// soft state from "Delete" — isArchived/archivedAt/archivedBy/
// archiveReason. It is NOT deletion: an archived hearing keeps its
// document (and its cases) completely untouched beyond these four
// fields, and is fully restorable. Archive exists so records that are
// done with active operations can leave the day-to-day views
// (Dashboard, Calendar, Search, Active Hearings, Reports by default)
// without ever disappearing from Firestore. isActiveHearing() below is
// the ONE place "should this hearing show up in active views" is
// decided — every query in this app that needs an active-only list
// calls it (or subscribeToHearings()'s default behavior, which already
// applies it) instead of re-checking isDeleted/isArchived itself.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "./firebase-init.js?v=0.9.6";

const hearingsCol = collection(db, "hearings");
const hearingCasesCol = collection(db, "hearingCases");

function currentUserEmail() {
  return (auth.currentUser && auth.currentUser.email) || "unknown";
}

// Maps the fixed hearingTime option strings (defined in hearings.js) to an
// hour/minute for computing hearingDateTime below. Kept here rather than
// imported, since hearings-data.js doesn't otherwise depend on the UI
// layer's constants — if the option list in hearings.js ever changes,
// this map needs to be updated to match.
const TIME_OF_DAY = {
  "8:30 in the Morning": { hour: 8, minute: 30 },
  "11:30 in the Morning": { hour: 11, minute: 30 },
  "1:30 in the Afternoon": { hour: 13, minute: 30 },
  "2:00 in the Afternoon": { hour: 14, minute: 0 },
};

/**
 * Computes a Firestore Timestamp from the separate hearingDate ("YYYY-MM-DD")
 * and hearingTime (one of the fixed option strings, or "" if not set)
 * fields. This is a DERIVED field only — it exists purely so future
 * Calendar/Dashboard/Search/sorting features can query and sort on a
 * single timestamp instead of parsing two separate string fields. Nobody
 * edits hearingDateTime directly; it's recomputed here on every save.
 *
 * If hearingTime isn't set, defaults to midnight (00:00) on that date —
 * hearingDate is a required field, so this only affects the time-of-day
 * portion, never whether a value exists at all.
 */
function computeHearingDateTime(hearingDate, hearingTime) {
  if (!hearingDate) return null;
  const { hour, minute } = TIME_OF_DAY[hearingTime] || { hour: 0, minute: 0 };
  const [year, month, day] = hearingDate.split("-").map(Number);
  const jsDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Timestamp.fromDate(jsDate);
}

/**
 * The single, centralized definition of "is this hearing in active
 * operations" — not soft-deleted, and not archived. Every page/feature
 * that needs an active-only list (Home Dashboard, Today's Timeline,
 * Calendar, Search, Active Hearings, Dashboard statistics, Upcoming
 * Hearings, Quick Actions, Reports by default) reuses this one function
 * (directly, or via subscribeToHearings()'s default below) instead of
 * re-checking isDeleted/isArchived itself.
 */
export function isActiveHearing(h) {
  return h.isDeleted !== true && h.isArchived !== true;
}

/**
 * Subscribe to live updates of hearings, ordered by hearing date.
 * Soft-deleted hearings are always filtered out. By default, archived
 * hearings are filtered out too (the normal "active operations" view
 * every page except Archived Hearings/Reports-with-checkbox wants) —
 * pass { includeArchived: true } to also receive archived (but still
 * non-deleted) hearings, e.g. for Reports' "Include Archived" option.
 * Returns an unsubscribe function.
 */
export function subscribeToHearings(onChange, { includeArchived = false } = {}) {
  const q = query(hearingsCol, orderBy("hearingDate", "asc"));
  return onSnapshot(q, (snapshot) => {
    const hearings = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((h) => (includeArchived ? h.isDeleted !== true : isActiveHearing(h)));
    onChange(hearings);
  });
}

/**
 * Subscribe to live updates of archived (and non-deleted) hearings only —
 * powers the Archived Hearings page. Same collection, same query shape as
 * subscribeToHearings() above, just the opposite filter; not a new
 * listener type.
 */
export function subscribeToArchivedHearings(onChange) {
  const q = query(hearingsCol, orderBy("hearingDate", "asc"));
  return onSnapshot(q, (snapshot) => {
    const hearings = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((h) => h.isDeleted !== true && h.isArchived === true);
    onChange(hearings);
  });
}

/**
 * Subscribe to live updates of all cases across all hearings.
 * Returns an unsubscribe function.
 */
export function subscribeToCases(onChange) {
  return onSnapshot(hearingCasesCol, (snapshot) => {
    const cases = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(cases);
  });
}

/**
 * Check whether a case number + case type combination already exists on
 * an ACTIVE hearing (i.e. one that is not soft-deleted), anywhere except
 * (optionally) the given hearing being edited.
 *
 * @param {Array} allCases - live hearingCases documents
 * @param {string} caseType
 * @param {string} caseNo
 * @param {string|null} excludeHearingId - the hearing currently being edited, if any
 * @param {Set<string>} [activeHearingIds] - IDs of currently non-deleted hearings.
 *   Cases whose hearingId isn't in this set belong to a soft-deleted
 *   hearing and are ignored — a deleted hearing's case numbers are no
 *   longer considered "in use". If omitted, behaves as before (no
 *   deleted-hearing filtering).
 */
export function isDuplicateCaseNumber(allCases, caseType, caseNo, excludeHearingId, activeHearingIds) {
  const normalizedNo = (caseNo || "").trim().toLowerCase();
  return allCases.some((c) => {
    if (excludeHearingId && c.hearingId === excludeHearingId) return false;
    if (activeHearingIds && !activeHearingIds.has(c.hearingId)) return false;
    return (
      (c.caseType || "") === caseType &&
      (c.caseNo || "").trim().toLowerCase() === normalizedNo
    );
  });
}

/**
 * Create or update a hearing along with its case rows, as one atomic batch.
 *
 * @param {string|null} hearingId - null to create a new hearing
 * @param {object} hearingData - fields for the hearings collection
 * @param {Array} caseRows - each row: { caseId: string|null, caseType, caseNo, charge, dateFiled }
 * @param {Array} existingCaseIds - case doc IDs currently attached to this hearing (for edit; rows not present here get deleted)
 */
export async function saveHearing(hearingId, hearingData, caseRows, existingCaseIds = []) {
  const batch = writeBatch(db);
  const isNew = !hearingId;
  const userEmail = currentUserEmail();

  const hearingRef = isNew ? doc(hearingsCol) : doc(db, "hearings", hearingId);
  const finalHearingId = hearingRef.id;

  const hearingWrite = {
    ...hearingData,
    hearingDateTime: computeHearingDateTime(hearingData.hearingDate, hearingData.hearingTime),
    caseCount: caseRows.length,
    updatedAt: serverTimestamp(),
    updatedBy: userEmail,
  };

  if (isNew) {
    batch.set(hearingRef, {
      ...hearingWrite,
      isDeleted: false,
      createdAt: serverTimestamp(),
      createdBy: userEmail,
    });
  } else {
    batch.set(hearingRef, hearingWrite, { merge: true });
  }

  const keptCaseIds = new Set();

  caseRows.forEach((row) => {
    const caseWrite = {
      hearingId: finalHearingId,
      caseType: row.caseType,
      caseNo: row.caseNo,
      charge: row.charge,
      dateFiled: row.dateFiled || "",
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    };

    if (row.caseId) {
      keptCaseIds.add(row.caseId);
      batch.set(doc(db, "hearingCases", row.caseId), caseWrite, { merge: true });
    } else {
      const newCaseRef = doc(hearingCasesCol);
      batch.set(newCaseRef, {
        ...caseWrite,
        createdAt: serverTimestamp(),
        createdBy: userEmail,
      });
    }
  });

  // Any case that existed on this hearing before, but isn't in caseRows
  // anymore, was removed by the Clerk in the form — this is a routine
  // edit correction, so it's a real delete (unlike deleting a whole
  // hearing, which is a soft delete below).
  existingCaseIds.forEach((caseId) => {
    if (!keptCaseIds.has(caseId)) {
      batch.delete(doc(db, "hearingCases", caseId));
    }
  });

  await batch.commit();
  return finalHearingId;
}

/**
 * Soft-delete a hearing: marks it isDeleted/deletedAt/deletedBy rather
 * than removing the document. Attached case documents are left untouched
 * so the whole hearing (and its cases) stays recoverable.
 */
export async function deleteHearing(hearingId) {
  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "hearings", hearingId),
    {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: userEmail,
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    },
    { merge: true }
  );
  await batch.commit();
}

/**
 * Archive a hearing: a soft state change only, completely separate from
 * deleteHearing() above — sets isArchived/archivedAt/archivedBy/
 * archiveReason, never isDeleted. The document (and its cases) are
 * otherwise untouched, so it stays fully visible/restorable from the
 * Archived Hearings page.
 *
 * @param {string} hearingId
 * @param {string} [reason] - optional free-text reason, stored as-is
 */
export async function archiveHearing(hearingId, reason = "") {
  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "hearings", hearingId),
    {
      isArchived: true,
      archivedAt: serverTimestamp(),
      archivedBy: userEmail,
      archiveReason: reason || "",
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    },
    { merge: true }
  );
  await batch.commit();
}

/**
 * Restore a previously-archived hearing: simply resets isArchived to
 * false. archivedAt/archivedBy/archiveReason are left in place as
 * historical record of the last archive action rather than cleared —
 * they're only ever read while isArchived is true.
 */
export async function restoreHearing(hearingId) {
  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "hearings", hearingId),
    {
      isArchived: false,
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    },
    { merge: true }
  );
  await batch.commit();
}
