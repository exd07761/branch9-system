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
//   - No Quick View modal, no export — narrower than hearings.js on
//     purpose; can be added later without breaking anything built here.
//   - The duplicate-case-number check below is implemented entirely in
//     this file, scanning the already-loaded caseRecords[] array, rather
//     than adding a new export to cases-data.js. Keeps that file's own
//     diff minimal.
//
// Phase 6 addition: search, a Case Type filter, a Case Status filter, and
// a sort control — all client-side over the already-loaded caseRecords[]
// array, no new Firestore queries per keystroke or dropdown change, same
// approach as hearings.js's own search.
//
// Phase 6 completion pass: the Status filter was initially left out
// because its vocabulary (STATUSES) was a module-local const in
// hearings.js, and duplicating it here risked drifting out of sync with
// it. Resolved by moving STATUSES into constants.js (same fix already
// used for SECTIONS, for a related reason — see that file's header
// comment) — hearings.js now imports it from there too, so both files
// read the exact same list rather than each keeping their own copy. This
// is also, per case-status-derivation.js, the complete set of values a
// Case's derived currentStatus can ever hold (always the latest linked
// Hearing's own status), so it's the correct vocabulary for this filter,
// not a second guess at one.
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { STATUSES } from "./constants.js?v=1.0.0";
import { subscribeToCaseRecords, saveCase, archiveCase } from "./cases-data.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { can, PERMISSIONS } from "./permissions.js?v=1.0.0";
import { escapeHtml as esc } from "./dom-utils.js?v=1.0.0";
import { showNotice } from "./notify.js?v=1.0.0";

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
let searchQuery = "";
let typeFilter = "All";
let statusFilter = "All";
let sortMode = "newest";

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

// --- Search / filter / sort -------------------------------------------
// All three operate on the already-loaded caseRecords[] array in memory
// — no new Firestore query runs per keystroke or dropdown change, same
// approach as hearings.js's own search.

function caseMatchesSearch(c, q) {
  if (!q) return true;
  const query = q.toLowerCase();
  const haystack = [c.caseType, c.caseNo, c.charge, c.currentStatus].join(" ").toLowerCase();
  return haystack.includes(query);
}

// Sortable millisecond value for a Case's createdAt (a Firestore
// Timestamp) — records with no usable createdAt (shouldn't normally
// happen, but a migrated/incomplete record is possible) sort last
// regardless of direction, rather than being treated as oldest or newest.
function createdAtMillis(c) {
  return c.createdAt && typeof c.createdAt.toMillis === "function" ? c.createdAt.toMillis() : null;
}

function sortCases(list) {
  const sorted = [...list];
  switch (sortMode) {
    case "oldest":
      sorted.sort((a, b) => {
        const am = createdAtMillis(a);
        const bm = createdAtMillis(b);
        if (am === null && bm === null) return 0;
        if (am === null) return 1;
        if (bm === null) return -1;
        return am - bm;
      });
      break;
    case "caseNo":
      sorted.sort((a, b) => (a.caseNo || "").localeCompare(b.caseNo || ""));
      break;
    case "status":
      sorted.sort((a, b) => (a.currentStatus || "").localeCompare(b.currentStatus || ""));
      break;
    case "newest":
    default:
      sorted.sort((a, b) => {
        const am = createdAtMillis(a);
        const bm = createdAtMillis(b);
        if (am === null && bm === null) return 0;
        if (am === null) return 1;
        if (bm === null) return -1;
        return bm - am;
      });
      break;
  }
  return sorted;
}

function visibleCases() {
  const filtered = caseRecords
    .filter((c) => typeFilter === "All" || c.caseType === typeFilter)
    .filter((c) => statusFilter === "All" || c.currentStatus === statusFilter)
    .filter((c) => caseMatchesSearch(c, searchQuery));
  return sortCases(filtered);
}

// --- List ------------------------------------------------------------------

