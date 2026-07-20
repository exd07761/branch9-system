// ---------------------------------------------------------------------------
// Home page logic (post-login page, now including the dashboard summary).
//
// Auth: require a logged-in user, then hand off to the shared
// wireNavAuth() helper for the nav bar's email display and Logout button
// (see nav-auth.js — used identically by hearings.js and calendar.js).
//
// Dashboard: reuses subscribeToHearings() from hearings-data.js — the
// exact same live-listener function hearings.js already uses — rather
// than writing a second, duplicate Firestore query. The actual stat
// math lives in dashboard-stats.js (a pure function), so this file stays
// a thin wiring layer: subscribe -> compute -> paint four numbers.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js";
import { wireNavAuth } from "./nav-auth.js";
import { subscribeToHearings } from "./hearings-data.js";
import { computeDashboardStats } from "./dashboard-stats.js";

function renderStats(hearings) {
  const stats = computeDashboardStats(hearings);
  document.getElementById("statActiveCases").textContent = stats.activeCases;
  document.getElementById("statHearingsToday").textContent = stats.hearingsToday;
  document.getElementById("statHearingsNext7").textContent = stats.hearingsNext7;
  document.getElementById("statHearingsNext30").textContent = stats.hearingsNext30;
}

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return; // requireAuth already redirected to login

  wireNavAuth(user);

  // Live listener — updates automatically whenever Firestore changes,
  // same as every other subscribeToHearings() consumer in this app.
  subscribeToHearings((hearings) => {
    renderStats(hearings);
  });
}

init();
