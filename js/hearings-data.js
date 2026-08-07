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
//                  createdBy, updatedBy, caseId (optional, IM-6 — see below)
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
//
// IM-6 (Structural Linkage only, DECISIONS_v1.1.md Decision 002/015 —
// approved narrowly as reference-establishment, not behavior): a
// hearingCases row may optionally carry `caseId`, pointing at a
// document in the NEW `cases` collection (the v1.1 Case aggregate
// root — see cases-data.js). caseId is absent on every row that
// existed before this milestone, and stays absent until something
// explicitly sets it (setHearingCaseLink() below) — nothing here
// backfills it, migrates it, or treats its absence as an error. This
// is deliberately a bare reference and nothing more:
//   - It does NOT read, derive, or write a Case's currentStatus/
//     currentStatusDate. Decision 016 (does a hearing's status mean
//     "at the time of" or "resulting from" that hearing?) is still
//     Deferred, and nothing here assumes an answer either way.
//   - It does NOT validate or enforce any status-transition rule.
//     Decisions 006/017/018 remain entirely untouched by this file.
//   - It does NOT infer anything from `status`, `hearingType`, or
//     `section` — those fields are not read anywhere in the functions
//     below.
// Referential integrity is checked by confirming the target Case
// exists (via cases-data.js's caseExists()) before writing a
// reference — not by reading the `cases` collection directly here,
// which would break the one-file-per-collection convention.
//
// IM-6B (Status Derivation, DECISIONS_v1.1.md Decisions 008/016 —
// both now Accepted): getCaseStatusHistory() below derives a Case's
// status history by reading its linked Hearings — Decision 008's
// Option (b), adopted instead of a separate dedicated log. It is
// read-only: it does not write to `cases` or to `hearings`/
// `hearingCases` itself. Writing a derived currentStatus back onto a
// Case is cases-data.js's applyDerivedCurrentStatus(), orchestrated by
// the new js/case-status-derivation.js — not by this file directly,
// preserving the one-file-per-collection convention in the same
// direction IM-6 already established (this file calls INTO
// cases-data.js's exports; it never constructs a `cases` document
// reference itself).
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "./firebase-init.js?v=1.0.0";
import { caseExists } from "./cases-data.js?v=1.0.0";

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
 * IM-8 note: `caseRows[].caseId` (this function's own, pre-v1.1 meaning —
 * "this row's own hearingCases document id, so we know whether to update
 * or create it") is renamed to `hearingCaseRowId` here, to stop colliding
 * with the unrelated, real `caseId` field IM-6 added directly to
 * hearingCases documents (the row's link to a v1.1 Case). This function
 * still never touches that link field — linking is still exclusively
 * hearings-data.js's setHearingCaseLink()'s job (IM-6), called separately
 * by the caller after this resolves. This function now also returns each
 * row's resulting id (parallel to the input `caseRows` array) so the
 * caller can do that linking — previously there was no way for a caller
 * to learn a newly-created row's id at all.
 *
 * @param {string|null} hearingId - null to create a new hearing
 * @param {object} hearingData - fields for the hearings collection
 * @param {Array} caseRows - each row: { hearingCaseRowId: string|null, caseType, caseNo, charge, dateFiled }
 * @param {Array} existingRowIds - hearingCases doc IDs currently attached to this hearing (for edit; rows not present here get deleted)
 * @returns {Promise<{hearingId: string, rowIds: string[]}>} rowIds is parallel to the input caseRows array
 */
export async function saveHearing(hearingId, hearingData, caseRows, existingRowIds = []) {
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

  const keptRowIds = new Set();
  const rowIds = caseRows.map((row) => {
    const caseWrite = {
      hearingId: finalHearingId,
      caseType: row.caseType,
      caseNo: row.caseNo,
      charge: row.charge,
      dateFiled: row.dateFiled || "",
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    };

    if (row.hearingCaseRowId) {
      keptRowIds.add(row.hearingCaseRowId);
      batch.set(doc(db, "hearingCases", row.hearingCaseRowId), caseWrite, { merge: true });
      return row.hearingCaseRowId;
    } else {
      const newCaseRef = doc(hearingCasesCol);
      batch.set(newCaseRef, {
        ...caseWrite,
        createdAt: serverTimestamp(),
        createdBy: userEmail,
      });
      return newCaseRef.id;
    }
  });

  // Any case that existed on this hearing before, but isn't in caseRows
  // anymore, was removed by the Clerk in the form — this is a routine
  // edit correction, so it's a real delete (unlike deleting a whole
  // hearing, which is a soft delete below).
  existingRowIds.forEach((rowId) => {
    if (!keptRowIds.has(rowId)) {
      batch.delete(doc(db, "hearingCases", rowId));
    }
  });

  await batch.commit();
  return { hearingId: finalHearingId, rowIds };
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

// --- IM-6: Structural Linkage (Hearing↔Case reference only) ---------------
//
// The three functions below are the entirety of IM-6's scope, as approved:
// establish/clear a reference from a hearingCases row to a Case, and look
// up existing references. None of them read or write currentStatus, none
// of them validate a workflow transition, and none of them read status/
// hearingType/section. See the header comment above for the full
// boundary — repeated in each function's own doc comment so it stays
// visible without having to scroll back up.

/**
 * Sets which Case (the v1.1 aggregate root — cases-data.js) a
 * hearingCases row belongs to. This is the ONLY effect of this
 * function — no status is read, derived, or written anywhere as a
 * result of calling it.
 *
 * Referential integrity: confirms the target Case actually exists
 * (via cases-data.js's caseExists()) before writing the reference.
 * Throws rather than silently writing a dangling reference if it
 * doesn't.
 *
 * caseId is optional at the schema level — most existing hearingCases
 * rows won't have one until (at the earliest) the eventual IM-7
 * migration runs, and nothing anywhere treats that absence as an
 * error.
 *
 * @param {string} hearingCaseId - the hearingCases document id to update
 * @param {string} caseId - the Case document id to link it to
 * @throws if no Case exists with the given caseId
 */
export async function setHearingCaseLink(hearingCaseId, caseId) {
  const exists = await caseExists(caseId);
  if (!exists) {
    throw new Error(`No Case found with id "${caseId}" — referential integrity check failed, link not set.`);
  }
  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "hearingCases", hearingCaseId),
    {
      caseId,
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    },
    { merge: true }
  );
  await batch.commit();
}

/**
 * Clears a previously-set link (sets caseId back to null), restoring
 * the row to its pre-linkage state. Symmetric counterpart to
 * setHearingCaseLink() — same non-scope: no status derivation, no
 * validation. No existence check needed here (clearing a reference
 * can't create a dangling one).
 */
export async function clearHearingCaseLink(hearingCaseId) {
  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "hearingCases", hearingCaseId),
    {
      caseId: null,
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    },
    { merge: true }
  );
  await batch.commit();
}

