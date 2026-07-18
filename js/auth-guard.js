// ---------------------------------------------------------------------------
// Shared authentication guard.
//
// This is the ONLY file in the project that calls onAuthStateChanged. Every
// page that needs to know "is someone logged in" goes through the two
// functions below instead of talking to Firebase Auth directly.
//
// Why this matters for the future: this milestone only checks "does a
// Firebase Auth user exist at all" — there is no concept of roles yet.
// When roles/permissions are added later, the extra logic (e.g. checking a
// user's role before granting access to a page) only needs to be added
// HERE. Pages that already call requireAuth() will not need to change.
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
 * Resolves with the Firebase user object if authenticated.
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
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (!user) {
        window.location.replace(loginPage);
        resolve(null);
        return;
      }
      resolve(user);
    });
  });
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
