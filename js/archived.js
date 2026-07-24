// ---------------------------------------------------------------------------
// Archived Hearings page controller (v0.9.3 — Archive & Case Lifecycle
// Management).
//
// Responsibilities: require login + the ARCHIVE_MANAGE permission (this
// whole page is Administrator/Branch Clerk only), render the live list of
// archived hearings, live client-side search, a read-only View modal, and
// the Restore action. All Firestore access goes through hearings-data.js
// — nothing in this file calls Firestore directly, matching the split
// every other page controller already uses.
//
// No editing happens here at all — no form, no save/validation logic of
// any kind is duplicated from hearings.js. The View modal mirrors
// hearings.js's own Quick View modal (same CSS classes, same layout) but
// is its own small renderer reading THIS page's own loaded data, the
// same way reports.js has its own row renderer rather than importing
// hearings.js's — hearings.js's in-memory `hearings[]` array never
// contains archived records to begin with (subscribeToHearings()
// excludes them by default), so there is nothing there to reuse.
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=0.9.6";
import { wireNavAuth } from "./nav-auth.js?v=0.9.6";
import { subscribeToArchivedHearings, subscribeToCases, restoreHearing } from "./hearings-data.js?v=0.9.6";
import { logActivity } from "./activity-data.js?v=0.9.6";
import { can, PERMISSIONS } from "./permissions.js?v=0.9.6";

