// ---------------------------------------------------------------------------
// Activity Log page controller.
//
// Responsibilities: require login, render the live activity feed (newest
// first), live client-side search, and the category filter dropdown. All
// Firestore access goes through activity-data.js — nothing in this file
// calls Firestore directly, matching the split hearings.js/hearings-data.js
// and calendar.js/calendar-data.js already use.
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { subscribeToActivityLogs } from "./activity-data.js?v=1.0.0";
import { PERMISSIONS } from "./permissions.js?v=1.0.0";
import { escapeHtml as esc } from "./dom-utils.js?v=1.0.0";

let entries = [];
let searchQuery = "";
let activeFilter = "all";

// --- Category filter ---------------------------------------------------
// A simple, fixed grouping of actions into the four buckets the filter
// dropdown offers. Purely a display concern — Firestore only ever stores
// the raw `action` string, never a category.

// Fixed at "Create Hearing"/"Edit Hearing"/etc. before this change — the
// Cases equivalents ("Create Case"/"Edit Case"/"Archived Case", already
// being written by cases.js, plus "Restored Case", added alongside
// Archived Cases restore on archived.html) fell into "Other" instead of
// "CRUD" as a result. Corrected here rather than left as-is, since it's
// the same categorization bug either way.
function categoryForAction(action) {
  if (action === "Login" || action === "Logout") return "Authentication";
  if (
    action === "Create Hearing" ||
    action === "Edit Hearing" ||
    action === "Delete Hearing" ||
    action === "Archived Hearing" ||
    action === "Restored Hearing" ||
    action === "Create Case" ||
    action === "Edit Case" ||
    action === "Delete Case" ||
    action === "Archived Case" ||
    action === "Restored Case"
  )
    return "CRUD";
  if ((action || "").startsWith("Export")) return "Export";
  return "Other";
}

// --- Formatting ----------------------------------------------------------

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

// --- Search + filter -------------------------------------------------------

function entryMatchesSearch(entry, q) {
  if (!q) return true;
  const haystack = [entry.userEmail, entry.action, entry.description]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function visibleEntries() {
  const q = searchQuery.trim().toLowerCase();
  return entries.filter((entry) => {
    if (activeFilter !== "all" && categoryForAction(entry.action) !== activeFilter) return false;
    return entryMatchesSearch(entry, q);
  });
}

// --- Render ----------------------------------------------------------------

function render() {
  const tbody = document.getElementById("activityTableBody");
  const list = visibleEntries();

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">${entries.length ? "No activity matches your search or filter." : "No activity recorded yet."}</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (entry) => `
        <tr>
          <td>${esc(fmtTimestamp(entry.timestamp))}</td>
          <td>${esc(entry.userEmail)}</td>
          <td>${esc(entry.action)}</td>
          <td>${esc(entry.module)}</td>
          <td>${esc(entry.description)}</td>
        </tr>
      `
    )
    .join("");
}

// --- Wiring ------------------------------------------------------------

function wireSearch() {
  const input = document.getElementById("activitySearchInput");
  input.addEventListener("input", () => {
    searchQuery = input.value;
    render();
  });
}

function wireFilter() {
  const select = document.getElementById("activityFilterSelect");
  select.addEventListener("change", () => {
    activeFilter = select.value === "All" ? "all" : select.value;
    render();
  });
}

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return; // requireAuth already redirected to login
  if (!requirePermission(user, PERMISSIONS.ACTIVITY_LOG_VIEW, { redirectTo: "home.html" })) return;

  wireNavAuth(user);
  wireSearch();
  wireFilter();

  subscribeToActivityLogs((data) => {
    entries = data;
    render();
  });
}

init();
