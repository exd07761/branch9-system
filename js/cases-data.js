// ---------------------------------------------------------------------------
// Firestore data access layer for the "cases" collection.
//
// This is the ONLY file that reads or writes the "cases" collection. Same
// split as hearings-data.js/activity-data.js/users-data.js: a future
// cases.js (page controller, not part of this milestone) will never talk to
// Firestore directly — it will call the functions below.
//
// IM-1 scope (Case Collection Foundation) — see DECISIONS_v1.1.md Decision
// 001 (Case as aggregate root) and Decision 007 (single currentStatus
// field). This milestone establishes ONLY the Case document itself:
// identity, audit fields, currentStatus, and soft-delete/archive
// compatibility. Deliberately NOT included (see Decision 008, 002, 005 —
// all still Deferred or scheduled for later milestones per
// IMPLEMENTATION_ROADMAP.md):
//   - No status history / transition log (Decision 008 is Deferred)
//   - No reference to, or write of, any Hearing document (Decision 002/015
//     is still Deferred — this file never reads or writes "hearings" or
//     "hearingCases")
//   - No migration or backfill from existing hearingCases documents
//   - No status-transition validation (never-backwards/never-skips) — that
//     belongs to IM-6, once Decisions 015-018 are resolved
//
// A naming note worth reading before touching this file: this project
// already uses the word "case" extensively for a different concept — a
// single case-number row attached to a Hearing (the "hearingCases"
// collection, accessed via hearings-data.js's subscribeToCases()/
// isDuplicateCaseNumber()). This file's "Case" is the NEW, separate
// concept from the v1.1 redesign: the aggregate root that owns a
// currentStatus (DECISIONS_v1.1.md Decision 001). The two are not (yet)
// linked to each other in any way — that linkage is Decision 002/015,
// scheduled for IM-6, not this milestone. To keep the two from being
// confused at the API level (not just in comments), this file's live
// listeners are named subscribeToCaseRecords()/
// subscribeToArchivedCaseRecords() rather than subscribeToCases() —
// deliberately different from hearings-data.js's existing
// subscribeToCases(), which is left exactly as it is.
//
// Schema (cases collection):
//   caseType, caseNo, charge, dateFiled  — identity fields, same names/
//     shape as the existing hearingCases row fields (see hearings-data.js)
//     so this stays recognizable rather than inventing new vocabulary
//   currentStatus, currentStatusDate     — Decision 007; currentStatusDate
//     only changes when currentStatus actually changes (see saveCase()
//     below) — it is NOT "last saved," it's "last status change"
//   isDeleted, deletedAt, deletedBy      — soft delete, identical pattern
//     to hearings-data.js
//   isArchived, archivedAt, archivedBy, archiveReason — archive, identical
//     pattern to hearings-data.js
//   createdAt, updatedAt, createdBy, updatedBy — audit fields
//
// Deliberately NOT on this schema yet: any "accused"/parties field.
// Today, "accused" is a field on the HEARING document, not on a
// hearingCases row (see hearings.js's required-field validation). Adding
// it to Case now would presuppose an answer to Decision 016 (still
// Deferred) about how Case and Hearing data actually relate — so it's
// left out rather than guessed at. See DECISIONS_v1.1.md / Principle 5
// ("never guess a missing business rule"). (Decision 015 — cardinality —
// was resolved via IM-5's real-data evidence review; this note is
// updated to no longer cite it as a reason for withholding this field,
// since it's Decision 016 alone that still blocks it.)
//
// IM-6 (Structural Linkage, DECISIONS_v1.1.md Decision 002/015): Cases
// can now be referenced FROM a hearingCases row via that row's `caseId`
// field — see hearings-data.js's setHearingCaseLink(). This file does
// not read or write that field itself (hearingCases belongs to
// hearings-data.js, not this file); it only exports caseExists() below
// so hearings-data.js can verify a Case exists before linking to it,
// without hearings-data.js reaching into the `cases` collection
// directly. Nothing in this file derives or modifies currentStatus as a
// result of any linkage — that remains blocked on Decision 016.
//
// IM-6B (Status Derivation, Decisions 008/016 — both now Accepted):
// applyDerivedCurrentStatus() below writes an already-derived
// currentStatus/currentStatusDate onto a Case. It never reads Hearing
// data itself — the actual derivation (reading a Case's linked Hearings
// and computing the latest status) lives in hearings-data.js's
// getCaseStatusHistory() and the new js/case-status-derivation.js,
// which orchestrates both files. This function's only job is the write,
// same separation every other *-data.js file in this project keeps.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "./firebase-init.js?v=1.0.0";

