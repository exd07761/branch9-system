// ---------------------------------------------------------------------------
// Home page logic (post-login proof-of-authentication page).
//
// This page intentionally does nothing beyond: require a logged-in user,
// then hand off to the shared wireNavAuth() helper for the nav bar's
// email display and Logout button (see nav-auth.js — used identically by
// hearings.js and calendar.js, so this wiring lives in exactly one place).
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js";
import { wireNavAuth } from "./nav-auth.js";

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return; // requireAuth already redirected to login

  wireNavAuth(user);
}

init();