function renderList() {
  const tbody = document.getElementById("casesTableBody");
  const visible = visibleCases();

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">${
      caseRecords.length ? "No cases match your search or filter." : 'No cases yet. Click "+ Add Case" to create one.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = visible
    .map((c) => {
      // IM-10: links to the new read-only Case Detail page (Activity &
      // History). Always shown to anyone who can see this list at all —
      // no separate permission, matches cases.view already gating this
      // whole page.
      const viewLink = `<a class="btn-small" href="case-detail.html?id=${encodeURIComponent(c.id)}">View</a>`;
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
            ${viewLink}
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
          <label for="f_caseType">Case type <span class="required">*</span></label>
          <select id="f_caseType">${optionsHtml(CASE_TYPES, c.caseType)}</select>
        </div>
        <div class="field">
          <label for="f_caseNo">Case no. <span class="required">*</span></label>
          <input type="text" id="f_caseNo" value="${esc(c.caseNo)}" placeholder="e.g. 4123">
        </div>
        <div class="field field-full">
          <label for="f_charge">Charge</label>
          <input type="text" id="f_charge" value="${esc(c.charge)}" placeholder="Specific charge for this case">
        </div>
        <div class="field">
          <label for="f_dateFiled">Date filed</label>
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
  // Phase 6: the Archived Cases page now exists (archived.html), so this
  // message no longer needs to warn that the case would be stranded —
  // it points at where to find/restore it instead. archiveCase()
  // (cases-data.js) only ever sets isArchived; the record itself is
  // preserved, not deleted.
  const msg = "Archive this case? It will disappear from this list. The case record is preserved, not deleted, and can be restored from the Archived page.";
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
    showNotice(document.getElementById("pageNotice"), `Could not archive: ${err.message}`);
  }
}

// --- Search / filter / sort wiring --------------------------------------

function populateTypeFilter() {
  const select = document.getElementById("casesTypeFilter");
  select.innerHTML =
    `<option value="All">All</option>` + CASE_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
}

// STATUSES (constants.js) is the same authoritative vocabulary
// hearings.js's own status <select> uses — see this file's header
// comment. A Case with no derived currentStatus yet ("Not yet set" in
// the table) is only reachable via "All statuses" here, same as it
// would be with any other single-value filter — there's no separate
// "unset" option, since that wasn't asked for and STATUSES itself has
// no such value to misrepresent.
function populateStatusFilter() {
  const select = document.getElementById("casesStatusFilter");
  select.innerHTML =
    `<option value="All">All statuses</option>` + STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
}

function wireListControls() {
  document.getElementById("casesSearchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderList();
  });
  document.getElementById("casesTypeFilter").addEventListener("change", (e) => {
    typeFilter = e.target.value;
    renderList();
  });
  document.getElementById("casesStatusFilter").addEventListener("change", (e) => {
    statusFilter = e.target.value;
    renderList();
  });
  document.getElementById("casesSortSelect").addEventListener("change", (e) => {
    sortMode = e.target.value;
    renderList();
  });
}

// --- Init ---------------------------------------------------------------

// ?action=add — opens the existing Add form (openAddForm()). Used by
// Home's "Add Case" quick action, mirroring hearings.js's identical
// ?action=add support for its own "Add Hearing" quick action.
const autoAddAction = new URLSearchParams(window.location.search).get("action") === "add";

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.CASES_VIEW, { redirectTo: "home.html" })) return;

  currentRole = user.role;
  wireNavAuth(user);
  populateTypeFilter();
  populateStatusFilter();
  wireListControls();

  const addCaseBtn = document.getElementById("addCaseBtn");
  if (can(currentRole, PERMISSIONS.CASES_CREATE)) {
    addCaseBtn.addEventListener("click", openAddForm);
  } else {
    addCaseBtn.hidden = true;
  }

  if (autoAddAction) {
    openAddForm(); // no-op if currentRole can't create — see openAddForm()
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState({}, "", url);
  }

  subscribeToCaseRecords(
    (data) => {
      caseRecords = data;
      renderList();
    },
    undefined,
    (err) => {
      showNotice(document.getElementById("pageNotice"), `Could not load cases: ${err.message}`);
    }
  );
}

init();
