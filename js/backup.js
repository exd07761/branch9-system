// ---------------------------------------------------------------------------
// Backup & Restore page controller (v0.9.4 — Administrator only).
//
// Responsibilities: require login + BACKUP_MANAGE, render the page,
// trigger a backup download, handle file selection + validation display,
// the restore confirmation dialog, and the progress bar / result summary.
// No Firestore access happens in this file — every read/write goes
// through backup-data.js, same split as every other page controller in
// this app (hearings.js/hearings-data.js, users.js/users-data.js, etc.).
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=0.9.6";
import { wireNavAuth } from "./nav-auth.js?v=0.9.6";
import { PERMISSIONS } from "./permissions.js?v=0.9.6";
import { exportBackup, validateBackupFile, restoreFromBackup } from "./backup-data.js?v=0.9.6";
import { logActivity } from "./activity-data.js?v=0.9.6";

const SYSTEM_VERSION = "0.9.4";

let pendingBackup = null; // the parsed, validated backup object staged for restore

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

// --- Backup (export) ------------------------------------------------------
// Own local copy of the download-a-Blob helper, same convention as
// docx-export.js and reports.js each keeping their own rather than
// sharing one across files.
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

function backupFilename() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `branch9-backup-${stamp}.json`;
}

async function handleCreateBackup() {
  const btn = document.getElementById("createBackupBtn");
  const statusEl = document.getElementById("backupStatus");
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.textContent = "Preparing backup\u2026";
  statusEl.textContent = "";

  try {
    const backup = await exportBackup(SYSTEM_VERSION);
    const counts = Object.entries(backup.collections).map(([name, records]) => `${name}: ${records.length}`).join(", ");
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const filename = backupFilename();
    downloadBlob(blob, filename);

    statusEl.textContent = `Backup downloaded as ${filename} (${counts}).`;
    statusEl.className = "backup-status backup-status-success";

    logActivity({
      action: "Backup Created",
      module: "Backup",
      description: `Created backup ${filename} (${counts})`,
    });
  } catch (err) {
    statusEl.textContent = `Backup failed: ${err.message}`;
    statusEl.className = "backup-status backup-status-error";
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- Restore (file selection + validation) --------------------------------

function renderValidation(errors, summary) {
  const root = document.getElementById("restoreValidation");
  const restoreBtn = document.getElementById("restoreBtn");

  if (!summary && !errors.length) {
    root.innerHTML = "";
    restoreBtn.disabled = true;
    return;
  }

  if (errors.length) {
    root.innerHTML = `
      <div class="backup-validation backup-validation-error">
        <p><strong>This file can't be restored:</strong></p>
        <ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
      </div>
    `;
    restoreBtn.disabled = true;
    return;
  }

  const rows = Object.entries(summary.counts)
    .map(([name, c]) => `<li>${esc(name)}: ${c.total} record(s)${c.malformed ? ` (${c.malformed} malformed, will be skipped)` : ""}</li>`)
    .join("");

  root.innerHTML = `
    <div class="backup-validation backup-validation-ok">
      <p><strong>Backup file looks valid.</strong></p>
      <ul>
        <li>Backup format version: ${esc(summary.backupVersion)}</li>
        <li>Created by system version: ${esc(summary.systemVersion)}</li>
        <li>Created at: ${esc(summary.createdAt)}</li>
      </ul>
      <p>Records found:</p>
      <ul>${rows}</ul>
    </div>
  `;
  restoreBtn.disabled = false;
}

function wireFileInput() {
  const input = document.getElementById("restoreFileInput");
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    pendingBackup = null;
    document.getElementById("restoreResult").innerHTML = "";
    renderValidation([], null);

    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        renderValidation([`File is not valid JSON (${err.message}).`], null);
        return;
      }
      const { valid, errors, summary } = validateBackupFile(parsed);
      renderValidation(errors, summary);
      if (valid) pendingBackup = parsed;
    };
    reader.onerror = () => {
      renderValidation(["Could not read the selected file."], null);
    };
    reader.readAsText(file);
  });
}

// --- Restore (confirmation + progress + summary) --------------------------

function confirmationMessage(summary) {
  const lines = Object.entries(summary.counts).map(([name, c]) => `  \u2022 ${name}: ${c.total} record(s)`);
  return [
    "Restore from this backup?",
    "",
    `Created: ${summary.createdAt}`,
    `System version at time of backup: ${summary.systemVersion}`,
    "",
    "Records in this file:",
    ...lines,
    "",
    "This will UPDATE any existing document with a matching ID, and CREATE any document that's missing. It will NEVER delete anything already in the system. Malformed records are skipped automatically. This cannot be undone automatically — continue?",
  ].join("\n");
}

function setProgress(processed, total) {
  const bar = document.getElementById("restoreProgressBar");
  const label = document.getElementById("restoreProgressLabel");
  const pct = total ? Math.round((processed / total) * 100) : 100;
  bar.style.width = `${pct}%`;
  label.textContent = total ? `${processed} / ${total} record(s) processed` : "Processing\u2026";
}

function renderRestoreSummary(results) {
  const root = document.getElementById("restoreResult");
  const rows = Object.entries(results)
    .map(([name, r]) => {
      if (r.note) return `<li>${esc(name)}: ${esc(r.note)}</li>`;
      return `<li>${esc(name)}: ${r.written} written, ${r.skippedExisting} already present (kept as-is), ${r.skippedMalformed} malformed (skipped), ${r.failed} failed</li>`;
    })
    .join("");
  root.innerHTML = `
    <div class="backup-validation backup-validation-ok">
      <p><strong>Restore complete.</strong></p>
      <ul>${rows}</ul>
    </div>
  `;
}

async function handleRestore() {
  if (!pendingBackup) return;
  const { summary } = validateBackupFile(pendingBackup);
  if (!confirm(confirmationMessage(summary))) return;

  const restoreBtn = document.getElementById("restoreBtn");
  const progressWrap = document.getElementById("restoreProgressWrap");
  restoreBtn.disabled = true;
  progressWrap.style.display = "block";
  setProgress(0, 0);
  document.getElementById("restoreResult").innerHTML = "";

  logActivity({ action: "Restore Started", module: "Backup", description: `Restore started from a backup created ${summary.createdAt}` });

  try {
    const results = await restoreFromBackup(pendingBackup, ({ processed, total }) => setProgress(processed, total));
    renderRestoreSummary(results);

    const anyFailed = Object.values(results).some((r) => r.failed > 0);
    const totals = Object.entries(results).map(([name, r]) => `${name}: ${r.written || 0} written`).join(", ");
    logActivity({
      action: anyFailed ? "Restore Failed" : "Restore Completed",
      module: "Backup",
      description: anyFailed
        ? `Restore finished with some failed records (${totals})`
        : `Restore completed successfully (${totals})`,
    });
  } catch (err) {
    document.getElementById("restoreResult").innerHTML = `<div class="backup-validation backup-validation-error"><p><strong>Restore failed:</strong> ${esc(err.message)}</p></div>`;
    logActivity({ action: "Restore Failed", module: "Backup", description: `Restore failed: ${err.message}` });
  } finally {
    restoreBtn.disabled = false;
  }
}

// --- Init ---------------------------------------------------------------

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.BACKUP_MANAGE, { redirectTo: "home.html" })) return;

  wireNavAuth(user);
  wireFileInput();
  document.getElementById("createBackupBtn").addEventListener("click", handleCreateBackup);
  document.getElementById("restoreBtn").addEventListener("click", handleRestore);
}

init();
