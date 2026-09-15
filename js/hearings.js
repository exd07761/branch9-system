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
//
// Edit Selected Case from Hearing form: once a row has an existing Case
// selected, an "Edit Case" button appears alongside "+ Add Case" (gated
// on cases.edit, same as cases.js's own Edit button) — "+ Add Case"
// always remains available regardless of selection. "Edit Case" opens
// the SAME dialog/state as "+ Add Case" (openEditCaseModal() sets
// addCaseModalMode = "edit" instead of a second modal) pre-filled from
// that Case. Save calls saveCase(existingCaseId, caseData) — an update,
// never a new Case — and never touches linkedCaseId on the row or the
// Hearing. See handleSaveCaseModal() below, which now handles both
// modes of this one dialog.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { SECTIONS, STATUSES } from "./constants.js?v=1.0.0";
import { exportHearingOrderToWord, exportCourtCalendarForDate, exportCourtCalendarForWeek, exportCourtCalendarForMonth } from "./docx-export.js?v=1.0.0";
import {
  subscribeToHearings,
  subscribeToCases,
  saveHearing,
  archiveHearing,
  setHearingCaseLink,
} from "./hearings-data.js?v=1.0.0";
import { subscribeToCaseRecords, saveCase } from "./cases-data.js?v=1.0.0";
import { refreshCaseStatusFromHearings } from "./case-status-derivation.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { can, PERMISSIONS } from "./permissions.js?v=1.0.0";
import { escapeHtml as esc, trapTabKey } from "./dom-utils.js?v=1.0.0";
import { showNotice, clearNotice } from "./notify.js?v=1.0.0";

// Fixed option lists, matching how this court branch already categorizes
// hearings and cases. Kept as plain constants — no separate "settings"
// collection, since these lists are stable and small.
//
// STATUSES moved to constants.js (Phase 6 completion pass) — see that
// file's header comment. Imported above alongside SECTIONS instead of
// defined here now; nothing else about how it's used below changed.

// IM-8: CASE_TYPES removed — case rows now link to an existing Case
// (which owns its own caseType) via the picker in caseRowHtml(), rather
// than free-typing a case type here. cases.js still has its own copy for
// the Case entity's own form, which is unaffected by this file.

// Hearing Inline Case Creation: CASE_TYPES is needed again here, but only
// for the "+ Add Case" dialog's own Case-creation fields (below) — the
// case-picker in caseRowHtml() above is untouched and still links to an
// existing Case's own caseType. Byte-identical to cases.js's own
// module-local CASE_TYPES; duplicated rather than shared, matching that
// file's own stated convention of keeping these small option lists
// page-local (see cases.js header comment) instead of a shared constants
// file.
const CASE_TYPES = [
  "FC Criminal Cases No",
  "FC Civil Case No",
  "FC CICL Case No",
  "FC Special Proceeding Case No",
];

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