let hearings = [];
let cases = [];
let currentRole = null;
let searchQuery = "";
let previewHearingId = null;

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Same shape as activity.js's fmtTimestamp() — kept local since it's
// only needed here for the "Archived On" column/preview, not shared UI.
function fmtTimestamp(ts) {
  if (ts && typeof ts.toDate === "function") {
    return ts.toDate().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return "\u2014";
}

function casesForHearing(hearingId) {
  return cases.filter((c) => c.hearingId === hearingId);
}

function caseSummary(hearingId) {
  const list = casesForHearing(hearingId);
  if (!list.length) return "(no case numbers)";
  return list.map((c) => `${c.caseType || ""}. ${c.caseNo || ""}`).join("; ");
}

function hearingLabel(data) {
  const plaintiff = data.plaintiff || "People of the Philippines";
  const accused = (data.accused || []).join(", ") || "Not set";
  return `${plaintiff} vs. ${accused}`;
}

// --- Search --------------------------------------------------------------
// Same matching fields/behavior as hearings.js's hearingMatchesSearch() —
// kept as its own local copy rather than imported, same reasoning
// reports.js already documents for not sharing page-controller-local
// formatting/search helpers across pages.

function hearingMatchesSearch(hearing, q) {
  if (!q) return true;
  const query = q.toLowerCase();
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

  return haystack.includes(query);
}

// --- List rendering --------------------------------------------------------

function renderList() {
  const tbody = document.getElementById("archivedTableBody");
  const visibleHearings = hearings.filter((h) => hearingMatchesSearch(h, searchQuery));

  if (!visibleHearings.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">${
      hearings.length ? "No archived hearings match your search." : "No hearings have been archived."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = visibleHearings
    .map((h) => {
      const accusedLine = (h.accused || []).join(", ");
      const count = typeof h.caseCount === "number" ? h.caseCount : casesForHearing(h.id).length;
      const restoreBtn = can(currentRole, PERMISSIONS.ARCHIVE_MANAGE)
        ? `<button type="button" class="btn-small" data-action="restore" data-id="${h.id}">Restore</button>`
        : "";
      return `
        <tr data-hearing-row="${h.id}" tabindex="0" role="button" aria-label="View archived hearing: ${esc(hearingLabel(h))}">
          <td>${h.hearingDate ? esc(fmtDate(h.hearingDate)) : "<span class=\"muted\">Not set</span>"}</td>
          <td>${esc(h.hearingTime) || '<span class="muted">&mdash;</span>'}</td>
          <td>${esc(h.section)}</td>
          <td>${esc(h.status)}</td>
          <td>${count}</td>
          <td>${esc(caseSummary(h.id))}</td>
          <td>${esc(accusedLine)}</td>
          <td>${esc(fmtTimestamp(h.archivedAt))}</td>
          <td class="row-actions">
            <button type="button" class="btn-small" data-action="view" data-id="${h.id}">View</button>
            ${restoreBtn}
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener("click", () => openPreview(btn.dataset.id));
  });
  tbody.querySelectorAll('[data-action="restore"]').forEach((btn) => {
    btn.addEventListener("click", () => handleRestore(btn.dataset.id));
  });

  // Row click (or Enter/Space when focused via keyboard) also opens the
  // read-only preview — but not when it originated from the View/Restore
  // buttons above.
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

// --- View (read-only preview modal) ---------------------------------------
// Same layout/CSS classes as hearings.js's Quick View modal (.preview-*),
// plus the archive-specific fields (Archived On/By/Reason). No "Edit"
// shortcut here — archived hearings cannot be edited from this page.

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
  const root = document.getElementById("archivedPreviewRoot");
  if (!previewHearingId) {
    root.innerHTML = "";
    return;
  }

  const h = hearings.find((x) => x.id === previewHearingId);
  if (!h) {
    // Hearing restored (or otherwise left the archived list) in another
    // tab while the preview was open — just close it.
    previewHearingId = null;
    root.innerHTML = "";
    return;
  }

  const hearingCasesList = casesForHearing(previewHearingId);

  root.innerHTML = `
    <div class="preview-overlay" id="archivedPreviewOverlay">
      <div class="preview-card" role="dialog" aria-modal="true" aria-label="Archived hearing details">
        <button type="button" class="preview-close" id="archivedPreviewCloseBtn" aria-label="Close">&times;</button>
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
          ${previewField("Archived On", fmtTimestamp(h.archivedAt))}
          ${previewField("Archived By", h.archivedBy)}
          ${previewField("Archive Reason", h.archiveReason)}
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
          <button type="button" class="btn-secondary" id="archivedPreviewCloseBtn2">Close</button>
          ${can(currentRole, PERMISSIONS.ARCHIVE_MANAGE) ? '<button type="button" class="btn-primary btn-inline" id="archivedPreviewRestoreBtn">Restore This Hearing</button>' : ""}
        </div>
      </div>
    </div>
  `;

  const overlay = document.getElementById("archivedPreviewOverlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePreview();
  });
  document.getElementById("archivedPreviewCloseBtn").addEventListener("click", closePreview);
  document.getElementById("archivedPreviewCloseBtn2").addEventListener("click", closePreview);
  const restoreBtn = document.getElementById("archivedPreviewRestoreBtn");
  if (restoreBtn) {
    restoreBtn.addEventListener("click", () => {
      closePreview();
      handleRestore(previewHearingId || h.id);
    });
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && previewHearingId) closePreview();
});

// --- Restore ---------------------------------------------------------------

async function handleRestore(hearingId) {
  if (!can(currentRole, PERMISSIONS.ARCHIVE_MANAGE)) return;
  if (!confirm("Restore this hearing? It will return to active operations.")) return;

  const hearing = hearings.find((h) => h.id === hearingId);

  try {
    await restoreHearing(hearingId);
    // Not awaited: logging must never block the UI.
    logActivity({
      action: "Restored Hearing",
      module: "Hearings",
      entityId: hearingId,
      entityType: "hearing",
      description: hearing ? `Restored hearing for ${hearingLabel(hearing)} on ${hearing.hearingDate}` : `Restored hearing ${hearingId}`,
    });
  } catch (err) {
    alert(`Could not restore: ${err.message}`);
  }
}

// --- Search wiring -----------------------------------------------------

function wireSearch() {
  const input = document.getElementById("archivedSearchInput");
  input.addEventListener("input", () => {
    searchQuery = input.value;
    renderList();
  });
}

// --- Init ---------------------------------------------------------------

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.ARCHIVE_MANAGE, { redirectTo: "home.html" })) return;

  currentRole = user.role;
  wireNavAuth(user);
  wireSearch();

  subscribeToArchivedHearings((data) => {
    hearings = data;
    renderList();
    renderPreview();
  });
  subscribeToCases((data) => {
    cases = data;
    renderList();
    renderPreview();
  });
}

init();