const casesCol = collection(db, "cases");

function currentUserEmail() {
  return (auth.currentUser && auth.currentUser.email) || "unknown";
}

/**
 * The single, centralized definition of "is this Case in active
 * operations" — not soft-deleted, and not archived. Mirrors
 * isActiveHearing() in hearings-data.js exactly. Any future feature that
 * needs an active-only list of Cases should reuse this (directly, or via
 * subscribeToCaseRecords()'s default below) instead of re-checking
 * isDeleted/isArchived itself.
 */
export function isActiveCase(c) {
  return c.isDeleted !== true && c.isArchived !== true;
}

/**
 * Subscribe to live updates of Cases. Soft-deleted Cases are always
 * filtered out. By default, archived Cases are filtered out too (the
 * normal "active operations" view) — pass { includeArchived: true } to
 * also receive archived (but still non-deleted) Cases, the same option
 * shape as subscribeToHearings() in hearings-data.js.
 *
 * Named subscribeToCaseRecords() rather than subscribeToCases() — see
 * this file's header comment — to stay clearly distinct from
 * hearings-data.js's existing subscribeToCases(), which is a different
 * concept (a hearingCases row) and is left untouched.
 *
 * Ordered by createdAt (insertion order) for now — there's no page
 * consuming this yet, so this is a deliberately neutral default rather
 * than a guess at what a future Cases list page will actually want to
 * sort by; revisit when that page (IM-2) has real requirements.
 *
 * Returns an unsubscribe function.
 */
export function subscribeToCaseRecords(onChange, { includeArchived = false } = {}) {
  const q = query(casesCol, orderBy("createdAt", "asc"));
  return onSnapshot(q, (snapshot) => {
    const cases = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => (includeArchived ? c.isDeleted !== true : isActiveCase(c)));
    onChange(cases);
  });
}

/**
 * Subscribe to live updates of archived (and non-deleted) Cases only —
 * same shape as subscribeToArchivedHearings() in hearings-data.js, for
 * whichever future page needs it (not built in this milestone). Named
 * subscribeToArchivedCaseRecords() to match subscribeToCaseRecords()
 * above, for the same disambiguation reason.
 */
export function subscribeToArchivedCaseRecords(onChange) {
  const q = query(casesCol, orderBy("createdAt", "asc"));
  return onSnapshot(q, (snapshot) => {
    const cases = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.isDeleted !== true && c.isArchived === true);
    onChange(cases);
  });
}

/**
 * Create or update a Case document.
 *
 * currentStatusDate is intentionally NOT recomputed on every save the way
 * hearingDateTime is in hearings-data.js. It only changes when
 * currentStatus itself actually changes value — otherwise a routine edit
 * to, say, the charge text would incorrectly reset "when did this case's
 * status last change." On create, currentStatusDate is always set (the
 * case's first recorded status). On update, this reads the existing
 * document first to compare old vs. new currentStatus before deciding.
 *
 * @param {string|null} caseId - null to create a new Case
 * @param {object} caseData - { caseType, caseNo, charge, dateFiled, currentStatus }
 * @returns {Promise<string>} the Case document's id
 */
export async function saveCase(caseId, caseData) {
  const userEmail = currentUserEmail();
  const isNew = !caseId;
  const caseRef = isNew ? doc(casesCol) : doc(db, "cases", caseId);

  let statusChanged = isNew;
  if (!isNew) {
    const existingSnap = await getDoc(caseRef);
    const existingStatus = existingSnap.exists() ? existingSnap.data().currentStatus : undefined;
    statusChanged = existingStatus !== caseData.currentStatus;
  }

  const caseWrite = {
    caseType: caseData.caseType,
    caseNo: caseData.caseNo,
    charge: caseData.charge,
    dateFiled: caseData.dateFiled || "",
    currentStatus: caseData.currentStatus,
    updatedAt: serverTimestamp(),
    updatedBy: userEmail,
  };

  if (statusChanged) {
    caseWrite.currentStatusDate = serverTimestamp();
  }

  const batch = writeBatch(db);

  if (isNew) {
    batch.set(caseRef, {
      ...caseWrite,
      isDeleted: false,
      isArchived: false,
      createdAt: serverTimestamp(),
      createdBy: userEmail,
    });
  } else {
    batch.set(caseRef, caseWrite, { merge: true });
  }

  await batch.commit();
  return caseRef.id;
}

