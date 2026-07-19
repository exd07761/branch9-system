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

export function wireNavAuth(user, { loginPage = "login.html" } = {}) {
  const emailEl = document.getElementById("userEmail");
  if (emailEl && user) {
    emailEl.textContent = user.email;
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.replace(loginPage);
    });
  }
}
