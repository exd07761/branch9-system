// ---------------------------------------------------------------------------
// Cases page controller (IM-2: Case Management UI).
//
// Same responsibility split as hearings.js: require login, require the
// cases.view permission for the page itself, render the live Case list,
// open/close the add/edit form, validate before saving (required fields +
// duplicate case number), and wire up archive. All Firestore access goes
// through cases-data.js — nothing in this file calls Firestore directly.
//
// Updated post-IM-8 (approved product decision): currentStatus/
// currentStatusDate are now a DERIVED field pair, maintained exclusively
// by case-status-derivation.js's refreshCaseStatusFromHearings() (called
// from hearings.js after every Hearing save). This supersedes IM-2's
// original design, which let a Clerk manually pick currentStatus from a
// dropdown on this page. That dropdown — and the CASE_STATUSES vocabulary
// backing it — is removed: the field is now display-only here, showing
// whatever the linked Hearings have derived (or a "Not yet set" state for
// a Case with no linked Hearings yet). saveCase() (cases-data.js) no
// longer accepts or writes either field, so there is no manual write path
// left to conflict with the derived one.
//
// IM-2 scope (see IMPLEMENTATION_ROADMAP.md) — standalone Case CRUD only:
//   - No Hearing linkage (Decision 002/015) — this page never reads or
//     writes "hearings" or "hearingCases"; the Case<->Hearing link itself
//     is entirely hearings.js's/hearings-data.js's responsibility (IM-6/
//     IM-8), read-only from here via the derived currentStatus display.
//   - No search bar, no Quick View modal, no export — narrower than
//     hearings.js on purpose; can be added later without breaking anything
//     built here.
//   - The duplicate-case-number check below is implemented entirely in
//     this file, scanning the already-loaded caseRecords[] array, rather
//     than adding a new export to cases-data.js. Keeps that file's own
//     diff minimal.
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { subscribeToCaseRecords, saveCase, archiveCase } from "./cases-data.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { can, PERMISSIONS } from "./permissions.js?v=1.0.0";

// Same fixed case-type vocabulary as hearings.js's (removed, IM-8)
// CASE_TYPES, duplicated locally rather than shared — matching that
// file's existing convention of keeping these small option lists
// page-local instead of a shared constants file.
const CASE_TYPES = [
  "FC Criminal Cases No",
  "FC Civil Case No",
  "FC CICL Case No",
  "FC Special Proceeding Case No",
];

let caseRecords = [];
let editingCaseId = null;
let formOpen = false;
let currentRole = null;

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// currentStatusDate is a Firestore Timestamp (see cases-data.js), not an
// "YYYY-MM-DD" string like hearingDate/dateFiled — a separate helper from
// fmtDate() above rather than overloading it to accept two shapes.
function fmtTimestamp(ts) {
  if (!ts || typeof ts.toDate !== "function") return "";
  return ts.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function optionsHtml(list, selected) {
  return list.map((opt) => `<option value="${esc(opt)}" ${opt === selected ? "selected" : ""}>${esc(opt)}</option>`).join("");
}

// Short label for Activity Log descriptions — same shape as hearings.js's
// hearingLabel().
function caseLabel(data) {
  return `${data.caseType || ""}. ${data.caseNo || ""}`;
}

// --- Duplicate case-number check (in-memory, this file only — see header
// comment for why this isn't a cases-data.js export) -----------------------

function isDuplicateCaseNo(caseType, caseNo, excludeCaseId) {
  return caseRecords.some(
    (c) => c.id !== excludeCaseId && c.caseType === caseType && c.caseNo === caseNo
  );
}

// --- List ------------------------------------------------------------------

function renderList() {
  const tbody = document.getElementById("casesTableBody");

  if (!caseRecords.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No cases yet. Click "+ Add Case" to create one.</td></tr>`;
    return;
  }

  tbody.innerHTML = caseRecords
    .map((c) => {
      const editBtn = can(currentRole, PERMISSIONS.CASES_EDIT)
        ? `<button type="button" class="btn-small" data-action="edit" data-id="${c.id}">Edit</button>`
        : "";
      const archiveBtn = can(currentRole, PERMISSIONS.ARCHIVE_MANAGE)
        ? `<button type="button" class="btn-small btn-danger" data-action="archive" data-id="${c.id}">Archive</button>`
        : "";
      return `
        <tr>
          <td>${esc(c.caseType)}</td>
          <td>${esc(c.caseNo)}</td>
          <td>${esc(c.charge) || '<span class="muted">&mdash;</span>'}</td>
          <td>${c.dateFiled ? esc(fmtDate(c.dateFiled)) : '<span class="muted">Not set</span>'}</td>
          <td>${c.currentStatus ? esc(c.currentStatus) : '<span class="muted">Not yet set</span>'}</td>
          <td>${c.currentStatusDate ? esc(fmtTimestamp(c.currentStatusDate)) : '<span class="muted">&mdash;</span>'}</td>
          <td class="row-actions">
            ${editBtn}
            ${archiveBtn}
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => openEditForm(btn.dataset.id));
  });
  tbody.querySelectorAll('[data-action="archive"]').forEach((btn) => {
    btn.addEventListener("click", () => handleArchive(btn.dataset.id));
  });
}