/**
 * Soft-delete a Case: marks it isDeleted/deletedAt/deletedBy rather than
 * removing the document. Identical pattern to deleteHearing() in
 * hearings-data.js.
 */
export async function deleteCase(caseId) {
  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "cases", caseId),
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
 * Archive a Case: a soft state change only, completely separate from
 * deleteCase() above. Identical pattern to archiveHearing() in
 * hearings-data.js.
 *
 * @param {string} caseId
 * @param {string} [reason] - optional free-text reason, stored as-is
 */
export async function archiveCase(caseId, reason = "") {
  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "cases", caseId),
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
 * Restore a previously-archived Case: resets isArchived to false.
 * archivedAt/archivedBy/archiveReason are left in place as historical
 * record, identical pattern to restoreHearing() in hearings-data.js.
 */
export async function restoreCase(caseId) {
  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "cases", caseId),
    {
      isArchived: false,
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    },
    { merge: true }
  );
  await batch.commit();
}

/**
 * IM-6 (Structural Linkage only): does a Case document with this id
 * actually exist? Used by hearings-data.js's setHearingCaseLink() as a
 * referential-integrity check before writing a caseId reference onto a
 * hearingCases row — kept here rather than having hearings-data.js read
 * the `cases` collection directly, preserving the one-file-per-collection
 * convention. Deliberately returns true for a soft-deleted or archived
 * Case too (existence, not "is this Case currently active") — whether a
 * link to an inactive Case should be allowed is a workflow question, out
 * of scope for a structural-linkage milestone.
 */
export async function caseExists(caseId) {
  if (!caseId) return false;
  const snap = await getDoc(doc(db, "cases", caseId));
  return snap.exists();
}

// --- IM-6B: Status Derivation (Decisions 008/016) -------------------------

/**
 * Writes a derived currentStatus/currentStatusDate onto a Case —
 * called by js/case-status-derivation.js's refreshCaseStatusFromHearings()
 * after it has already derived these values from the Case's linked
 * Hearings via hearings-data.js's getCaseStatusHistory(). This function
 * itself never reads Hearing data — it only ever receives
 * already-computed values and writes them, same separation of concerns
 * as every other *-data.js file in this project.
 *
 * Mirrors saveCase()'s existing rule from Decision 007 (IM-1): if
 * currentStatus hasn't actually changed, nothing is written at all —
 * not even audit fields — to avoid noisy writes on a no-op refresh.
 *
 * Deliberately different from saveCase()'s manual-edit path in one way:
 * currentStatusDate here is whatever the caller passes in (the linked
 * Hearing's own hearingDateTime — see case-status-derivation.js), NOT
 * serverTimestamp(). A derived status change should be dated to when
 * the procedure actually happened, not to whenever this refresh
 * function happened to run. saveCase()'s manual-edit path still uses
 * serverTimestamp() for its own currentStatusDate, since a human
 * editing the dropdown has no "hearing date" to attach it to instead —
 * these are two different write paths with two different, both
 * correct, meanings for the same field.
 *
 * @param {string} caseId
 * @param {string} currentStatus - the derived status value
 * @param {Timestamp|null} currentStatusDate - the linked Hearing's own
 *   hearingDateTime, or null if there's nothing to derive from
 * @returns {Promise<boolean>} true if a write occurred, false if the
 *   status was already up to date (no-op)
 * @throws if no Case exists with the given caseId
 */
export async function applyDerivedCurrentStatus(caseId, currentStatus, currentStatusDate) {
  const caseRef = doc(db, "cases", caseId);
  const existingSnap = await getDoc(caseRef);
  if (!existingSnap.exists()) {
    throw new Error(`No Case found with id "${caseId}" — cannot apply derived status.`);
  }

  const existing = existingSnap.data();
  if (existing.currentStatus === currentStatus) {
    return false;
  }

  const userEmail = currentUserEmail();
  const batch = writeBatch(db);
  batch.set(
    caseRef,
    {
      currentStatus,
      currentStatusDate,
      updatedAt: serverTimestamp(),
      updatedBy: userEmail,
    },
    { merge: true }
  );
  await batch.commit();
  return true;
}
