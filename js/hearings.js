// ---------------------------------------------------------------------------
// Hearings page controller.
//
// Responsibilities: require login, render the live hearings list, open/close
// the add/edit form, manage dynamic case rows within that form (each now
// linked to an existing Case rather than free-typed — see IM-8), validate
// before saving required fields, and wire up delete. All Firestore access
// goes through hearings-data.js/cases-data.js/case-status-derivation.js —
// nothing in this file calls Firestore directly.
//
// IM-8 (Hearing Workflow Refactor, HEARING_WORKFLOW_REFACTOR_PLAN.md,
// approved product decision): the free-text "Hearing type / purpose" field
// is removed from this form for new/edited hearings. The pre-existing
// "Notes" field (already in this file before this milestone, already
// excluded from search/reporting/derivation — verified before this change)
// is the approved replacement for anything hearingType captured that
// status/section didn't; nothing needed to be added for that, since Notes
// already existed and already behaved correctly. Historical hearingType
// values on existing Hearing documents are untouched (Decision 003/005) —
// this only stops the field from being written going forward.
//
// Case rows in this form are now selected from existing Cases (via the
// new Case picker below) rather than free-typed — reusing cases-data.js's
// subscribeToCaseRecords() (IM-1) and hearings-data.js's
// setHearingCaseLink() (IM-6) unchanged. After a successful save, this
// file also calls case-status-derivation.js's refreshCaseStatusFromHearings()
// for each linked Case — the one piece of wiring IM-6B/IM-7A never added
// anywhere in the live app (both shipped with zero callers) — so a Case's
// currentStatus now stays accurate as new hearings are added day to day,
// not only at migration time.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { SECTIONS } from "./constants.js?v=1.0.0";
import { exportHearingOrderToWord, exportCourtCalendarForDate, exportCourtCalendarForWeek, exportCourtCalendarForMonth } from "./docx-export.js?v=1.0.0";
import {
  subscribeToHearings,
  subscribeToCases,
  saveHearing,
  archiveHearing,
  setHearingCaseLink,
} from "./hearings-data.js?v=1.0.0";
import { subscribeToCaseRecords } from "./cases-data.js?v=1.0.0";
import { refreshCaseStatusFromHearings } from "./case-status-derivation.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { can, PERMISSIONS } from "./permissions.js?v=1.0.0";

// Fixed option lists, matching how this court branch already categorizes
// hearings and cases. Kept as plain constants — no separate "settings"
// collection, since these lists are stable and small.

const STATUSES = [
  "Arraignment and Pre-Trial Conference",
  "Pre-Trial Conference",
  "Initial Presentation of Prosecution's Evidence",
  "Continuation of the Direct Examination of Prosecution's Witness",
  "Cross Examination of Prosecution's Witness",
];

// IM-8: CASE_TYPES removed — case rows now link to an existing Case
// (which owns its own caseType) via the picker in caseRowHtml(), rather
// than free-typing a case type here. cases.js still has its own copy for
// the Case entity's own form, which is unaffected by this file.

const HEARING_TIMES = [
  "8:30 in the Morning",
  "11:30 in the Morning",
  "1:30 in the Afternoon",
  "2:00 in the Afternoon",
];

let hearings = [];
let cases = [];
let caseRecords = []; // IM-8: live Cases (cases-data.js), for the Case picker in the form — separate from `cases` above, which is the OLD hearingCases rows array (see this file's header comment on naming)
let editingHearingId = null;
let formCaseRows = [];
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

// "YYYY-MM-DD" for a JS Date — only needed for Activity Log entityId/
// description text on the week/month export logging below, not for any
// rendered UI on this page. Same shape as home.js's todayDateStr().
function isoDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function casesForHearing(hearingId) {
  return cases.filter((c) => c.hearingId === hearingId);
}

function caseSummary(hearingId) {
  const list = casesForHearing(hearingId);
  if (!list.length) return "(no case numbers)";
  return list.map((c) => `${c.caseType || ""}. ${c.caseNo || ""}`).join("; ");
}

// Short "Plaintiff vs. Accused" label for Activity Log descriptions —
// same shape as home.js's caseTitle(), kept local since it's only needed
// here for logging text, not for any rendered UI on this page.
function hearingLabel(data) {
  const plaintiff = data.plaintiff || "People of the Philippines";
  const accused = (data.accused || []).join(", ") || "Not set";
  return `${plaintiff} vs. ${accused}`;
}

