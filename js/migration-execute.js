// ---------------------------------------------------------------------------
// v1.1 Pilot Migration Tool (IM-7A) — page controller.
//
// Same standalone-tool posture as migration-dryrun.html (not linked from
// the Clerk-facing app, not part of its nav), but this one DOES write to
// Firestore, so unlike that tool it requires sign-in and the
// Administrator-only BACKUP_MANAGE permission (the same permission
// backup.html already gates behind — no new permission was invented for
// this).
//
// Scope (per IM7_PLANNING.md, approved before this was built):
//   - Reuses migration-dryrun.js's buildAnalysis() (now exported) against
//     LIVE Firestore reads instead of a backup file, rather than
//     re-implementing the same grouping/ambiguity logic a second time.
//   - Reuses hearings-data.js's setHearingCaseLink() and
//     case-status-derivation.js's refreshCaseStatusFromHearings()
//     unchanged — this file adds NO new derivation or linkage logic of
//     its own, only orchestrates existing, already-tested functions.
//   - Ambiguous groups (per buildAnalysis()'s own flagging) are SKIPPED,
//     not auto-created with a best guess — recorded in the report for
//     manual follow-up via cases.html instead.
//   - Idempotency: before migrating a group, every candidate row is
//     checked for an already-set `caseId` (from a prior run). If any
//     member row already has one, the WHOLE group is skipped as
//     "already migrated" — including a partially-linked group, since
//     silently trying to finish a partial group risks creating a SECOND
//     Case for a real-world case that's already (at least partly)
//     linked to a different one. That's a deliberate, conservative
//     choice, not an oversight — a partially-migrated group found this
//     way should be reviewed manually, not auto-completed.
//   - Pilot limit: an optional cap on how many groups get migrated in
//     one run, so an operator can migrate a handful, review them via
//     cases.html, and only then run the rest.
//   - Rollback is explicitly NOT part of this milestone (see
//     IM7_PLANNING.md §6) — the only safety net right now is the
//     pre-migration backup this tool repeatedly tells the operator to
//     take.
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=1.0.0";
import { PERMISSIONS } from "./permissions.js?v=1.0.0";
import { buildAnalysis } from "./migration-dryrun.js?v=1.0.0";
import { getAllHearings, getAllHearingCaseRows, setHearingCaseLink } from "./hearings-data.js?v=1.0.0";
import { createCaseShell } from "./cases-data.js?v=1.0.0";
import { refreshCaseStatusFromHearings } from "./case-status-derivation.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";

let currentUser = null;
let liveAnalysis = null; // last buildAnalysis() result, against live data
let rawHearingCaseRows = []; // all hearingCases rows, for member-row lookup + idempotency
let hearingsById = new Map(); // hearingId -> hearing doc, for the same linkable-row filter buildAnalysis/getCaseStatusHistory already use

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

