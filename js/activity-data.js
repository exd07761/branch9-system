// ---------------------------------------------------------------------------
// Firestore data access layer for the Activity Log.
//
// This is the ONLY file that reads or writes the "activityLogs" collection.
// Same split as hearings-data.js/calendar-data.js: activity.js (the page
// controller) never talks to Firestore directly, and every other page
// that wants to record an action imports logActivity() from here instead
// of writing to Firestore itself. No UI in this file.
//
// Milestone 0.9.0: new collection, additive only. hearings/hearingCases/
// systemConfig/users are untouched — nothing here reads or writes them.
//
// Schema (kept intentionally lightweight — see the milestone brief: avoid
// storing entire hearing objects):
//   activityLogs: timestamp, userEmail, action, module, entityId,
//                 entityType, description, oldValue (optional),
//                 newValue (optional)
// ---------------------------------------------------------------------------

import {
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "./firebase-init.js?v=1.0.0";

const activityLogsCol = collection(db, "activityLogs");

// Live views only ever need "recent" history, not the whole collection —
// capping the listener keeps this cheap regardless of how long the court
// has been using the system. activity.js's client-side search/filter
// still works normally within this window.
const DEFAULT_LIVE_LIMIT = 500;

function currentUserEmail() {
  return (auth.currentUser && auth.currentUser.email) || "unknown";
}

/**
 * Records one audit entry. Fire-and-forget by design: logging must never
 * block or interrupt the action it's describing, so this never throws —
 * a failed write is swallowed and reported to the console only. Callers
 * should NOT await this if doing so would delay user-facing feedback;
 * it's safe to call without awaiting.
 *
 * @param {object} entry
 * @param {string} entry.action - e.g. "Create Hearing", "Login"
 * @param {string} entry.module - e.g. "Hearings", "Authentication"
 * @param {string|null} [entry.entityId] - id of the record affected, if any
 * @param {string|null} [entry.entityType] - e.g. "hearing"
 * @param {string} [entry.description] - short human-readable summary
 * @param {*} [entry.oldValue] - optional lightweight before-state
 * @param {*} [entry.newValue] - optional lightweight after-state
 */
export async function logActivity({
  action,
  module,
  entityId = null,
  entityType = null,
  description = "",
  oldValue = null,
  newValue = null,
}) {
  try {
    await addDoc(activityLogsCol, {
      timestamp: serverTimestamp(),
      userEmail: currentUserEmail(),
      action,
      module,
      entityId,
      entityType,
      description,
      oldValue,
      newValue,
    });
  } catch (err) {
    // Never interrupt the original action over a logging failure.
    console.warn("[activity] Failed to record activity log entry:", err);
  }
}

/**
 * Subscribe to live updates of the most recent activity log entries,
 * newest first. Returns an unsubscribe function.
 */
export function subscribeToActivityLogs(onChange, { max = DEFAULT_LIVE_LIMIT } = {}) {
  const q = query(activityLogsCol, orderBy("timestamp", "desc"), limit(max));
  return onSnapshot(q, (snapshot) => {
    const entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(entries);
  });
}

// --- IM-10: Case Activity & History (read-only) ----------------------------
//
// Firestore's `in` operator accepts at most 10 values per query, so a
// larger entityIds list is split into chunks and the results merged —
// existing behavior/schema of this collection is otherwise untouched by
// this addition. One-shot (not a live listener), matching how case-detail.js
// (IM-10) uses it: a page load, not a real-time view, same posture as
// hearings-data.js's getCaseStatusHistory().

const WHERE_IN_CHUNK_SIZE = 10;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * One-shot fetch of every activityLogs entry for a given entityType whose
 * entityId is in `entityIds`. Used by case-detail.js (IM-10) to pull a
 * Case's own activity (entityType "case", a single-id array) and its
 * linked Hearings' activity (entityType "hearing", one or more hearing
 * ids) — both already-logged by existing callers (cases.js, hearings.js),
 * nothing new is written here. Returns [] immediately for an empty
 * entityIds array (avoids an invalid empty `in` query).
 *
 * @param {string} entityType - e.g. "case" or "hearing"
 * @param {string[]} entityIds
 * @returns {Promise<Array<object>>} unsorted; caller merges/sorts alongside
 *   other timeline sources.
 */
export async function getActivityForEntities(entityType, entityIds) {
  const ids = [...new Set((entityIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const chunks = chunk(ids, WHERE_IN_CHUNK_SIZE);
  const results = await Promise.all(
    chunks.map((idChunk) => {
      const q = query(
        activityLogsCol,
        where("entityType", "==", entityType),
        where("entityId", "in", idChunk)
      );
      return getDocs(q);
    })
  );

  return results.flatMap((snapshot) => snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
}
