// ---------------------------------------------------------------------------
// Real application entry point (the site's root page).
//
// Does not duplicate any auth logic — it reuses the existing requireAuth()
// from auth-guard.js, the same function every other protected page uses.
// requireAuth() already redirects to login.html when nobody is signed in
// (and shows a fatal-error overlay if Firebase failed to initialize, via
// the same auth-guard.js change used everywhere else). The only new
// behavior here is: if requireAuth() resolves with a real user, send them
// on to home.html instead of rendering any content of its own.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js?v=0.9.6";

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return; // requireAuth already redirected to login, or showed a fatal error
  window.location.replace("home.html");
}

init();
