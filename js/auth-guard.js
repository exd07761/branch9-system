// ---------------------------------------------------------------------------
// Shared authentication guard.
//
// This is the ONLY file in the project that calls onAuthStateChanged. Every
// page that needs to know "is someone logged in" goes through the two
// functions below instead of talking to Firebase Auth directly.
//
// v0.9.2 (RBAC): this is the extension point this comment already
// anticipated — requireAuth() now also resolves the signed-in user's role
// (one Firestore read via users-data.js, not a listener — "load it once,
// reuse it") and attaches it as user.role. Every page that already calls
// requireAuth() automatically gets user.role with no call-site changes;
// only pages that need to act on the role were touched this milestone.
// requirePermission() is the new page-level gate: call it after
// requireAuth() on any page a role might be denied entirely, and it
// redirects away exactly the way requireAuth() already redirects signed-out
// visitors to the login page. Button-level hiding (a different, UI-only
// concern) still lives in each page's own render code via can() from
// permissions.js — this file only decides "can this person be on this page
// at all."
//
// Firebase init failure handling: if firebase-init.js failed to initialize
// (bad config, blocked network, etc.), `auth` is null and calling
// onAuthStateChanged(auth, ...) would throw synchronously. Both functions
// below check for that up front and show a visible, user-facing overlay
// instead — no page is left blank with only an uncaught exception in the
// console. This does not change the authentication architecture: it's the
// same two functions, same call sites, just a guarded early return.
// ---------------------------------------------------------------------------

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth, firebaseInitError } from "./firebase-init.js";
import { getOrCreateUserRole } from "./users-data.js";
import { can } from "./permissions.js";

function escapeHtml(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

/**
 * Shows a full-page overlay explaining Firebase couldn't be reached. Safe
 * to call more than once (only injects one overlay). Used instead of
 * letting onAuthStateChanged throw against a null `auth` instance.
 */
function showFirebaseFatalError() {
  if (document.getElementById("firebaseFatalOverlay")) return;

  const detail = (firebaseInitError && firebaseInitError.message) || "Unknown error";
  const overlay = document.createElement("div");
  overlay.id = "firebaseFatalOverlay";
  overlay.className = "fatal-overlay";
  overlay.innerHTML = `
    <div class="fatal-card">
      <h2>Unable to connect</h2>
      <p>This system couldn't reach Firebase, so it can't check who's signed in or load any data right now.</p>
      <p>Please check your internet connection and reload the page. If this keeps happening, contact your system administrator.</p>
      <p class="fatal-detail">${escapeHtml(detail)}</p>
    </div>
  `;
  document.body.appendChild(overlay);
}

/**
 * Call at the top of any page that requires a logged-in user.
 * Redirects to the login page if nobody is signed in.
 * Resolves with the Firebase user object (with .role attached) if
 * authenticated.
 * Resolves with null (and shows a fatal-error overlay) if Firebase itself
 * failed to initialize — the caller's usual "not authenticated" handling
 * (returning early, doing nothing further) is exactly the right response.
 */
export function requireAuth({ loginPage = "login.html" } = {}) {
  if (firebaseInitError) {
    showFirebaseFatalError();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (!user) {
        window.location.replace(loginPage);
        resolve(null);
        return;
      }
      user.role = await getOrCreateUserRole(user);
      resolve(user);
    });
  });
}

/**
 * Call after requireAuth() on any page a role might be denied entirely
 * (as opposed to individual buttons/actions within a page a role is
 * otherwise allowed on — that's handled per-page via can() instead).
 * Redirects to `redirectTo` and returns false if `user` lacks
 * `permission`; returns true otherwise.
 */
export function requirePermission(user, permission, { redirectTo = "home.html" } = {}) {
  if (!can(user.role, permission)) {
    window.location.replace(redirectTo);
    return false;
  }
  return true;
}

/**
 * Call at the top of the login page.
 * Redirects to the given home page if someone is already signed in,
 * so a returning, still-logged-in Clerk skips the login form entirely.
 * Resolves with the Firebase user object (or null if not signed in, or if
 * Firebase failed to initialize — in which case a fatal-error overlay is
 * shown instead).
 */
export function redirectIfAuthenticated({ homePage = "home.html" } = {}) {
  if (firebaseInitError) {
    showFirebaseFatalError();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        window.location.replace(homePage);
      }
      resolve(user);
    });
  });
}