// --- Form --------------------------------------------------------------

function showFormMessage(text) {
  const el = document.getElementById("formMessage");
  if (el) el.textContent = text || "";
}

// currentStatus/currentStatusDate display: read-only, sourced straight
// from the Case record — see this file's header comment. Shown only when
// editing an existing Case (a brand-new one has neither yet, by design,
// the same way a migrated Case can). Not shown as a form field at all —
// there is nothing here for the Clerk to edit, so this renders as plain
// text, not a disabled input.
function statusDisplayHtml(c) {
  const status = c.currentStatus ? esc(c.currentStatus) : "Not yet set";
  const since = c.currentStatusDate ? ` &middot; since ${esc(fmtTimestamp(c.currentStatusDate))}` : "";
  return `
    <div class="field field-full">
      <label>Current status</label>
      <p>${status}${since}</p>
      <p class="muted">Set automatically from this case's linked hearings — not editable here.</p>
    </div>
  `;
}

function renderForm() {
  const panel = document.getElementById("formPanel");

  if (!formOpen) {
    panel.innerHTML = "";
    return;
  }

  const c = editingCaseId ? caseRecords.find((x) => x.id === editingCaseId) : {};

  panel.innerHTML = `
    <section class="card form-card">
      <h2>${editingCaseId ? "Edit Case" : "Add Case"}</h2>

      <div class="form-grid form-grid-2">
        <div class="field">
          <label>Case type <span class="required">*</span></label>
          <select id="f_caseType">${optionsHtml(CASE_TYPES, c.caseType)}</select>
        </div>
        <div class="field">
          <label>Case no. <span class="required">*</span></label>
          <input type="text" id="f_caseNo" value="${esc(c.caseNo)}" placeholder="e.g. 4123">
        </div>
        <div class="field field-full">
          <label>Charge</label>
          <input type="text" id="f_charge" value="${esc(c.charge)}" placeholder="Specific charge for this case">
        </div>
        <div class="field">
          <label>Date filed</label>
          <input type="date" id="f_dateFiled" value="${c.dateFiled || ""}">
        </div>
        ${editingCaseId ? statusDisplayHtml(c) : ""}
      </div>

      <p class="form-error" id="formMessage" role="alert"></p>

      <div class="form-actions">
        <button type="button" class="btn-secondary" id="cancelFormBtn">Cancel</button>
        <button type="button" class="btn-primary" id="saveFormBtn">Save Case</button>
      </div>
    </section>
  `;

  if (window.lucide) lucide.createIcons();

  document.getElementById("cancelFormBtn").addEventListener("click", closeForm);
  document.getElementById("saveFormBtn").addEventListener("click", handleSave);
}

// --- Form open/close ------------------------------------------------------

function openAddForm() {
  if (!can(currentRole, PERMISSIONS.CASES_CREATE)) return;
  editingCaseId = null;
  formOpen = true;
  renderForm();
  document.getElementById("formPanel").scrollIntoView({ behavior: "smooth" });
}