// --- Hearing Inline Case Creation ("+ Add Case") state -------------------
// Which case row (by index into formCaseRows) the "Add Case" dialog was
// opened from, so a successful save knows which row to link the new Case
// into. Mirrors the Hearing Quick View modal's own state shape (see
// previewHearingId/previewTriggerEl below) — same pattern, separate
// dialog, own mount (#addCaseModalRoot) so it never touches formPanel's
// markup and can never clobber in-progress Hearing form data.
let addCaseModalOpen = false;
let addCaseModalRowIdx = null;
let addCaseModalTriggerEl = null;
let addCaseModalSaving = false;
// Inline Case Edit (Edit Selected Case from Hearing form): the same
// dialog now serves two modes. "add" is the original behavior above;
// "edit" is set by openEditCaseModal() below and carries the existing
// Case's id so handleSaveCaseModal() calls saveCase(existingCaseId, ...)
// instead of saveCase(null, ...). Reset to "add"/null by
// closeAddCaseModal() so a later "+ Add Case" open never inherits a
// stale edit target.
let addCaseModalMode = "add"; // "add" | "edit"
let addCaseModalEditingCaseId = null;
// Persists whatever the Clerk has typed across a re-render (e.g. the
// disabled state while saving, or an error message after a failed save)
// so a mid-save/failed-save re-render never silently blanks the fields —
// renderAddCaseModal() reads from this instead of leaving the inputs
// unbound. Reset fresh each time the dialog opens.
let addCaseFormValues = { caseType: "", caseNo: "", charge: "", dateFiled: "" };

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Preview-panel display string for h.previousSetting, in the same style
// as this file's existing separate "Hearing Date" (fmtDate) / "Hearing
// Time" (shown raw, untransformed) preview lines, just combined into
// one line since previousSetting is one field. "" when nothing is set,
// so previewField() shows its normal "Not set" styling.
function formatPreviousSettingPreview(previousSetting) {
  if (!previousSetting) return "";
  const datePart = previousSetting.date ? fmtDate(previousSetting.date) : "";
  const timePart = previousSetting.time || "";
  if (datePart && timePart) return `${datePart} at ${timePart}`;
  return datePart || timePart;
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

// --- Global search / filter / sort ---------------------------------------
// All operate on the already-loaded `hearings` array in memory — no new
// Firestore query runs per keystroke or dropdown change, same approach as
// cases.js's search/filter/sort. Reuses casesForHearing() (already defined
// above) rather than duplicating any case-lookup logic.

let searchQuery = "";
let sectionFilter = "All";
let statusFilter = "All";
let whenFilter = "All";
let sortMode = "date-asc";

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
    hearing.section,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

// "YYYY-MM-DD" for today, local time — same shape as isoDateStr(d) above,
// just anchored to `new Date()` — used only by the When filter below.
function todayDateStr() {
  return isoDateStr(new Date());
}

function hearingMatchesWhen(hearing) {
  if (whenFilter === "All") return true;
  if (!hearing.hearingDate) return false;
  const today = todayDateStr();
  if (whenFilter === "today") return hearing.hearingDate === today;
  if (whenFilter === "upcoming") return hearing.hearingDate >= today;
  if (whenFilter === "past") return hearing.hearingDate < today;
  return true;
}

// createdAt is a Firestore Timestamp (see hearings-data.js); records with
// no usable createdAt (shouldn't normally happen) sort last regardless of
// direction — same convention as cases.js's createdAtMillis().
function createdAtMillis(h) {
  return h.createdAt && typeof h.createdAt.toMillis === "function" ? h.createdAt.toMillis() : null;
}

function sortHearings(list) {
  const sorted = [...list];
  switch (sortMode) {
    case "date-desc":
      sorted.sort((a, b) => (b.hearingDate || "").localeCompare(a.hearingDate || ""));
      break;
    case "section":
      sorted.sort((a, b) => (a.section || "").localeCompare(b.section || ""));
      break;
    case "status":
      sorted.sort((a, b) => (a.status || "").localeCompare(b.status || ""));
      break;
    case "newest":
      sorted.sort((a, b) => {
        const am = createdAtMillis(a);
        const bm = createdAtMillis(b);
        if (am === null && bm === null) return 0;
        if (am === null) return 1;
        if (bm === null) return -1;
        return bm - am;
      });
      break;
    case "date-asc":
    default:
      sorted.sort((a, b) => (a.hearingDate || "").localeCompare(b.hearingDate || ""));
      break;
  }
  return sorted;
}

// The single combined "what should the list show" function — search,
// filters, and sort all apply together (an active search plus an active
// filter plus a sort produce the expected intersection, not one control
// silently replacing another).
function visibleHearings() {
  const filtered = hearings
    .filter((h) => sectionFilter === "All" || h.section === sectionFilter)
    .filter((h) => statusFilter === "All" || h.status === statusFilter)
    .filter((h) => hearingMatchesWhen(h))
    .filter((h) => hearingMatchesSearch(h, searchQuery));
  return sortHearings(filtered);
}

function hasActiveSearchOrFilter() {
  return Boolean(searchQuery) || sectionFilter !== "All" || statusFilter !== "All" || whenFilter !== "All";
}

function resetSearchAndFilters() {
  searchQuery = "";
  sectionFilter = "All";
  statusFilter = "All";
  whenFilter = "All";
  document.getElementById("hearingsSearchInput").value = "";
  document.getElementById("hearingsSectionFilter").value = "All";
  document.getElementById("hearingsStatusFilter").value = "All";
  document.getElementById("hearingsWhenFilter").value = "All";
  renderList();
}

// --- List rendering ---------------------------------------------------

function renderList() {
  const tbody = document.getElementById("hearingsTableBody");
  const visible = visibleHearings();

  if (!visible.length) {
    const message = hearings.length
      ? "No hearings match your current search/filters."
      : "No hearings have been recorded yet.";
    const resetLink =
      hearings.length && hasActiveSearchOrFilter()
        ? ` <button type="button" class="btn-small" id="resetHearingsFiltersBtn">Reset search &amp; filters</button>`
        : hearings.length
        ? ""
        : can(currentRole, PERMISSIONS.HEARINGS_CREATE)
        ? ' Click "+ Add Hearing" to create one.'
        : "";
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">${message}${resetLink}</td></tr>`;
    const resetBtn = document.getElementById("resetHearingsFiltersBtn");
    if (resetBtn) resetBtn.addEventListener("click", resetSearchAndFilters);
    return;
  }

  tbody.innerHTML = visible
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
// Phase 11: element that had focus right before the dialog opened (the
// clicked/keyboard-activated table row), so closePreview() can return
// focus there instead of leaving it on document.body.
let previewTriggerEl = null;

function previewField(label, value) {
  const v = (value || "").toString().trim();
  return `<div class="preview-field"><span class="preview-field-label">${esc(label)}</span><span class="preview-field-value${v ? "" : " muted"}">${v ? esc(v) : "Not set"}</span></div>`;
}

// Optional companion field (e.g. lawyerForPeople/lawyerForAccused): unlike
// previewField() above, renders nothing at all when empty rather than a
// "Not set" row — these fields are genuinely optional (most hearings are
// handled by a public office with no separate named lawyer to show).
function previewFieldOptional(label, value) {
  const v = (value || "").toString().trim();
  if (!v) return "";
  return `<div class="preview-field"><span class="preview-field-label">${esc(label)}</span><span class="preview-field-value">${esc(v)}</span></div>`;
}

function openPreview(hearingId) {
  previewTriggerEl = document.activeElement;
  previewHearingId = hearingId;
  renderPreview();
}

function closePreview() {
  previewHearingId = null;
  renderPreview();
  if (previewTriggerEl && document.body.contains(previewTriggerEl)) previewTriggerEl.focus();
  previewTriggerEl = null;
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
          ${previewField("Previous Setting", formatPreviousSettingPreview(h.previousSetting))}
          ${previewField("Plaintiff", h.plaintiff)}
          ${previewField("Accused", (h.accused || []).join(", "))}
          ${previewField("Victim(s)", (h.victims || []).join(", "))}
          ${previewField("Detention / Bond Status", h.detentionStatus)}
          ${previewField("Counsel for the People", h.counselForPeople)}
          ${previewFieldOptional("Lawyer", h.lawyerForPeople)}
          ${previewField("Counsel for the Accused", h.counselForAccused)}
          ${previewFieldOptional("Lawyer", h.lawyerForAccused)}
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
  const closeBtn = document.getElementById("previewCloseBtn");
  closeBtn.addEventListener("click", closePreview);
  document.getElementById("previewCloseBtn2").addEventListener("click", closePreview);
  const previewEditBtn = document.getElementById("previewEditBtn");
  if (previewEditBtn) {
    previewEditBtn.addEventListener("click", () => {
      closePreview();
      openEditForm(previewHearingId || h.id);
    });
  }

  // Phase 11: move focus into the dialog on open, and keep Tab from
  // reaching the (visually obscured) page behind the overlay.
  closeBtn.focus();
  const card = document.querySelector("#previewOverlay .preview-card");
  card.addEventListener("keydown", (e) => trapTabKey(card, e));
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (addCaseModalOpen) closeAddCaseModal();
  else if (previewHearingId) closePreview();
});

// --- "+ Add Case" dialog (Hearing Inline Case Creation) --------------------
// Lets the Clerk create a brand-new Case without leaving the Hearing form.
// Deliberately thin: all it does is collect the same fields cases.js's own
// Add Case form collects, then hand them to cases-data.js's saveCase() —
// the exact same function cases.js calls for its own "Save Case" button.
// There is no second definition of how a Case is created anywhere in this
// file; this dialog is just another caller of the one that already exists.
//
// Uses its own mount (#addCaseModalRoot, outside #formPanel) and the same
// .preview-overlay/.preview-card dialog chrome + trapTabKey() focus-trap
// already established by the Hearing Quick View modal above — no new
// modal system, no new CSS framework.

function isDuplicateCaseNo(caseType, caseNo, excludeCaseId) {
  return caseRecords.some((c) => c.id !== excludeCaseId && c.caseType === caseType && c.caseNo === caseNo);
}

function openAddCaseModal(rowIdx) {
  if (!can(currentRole, PERMISSIONS.CASES_CREATE)) return;
  addCaseModalTriggerEl = document.activeElement;
  addCaseModalRowIdx = rowIdx;
  addCaseModalMode = "add";
  addCaseModalEditingCaseId = null;
  addCaseModalOpen = true;
  addCaseModalSaving = false;
  addCaseFormValues = { caseType: CASE_TYPES[0], caseNo: "", charge: "", dateFiled: "" };
  renderAddCaseModal();
}

// Edit Selected Case from Hearing form: opens the SAME dialog as
// openAddCaseModal() above, pre-populated from the row's currently
// linked Case. Requires cases.edit (the existing Case-edit permission —
// see caseRowHtml()'s gating of the "Edit Case" button itself, which is
// the first line of defense; this check is the second, same
// belt-and-suspenders pattern openAddCaseModal() already uses for
// cases.create).
function openEditCaseModal(rowIdx) {
  if (!can(currentRole, PERMISSIONS.CASES_EDIT)) return;
  const row = formCaseRows[rowIdx];
  const linked = row && row.linkedCaseId ? caseRecords.find((c) => c.id === row.linkedCaseId) : null;
  if (!linked) return; // row's Case selection changed/vanished between click and here

  addCaseModalTriggerEl = document.activeElement;
  addCaseModalRowIdx = rowIdx;
  addCaseModalMode = "edit";
  addCaseModalEditingCaseId = linked.id;
  addCaseModalOpen = true;
  addCaseModalSaving = false;
  addCaseFormValues = {
    caseType: linked.caseType || CASE_TYPES[0],
    caseNo: linked.caseNo || "",
    charge: linked.charge || "",
    dateFiled: linked.dateFiled || "",
  };
  renderAddCaseModal();
}

function closeAddCaseModal() {
  addCaseModalOpen = false;
  addCaseModalRowIdx = null;
  addCaseModalMode = "add";
  addCaseModalEditingCaseId = null;
  addCaseModalSaving = false;
  renderAddCaseModal();
  // Phase 11 convention (see closePreview() above): return focus to
  // whatever had it before the dialog opened, if it's still on the page.
  // The row's "+ Add Case" button is re-created on every renderCaseRows()
  // call, so this only holds if the button element itself is still the
  // exact node — falls through to the case-picker focus set by
  // handleSaveCaseModal() on success, or is simply skipped on Cancel where
  // the button node is untouched.
  if (addCaseModalTriggerEl && document.body.contains(addCaseModalTriggerEl)) {
    addCaseModalTriggerEl.focus();
  }
  addCaseModalTriggerEl = null;
}

function renderAddCaseModal(focusFirstField = true) {
  const root = document.getElementById("addCaseModalRoot");
  if (!addCaseModalOpen) {
    root.innerHTML = "";
    return;
  }

  const isEdit = addCaseModalMode === "edit";

  root.innerHTML = `
    <div class="preview-overlay" id="addCaseOverlay">
      <div class="preview-card" role="dialog" aria-modal="true" aria-labelledby="addCaseModalTitle">
        <button type="button" class="preview-close" id="addCaseCloseBtn" aria-label="Close">&times;</button>
        <h2 class="preview-title" id="addCaseModalTitle">${isEdit ? "Edit Case" : "Add Case"}</h2>

        <div class="form-grid form-grid-2">
          <div class="field">
            <label for="ac_caseType">Case type <span class="required">*</span></label>
            <select id="ac_caseType" ${addCaseModalSaving ? "disabled" : ""}>${optionsHtml(CASE_TYPES, addCaseFormValues.caseType)}</select>
          </div>
          <div class="field">
            <label for="ac_caseNo">Case no. <span class="required">*</span></label>
            <input type="text" id="ac_caseNo" value="${esc(addCaseFormValues.caseNo)}" placeholder="e.g. 4123" ${addCaseModalSaving ? "disabled" : ""}>
          </div>
          <div class="field field-full">
            <label for="ac_charge">Charge</label>
            <input type="text" id="ac_charge" value="${esc(addCaseFormValues.charge)}" placeholder="Specific charge for this case" ${addCaseModalSaving ? "disabled" : ""}>
          </div>
          <div class="field">
            <label for="ac_dateFiled">Date filed</label>
            <input type="date" id="ac_dateFiled" value="${addCaseFormValues.dateFiled || ""}" ${addCaseModalSaving ? "disabled" : ""}>
          </div>
        </div>

        <p class="form-error" id="addCaseMessage" role="alert"></p>

        <div class="form-actions">
          <button type="button" class="btn-secondary" id="addCaseCancelBtn" ${addCaseModalSaving ? "disabled" : ""}>Cancel</button>
          <button type="button" class="btn-primary" id="addCaseSaveBtn" ${addCaseModalSaving ? "disabled" : ""}>${
            addCaseModalSaving ? "Saving\u2026" : isEdit ? "Save Changes" : "Save Case"
          }</button>
        </div>
      </div>
    </div>
  `;

  const overlay = document.getElementById("addCaseOverlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !addCaseModalSaving) closeAddCaseModal();
  });
  document.getElementById("addCaseCloseBtn").addEventListener("click", () => {
    if (!addCaseModalSaving) closeAddCaseModal();
  });
  document.getElementById("addCaseCancelBtn").addEventListener("click", () => {
    if (!addCaseModalSaving) closeAddCaseModal();
  });
  document.getElementById("addCaseSaveBtn").addEventListener("click", handleSaveCaseModal);

  const card = document.querySelector("#addCaseOverlay .preview-card");
  card.addEventListener("keydown", (e) => trapTabKey(card, e));
  // Only steal focus on the dialog's initial open — a re-render triggered
  // mid-save (disabling the fields) or after a failed save (showing the
  // error) must not yank focus away from wherever the Clerk left it.
  if (focusFirstField) document.getElementById("ac_caseType").focus();
}

