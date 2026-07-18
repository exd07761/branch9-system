// ---------------------------------------------------------------------------
// Login page logic.
//
// Responsibilities: skip the form if already logged in, sign in on submit,
// show a loading state, and translate Firebase Auth error codes into
// friendly, non-technical messages for the Clerk.
// ---------------------------------------------------------------------------

import {
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "./firebase-init.js";
import { redirectIfAuthenticated } from "./auth-guard.js";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorEl = document.getElementById("loginError");
const submitBtn = document.getElementById("submitBtn");

// If the Clerk is already signed in (e.g. reopened the tab), skip straight
// to the home page instead of showing the login form.
redirectIfAuthenticated({ homePage: "home.html" });

function friendlyError(code) {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look valid.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your system administrator.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Signing in\u2026" : "Log in";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";

  // Belt-and-suspenders: the form's required attributes (native browser
  // validation, now that novalidate has been removed) already stop this
  // handler from running with empty fields in normal use. This check
  // guarantees no Firebase call is ever made with blank credentials even
  // if the submit event fires some other way.
  if (!emailInput.value.trim() || !passwordInput.value) {
    errorEl.textContent = "Please enter both your email and password.";
    return;
  }

  setLoading(true);

  try {
    // Explicit, even though it's Firebase's default, so the persistence
    // behavior is documented in code rather than assumed.
    await setPersistence(auth, browserLocalPersistence);
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
    window.location.replace("home.html");
  } catch (err) {
    errorEl.textContent = friendlyError(err.code);
    setLoading(false);
  }
});