/**
 * One-shot lookup: every hearingCases row currently linked to a given
 * Case id. A plain query, not a live subscription (subscribeToX) —
 * nothing in this milestone's scope needs a real-time view of this; a
 * future milestone that builds actual UI around this reference can add
 * a live version then, if it turns out to need one. Read-only, no side
 * effects, does not touch currentStatus or any status field.
 */
export async function getHearingCaseRowsForCase(caseId) {
  const q = query(hearingCasesCol, where("caseId", "==", caseId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- IM-6B: Status Derivation (Decisions 008/016) -------------------------

/**
 * Derives a Case's status history by reading its linked Hearings —
 * Decision 008's Option (b): no separate history log is maintained
 * anywhere; this function IS the history, computed fresh each time from
 * the Hearing records that already exist as the durable, immutable
 * source of truth (Decision 003).
 *
 * For each Hearing linked to this Case (via getHearingCaseRowsForCase()
 * above), reads that Hearing's own `status` field — per Decision 009's
 * addendum, the recommended (not definitively confirmed) source field —
 * and its `hearingDateTime`. Per Decision 016 (resolved via Clerk
 * interview), a Hearing's `status` represents the procedure actually
 * being conducted at that hearing, so sorting these chronologically and
 * reading them in order is a meaningful history, not an arbitrary one.
 *
 * Included: archived Hearings (isArchived true or false) — archiving is
 * a view-layer state (v0.9.3), not data removal, and a completed,
 * archived hearing is real history that happened.
 * Excluded: soft-deleted Hearings (isDeleted true) — a soft-deleted
 * hearing represents "this shouldn't have existed," not a real
 * procedural event, so it's left out of the derived history entirely.
 *
 * Known limitation, not resolved here: if two linked Hearings share the
 * exact same `hearingDateTime` (this has been observed in real
 * production data — see the IM-5 dry-run evidence for case 7009), which
 * one is treated as "later" depends on their order in the underlying
 * query result, which Firestore does not guarantee to be stable across
 * calls. No business rule exists to break such a tie, so none is
 * invented here — this is named as a limitation, not silently patched
 * over with an assumed rule.
 *
 * @param {string} caseId
 * @returns {Promise<Array<{hearingId: string, hearingDateTime: Timestamp|null, status: string}>>}
 *   sorted ascending by hearingDateTime (entries with no usable date sort last).
 *   Empty array if the Case has no linked, non-deleted Hearings.
 */
export async function getCaseStatusHistory(caseId) {
  const rows = await getHearingCaseRowsForCase(caseId);

  const uniqueHearingIds = [...new Set(rows.map((r) => r.hearingId).filter(Boolean))];

  const hearingDocs = await Promise.all(
    uniqueHearingIds.map((hearingId) => getDoc(doc(db, "hearings", hearingId)))
  );

  const history = hearingDocs
    .filter((snap) => snap.exists())
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .filter((h) => h.isDeleted !== true)
    .map((h) => ({
      hearingId: h.id,
      hearingDateTime: h.hearingDateTime || null,
      status: h.status || "",
    }));

  history.sort((a, b) => {
    if (!a.hearingDateTime && !b.hearingDateTime) return 0;
    if (!a.hearingDateTime) return 1;
    if (!b.hearingDateTime) return -1;
    return a.hearingDateTime.toMillis() - b.hearingDateTime.toMillis();
  });

  return history;
}

// --- IM-7A: Pilot Migration support (read-only bulk fetches) --------------
//
// The two functions below exist solely so js/migration-execute.js can
// build the same { collections: { hearings, hearingCases } } shape that
// migration-dryrun.js's buildAnalysis() already expects, from LIVE
// Firestore reads instead of a backup file. Both are one-shot reads
// (not subscribeToX live listeners) — a migration run reads a snapshot
// of the data once, deliberately, rather than reacting to further
// changes mid-run. Neither filters anything out (no active/archived/
// deleted distinction here) — that filtering is buildAnalysis()'s job
// (via its existing, unchanged logic) and getCaseStatusHistory()'s job
// (above) for the actual status derivation. Both are read-only; neither
// writes anything.

/**
 * Every hearingCases document, unfiltered. Used by migration-execute.js
 * both to build buildAnalysis()'s input and to check each row's own
 * `caseId` field directly for the idempotency guard (has this row
 * already been migrated?).
 */
export async function getAllHearingCaseRows() {
  const snapshot = await getDocs(hearingCasesCol);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Every hearing document, unfiltered. Used by migration-execute.js to
 * build buildAnalysis()'s input.
 */
export async function getAllHearings() {
  const snapshot = await getDocs(hearingsCol);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}