function showAddCaseMessage(text) {
  const el = document.getElementById("addCaseMessage");
  if (el) el.textContent = text || "";
}

// Short label for Activity Log descriptions — same shape as cases.js's
// own caseLabel(), duplicated locally for the same reason CASE_TYPES is
// above (see that constant's comment).
function newCaseLabel(data) {
  return `${data.caseType || ""}. ${data.caseNo || ""}`;
}

// Handles Save for BOTH modes of the shared Add/Edit Case dialog. Reuses
// the exact same saveCase() call, required-field rule, duplicate check,
// and error-recovery shape as the original add-only save handler this
// function replaces — the only branching is: which permission is
// required, whether saveCase() is passed an id, whether the Activity Log
// entry says Create vs. Edit, and how the in-memory caseRecords/row
// state gets updated afterward.
async function handleSaveCaseModal() {
  const isEdit = addCaseModalMode === "edit";
  const requiredPermission = isEdit ? PERMISSIONS.CASES_EDIT : PERMISSIONS.CASES_CREATE;
  if (!can(currentRole, requiredPermission) || addCaseModalRowIdx === null) return;
  if (isEdit && !addCaseModalEditingCaseId) return;

  showAddCaseMessage("");

  const caseData = {
    caseType: document.getElementById("ac_caseType").value,
    caseNo: document.getElementById("ac_caseNo").value.trim(),
    charge: document.getElementById("ac_charge").value.trim(),
    dateFiled: document.getElementById("ac_dateFiled").value,
  };

  // --- Required field validation — identical rule to cases.js's own
  // Add/Edit Case form (only Case no. is required there too).
  if (!caseData.caseNo) {
    showAddCaseMessage("Please fill in: Case no.");
    return;
  }

  // --- Duplicate case number warning — same confirm()-based UX as
  // cases.js's handleSave(), reading the same already-loaded caseRecords
  // this form's own picker already uses, so no extra Firestore read. In
  // edit mode, the Case being edited is excluded from its own duplicate
  // check (same as cases.js's isDuplicateCaseNo(..., editingCaseId)) so
  // saving a Case's other fields unchanged never flags it against
  // itself; every other Case's number is still checked.
  if (isDuplicateCaseNo(caseData.caseType, caseData.caseNo, isEdit ? addCaseModalEditingCaseId : undefined)) {
    const confirmed = confirm(
      `"${caseData.caseType}. ${caseData.caseNo}" already exists on another case. Save anyway?`
    );
    if (!confirmed) return;
  }

  const rowIdx = addCaseModalRowIdx;
  const editingCaseId = addCaseModalEditingCaseId;
  addCaseModalSaving = true;
  addCaseFormValues = caseData;
  renderAddCaseModal(false);

  try {
    // Same saveCase() call the Cases page itself uses: passing an
    // existing id updates that Case in place (merge: true in
    // cases-data.js), never creates a second Case, and never touches
    // this row's linkedCaseId/the Hearing's linkedCaseId — only the
    // Case's own editable fields change.
    const savedCaseId = await saveCase(isEdit ? editingCaseId : null, caseData);

    // Not awaited: logging must never delay closing the dialog or block
    // the UI — identical fire-and-forget convention to every other
    // logActivity() call in this file and in cases.js's own handleSave().
    // Exactly one Activity Log entry per save, same convention as
    // cases.js: Create Case for a new Case, Edit Case for an update.
    logActivity({
      action: isEdit ? "Edit Case" : "Create Case",
      module: "Cases",
      entityId: savedCaseId,
      entityType: "case",
      description: `${isEdit ? "Updated" : "Created"} case ${newCaseLabel(caseData)}`,
    });

    if (isEdit) {
      // Update the in-memory record so the Hearing form (this row's
      // read-only charge/date-filed summary, and the picker's own
      // label) reflects the edit immediately, without waiting on the
      // live subscribeToCaseRecords() listener to catch up. The row's
      // linkedCaseId is untouched — it already points at this same id.
      caseRecords = caseRecords.map((c) => (c.id === savedCaseId ? { ...c, ...caseData, id: savedCaseId } : c));
    } else {
      // Make the new Case available immediately without waiting on the
      // live subscribeToCaseRecords() listener (init(), below) to catch
      // up — it will, and will then overwrite this with the
      // authoritative record, but the picker/selection must not flicker
      // or sit empty in the meantime. Guarded so a listener update that
      // already arrived first doesn't get duplicated.
      if (!caseRecords.some((c) => c.id === savedCaseId)) {
        caseRecords = [...caseRecords, { id: savedCaseId, ...caseData }];
      }

      // Link the new Case into the row that opened this dialog — in-memory
      // only. The Hearing itself may not exist in Firestore yet (Add
      // Hearing), so nothing here writes a hearingCases relationship; the
      // existing Hearing save path (handleSave() above) does that exactly
      // as it already does for any other picker selection, once the
      // Hearing itself is saved. Other rows' linkedCaseId are untouched.
      if (formCaseRows[rowIdx]) {
        formCaseRows[rowIdx].linkedCaseId = savedCaseId;
      }
    }

    addCaseModalOpen = false;
    addCaseModalRowIdx = null;
    addCaseModalMode = "add";
    addCaseModalEditingCaseId = null;
    addCaseModalSaving = false;
    renderAddCaseModal();
    renderCaseRows();

    // Return focus to the row's picker — same target whether this was
    // an Add (landing on the now-selected picker) or an Edit (the
    // picker's option label has just been re-rendered with the updated
    // Case info; the row's own now-recreated "Edit Case" button is a
    // reasonable place too, but the picker is the one element guaranteed
    // present in both modes).
    const picker = document.getElementById(`f_casePicker_${rowIdx}`);
    if (picker) picker.focus();
    addCaseModalTriggerEl = null;
  } catch (err) {
    // Keep the dialog open, keep whatever the Clerk typed, and show the
    // existing Branch9 error style — same recovery shape as cases.js's
    // own handleSave() catch block. The Hearing form behind this dialog
    // is completely untouched by any of this, so nothing there is lost
    // either. No relationship was written/changed (setHearingCaseLink()
    // is never reached from this dialog at all), so there is no partial
    // link to clean up.
    addCaseModalSaving = false;
    renderAddCaseModal(false);
    showAddCaseMessage(`Could not save: ${err.message}`);
  }
}

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
        <label for="f_casePicker_${idx}">Select case <span class="required">*</span></label>
        <div class="case-picker-row">
          <select class="case-picker" id="f_casePicker_${idx}">
            <option value="">-- Select a case --</option>
            ${caseRecords
              .map(
                (c) =>
                  `<option value="${esc(c.id)}" ${c.id === row.linkedCaseId ? "selected" : ""}>${esc(c.caseType)}. ${esc(c.caseNo)}</option>`
              )
              .join("")}
          </select>
          ${linked && can(currentRole, PERMISSIONS.CASES_EDIT) ? `<button type="button" class="btn-small" data-edit-case="${idx}">Edit Case</button>` : ""}
          ${can(currentRole, PERMISSIONS.CASES_CREATE) ? `<button type="button" class="btn-small" data-add-case="${idx}">+ Add Case</button>` : ""}
        </div>
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
  mount.querySelectorAll("[data-add-case]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncCaseRowsFromDom();
      openAddCaseModal(parseInt(btn.dataset.addCase, 10));
    });
  });
  mount.querySelectorAll("[data-edit-case]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncCaseRowsFromDom();
      openEditCaseModal(parseInt(btn.dataset.editCase, 10));
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
          <label for="f_section">Section <span class="required">*</span></label>
          <select id="f_section">${optionsHtml(SECTIONS, h.section)}</select>
        </div>
        <div class="field">
          <label for="f_status">Status <span class="required">*</span></label>
          <select id="f_status">${optionsHtml(STATUSES, h.status)}</select>
        </div>
        <div class="field">
          <label for="f_plaintiff">Plaintiff</label>
          <input type="text" id="f_plaintiff" value="${esc(h.plaintiff || "People of the Philippines")}">
        </div>
        <div class="field">
          <label for="f_accused">Accused <span class="required">*</span></label>
          <input type="text" id="f_accused" value="${esc((h.accused || []).join(", "))}" placeholder="Comma-separated if more than one">
        </div>
        <div class="field">
          <label for="f_victims">Victim(s)</label>
          <input type="text" id="f_victims" value="${esc((h.victims || []).join(", "))}" placeholder="e.g. AAA, BBB">
        </div>
        <div class="field">
          <label for="f_detentionStatus">Detention / bond status</label>
          <input type="text" id="f_detentionStatus" value="${esc(h.detentionStatus)}">
        </div>
        <div class="field">
          <label for="f_counselForPeople">Counsel for the People</label>
          <input type="text" id="f_counselForPeople" value="${esc(h.counselForPeople)}">
        </div>
        <div class="field">
          <label for="f_lawyerForPeople">Lawyer for the People</label>
          <input type="text" id="f_lawyerForPeople" value="${esc(h.lawyerForPeople)}" placeholder="Optional — named lawyer, if any">
        </div>
        <div class="field">
          <label for="f_counselForAccused">Counsel for the Accused</label>
          <input type="text" id="f_counselForAccused" value="${esc(h.counselForAccused)}">
        </div>
        <div class="field">
          <label for="f_lawyerForAccused">Lawyer for the Accused</label>
          <input type="text" id="f_lawyerForAccused" value="${esc(h.lawyerForAccused)}" placeholder="Optional — named lawyer, if any">
        </div>
        <div class="field">
          <label for="f_hearingDate">Hearing date <span class="required">*</span></label>
          <input type="date" id="f_hearingDate" value="${h.hearingDate || ""}">
        </div>
        <div class="field">
          <label for="f_hearingTime">Hearing time</label>
          <select id="f_hearingTime">
            <option value="">Not set</option>
            ${optionsHtml(HEARING_TIMES, h.hearingTime)}
          </select>
        </div>
        <div class="field">
          <label for="f_previousSettingDate">Previous setting date</label>
          <input type="date" id="f_previousSettingDate" value="${(h.previousSetting && h.previousSetting.date) || ""}">
        </div>
        <div class="field">
          <label for="f_previousSettingTime">Previous setting time</label>
          <select id="f_previousSettingTime">
            <option value="">Not set</option>
            ${optionsHtml(HEARING_TIMES, h.previousSetting && h.previousSetting.time)}
          </select>
        </div>
        <div class="field field-full">
          <label for="f_notes">Notes / Remarks</label>
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
  // Defensive only — the overlay/focus-trap already prevent the Hearing
  // form's own Cancel/Save from being reached while the "+ Add Case"
  // dialog is open, so this should be a no-op in normal use.
  if (addCaseModalOpen) closeAddCaseModal();
}

