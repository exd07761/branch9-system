// ---------------------------------------------------------------------------
// Firestore data access layer for Backup & Restore (v0.9.4).
//
// This is the ONLY file that reads the collections below for backup
// purposes and writes them back during a restore. backup.js (the page
// controller) never talks to Firestore directly — same split as every
// other *-data.js file in this project (hearings-data.js, activity-data.js,
// users-data.js). No UI, no DOM access, anywhere in this file.
//
// Collections included:
//   hearings, hearingCases, activityLogs, users, systemStatus
//
// A note on "systemConfig": this app has no collection by that name — its
// only system-level collection is `systemStatus` (a lightweight,
// read-only connectivity probe used by app.js/diagnostics.js; see its own
// header comments). That is what gets backed up here, under its real
// name, rather than inventing a new `systemConfig` collection. It is
// exported for completeness but deliberately never restored — see
// RESTORE_POLICY below.
//
// Restore policy per collection (see RESTORE_POLICY):
//   - hearings, hearingCases, users: "upsert" — update the document if it
//     already exists at the destination, create it if it doesn't. Never
//     deletes anything.
//   - activityLogs: "create-missing" — only writes entries that do NOT
//     already exist at the destination. activityLogs' own Firestore rule
//     is intentionally update/delete: false (an immutable audit trail);
//     restoring must not fight that, so an existing log entry is left
//     completely alone rather than overwritten.
//   - systemStatus: "skip" — exported for reference only. Its rule is
//     write: false for every role, and it holds no real configuration, so
//     there is nothing meaningful to restore and no write would ever
//     succeed anyway.
//
// Batch processing: writes are chunked (BATCH_SIZE docs per
// writeBatch), with a yield back to the browser's event loop between
// chunks (see yieldToBrowser()) so a large restore never freezes the UI.
// Malformed records (missing/invalid id, or not an object) are filtered
// out BEFORE a chunk is built, so one bad record can never take an
// otherwise-good batch down with it. If a chunk's commit() itself fails
// (a "recoverable error" — e.g. a transient network blip), that chunk's
// documents are recorded as failed and the restore continues with the
// next chunk rather than aborting.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDocs,
  writeBatch,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

export const BACKUP_VERSION = "1.0";

// Every collection this backup format knows about, in the order they're
// exported/restored. Order matters a little for readability of the
// resulting JSON and the progress display, not for correctness.
const ALL_COLLECTIONS = ["hearings", "hearingCases", "activityLogs", "users", "systemStatus"];

// "upsert"        -> set(doc, data, {merge:true}) regardless of whether
//                    the doc already exists (update-or-create).
// "create-missing"-> only written if the id does NOT already exist at
//                    the destination.
// "skip"          -> never written during restore, exported only.
const RESTORE_POLICY = {
  hearings: "upsert",
  hearingCases: "upsert",
  users: "upsert",
  activityLogs: "create-missing",
  systemStatus: "skip",
};

const BATCH_SIZE = 400; // Firestore's writeBatch limit is 500; keep headroom.

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

// --- Timestamp (de)serialization -------------------------------------------
// Firestore Timestamp instances aren't valid JSON. Every Timestamp field
// (hearingDateTime, createdAt, updatedAt, archivedAt, deletedAt, the
// activityLogs `timestamp` field, etc.) is converted to a small tagged
// shape on export, and back to a real Timestamp on restore — so fields
// Calendar's range queries depend on (hearingDateTime) keep working
// correctly after a restore, instead of silently becoming plain strings.

function isFirestoreTimestamp(v) {
  return !!v && typeof v.seconds === "number" && typeof v.nanoseconds === "number" && typeof v.toDate === "function";
}

function serializeValue(v) {
  if (isFirestoreTimestamp(v)) {
    return { __type: "timestamp", seconds: v.seconds, nanoseconds: v.nanoseconds };
  }
  if (Array.isArray(v)) return v.map(serializeValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = serializeValue(val);
    return out;
  }
  return v;
}

function deserializeValue(v) {
  if (v && typeof v === "object" && v.__type === "timestamp") {
    return new Timestamp(v.seconds, v.nanoseconds);
  }
  if (Array.isArray(v)) return v.map(deserializeValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = deserializeValue(val);
    return out;
  }
  return v;
}

// --- Export ------------------------------------------------------------

/**
 * Reads every collection in ALL_COLLECTIONS and assembles the full backup
 * object (not yet a string/Blob — that's backup.js's job, same split as
 * reports-data.js building CSV rows vs. reports.js turning them into a
 * downloadable Blob). Document IDs are preserved as the `id` field on
 * each record, the same `{ id, ...data }` shape used everywhere else in
 * this app (subscribeToHearings(), subscribeToAllUsers(), etc.).
 *
 * @param {string} systemVersion - current app VERSION, stamped into the
 *   backup's metadata purely for reference (not enforced on restore).
 */
export async function exportBackup(systemVersion) {
  const collections = {};
  for (const name of ALL_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, name));
    collections[name] = snapshot.docs.map((d) => serializeValue({ id: d.id, ...d.data() }));
  }

  return {
    backupVersion: BACKUP_VERSION,
    systemVersion: systemVersion || "unknown",
    createdAt: new Date().toISOString(),
    collections,
  };
}

// --- Validation ----------------------------------------------------------

