// ---------------------------------------------------------------------------
// Home page logic (post-login proof-of-authentication page).
//
// This page intentionally does nothing beyond: require a logged-in user,
// show their email, and let them log out. No dashboard widgets, summaries,
// or navigation belong here — that content is Milestone 5.
// ---------------------------------------------------------------------------

import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "./firebase-init.js";
import { requireAuth } from "./auth-guard.js";

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return; // requireAuth already redirected to login

  document.getElementById("userEmail").textContent = user.email;

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut(auth);
    window.location.replace("login.html");
  });
}

init();
