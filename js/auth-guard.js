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
// ---------------------------------------------------------------------------

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "./firebase-init.js";

/**
 * Call at the top of any page that requires a logged-in user.
 * Redirects to the login page if nobody is signed in.
 * Resolves with the Firebase user object if authenticated.
 */
export function requireAuth({ loginPage = "login.html" } = {}) {
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
 * Resolves with the Firebase user object (or null if not signed in).
 */
export function redirectIfAuthenticated({ homePage = "home.html" } = {}) {
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
