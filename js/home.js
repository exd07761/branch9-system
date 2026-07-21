// ---------------------------------------------------------------------------
// Home page logic (post-login page, including the dashboard summary and
// Today's Hearings panel).
//
// Auth: require a logged-in user, then hand off to the shared
// wireNavAuth() helper for the nav bar's email display and Logout button
// (see nav-auth.js — used identically by hearings.js and calendar.js).
//
// Dashboard + Today's Hearings: both reuse the SAME subscribeToHearings()
// call below — one listener, not two — from hearings-data.js, the exact
// same live-listener function hearings.js already uses. The actual math
// (stat counts, today's-hearings filter+sort) lives in dashboard-stats.js
// as pure functions, so this file stays a thin wiring layer: subscribe ->
// compute -> paint.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js";
import { wireNavAuth } from "./nav-auth.js";
import { subscribeToHearings } from "./hearings-data.js";
import { computeDashboardStats, getTodaysHearingsSorted } from "./dashboard-stats.js";

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function renderStats(hearings) {
  const stats = computeDashboardStats(hearings);
  document.getElementById("statActiveCases").textContent = stats.activeCases;
  document.getElementById("statHearingsToday").textContent = stats.hearingsToday;
  document.getElementById("statHearingsNext7").textContent = stats.hearingsNext7;
  document.getElementById("statHearingsNext30").textContent = stats.hearingsNext30;
}

function formatHearingTime(hearing) {
  if (hearing.hearingDateTime && typeof hearing.hearingDateTime.toDate === "function") {
    return hearing.hearingDateTime.toDate().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return hearing.hearingTime || "Time not set";
}

function renderTodaysHearings(hearings) {
  const container = document.getElementById("todaysHearingsList");
  const todays = getTodaysHearingsSorted(hearings);

  if (!todays.length) {
    container.innerHTML = `<p class="empty-row">No hearings scheduled today.</p>`;
    return;
  }

  container.innerHTML = `
    <ul class="today-hearing-list">
      ${todays
        .map((h) => {
          const caseTitle = `${h.plaintiff || "People of the Philippines"} vs. ${(h.accused || []).join(", ") || "Not set"}`;
          return `
            <li class="today-hearing-item" data-open-hearing="${h.id}">
              <span class="today-hearing-time">${esc(formatHearingTime(h))}</span>
              <span class="today-hearing-body">
                <span class="today-hearing-title">${esc(caseTitle)}</span>
                <span class="today-hearing-stage">${esc(h.status)}</span>
              </span>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;

  // Reuses the exact same hearings.html?openHearing=<id> mechanism
  // Calendar already uses (see calendar.js) — deliberately NOT changed to
  // open the newer quick-view modal instead, since that mechanism is
  // shared with Calendar and this milestone requires Calendar's existing
  // behavior to stay unchanged.
  container.querySelectorAll("[data-open-hearing]").forEach((el) => {
    el.addEventListener("click", () => {
      window.location.href = `hearings.html?openHearing=${encodeURIComponent(el.dataset.openHearing)}`;
    });
  });
}

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return; // requireAuth already redirected to login

  wireNavAuth(user);

  // Single live listener shared by both the stat cards and the Today's
  // Hearings panel — updates automatically whenever Firestore changes,
  // same as every other subscribeToHearings() consumer in this app.
  subscribeToHearings((hearings) => {
    renderStats(hearings);
    renderTodaysHearings(hearings);
  });
}

init();