// --- Global search -------------------------------------------------------
// Filters the already-loaded `hearings` array in memory — no new
// Firestore query runs per keystroke. Reuses casesForHearing() (already
// defined above) rather than duplicating any case-lookup logic.

let searchQuery = "";

function hearingMatchesSearch(hearing, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const hearingCases = casesForHearing(hearing.id);

  const haystack = [
    hearingCases.map((c) => c.caseNo).join(" "),
    hearingCases.map((c) => c.charge).join(" "),
    hearing.plaintiff,
    (hearing.accused || []).join(" "),
    hearing.hearingDate,
    fmtDate(hearing.hearingDate),
    hearing.status,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

// --- List rendering ---------------------------------------------------

function renderList() {
  const tbody = document.getElementById("hearingsTableBody");
  const visibleHearings = hearings.filter((h) => hearingMatchesSearch(h, searchQuery));

  if (!visibleHearings.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">${
      hearings.length ? "No hearings match your search." : 'No hearings yet. Click "+ Add Hearing" to create one.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = visibleHearings
    .map((h) => {
      const accusedLine = (h.accused || []).join(", ");
      // caseCount is written on every save; fall back to counting live
      // case docs only for older records saved before this field existed.
      const count = typeof h.caseCount === "number" ? h.caseCount : casesForHearing(h.id).length;
      const editBtn = can(currentRole, PERMISSIONS.HEARINGS_EDIT)
        ? `<button type="button" class="btn-small" data-action="edit" data-id="${h.id}">Edit</button>`
        : "";
      // v0.9.3 (Archive & Case Lifecycle Management): the row action here
      // used to be "Delete" (a soft-delete via deleteHearing()). Per that
      // milestone it's replaced with "Archive" — a separate, restorable
      // soft state (see archiveHearing() in hearings-data.js) gated by
      // the ARCHIVE_MANAGE permission (Administrator/Branch Clerk only,
      // same as delete used to be).
      const archiveBtn = can(currentRole, PERMISSIONS.ARCHIVE_MANAGE)
        ? `<button type="button" class="btn-small btn-danger" data-action="archive" data-id="${h.id}">Archive</button>`
        : "";
      return `
        <tr data-hearing-row="${h.id}" tabindex="0" role="button" aria-label="View hearing: ${esc(hearingLabel(h))}">
          <td>${h.hearingDate ? esc(fmtDate(h.hearingDate)) : "<span class=\"muted\">Not set</span>"}</td>
          <td>${esc(h.hearingTime) || '<span class="muted">&mdash;</span>'}</td>
          <td>${esc(h.section)}</td>
          <td>${esc(h.status)}</td>
          <td>${count}</td>
          <td>${esc(caseSummary(h.id))}</td>
          <td>${esc(accusedLine)}</td>
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

  // Row click (or Enter/Space when focused via keyboard) opens the
  // read-only quick-view modal — but not when it originated from the
  // Edit/Archive buttons above, which must keep working exactly as they
  // already do.
  tbody.querySelectorAll("[data-hearing-row]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]")) return;
      openPreview(tr.dataset.hearingRow);
    });
    tr.addEventListener("keydown", (e) => {
      if (e.target.closest("[data-action]")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPreview(tr.dataset.hearingRow);
      }
    });
  });
}

// --- Hearing Quick View (read-only modal) --------------------------------
// Opens on a row click, shows the same already-loaded hearing + case data
// the table/edit form already have in memory — no new Firestore read.
// The only actions inside it are Close and a convenience "Edit" shortcut
// that calls the existing openEditForm() unchanged; nothing here
// duplicates save/delete/validation logic.

let previewHearingId = null;

function previewField(label, value) {
  const v = (value || "").toString().trim();
  return `<div class="preview-field"><span class="preview-field-label">${esc(label)}</span><span class="preview-field-value${v ? "" : " muted"}">${v ? esc(v) : "Not set"}</span></div>`;
}

function openPreview(hearingId) {
  previewHearingId = hearingId;
  renderPreview();
}

function closePreview() {
  previewHearingId = null;
  renderPreview();
}

function renderPreview() {
  const root = document.getElementById("hearingPreviewRoot");
  if (!previewHearingId) {
    root.innerHTML = "";
    return;
  }

  const h = hearings.find((x) => x.id === previewHearingId);
  if (!h) {
    // Hearing disappeared from the loaded list (e.g. deleted in another
    // tab) while the preview was open — just close it rather than show
    // stale/empty data.
    previewHearingId = null;
    root.innerHTML = "";
    return;
  }

  const hearingCasesList = casesForHearing(previewHearingId);

  root.innerHTML = `
    <div class="preview-overlay" id="previewOverlay">
      <div class="preview-card" role="dialog" aria-modal="true" aria-label="Hearing details">
        <button type="button" class="preview-close" id="previewCloseBtn" aria-label="Close">&times;</button>
        <p class="eyebrow">${esc(h.section)}</p>
        <h2 class="preview-title">${esc(h.hearingType) || esc(h.status) || "Hearing"}</h2>

        <div class="preview-grid">
          ${previewField("Status", h.status)}
          ${previewField("Hearing Date", h.hearingDate ? fmtDate(h.hearingDate) : "")}
          ${previewField("Hearing Time", h.hearingTime)}
          ${previewField("Plaintiff", h.plaintiff)}
          ${previewField("Accused", (h.accused || []).join(", "))}
          ${previewField("Victim(s)", (h.victims || []).join(", "))}
          ${previewField("Detention / Bond Status", h.detentionStatus)}
          ${previewField("Counsel for the People", h.counselForPeople)}
          ${previewField("Counsel for the Accused", h.counselForAccused)}
        </div>
        <div class="preview-notes">${previewField("Notes", h.notes)}</div>

        <div class="preview-cases">
          <h3>Cases (${hearingCasesList.length})</h3>
          ${
            hearingCasesList.length
              ? hearingCasesList
                  .map(
                    (c) => `
                <div class="preview-case-item">
                  <p class="preview-case-no">${esc(c.caseType)}. ${esc(c.caseNo)}</p>
                  <p class="preview-case-charge">${esc(c.charge) || "No charge on file"}</p>
                  ${c.dateFiled ? `<p class="preview-case-filed">Filed: ${esc(fmtDate(c.dateFiled))}</p>` : ""}
                </div>
              `
                  )
                  .join("")
              : `<p class="muted">No case numbers attached.</p>`
          }
        </div>

        <div class="preview-actions">
          <button type="button" class="btn-secondary" id="previewCloseBtn2">Close</button>
          ${can(currentRole, PERMISSIONS.HEARINGS_EDIT) ? '<button type="button" class="btn-primary btn-inline" id="previewEditBtn">Edit This Hearing</button>' : ""}
        </div>
      </div>
    </div>
  `;

  const overlay = document.getElementById("previewOverlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePreview();
  });
  document.getElementById("previewCloseBtn").addEventListener("click", closePreview);
  document.getElementById("previewCloseBtn2").addEventListener("click", closePreview);
  const previewEditBtn = document.getElementById("previewEditBtn");
  if (previewEditBtn) {
    previewEditBtn.addEventListener("click", () => {
      closePreview();
      openEditForm(previewHearingId || h.id);
    });
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && previewHearingId) closePreview();
});

// --- Form rendering -----------------------------------------------------

function optionsHtml(list, selected) {
  return list.map((opt) => `<option value="${esc(opt)}" ${opt === selected ? "selected" : ""}>${esc(opt)}</option>`).join("");
}

// IM-8: each row now links to an existing Case (cases-data.js) rather than
// free-typing its identity fields. caseType/caseNo/charge/dateFiled are no
// longer entered here at all — they display read-only, sourced from
// whichever Case is selected, purely for the Clerk's confirmation. Editing
// those fields, if ever needed, is cases.html's job now (Case is the
// master record) — not this form's.
function caseRowHtml(row, idx) {
  const linked = row.linkedCaseId ? caseRecords.find((c) => c.id === row.linkedCaseId) : null;
  return `
    <div class="case-row" data-idx="${idx}">
      <div class="case-row-header">
        <span class="case-row-label">Case ${idx + 1}</span>
        <button type="button" class="btn-small btn-danger" data-remove-case="${idx}">Remove</button>
      </div>
      <div class="field">
        <label>Select case <span class="required">*</span></label>
        <select class="case-picker">
          <option value="">-- Select a case --</option>
          ${caseRecords
            .map(
              (c) =>
                `<option value="${esc(c.id)}" ${c.id === row.linkedCaseId ? "selected" : ""}>${esc(c.caseType)}. ${esc(c.caseNo)}</option>`
            )
            .join("")}
        </select>
      </div>
      ${
        linked
          ? `<p class="muted">${esc(linked.charge) || "No charge on file"} &middot; Filed: ${linked.dateFiled ? esc(linked.dateFiled) : "not set"}</p>`
          : `<p class="muted">No case selected yet. Not in the list? Create it first via Cases, then come back to link it here.</p>`
      }
    </div>
  `;
}

function syncCaseRowsFromDom() {
  document.querySelectorAll(".case-row").forEach((rowEl) => {
    const idx = parseInt(rowEl.dataset.idx, 10);
    if (!formCaseRows[idx]) return;
    formCaseRows[idx].linkedCaseId = rowEl.querySelector(".case-picker").value || null;
  });
}

function renderCaseRows() {
  const mount = document.getElementById("caseRowsMount");
  mount.innerHTML = formCaseRows.map((row, idx) => caseRowHtml(row, idx)).join("");
  mount.querySelectorAll("[data-remove-case]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncCaseRowsFromDom();
      if (formCaseRows.length <= 1) {
        showFormMessage("A hearing needs at least one case number.");
        return;
      }
      formCaseRows.splice(parseInt(btn.dataset.removeCase, 10), 1);
      renderCaseRows();
    });
  });
  mount.querySelectorAll(".case-row").forEach((rowEl) => {
    rowEl.querySelector(".case-picker").addEventListener("change", () => {
      syncCaseRowsFromDom();
      renderCaseRows();
    });
  });
}

function showFormMessage(text) {
  const el = document.getElementById("formMessage");
  if (el) el.textContent = text || "";
}

function renderForm() {
  const panel = document.getElementById("formPanel");

  if (!formOpen) {
    panel.innerHTML = "";
    return;
  }

  const h = editingHearingId ? hearings.find((x) => x.id === editingHearingId) : {};

  panel.innerHTML = `
    <section class="card form-card">
      <h2>${editingHearingId ? "Edit Hearing" : "Add Hearing"}</h2>

      <div class="form-grid form-grid-2">
        <div class="field">
          <label>Section <span class="required">*</span></label>
          <select id="f_section">${optionsHtml(SECTIONS, h.section)}</select>
        </div>
        <div class="field">
          <label>Status <span class="required">*</span></label>
          <select id="f_status">${optionsHtml(STATUSES, h.status)}</select>
        </div>
        <div class="field">
          <label>Plaintiff</label>
          <input type="text" id="f_plaintiff" value="${esc(h.plaintiff || "People of the Philippines")}">
        </div>
        <div class="field">
          <label>Accused <span class="required">*</span></label>
          <input type="text" id="f_accused" value="${esc((h.accused || []).join(", "))}" placeholder="Comma-separated if more than one">
        </div>
        <div class="field">
          <label>Victim(s)</label>
          <input type="text" id="f_victims" value="${esc((h.victims || []).join(", "))}" placeholder="e.g. AAA, BBB">
        </div>
        <div class="field">
          <label>Detention / bond status</label>
          <input type="text" id="f_detentionStatus" value="${esc(h.detentionStatus)}">
        </div>
        <div class="field">
          <label>Counsel for the People</label>
          <input type="text" id="f_counselForPeople" value="${esc(h.counselForPeople)}">
        </div>
        <div class="field">
          <label>Counsel for the Accused</label>
          <input type="text" id="f_counselForAccused" value="${esc(h.counselForAccused)}">
        </div>
        <div class="field">
          <label>Hearing date <span class="required">*</span></label>
          <input type="date" id="f_hearingDate" value="${h.hearingDate || ""}">
        </div>
        <div class="field">
          <label>Hearing time</label>
          <select id="f_hearingTime">
            <option value="">Not set</option>
            ${optionsHtml(HEARING_TIMES, h.hearingTime)}
          </select>
        </div>
        <div class="field field-full">
          <label>Notes / Remarks</label>
          <textarea id="f_notes" placeholder="Optional — for human reference only; not used in status, reports, or search">${esc(h.notes)}</textarea>
        </div>
      </div>

      <div class="case-rows-section">
        <h3>Cases in this hearing <span class="required">*</span></h3>
        <div id="caseRowsMount"></div>
        <button type="button" class="btn-small" id="addCaseRowBtn">+ Link another case</button>
      </div>

      <p class="form-error" id="formMessage" role="alert"></p>

      <div class="form-actions">
        ${editingHearingId && can(currentRole, PERMISSIONS.EXPORT) ? `<button type="button" class="btn-secondary" id="exportWordBtn"><i data-lucide="file-down" aria-hidden="true"></i><span>Export to Word</span></button>` : ""}
        <button type="button" class="btn-secondary" id="cancelFormBtn">Cancel</button>
        <button type="button" class="btn-primary" id="saveFormBtn">Save Hearing</button>
      </div>
    </section>
  `;

  renderCaseRows();

  if (window.lucide) lucide.createIcons();

  if (editingHearingId && can(currentRole, PERMISSIONS.EXPORT)) {
    document.getElementById("exportWordBtn").addEventListener("click", handleExportWord);
  }

  document.getElementById("addCaseRowBtn").addEventListener("click", () => {
    syncCaseRowsFromDom();
    formCaseRows.push({ hearingCaseRowId: null, linkedCaseId: null });
    renderCaseRows();
  });

  document.getElementById("cancelFormBtn").addEventListener("click", closeForm);
  document.getElementById("saveFormBtn").addEventListener("click", handleSave);
}

// --- Form open/close -----------------------------------------------------

function openAddForm() {
  if (!can(currentRole, PERMISSIONS.HEARINGS_CREATE)) return;
  editingHearingId = null;
  formCaseRows = [{ hearingCaseRowId: null, linkedCaseId: null }];
  formOpen = true;
  renderForm();
  document.getElementById("formPanel").scrollIntoView({ behavior: "smooth" });
}

function openEditForm(hearingId) {
  if (!can(currentRole, PERMISSIONS.HEARINGS_EDIT)) return;
  const existing = casesForHearing(hearingId);
  editingHearingId = hearingId;
  // hearingCaseRowId = this hearingCases row's own document id (pre-v1.1
  // bookkeeping, so save() knows which row to update vs. create).
  // linkedCaseId = the row's real IM-6 `caseId` field — the actual Case
  // this row is linked to. Previously these were both called `caseId`,
  // which meant two unrelated things in this file (see the header
  // comment) — renamed here as part of IM-8, no behavior change.
  formCaseRows = existing.length
    ? existing.map((c) => ({ hearingCaseRowId: c.id, linkedCaseId: c.caseId || null }))
    : [{ hearingCaseRowId: null, linkedCaseId: null }];
  formOpen = true;
  renderForm();
  document.getElementById("formPanel").scrollIntoView({ behavior: "smooth" });
}

function closeForm() {
  formOpen = false;
  editingHearingId = null;
  formCaseRows = [];
  renderForm();
}

// --- Save / Delete ---------------------------------------------------------

async function handleSave() {
  const requiredPermission = editingHearingId ? PERMISSIONS.HEARINGS_EDIT : PERMISSIONS.HEARINGS_CREATE;
  if (!can(currentRole, requiredPermission)) return;

  syncCaseRowsFromDom();
  showFormMessage("");

  const hearingData = {
    section: document.getElementById("f_section").value,
    status: document.getElementById("f_status").value,
    plaintiff: document.getElementById("f_plaintiff").value.trim(),
    accused: document.getElementById("f_accused").value.split(",").map((s) => s.trim()).filter(Boolean),
    victims: document.getElementById("f_victims").value.split(",").map((s) => s.trim()).filter(Boolean),
    detentionStatus: document.getElementById("f_detentionStatus").value.trim(),
    counselForPeople: document.getElementById("f_counselForPeople").value.trim(),
    counselForAccused: document.getElementById("f_counselForAccused").value.trim(),
    notes: document.getElementById("f_notes").value.trim(),
    hearingDate: document.getElementById("f_hearingDate").value,
    hearingTime: document.getElementById("f_hearingTime").value,
  };

  // --- Required field validation ---
  // IM-8: "Hearing type / purpose" removed entirely (approved product
  // decision — see HEARING_WORKFLOW_REFACTOR_PLAN.md). A row now counts
  // as valid if a Case has actually been selected in its picker, not by
  // a free-typed case number (that field no longer exists here).
  const missing = [];
  if (!hearingData.accused.length) missing.push("Accused");
  if (!hearingData.hearingDate) missing.push("Hearing date");
  const validCaseRows = formCaseRows.filter((r) => r.linkedCaseId);
  if (!validCaseRows.length) missing.push("At least one linked case");

  if (missing.length) {
    showFormMessage(`Please fill in: ${missing.join(", ")}.`);
    return;
  }

  // IM-8: the old free-text duplicate-case-number check is removed —
  // it existed to catch typos creating look-alike case numbers, a
  // problem the Case picker prevents structurally (you're linking to
  // one canonical, already-existing Case, never typing a number that
  // might coincidentally collide with another).

  // Denormalize each linked Case's identity fields onto its row, same
  // fields hearingCases rows have always carried (reports/exports/
  // search all read caseType/caseNo/charge/dateFiled directly off the
  // row — see HEARING_WORKFLOW_REFACTOR_PLAN.md §7) — just sourced from
  // the selected Case now instead of free-typed. hearingCaseRowId (not
  // linkedCaseId) is what saveHearing() uses to know which row to
  // update vs. create; linkedCaseId is used afterward, below, to call
  // setHearingCaseLink() — saveHearing() itself never touches the link.
  const caseRowsForSave = validCaseRows.map((r) => {
    const linked = caseRecords.find((c) => c.id === r.linkedCaseId);
    return {
      hearingCaseRowId: r.hearingCaseRowId,
      caseType: linked ? linked.caseType : "",
      caseNo: linked ? linked.caseNo : "",
      charge: linked ? linked.charge : "",
      dateFiled: linked ? linked.dateFiled : "",
    };
  });

  const saveBtn = document.getElementById("saveFormBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving\u2026";

  try {
    const isNew = !editingHearingId;
    const existingRowIds = editingHearingId
      ? casesForHearing(editingHearingId).map((c) => c.id)
      : [];
    const { hearingId: savedHearingId, rowIds } = await saveHearing(editingHearingId, hearingData, caseRowsForSave, existingRowIds);

    // Link each row to its selected Case (setHearingCaseLink() does its
    // own referential-integrity check — see hearings-data.js/IM-6) and
    // then refresh each linked Case's derived currentStatus (IM-6B) —
    // the one piece of wiring that never existed anywhere in the live
    // app until this milestone (IM-6B and IM-7A both only ever called
    // it from an offline tool, not from the Clerk-facing workflow).
    const linkedCaseIds = new Set();
    for (let i = 0; i < validCaseRows.length; i++) {
      const rowId = rowIds[i];
      const linkedCaseId = validCaseRows[i].linkedCaseId;
      if (rowId && linkedCaseId) {
        await setHearingCaseLink(rowId, linkedCaseId);
        linkedCaseIds.add(linkedCaseId);
      }
    }
    for (const caseId of linkedCaseIds) {
      await refreshCaseStatusFromHearings(caseId);
    }

    // Not awaited: logging must never delay closeForm() or block the UI.
    logActivity({
      action: isNew ? "Create Hearing" : "Edit Hearing",
      module: "Hearings",
      entityId: savedHearingId,
      entityType: "hearing",
      description: `${isNew ? "Created" : "Updated"} hearing for ${hearingLabel(hearingData)} on ${hearingData.hearingDate}`,
    });
    closeForm();
  } catch (err) {
    showFormMessage(`Could not save: ${err.message}`);
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Hearing";
  }
}

async function handleExportWord() {
  if (!can(currentRole, PERMISSIONS.EXPORT)) return;
  if (!window.docx) {
    showFormMessage("Could not export: the Word export library failed to load. Check your internet connection and try again.");
    return;
  }

  // Reuses data already loaded in this page's own state (hearings/cases,
  // populated by the existing subscribeToHearings/subscribeToCases
  // listeners) — no new Firestore read happens for this export.
  const hearing = hearings.find((h) => h.id === editingHearingId);
  if (!hearing) return;
  const hearingCasesList = casesForHearing(editingHearingId);

  const exportBtn = document.getElementById("exportWordBtn");
  const originalLabel = exportBtn.innerHTML;
  exportBtn.disabled = true;
  exportBtn.textContent = "Exporting\u2026";

  try {
    await exportHearingOrderToWord(hearing, hearingCasesList);
    logActivity({
      action: "Export Hearing Order",
      module: "Hearings",
      entityId: hearing.id,
      entityType: "hearing",
      description: `Exported hearing order for ${hearingLabel(hearing)} on ${hearing.hearingDate}`,
    });
  } catch (err) {
    showFormMessage(`Could not export: ${err.message}`);
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = originalLabel;
    if (window.lucide) lucide.createIcons();
  }
}

// --- Page-level Court Calendar export modes ---------------------------
// All three reuse the same already-loaded `hearings`/`cases` state as
// handleExportWord above — no new Firestore reads for any of them — and
// all three call into the exact same shared document builder in
// docx-export.js that handleExportWord uses.

function closeExportDropdown() {
  const menu = document.getElementById("exportDropdownMenu");
  const toggle = document.getElementById("exportDropdownToggle");
  menu.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
}

function wireExportDropdown() {
  const toggle = document.getElementById("exportDropdownToggle");
  const menu = document.getElementById("exportDropdownMenu");
  const dropdown = document.getElementById("exportDropdown");

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !menu.hidden;
    menu.hidden = isOpen;
    toggle.setAttribute("aria-expanded", String(!isOpen));
  });

  // Close when clicking anywhere outside the dropdown.
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !dropdown.contains(e.target)) closeExportDropdown();
  });

  // Close on Escape.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) closeExportDropdown();
  });

  // Clicking inside the menu (date row aside) shouldn't bubble to the
  // document listener and immediately close the menu on the same click.
  menu.addEventListener("click", (e) => e.stopPropagation());
}

function setToolbarExportStatus(text) {
  const el = document.getElementById("toolbarExportStatus");
  if (el) el.textContent = text || "";
}

async function withExportButton(buttonId, task, onSuccess) {
  if (!can(currentRole, PERMISSIONS.EXPORT)) return;
  if (!window.docx) {
    setToolbarExportStatus("Could not export: the Word export library failed to load. Check your internet connection and try again.");
    return;
  }
  const btn = document.getElementById(buttonId);
  // Captured/restored via innerHTML, not textContent — this button has an
  // icon child element, and textContent would silently strip it on the
  // first click (textContent only sees text nodes, not the <i> element).
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Exporting\u2026";
  setToolbarExportStatus("");
  try {
    await task();
    // Not awaited: logging must never delay closing the dropdown or
    // block the UI. Only called on success, same as the pattern below.
    if (onSuccess) logActivity(onSuccess());
    closeExportDropdown();
  } catch (err) {
    setToolbarExportStatus(`Could not export: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

async function handleExportSelectedDate() {
  const dateStr = document.getElementById("exportDateInput").value;
  if (!dateStr) {
    setToolbarExportStatus("Pick a date first.");
    return;
  }
  await withExportButton(
    "exportDateBtn",
    () => exportCourtCalendarForDate(hearings, cases, dateStr),
    () => ({
      action: "Export Selected Date's Calendar",
      module: "Hearings",
      entityId: dateStr,
      entityType: "calendarExport",
      description: `Exported calendar for ${dateStr}`,
    })
  );
}

async function handleExportCurrentWeek() {
  const anchorDate = new Date();
  await withExportButton(
    "exportWeekBtn",
    () => exportCourtCalendarForWeek(hearings, cases, anchorDate),
    () => ({
      action: "Export Weekly Calendar",
      module: "Hearings",
      entityId: isoDateStr(anchorDate),
      entityType: "calendarExport",
      description: `Exported calendar for the week of ${isoDateStr(anchorDate)}`,
    })
  );
}

async function handleExportCurrentMonth() {
  const anchorDate = new Date();
  await withExportButton(
    "exportMonthBtn",
    () => exportCourtCalendarForMonth(hearings, cases, anchorDate),
    () => ({
      action: "Export Monthly Calendar",
      module: "Hearings",
      entityId: isoDateStr(anchorDate),
      entityType: "calendarExport",
      description: `Exported calendar for the month of ${anchorDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    })
  );
}

// v0.9.3 (Archive & Case Lifecycle Management): replaces the previous
// handleDelete() row action. Archive is a soft state change only — see
// archiveHearing() in hearings-data.js — never a delete.
async function handleArchive(hearingId) {
  if (!can(currentRole, PERMISSIONS.ARCHIVE_MANAGE)) return;
  const msg = "Archive this hearing? It will disappear from active operations but remain available in Archived Hearings. This action can be restored later.";
  if (!confirm(msg)) return;

  // Captured before the archive resolves — hearings[] won't have this
  // hearing removed from it until the live listener's next update.
  const hearing = hearings.find((h) => h.id === hearingId);

  try {
    await archiveHearing(hearingId);
    // Not awaited: logging must never block the UI.
    logActivity({
      action: "Archived Hearing",
      module: "Hearings",
      entityId: hearingId,
      entityType: "hearing",
      description: hearing ? `Archived hearing for ${hearingLabel(hearing)} on ${hearing.hearingDate}` : `Archived hearing ${hearingId}`,
    });
  } catch (err) {
    alert(`Could not archive: ${err.message}`);
  }
}

// --- Init ---------------------------------------------------------------

// Supports Calendar linking directly to a hearing's edit form via
// hearings.html?openHearing=<id>. This does NOT duplicate any form,
// validation, save, or delete logic — it just calls the same
// openEditForm() the "Edit" button already uses, once both live
// collections have loaded at least once so the form has real data to
// show. Calendar itself never touches Firestore writes at all.
//
// v0.8.0 adds two siblings, both reusing existing functions unchanged:
//   ?previewHearing=<id> — opens the existing Quick View/Lightbox modal
//     (openPreview(), from v0.7.1) instead of the edit form. Used by the
//     new Home dashboard's Timeline and Current/Next Session cards.
//     Deliberately a separate param from ?openHearing so Calendar's own
//     linking behavior is untouched.
//   ?action=add — opens the existing Add form (openAddForm()). Used by
//     Home's new "Add Hearing" quick action.
const urlParams = new URLSearchParams(window.location.search);
let autoOpenId = urlParams.get("openHearing");
let autoPreviewId = urlParams.get("previewHearing");
let autoAddAction = urlParams.get("action") === "add";
let hearingsLoaded = false;
let casesLoaded = false;

function maybeAutoOpenFromUrl() {
  if (!hearingsLoaded || !casesLoaded) return;

  if (autoOpenId) {
    const targetId = autoOpenId;
    autoOpenId = null; // only ever attempt this once per page load
    if (hearings.find((h) => h.id === targetId)) {
      // Calendar's "Details" link always points at ?openHearing= (see the
      // comment above), which has always meant "open the edit form." A
      // role without edit permission gets the read-only Quick View
      // instead, rather than the link silently doing nothing — Calendar
      // itself stays completely unchanged for this.
      if (can(currentRole, PERMISSIONS.HEARINGS_EDIT)) openEditForm(targetId);
      else openPreview(targetId);
    }
  }

  if (autoPreviewId) {
    const targetId = autoPreviewId;
    autoPreviewId = null; // only ever attempt this once per page load
    if (hearings.find((h) => h.id === targetId)) openPreview(targetId);
  }

  // Tidy the URL so refreshing the page doesn't re-trigger the auto-open.
  const url = new URL(window.location.href);
  url.searchParams.delete("openHearing");
  url.searchParams.delete("previewHearing");
  window.history.replaceState({}, "", url);
}

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;

  currentRole = user.role;
  wireNavAuth(user);

  const addHearingBtn = document.getElementById("addHearingBtn");
  if (can(currentRole, PERMISSIONS.HEARINGS_CREATE)) {
    addHearingBtn.addEventListener("click", openAddForm);
  } else {
    addHearingBtn.hidden = true;
  }

  if (autoAddAction) {
    autoAddAction = false;
    openAddForm(); // no-op if currentRole can't create — see openAddForm()
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState({}, "", url);
  }

  document.getElementById("hearingsSearchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderList();
  });

  // Export Calendar dropdown: Encoder and Read Only don't have export
  // permission (see permissions.js) — hidden entirely rather than left
  // clickable and silently doing nothing.
  if (can(currentRole, PERMISSIONS.EXPORT)) {
    document.getElementById("exportDateBtn").addEventListener("click", handleExportSelectedDate);
    document.getElementById("exportWeekBtn").addEventListener("click", handleExportCurrentWeek);
    document.getElementById("exportMonthBtn").addEventListener("click", handleExportCurrentMonth);
    wireExportDropdown();
  } else {
    document.getElementById("exportDropdown").hidden = true;
  }

  subscribeToHearings((data) => {
    hearings = data;
    hearingsLoaded = true;
    renderList();
    maybeAutoOpenFromUrl();
  });

  subscribeToCases((data) => {
    cases = data;
    casesLoaded = true;
    renderList();
    maybeAutoOpenFromUrl();
  });

  // IM-8: powers the Case picker in the add/edit form (caseRowHtml()).
  // Not gated into hearingsLoaded/casesLoaded/maybeAutoOpenFromUrl — the
  // picker simply shows "-- Select a case --" with no options until this
  // first fires, same as any other not-yet-loaded list in this app.
  subscribeToCaseRecords((data) => {
    caseRecords = data;
    if (formOpen) renderCaseRows();
  });
}

init();