// --- Save / Delete ---------------------------------------------------------

async function handleSave() {
  const requiredPermission = editingHearingId ? PERMISSIONS.HEARINGS_EDIT : PERMISSIONS.HEARINGS_CREATE;
  if (!can(currentRole, requiredPermission)) return;

  syncCaseRowsFromDom();
  showFormMessage("");

  // Previous Setting: Hearing-level, not Case-level (a Case can have
  // multiple Hearings; the previous setting belongs to this particular
  // hearing/setting being recorded — see docx-export.js's
  // buildCaseDetailsParas() for the same rationale on the export side).
  // Stored as one field, an object mirroring the existing hearingDate/
  // hearingTime split (same "YYYY-MM-DD" date-input value, same
  // HEARING_TIMES option strings) so the DOCX export can reuse the exact
  // same date/time formatting helpers already used for hearingTime.
  // Optional: if the Clerk leaves (or clears) both inputs, this saves as
  // null — the established "not set" representation other optional
  // Hearing fields (e.g. detentionStatus's "") already use the empty
  // form of their own type; null here plays that same role for an
  // object-shaped field, and old hearings with no previousSetting field
  // at all read back the same way (undefined and null both fail the
  // truthiness check callers use).
  const previousSettingDate = document.getElementById("f_previousSettingDate").value;
  const previousSettingTime = document.getElementById("f_previousSettingTime").value;
  const previousSetting = previousSettingDate || previousSettingTime ? { date: previousSettingDate, time: previousSettingTime } : null;

  const hearingData = {
    section: document.getElementById("f_section").value,
    status: document.getElementById("f_status").value,
    plaintiff: document.getElementById("f_plaintiff").value.trim(),
    accused: document.getElementById("f_accused").value.split(",").map((s) => s.trim()).filter(Boolean),
    victims: document.getElementById("f_victims").value.split(",").map((s) => s.trim()).filter(Boolean),
    detentionStatus: document.getElementById("f_detentionStatus").value.trim(),
    counselForPeople: document.getElementById("f_counselForPeople").value.trim(),
    lawyerForPeople: document.getElementById("f_lawyerForPeople").value.trim(),
    counselForAccused: document.getElementById("f_counselForAccused").value.trim(),
    lawyerForAccused: document.getElementById("f_lawyerForAccused").value.trim(),
    notes: document.getElementById("f_notes").value.trim(),
    hearingDate: document.getElementById("f_hearingDate").value,
    hearingTime: document.getElementById("f_hearingTime").value,
    previousSetting,
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
    showNotice(document.getElementById("pageNotice"), `Could not archive: ${err.message}`);
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

// Populates the Section/Status filter <select>s from the same shared
// option lists the form itself uses (SECTIONS locally, STATUSES from
// constants.js) — never a second, independently-typed list. Same "All"-
// prefixed shape as cases.js's populateTypeFilter()/populateStatusFilter().
function populateSectionFilter() {
  const select = document.getElementById("hearingsSectionFilter");
  select.innerHTML = `<option value="All">All</option>` + SECTIONS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
}

function populateStatusFilter() {
  const select = document.getElementById("hearingsStatusFilter");
  select.innerHTML = `<option value="All">All statuses</option>` + STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
}

function wireListControls() {
  document.getElementById("hearingsSearchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderList();
  });
  document.getElementById("hearingsSectionFilter").addEventListener("change", (e) => {
    sectionFilter = e.target.value;
    renderList();
  });
  document.getElementById("hearingsStatusFilter").addEventListener("change", (e) => {
    statusFilter = e.target.value;
    renderList();
  });
  document.getElementById("hearingsWhenFilter").addEventListener("change", (e) => {
    whenFilter = e.target.value;
    renderList();
  });
  document.getElementById("hearingsSortSelect").addEventListener("change", (e) => {
    sortMode = e.target.value;
    renderList();
  });
}

// --- Listener error handling ----------------------------------------------
// subscribeToHearings()/subscribeToCases() (hearings-data.js) both accept
// an optional onError callback — see home.js's identical use of the same
// additive-only contract. Wired here so a Firestore listener failure
// (offline, permission-denied, etc.) is shown to the user via the existing
// #pageNotice + notify.js infrastructure, with a Retry action, instead of
// leaving the table stuck on "Loading…" forever.
let unsubscribeHearings = null;
let unsubscribeCases = null;

function renderListenerError(what, retry) {
  return (err) => {
    console.error(`Hearings: ${what} listener failed`, err);
    const noticeHost = document.getElementById("pageNotice");
    showNotice(noticeHost, `Could not load ${what}. Check your connection and try again.`, "error");
    const closeBtn = noticeHost.querySelector(".inline-notice-close");
    if (closeBtn) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "inline-notice-retry";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", retry);
      noticeHost.querySelector(".inline-notice")?.insertBefore(retryBtn, closeBtn);
    }
    const tbody = document.getElementById("hearingsTableBody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Unable to load hearings.</td></tr>`;
  };
}

function startHearingsSubscription() {
  clearNotice(document.getElementById("pageNotice"));
  if (typeof unsubscribeHearings === "function") unsubscribeHearings();
  unsubscribeHearings = subscribeToHearings(
    (data) => {
      hearings = data;
      hearingsLoaded = true;
      renderList();
      maybeAutoOpenFromUrl();
    },
    {},
    renderListenerError("hearings", startHearingsSubscription)
  );
}

function startCasesSubscription() {
  clearNotice(document.getElementById("pageNotice"));
  if (typeof unsubscribeCases === "function") unsubscribeCases();
  unsubscribeCases = subscribeToCases(
    (data) => {
      cases = data;
      casesLoaded = true;
      renderList();
      maybeAutoOpenFromUrl();
    },
    renderListenerError("case numbers", startCasesSubscription)
  );
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

  populateSectionFilter();
  populateStatusFilter();
  wireListControls();

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

  startHearingsSubscription();
  startCasesSubscription();

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
