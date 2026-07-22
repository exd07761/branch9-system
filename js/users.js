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

import { requireAuth, requirePermission } from "./auth-guard.js";
import { wireNavAuth } from "./nav-auth.js";
import { subscribeToAllUsers, updateUserRole } from "./users-data.js";
import { logActivity } from "./activity-data.js";
import { ALL_ROLES, ROLE_LABELS, PERMISSIONS } from "./permissions.js";

let currentUser = null;
let users = [];

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

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
            <select class="role-select" data-role-select data-uid="${esc(u.id)}" ${isSelf ? "disabled" : ""}>
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

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;
  if (!requirePermission(user, PERMISSIONS.USERS_MANAGE, { redirectTo: "home.html" })) return;

  currentUser = user;
  wireNavAuth(user);

  subscribeToAllUsers((data) => {
    users = data;
    render();
  });
}

init();
