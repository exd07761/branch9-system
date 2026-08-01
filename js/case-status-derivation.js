// ---------------------------------------------------------------------------
// Status Derivation (IM-6B) — DECISIONS_v1.1.md Decisions 008 and 016,
// both Accepted.
//
// This file is the orchestration layer for status derivation. It does
// NOT own a Firestore collection and never touches Firestore directly
// itself — it only calls already-existing, single-purpose functions in
// hearings-data.js (reads Hearings/hearingCases) and cases-data.js
// (writes to Cases), keeping the one-file-per-collection convention
// intact while giving "derive and apply a Case's current status" one
// clear home, rather than folding it into either data file (which would
// have required one of them to import the other in both directions —
// hearings-data.js already imports FROM cases-data.js for
// caseExists(); this file avoids ever needing the reverse).
//
// Decision 008 (Option (b), adopted): there is no separate Case status
// history log anywhere. getHistory()/refreshCaseStatusFromHearings()
// below ARE the history mechanism — computed fresh from Hearing
// records each time, never stored redundantly.
//
// Decision 016 (resolved via Clerk interview): a Hearing's `status`
// represents the procedure actually being conducted at that hearing,
// advancing only when the court reaches a genuinely new stage — so the
// chronologically LATEST linked Hearing's status is the correct,
// meaningful choice for a Case's currentStatus.
//
// Scope, explicitly: this milestone (IM-6B) implements the derivation
// logic only. Nothing in this file is called by any UI, any migration
// script, or any other part of the application yet — same posture as
// IM-6's setHearingCaseLink(), which also shipped with zero callers.
// Wiring this into an actual trigger point (a Hearing save, a migration
// run, a manual "recompute" action) is future work, not part of this
// milestone.
// ---------------------------------------------------------------------------

import { getCaseStatusHistory } from "./hearings-data.js?v=1.0.0";
import { applyDerivedCurrentStatus } from "./cases-data.js?v=1.0.0";

/**
 * Pure function, no Firestore access: given a Case's status history
 * (as returned by hearings-data.js's getCaseStatusHistory(), already
 * sorted ascending by hearingDateTime), returns the derived current
 * status and its date — the last entry in the history.
 *
 * Returns { currentStatus: null, currentStatusDate: null } for an empty
 * history (a Case with no linked, non-deleted Hearings yet) — this is a
 * valid, expected state, not an error. Callers should treat a null
 * result as "nothing to derive," not "clear the Case's existing
 * status" — see refreshCaseStatusFromHearings() below, which does
 * exactly that.
 *
 * @param {Array<{hearingId: string, hearingDateTime: *, status: string}>} history
 * @returns {{currentStatus: string|null, currentStatusDate: *|null}}
 */
export function deriveCurrentStatusFromHistory(history) {
  if (!history || history.length === 0) {
    return { currentStatus: null, currentStatusDate: null };
  }
  const latest = history[history.length - 1];
  return {
    currentStatus: latest.status,
    currentStatusDate: latest.hearingDateTime,
  };
}

/**
 * Orchestrates a full refresh for one Case: reads its status history
 * from linked Hearings, derives the current status/date, and — only if
 * there's something to derive — writes it. A Case with no linked
 * Hearings is left completely untouched (no write, no clearing of
 * whatever status it already had); "no history yet" is not the same
 * thing as "no status."
 *
 * @param {string} caseId
 * @returns {Promise<{currentStatus: string|null, currentStatusDate: *|null, applied: boolean}>}
 *   applied is true only if a write actually occurred (see
 *   applyDerivedCurrentStatus()'s own no-op-if-unchanged behavior).
 */
export async function refreshCaseStatusFromHearings(caseId) {
  const history = await getCaseStatusHistory(caseId);
  const derived = deriveCurrentStatusFromHistory(history);

  if (derived.currentStatus === null) {
    return { ...derived, applied: false };
  }

  const applied = await applyDerivedCurrentStatus(caseId, derived.currentStatus, derived.currentStatusDate);
  return { ...derived, applied };
}
