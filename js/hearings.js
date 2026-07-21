// ---------------------------------------------------------------------------
// Hearings page controller.
//
// Responsibilities: require login, render the live hearings list, open/close
// the add/edit form, manage dynamic case-number rows within that form,
// validate before saving (required fields + duplicate case number), and
// wire up delete. All Firestore access goes through hearings-data.js —
// nothing in this file calls Firestore directly.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js";
import { wireNavAuth } from "./nav-auth.js";
import { SECTIONS } from "./constants.js";
import { exportHearingOrderToWord, exportCourtCalendarForDate, exportCourtCalendarForWeek, exportCourtCalendarForMonth } from "./docx-export.js";
import {
  subscribeToHearings,
  subscribeToCases,
  saveHearing,
  deleteHearing,
  isDuplicateCaseNumber,
} from "./hearings-data.js";

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
let editingHearingId = null;
let formCaseRows = [];
let formOpen = false;

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function casesForHearing(hearingId) {
  return cases.filter((c) => c.hearingId === hearingId);
}

function caseSummary(hearingId) {
  const list = casesForHearing(hearingId);
  if (!list.length) return "(no case numbers)";
  return list.map((c) => `${c.caseType || ""}. ${c.caseNo || ""}`).join("; ");
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
      return `
        <tr data-hearing-row="${h.id}">
          <td>${h.hearingDate ? esc(fmtDate(h.hearingDate)) : "<span class=\"muted\">Not set</span>"}</td>
          <td>${esc(h.hearingTime) || '<span class="muted">&mdash;</span>'}</td>
          <td>${esc(h.section)}</td>
          <td>${esc(h.status)}</td>
          <td>${count}</td>
          <td>${esc(caseSummary(h.id))}</td>
          <td>${esc(accusedLine)}</td>
          <td class="row-actions">
            <button type="button" class="btn-small" data-action="edit" data-id="${h.id}">Edit</button>
            <button type="button" class="btn-small btn-danger" data-action="delete" data-id="${h.id}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => openEditForm(btn.dataset.id));
  });
  tbody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.id));
  });

  // Row click opens the read-only quick-view modal — but not when the
  // click originated from the Edit/Delete buttons above, which must keep
  // working exactly as they already do.
  tbody.querySelectorAll("[data-hearing-row]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]")) return;
      openPreview(tr.dataset.hearingRow);
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
      <div class="preview-card">
        <button type="button" class="preview-close" id="previewCloseBtn" aria-label="Close">&times;</button>
        <p class="eyebrow">${esc(h.section)}</p>
        <h2 class="preview-title">${esc(h.hearingType) || "Hearing"}</h2>

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
          <button type="button" class="btn-primary btn-inline" id="previewEditBtn">Edit This Hearing</button>
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
  document.getElementById("previewEditBtn").addEventListener("click", () => {
    closePreview();
    openEditForm(previewHearingId || h.id);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && previewHearingId) closePreview();
});

// --- Form rendering -----------------------------------------------------

function optionsHtml(list, selected) {
  return list.map((opt) => `<option value="${esc(opt)}" ${opt === selected ? "selected" : ""}>${esc(opt)}</option>`).join("");
}

function caseRowHtml(row, idx) {
  return `
    <div class="case-row" data-idx="${idx}">
      <div class="case-row-header">
        <span class="case-row-label">Case ${idx + 1}</span>
        <button type="button" class="btn-small btn-danger" data-remove-case="${idx}">Remove</button>
      </div>
      <div class="form-grid form-grid-3">
        <div class="field">
          <label>Case type</label>
          <select class="case-caseType">${optionsHtml(CASE_TYPES, row.caseType)}</select>
        </div>
        <div class="field">
          <label>Case no.</label>
          <input type="text" class="case-caseNo" value="${esc(row.caseNo)}" placeholder="e.g. 4123">
        </div>
        <div class="field">
          <label>Date filed</label>
          <input type="date" class="case-dateFiled" value="${row.dateFiled || ""}">
        </div>
      </div>
      <div class="field">
        <label>Charge</label>
        <input type="text" class="case-charge" value="${esc(row.charge)}" placeholder="Specific charge for this case number">
      </div>
    </div>
  `;
}

function syncCaseRowsFromDom() {
  document.querySelectorAll(".case-row").forEach((rowEl) => {
    const idx = parseInt(rowEl.dataset.idx, 10);
    if (!formCaseRows[idx]) return;
    formCaseRows[idx].caseType = rowEl.querySelector(".case-caseType").value;
    formCaseRows[idx].caseNo = rowEl.querySelector(".case-caseNo").value.trim();
    formCaseRows[idx].charge = rowEl.querySelector(".case-charge").value.trim();
    formCaseRows[idx].dateFiled = rowEl.querySelector(".case-dateFiled").value;
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
        <div class="field field-full">
          <label>Hearing type / purpose <span class="required">*</span></label>
          <input type="text" id="f_hearingType" value="${esc(h.hearingType)}" placeholder="e.g. Cross Examination of Prosecution's Witness AAA">
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
          <label>Notes</label>
          <textarea id="f_notes">${esc(h.notes)}</textarea>
        </div>
      </div>

      <div class="case-rows-section">
        <h3>Cases in this hearing <span class="required">*</span></h3>
        <div id="caseRowsMount"></div>
        <button type="button" class="btn-small" id="addCaseRowBtn">+ Add another case number</button>
      </div>

      <p class="form-error" id="formMessage" role="alert"></p>

      <div class="form-actions">
        ${editingHearingId ? `<button type="button" class="btn-secondary" id="exportWordBtn"><i data-lucide="file-down" aria-hidden="true"></i><span>Export to Word</span></button>` : ""}
        <button type="button" class="btn-secondary" id="cancelFormBtn">Cancel</button>
        <button type="button" class="btn-primary" id="saveFormBtn">Save Hearing</button>
      </div>
    </section>
  `;

  renderCaseRows();

  if (window.lucide) lucide.createIcons();

  if (editingHearingId) {
    document.getElementById("exportWordBtn").addEventListener("click", handleExportWord);
  }

  document.getElementById("addCaseRowBtn").addEventListener("click", () => {
    syncCaseRowsFromDom();
    formCaseRows.push({ caseId: null, caseType: CASE_TYPES[0], caseNo: "", charge: "", dateFiled: "" });
    renderCaseRows();
  });

  document.getElementById("cancelFormBtn").addEventListener("click", closeForm);
  document.getElementById("saveFormBtn").addEventListener("click", handleSave);
}

