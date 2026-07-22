// ---------------------------------------------------------------------------
// Shared nav UI helper.
//
// This does NOT duplicate authentication logic — auth-guard.js's
// requireAuth()/redirectIfAuthenticated() remain the only functions that
// talk to Firebase Auth's onAuthStateChanged, exactly as before. Every
// page still calls requireAuth() itself, on its own, to decide whether to
// render at all.
//
// What this file adds is much narrower: once a page already has the user
// object requireAuth() resolved, wireNavAuth(user) does the two small,
// identical things every authenticated page's nav bar needs — show the
// signed-in email, and make the Logout button actually sign out — in one
// place instead of copy-pasted into home.js/hearings.js/calendar.js.
//
// Both target elements are optional: wireNavAuth() checks for them before
// touching anything, so it's safe to call from any page regardless of
// whether that page's nav happens to include a #userEmail/#logoutBtn.
// ---------------------------------------------------------------------------

import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "./firebase-init.js";
import { logActivity } from "./activity-data.js";
import { can } from "./permissions.js";

// v0.9.2 (RBAC): nav links a role can't use are hidden here, in the one
// place every page already calls to wire its nav — this is the reusable
// permission helper's single call site for "which nav links show," so no
// page repeats this check itself. A link opts in by adding
// data-permission="<permission>" (see permissions.js for the list); links
// with no data-permission attribute (Home, Hearings, Calendar) are always
// shown, since every role has access to those.
function applyNavPermissions(role) {
  document.querySelectorAll(".app-nav-links [data-permission]").forEach((link) => {
    link.hidden = !can(role, link.dataset.permission);
  });
}

export function wireNavAuth(user, { loginPage = "login.html" } = {}) {
  const emailEl = document.getElementById("userEmail");
  if (emailEl && user) {
    emailEl.textContent = user.email;
  }

  if (user) applyNavPermissions(user.role);

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      // Logged before signOut() — auth.currentUser is cleared once
      // signOut() resolves, and logActivity() falls back to "unknown"
      // without it. Not awaited: never delay the redirect over logging.
      logActivity({
        action: "Logout",
        module: "Authentication",
        description: `${user.email} logged out`,
      });
      await signOut(auth);
      window.location.replace(loginPage);
    });
  }
}
