// ---------------------------------------------------------------------------
// User Management page controller.
//
// UI only: rendering and the role-change action. All Firestore access goes
// through users-data.js. Administrator only — gated both by hiding the nav
// link (nav-auth.js) and, here, by requirePermission() redirecting away
// any other role that reaches this URL directly. Hiding the link is a UI
// convenience, not the security boundary; requirePermission() plus
// Firestore Security Rules are what actually stop a non-admin (see
// README.md, "Firestore Security Rules for RBAC").
//
// No account creation here — accounts are created implicitly the first
// time someone signs in (see getOrCreateUserRole() in users-data.js). The
// "Add User" button in users.html is a disabled placeholder only.
// ---------------------------------------------------------------------------

import { requireAuth, requirePermission } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { subscribeToAllUsers, updateUserRole } from "./users-data.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { ALL_ROLES, ROLE_LABELS, PERMISSIONS } from "./permissions.js?v=1.0.0";
import { escapeHtml as esc } from "./dom-utils.js?v=1.0.0";
import { showNotice, clearNotice } from "./notify.js?v=1.0.0";

let currentUser = null;
let users = [];

function setStatus(text) {
  document.getElementById("usersStatus").textContent = text || "";
}

function roleOptionsHtml(selected) {
  return ALL_ROLES.map((r) => `<option value="${r}"${r === selected ? " selected" : ""}>${esc(ROLE_LABELS[r])}</option>`).join("");
}

function render() {
  const tbody = document.getElementById("usersTableBody");

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-row">No accounts have signed in yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = users
    .map((u) => {
      // Prevents an Administrator from locking themselves (or the last
      // admin) out by accidentally changing their own role — a common
      // real-world RBAC pitfall, not a Firestore-enforced rule.
      const isSelf = u.id === currentUser.uid;
      return `
        <tr>
          <td>${esc(u.email)}</td>
          <td>
            <select class="role-select" data-role-select data-uid="${esc(u.id)}" aria-label="Role for ${esc(u.email)}" ${isSelf ? "disabled" : ""}>
              ${roleOptionsHtml(u.role)}
            </select>
          </td>
          <td>${isSelf ? '<span class="muted">This is you</span>' : ""}</td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("[data-role-select]").forEach((select) => {
    select.addEventListener("change", () => handleRoleChange(select.dataset.uid, select.value));
  });
}

async function handleRoleChange(uid, newRole) {
  const target = users.find((u) => u.id === uid);
  const oldRole = target ? target.role : "(unknown)";
  setStatus("");
  try {
    await updateUserRole(uid, newRole);
    // Not awaited: logging must never block the UI.
    logActivity({
      action: "Change User Role",
      module: "User Management",
      entityId: uid,
      entityType: "user",
      description: `Changed role for ${target ? target.email : uid} from ${oldRole} to ${newRole}`,
      oldValue: oldRole,
      newValue: newRole,
    });
  } catch (err) {
    setStatus(`Could not change role: ${err.message}`);
    render(); // revert the <select> to the last known-good value
  }
}

// --- Error state -----------------------------------------------------------
// subscribeToAllUsers() now accepts an optional onError callback (additive
// — see users-data.js), so a Firestore failure here shows a message with a
// Retry action instead of leaving the table stuck on "Loading…" forever.
// Same notify.js + Retry-button convention home.js already established for
// its own live listeners.

let unsubscribeUsers = null;

function renderUsersError(err) {
  console.error("Users: listener failed", err);
  const noticeHost = document.getElementById("usersLoadError");
  showNotice(noticeHost, "Could not load user accounts. Check your connection and try again.", "error");
  const closeBtn = noticeHost.querySelector(".inline-notice-close");
  if (closeBtn) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "inline-notice-retry";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", startUsersSubscription);
    noticeHost.querySelector(".inline-notice")?.insertBefore(retryBtn, closeBtn);
  }
  document.getElementById("usersTableBody").innerHTML = `<tr><td colspan="3" class="empty-row">Unavailable.</td></tr>`;
}

function startUsersSubscription() {
  if (typeof unsubscribeUsers === "function") unsubscribeUsers();
  clearNotice(document.getElementById("usersLoadError"));
  unsubscribeUsers = subscribeToAllUsers((data) => {
    users = data;
    clearNotice(document.getElementById("usersLoadError"));
    render();
  }, renderUsersError);
}

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.USERS_MANAGE, { redirectTo: "home.html" })) return;

  currentUser = user;
  wireNavAuth(user);

  startUsersSubscription();
}

init();