// --- Form open/close -----------------------------------------------------

function openAddForm() {
  editingHearingId = null;
  formCaseRows = [{ caseId: null, caseType: CASE_TYPES[0], caseNo: "", charge: "", dateFiled: "" }];
  formOpen = true;
  renderForm();
  document.getElementById("formPanel").scrollIntoView({ behavior: "smooth" });
}

function openEditForm(hearingId) {
  const existing = casesForHearing(hearingId);
  editingHearingId = hearingId;
  formCaseRows = existing.length
    ? existing.map((c) => ({ caseId: c.id, caseType: c.caseType || CASE_TYPES[0], caseNo: c.caseNo || "", charge: c.charge || "", dateFiled: c.dateFiled || "" }))
    : [{ caseId: null, caseType: CASE_TYPES[0], caseNo: "", charge: "", dateFiled: "" }];
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
  syncCaseRowsFromDom();
  showFormMessage("");

  const hearingData = {
    section: document.getElementById("f_section").value,
    status: document.getElementById("f_status").value,
    hearingType: document.getElementById("f_hearingType").value.trim(),
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
  const missing = [];
  if (!hearingData.hearingType) missing.push("Hearing type / purpose");
  if (!hearingData.accused.length) missing.push("Accused");
  if (!hearingData.hearingDate) missing.push("Hearing date");
  const validCaseRows = formCaseRows.filter((r) => r.caseNo);
  if (!validCaseRows.length) missing.push("At least one case number");

  if (missing.length) {
    showFormMessage(`Please fill in: ${missing.join(", ")}.`);
    return;
  }

  // --- Duplicate case number warning ---
  // hearings[] only ever contains non-deleted hearings (subscribeToHearings
  // filters isDeleted out), so this Set naturally excludes soft-deleted
  // hearings' case numbers from the duplicate check.
  const activeHearingIds = new Set(hearings.map((h) => h.id));
  for (const row of validCaseRows) {
    if (isDuplicateCaseNumber(cases, row.caseType, row.caseNo, editingHearingId, activeHearingIds)) {
      const confirmed = confirm(
        `"${row.caseType}. ${row.caseNo}" already exists on another hearing. Save anyway?`
      );
      if (!confirmed) return;
    }
  }

  const saveBtn = document.getElementById("saveFormBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving\u2026";

  try {
    const existingCaseIds = editingHearingId
      ? casesForHearing(editingHearingId).map((c) => c.id)
      : [];
    await saveHearing(editingHearingId, hearingData, validCaseRows, existingCaseIds);
    closeForm();
  } catch (err) {
    showFormMessage(`Could not save: ${err.message}`);
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Hearing";
  }
}

async function handleExportWord() {
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

async function withExportButton(buttonId, task) {
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
  await withExportButton("exportDateBtn", () => exportCourtCalendarForDate(hearings, cases, dateStr));
}

async function handleExportCurrentWeek() {
  await withExportButton("exportWeekBtn", () => exportCourtCalendarForWeek(hearings, cases, new Date()));
}

async function handleExportCurrentMonth() {
  await withExportButton("exportMonthBtn", () => exportCourtCalendarForMonth(hearings, cases, new Date()));
}

async function handleDelete(hearingId) {
  const attached = casesForHearing(hearingId);
  const msg = attached.length
    ? `Delete this hearing? It will be removed from the list along with its ${attached.length} case number(s), but the record stays recoverable. Continue?`
    : "Delete this hearing? It will be removed from the list, but the record stays recoverable. Continue?";
  if (!confirm(msg)) return;

  try {
    await deleteHearing(hearingId);
  } catch (err) {
    alert(`Could not delete: ${err.message}`);
  }
}

// --- Init ---------------------------------------------------------------

// Supports Calendar linking directly to a hearing's edit form via
// hearings.html?openHearing=<id>. This does NOT duplicate any form,
// validation, save, or delete logic — it just calls the same
// openEditForm() the "Edit" button already uses, once both live
// collections have loaded at least once so the form has real data to
// show. Calendar itself never touches Firestore writes at all.
let autoOpenId = new URLSearchParams(window.location.search).get("openHearing");
let hearingsLoaded = false;
let casesLoaded = false;

function maybeAutoOpenFromUrl() {
  if (!autoOpenId || !hearingsLoaded || !casesLoaded) return;
  const targetId = autoOpenId;
  autoOpenId = null; // only ever attempt this once per page load

  if (hearings.find((h) => h.id === targetId)) {
    openEditForm(targetId);
  }

  // Tidy the URL so refreshing the page doesn't re-trigger the auto-open.
  const url = new URL(window.location.href);
  url.searchParams.delete("openHearing");
  window.history.replaceState({}, "", url);
}

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;

  wireNavAuth(user);

  document.getElementById("addHearingBtn").addEventListener("click", openAddForm);
  document.getElementById("hearingsSearchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderList();
  });
  document.getElementById("exportDateBtn").addEventListener("click", handleExportSelectedDate);
  document.getElementById("exportWeekBtn").addEventListener("click", handleExportCurrentWeek);
  document.getElementById("exportMonthBtn").addEventListener("click", handleExportCurrentMonth);
  wireExportDropdown();

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
}

init();