function openEditForm(caseId) {
  if (!can(currentRole, PERMISSIONS.CASES_EDIT)) return;
  editingCaseId = caseId;
  formOpen = true;
  renderForm();
  document.getElementById("formPanel").scrollIntoView({ behavior: "smooth" });
}

function closeForm() {
  formOpen = false;
  editingCaseId = null;
  renderForm();
}

// --- Save / Archive ---------------------------------------------------------

async function handleSave() {
  const requiredPermission = editingCaseId ? PERMISSIONS.CASES_EDIT : PERMISSIONS.CASES_CREATE;
  if (!can(currentRole, requiredPermission)) return;

  showFormMessage("");

  // currentStatus is intentionally absent here — it's a derived field
  // (see header comment) and saveCase() no longer accepts it.
  const caseData = {
    caseType: document.getElementById("f_caseType").value,
    caseNo: document.getElementById("f_caseNo").value.trim(),
    charge: document.getElementById("f_charge").value.trim(),
    dateFiled: document.getElementById("f_dateFiled").value,
  };

  // --- Required field validation ---
  const missing = [];
  if (!caseData.caseNo) missing.push("Case no.");

  if (missing.length) {
    showFormMessage(`Please fill in: ${missing.join(", ")}.`);
    return;
  }

  // --- Duplicate case number warning ---
  // caseRecords[] only ever contains active (non-deleted, non-archived)
  // Cases (subscribeToCaseRecords()'s default), so this naturally excludes
  // archived/deleted Cases' numbers from the duplicate check, the same
  // way hearings.js's equivalent check does.
  if (isDuplicateCaseNo(caseData.caseType, caseData.caseNo, editingCaseId)) {
    const confirmed = confirm(
      `"${caseData.caseType}. ${caseData.caseNo}" already exists on another case. Save anyway?`
    );
    if (!confirmed) return;
  }

  const saveBtn = document.getElementById("saveFormBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving\u2026";

  try {
    const isNew = !editingCaseId;
    const savedCaseId = await saveCase(editingCaseId, caseData);
    // Not awaited: logging must never delay closeForm() or block the UI.
    logActivity({
      action: isNew ? "Create Case" : "Edit Case",
      module: "Cases",
      entityId: savedCaseId,
      entityType: "case",
      description: `${isNew ? "Created" : "Updated"} case ${caseLabel(caseData)}`,
    });
    closeForm();
  } catch (err) {
    showFormMessage(`Could not save: ${err.message}`);
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Case";
  }
}

async function handleArchive(caseId) {
  if (!can(currentRole, PERMISSIONS.ARCHIVE_MANAGE)) return;
  // No "Archived Cases" page exists yet (out of IM-2 scope — mirrors
  // archived.html for Hearings, not built here) — the message below says
  // so plainly rather than promising a page that isn't there. The data is
  // still safe: archiveCase() (cases-data.js) sets isArchived, and
  // restoreCase() already exists in that file for whenever a future
  // milestone adds the page.
  const msg = "Archive this case? It will disappear from this list (no Archived Cases page exists yet). The case record itself is preserved, not deleted, and can be restored later once that page is built.";
  if (!confirm(msg)) return;

  // Captured before the archive resolves — caseRecords[] won't have this
  // Case removed from it until the live listener's next update.
  const caseRecord = caseRecords.find((c) => c.id === caseId);

  try {
    await archiveCase(caseId);
    // Not awaited: logging must never block the UI.
    logActivity({
      action: "Archived Case",
      module: "Cases",
      entityId: caseId,
      entityType: "case",
      description: caseRecord ? `Archived case ${caseLabel(caseRecord)}` : `Archived case ${caseId}`,
    });
  } catch (err) {
    alert(`Could not archive: ${err.message}`);
  }
}

// --- Init ---------------------------------------------------------------

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.CASES_VIEW, { redirectTo: "home.html" })) return;

  currentRole = user.role;
  wireNavAuth(user);

  const addCaseBtn = document.getElementById("addCaseBtn");
  if (can(currentRole, PERMISSIONS.CASES_CREATE)) {
    addCaseBtn.addEventListener("click", openAddForm);
  } else {
    addCaseBtn.hidden = true;
  }

  subscribeToCaseRecords((data) => {
    caseRecords = data;
    renderList();
  });
}

init();