/**
 * Checks that a parsed backup file has the shape this app can restore
 * from. Pure — no Firestore access. Returns a result object rather than
 * throwing, so backup.js can render every problem found instead of
 * stopping at the first one.
 *
 * @param {*} parsed - the result of JSON.parse() on the selected file
 */
export function validateBackupFile(parsed) {
  const errors = [];

  if (!parsed || typeof parsed !== "object") {
    return { valid: false, errors: ["File is not a valid JSON object."], summary: null };
  }
  if (typeof parsed.backupVersion !== "string" || !parsed.backupVersion) {
    errors.push("Missing or invalid \"backupVersion\".");
  }
  if (!parsed.collections || typeof parsed.collections !== "object") {
    errors.push("Missing or invalid \"collections\" object.");
    return { valid: false, errors, summary: null };
  }

  const counts = {};
  for (const name of Object.keys(parsed.collections)) {
    const records = parsed.collections[name];
    if (!Array.isArray(records)) {
      errors.push(`Collection "${name}" is not a list of records — skipping it entirely.`);
      continue;
    }
    const malformed = records.filter((r) => !r || typeof r !== "object" || typeof r.id !== "string" || !r.id).length;
    counts[name] = { total: records.length, malformed };
  }

  const summary = {
    backupVersion: parsed.backupVersion || "unknown",
    systemVersion: parsed.systemVersion || "unknown",
    createdAt: parsed.createdAt || "unknown",
    counts,
  };

  return { valid: errors.length === 0, errors, summary };
}

// --- Restore ---------------------------------------------------------------

/**
 * Restores every restorable collection present in a validated backup
 * object. Never deletes anything. Malformed records are skipped before
 * ever being batched; a chunk that fails to commit (a recoverable error)
 * is recorded and the restore continues with the next chunk/collection
 * rather than aborting the whole operation.
 *
 * @param {object} backup - the parsed (and already-validated) backup object
 * @param {(info: object) => void} [onProgress] - called after every chunk
 *   with { collection, processed, total } so the UI can render a progress
 *   bar without doing any Firestore work itself.
 * @returns {Promise<object>} per-collection summary: created/updated
 *   counts aren't distinguishable client-side without an extra read per
 *   doc (not worth it for a disaster-recovery tool), so each collection
 *   reports { written, skippedMalformed, skippedExisting, failed }.
 */
export async function restoreFromBackup(backup, onProgress) {
  const results = {};
  const collections = backup.collections || {};

  const grandTotal = Object.entries(collections).reduce((sum, [name, records]) => {
    return RESTORE_POLICY[name] === "skip" || !Array.isArray(records) ? sum : sum + records.length;
  }, 0);
  let grandProcessed = 0;

  for (const name of Object.keys(collections)) {
    const policy = RESTORE_POLICY[name];
    const records = Array.isArray(collections[name]) ? collections[name] : [];

    if (!policy) {
      // Unknown collection name in the file (e.g. from a newer/older
      // backup format) — not part of this app's schema, so it's simply
      // not restorable. Not an error; just not written.
      results[name] = { written: 0, skippedMalformed: 0, skippedExisting: 0, failed: 0, note: "Unknown collection — not restored." };
      continue;
    }
    if (policy === "skip") {
      results[name] = { written: 0, skippedMalformed: 0, skippedExisting: 0, failed: 0, note: "Reference only — never restored." };
      continue;
    }

    const summary = { written: 0, skippedMalformed: 0, skippedExisting: 0, failed: 0 };

    // Filter out malformed records up front, before anything is batched,
    // so one bad record can never take a whole otherwise-good batch down
    // with it.
    const wellFormed = [];
    for (const r of records) {
      if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.id) {
        summary.skippedMalformed++;
        continue;
      }
      wellFormed.push(r);
    }

    let toWrite = wellFormed;
    if (policy === "create-missing") {
      // activityLogs' rule forbids updating an existing entry, and this
      // app never wants to anyway (immutable audit trail) — so only
      // entries whose id isn't already present at the destination are
      // written. One bulk read of existing ids, not one read per record.
      const existingSnapshot = await getDocs(collection(db, name));
      const existingIds = new Set(existingSnapshot.docs.map((d) => d.id));
      toWrite = [];
      for (const r of wellFormed) {
        if (existingIds.has(r.id)) {
          summary.skippedExisting++;
        } else {
          toWrite.push(r);
        }
      }
    }

    for (const group of chunk(toWrite, BATCH_SIZE)) {
      try {
        const batch = writeBatch(db);
        for (const record of group) {
          const { id, ...fields } = record;
          batch.set(doc(db, name, id), deserializeValue(fields), { merge: true });
        }
        await batch.commit();
        summary.written += group.length;
      } catch (err) {
        // A recoverable error (e.g. a transient network failure) fails
        // this whole chunk — recorded, and the restore continues with
        // the next chunk/collection rather than stopping altogether.
        console.warn(`[backup-data] Chunk of ${group.length} record(s) in "${name}" failed to commit:`, err);
        summary.failed += group.length;
      }
      grandProcessed += group.length;
      if (onProgress) onProgress({ collection: name, processed: grandProcessed, total: grandTotal });
      // Yield back to the browser between chunks so a large restore never
      // freezes the tab — the progress bar actually gets to repaint.
      await yieldToBrowser();
    }

    results[name] = summary;
  }

  return results;
}