// Same normalization as hearings-data.js's isDuplicateCaseNumber() and
// migration-dryrun.js's own normalizeCaseNo() — kept consistent with
// both rather than inventing a third version.
function normalizeCaseNo(s) {
  return (s || "").trim().toLowerCase();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Converts a live Firestore Timestamp into the same tagged shape
// migration-dryrun.js's buildAnalysis() already knows how to read from a
// backup file — the ONLY adapter needed to reuse that function unchanged
// against live data instead of a file.
function tsToTagged(ts) {
  if (!ts) return null;
  return { __type: "timestamp", seconds: ts.seconds, nanoseconds: ts.nanoseconds };
}

// --- Analysis (read-only) ---------------------------------------------

async function loadLiveAnalysis() {
  const [hearings, hearingCaseRows] = await Promise.all([getAllHearings(), getAllHearingCaseRows()]);

  rawHearingCaseRows = hearingCaseRows;
  hearingsById = new Map(hearings.map((h) => [h.id, h]));

  const parsed = {
    backupVersion: "live",
    systemVersion: "live",
    createdAt: new Date().toISOString(),
    collections: {
      hearings: hearings.map((h) => ({ ...h, hearingDateTime: tsToTagged(h.hearingDateTime) })),
      hearingCases: hearingCaseRows,
    },
  };

  return buildAnalysis(parsed);
}

// Every raw hearingCases row belonging to a candidate group, restricted
// to rows whose hearingId resolves to a real, non-deleted hearing — the
// same "linkable" rule getCaseStatusHistory() already applies for status
// derivation, kept consistent here for which rows actually get linked.
function getLinkableMemberRows(candidate) {
  return rawHearingCaseRows.filter((r) => {
    if ((r.caseType || "") !== candidate.caseType) return false;
    if (normalizeCaseNo(r.caseNo) !== normalizeCaseNo(candidate.caseNo)) return false;
    const hearing = hearingsById.get(r.hearingId);
    return hearing && hearing.isDeleted !== true;
  });
}

function isAlreadyMigrated(memberRows) {
  return memberRows.some((r) => !!r.caseId);
}

function renderAnalysisSummary(analysis) {
  const el = document.getElementById("analysisSummary");
  const c = analysis.counts;

  const categorized = analysis.reconstructed.map((candidate) => {
    const memberRows = getLinkableMemberRows(candidate);
    let category;
    if (isAlreadyMigrated(memberRows)) category = "already-migrated";
    else if (!candidate.clean) category = "ambiguous";
    else category = "eligible";
    return { candidate, memberRows, category };
  });

  const eligible = categorized.filter((c) => c.category === "eligible").length;
  const alreadyMigrated = categorized.filter((c) => c.category === "already-migrated").length;
  const ambiguous = categorized.filter((c) => c.category === "ambiguous").length;

  el.innerHTML = `
    <ul>
      <li>${c.hearingsTotal} hearing(s), ${c.hearingCasesTotal} case row(s) read just now.</li>
      <li>${analysis.reconstructed.length} candidate case group(s) found.</li>
      <li><strong>${eligible} eligible to migrate</strong> in this run.</li>
      <li>${alreadyMigrated} already migrated in a prior run — will be skipped automatically.</li>
      <li>${ambiguous} ambiguous — will be skipped; use <code>cases.html</code> to create these manually. See the downloadable report after running for exactly which ones.</li>
    </ul>
  `;

  document.getElementById("runSection").hidden = eligible === 0 && alreadyMigrated === 0;
  return categorized;
}

let lastCategorized = [];

document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const btn = document.getElementById("analyzeBtn");
  btn.disabled = true;
  btn.textContent = "Analyzing\u2026";
  try {
    liveAnalysis = await loadLiveAnalysis();
    lastCategorized = renderAnalysisSummary(liveAnalysis);
  } catch (err) {
    document.getElementById("analysisSummary").innerHTML = `<p class="form-error">Could not analyze: ${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze Current Data";
  }
});

// --- Migration run -------------------------------------------------------

async function migrateOneGroup(candidate, memberRows) {
  const linkedRowIds = [];
  const caseId = await createCaseShell({
    caseType: candidate.caseType,
    caseNo: candidate.caseNo,
    charge: candidate.charge,
    dateFiled: candidate.dateFiled,
  });

  for (const row of memberRows) {
    await setHearingCaseLink(row.id, caseId);
    linkedRowIds.push(row.id);
  }

  const derived = await refreshCaseStatusFromHearings(caseId);

  logActivity({
    action: "Migrated Case",
    module: "Cases",
    entityId: caseId,
    entityType: "case",
    description: `Migrated case ${candidate.caseType}. ${candidate.caseNo} (IM-7A pilot)`,
  });

  return {
    caseId,
    caseType: candidate.caseType,
    caseNo: candidate.caseNo,
    linkedHearingCaseRowIds: linkedRowIds,
    derivedCurrentStatus: derived.currentStatus,
    derivedCurrentStatusDate: derived.currentStatusDate,
  };
}

async function runMigration(limit) {
  const eligible = lastCategorized.filter((c) => c.category === "eligible");
  const alreadyMigratedSkips = lastCategorized
    .filter((c) => c.category === "already-migrated")
    .map((c) => ({ caseType: c.candidate.caseType, caseNo: c.candidate.caseNo }));
  const ambiguousSkips = lastCategorized
    .filter((c) => c.category === "ambiguous")
    .map((c) => ({ caseType: c.candidate.caseType, caseNo: c.candidate.caseNo, reasons: c.candidate.reasons }));

  // Deterministic, reproducible order — sorted by caseType then caseNo.
  eligible.sort((a, b) => {
    const ta = a.candidate.caseType || "";
    const tb = b.candidate.caseType || "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return normalizeCaseNo(a.candidate.caseNo) < normalizeCaseNo(b.candidate.caseNo) ? -1 : 1;
  });

  const toMigrate = limit ? eligible.slice(0, limit) : eligible;
  const notReachedThisRun = limit ? eligible.slice(limit) : [];

  const created = [];
  const errors = [];

  for (const { candidate, memberRows } of toMigrate) {
    try {
      const result = await migrateOneGroup(candidate, memberRows);
      created.push(result);
    } catch (err) {
      errors.push({ caseType: candidate.caseType, caseNo: candidate.caseNo, message: err.message });
    }
  }

  return {
    runAt: new Date().toISOString(),
    operator: currentUser.email,
    pilotLimit: limit || null,
    created,
    skippedAlreadyMigrated: alreadyMigratedSkips,
    skippedAmbiguous: ambiguousSkips,
    skippedNotReachedThisRun: notReachedThisRun.map((c) => ({ caseType: c.candidate.caseType, caseNo: c.candidate.caseNo })),
    errors,
  };
}

function renderRunReport(manifest) {
  const root = document.getElementById("reportRoot");

  const createdList = manifest.created
    .map(
      (c) =>
        `<li>${esc(c.caseType)}. ${esc(c.caseNo)} &rarr; Case ${esc(c.caseId)}, ${c.linkedHearingCaseRowIds.length} hearing(s) linked, status: ${c.derivedCurrentStatus ? esc(c.derivedCurrentStatus) : '<span class="muted">none derived</span>'}</li>`
    )
    .join("");

  const errorList = manifest.errors
    .map((e) => `<li>${esc(e.caseType)}. ${esc(e.caseNo)}: ${esc(e.message)}</li>`)
    .join("");

  const noStatusCount = manifest.created.filter((c) => !c.derivedCurrentStatus).length;

  root.innerHTML = `
    <section class="card">
      <h2>Migration run complete</h2>
      <ul>
        <li><strong>${manifest.created.length} case(s) created</strong>, ${manifest.created.reduce((n, c) => n + c.linkedHearingCaseRowIds.length, 0)} hearing link(s) created.</li>
        <li>${manifest.skippedAlreadyMigrated.length} group(s) skipped (already migrated).</li>
        <li>${manifest.skippedAmbiguous.length} group(s) skipped (ambiguous — needs manual creation via cases.html).</li>
        ${manifest.skippedNotReachedThisRun.length ? `<li>${manifest.skippedNotReachedThisRun.length} eligible group(s) not reached this run (pilot limit) — run again to continue.</li>` : ""}
        <li>${manifest.errors.length} error(s) encountered.</li>
        ${noStatusCount ? `<li class="form-error">${noStatusCount} created case(s) have no derived status yet — their linked hearings didn't yield one. These will show as blank in cases.html's list and default to "Case Filed" if opened for editing; review them before relying on that default (see IM7_PLANNING.md §2/§9).</li>` : ""}
      </ul>
      ${manifest.created.length ? `<p>Cases created this run:</p><ul>${createdList}</ul>` : ""}
      ${manifest.errors.length ? `<p>Errors:</p><ul>${errorList}</ul>` : ""}
      <button type="button" class="btn-secondary" id="downloadManifestBtn">Download migration-run manifest (JSON)</button>
    </section>
  `;

  document.getElementById("downloadManifestBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    downloadBlob(blob, `migration-run-${manifest.runAt.slice(0, 10)}.json`);
  });
}

document.getElementById("runBtn").addEventListener("click", async () => {
  const errorEl = document.getElementById("runError");
  errorEl.textContent = "";

  const limitRaw = document.getElementById("limitInput").value.trim();
  const limit = limitRaw ? parseInt(limitRaw, 10) : null;
  if (limitRaw && (!Number.isInteger(limit) || limit < 1)) {
    errorEl.textContent = "Pilot limit must be a positive whole number, or left blank.";
    return;
  }

  const eligibleCount = lastCategorized.filter((c) => c.category === "eligible").length;
  const willMigrate = limit ? Math.min(limit, eligibleCount) : eligibleCount;

  const confirmMsg = [
    "Have you taken a fresh backup via backup.html? This cannot be undone automatically if not.",
    "",
    limit
      ? `This will migrate up to ${willMigrate} case group(s) (pilot limit: ${limit}).`
      : `This will migrate ALL ${willMigrate} eligible case group(s) — no limit set.`,
    "",
    "This creates real Case documents and links real Hearing records. Continue?",
  ].join("\n");

  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById("runBtn");
  btn.disabled = true;
  btn.textContent = "Migrating\u2026";

  try {
    const manifest = await runMigration(limit);
    renderRunReport(manifest);
    // Refresh the analysis so re-running (or reviewing) reflects what
    // was just migrated, rather than showing stale pre-run counts.
    liveAnalysis = await loadLiveAnalysis();
    lastCategorized = renderAnalysisSummary(liveAnalysis);
  } catch (err) {
    errorEl.textContent = `Migration run failed: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Run Migration";
  }
});

// --- Init -----------------------------------------------------------------

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.BACKUP_MANAGE, { redirectTo: "home.html" })) return;
  currentUser = user;
  // Deliberately nothing else runs here — no analysis, no migration.
  // Both require an explicit button click (requirement: no automatic
  // migration when the tool is opened).
}

init();
