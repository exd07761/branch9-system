// ---------------------------------------------------------------------------
// Home page logic — post-login dashboard: summary stat cards, the
// Current/Next Session card, Today's Summary, Quick Actions, and the
// Today's Hearings timeline.
//
// Auth: require a logged-in user, then hand off to the shared
// wireNavAuth() helper for the nav bar's email display and Logout button
// (see nav-auth.js — used identically by hearings.js and calendar.js).
//
// Data: subscribeToHearings() (from hearings-data.js) is the SAME live
// listener v0.7.0/v0.7.2 already added here — still just one hearings
// listener, not two. v0.8.0 additionally calls subscribeToCases(), the
// same existing function hearings.js already uses, solely so the new
// "Export Today's Calendar" quick action has case data to include —
// no new Firestore access code was written for this, it's the exact
// same reusable subscription helper hearings-data.js already exports.
//
// Computation: dashboard-stats.js (stat cards, today's-hearings
// filter+sort) and dashboard-live.js (current/next hearing, today's
// summary, timeline status) are both pure, no-DOM modules. This file
// stays a thin wiring layer: subscribe -> compute -> paint, plus one
// setInterval so the Session card/Timeline stay current as real time
// passes even between Firestore updates.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js";
import { wireNavAuth } from "./nav-auth.js";
import { subscribeToHearings, subscribeToCases } from "./hearings-data.js";
import { computeDashboardStats, getTodaysHearingsSorted } from "./dashboard-stats.js";
import {
  getCurrentHearing,
  getNextUpcomingHearing,
  getTodaysSummary,
  minutesUntil,
  annotateTimelineStatuses,
} from "./dashboard-live.js";
import { exportCourtCalendarForDate } from "./docx-export.js";

const STATUS_LABEL = { now: "Now", next: "Next", completed: "Completed", upcoming: "Upcoming" };

let hearings = [];
let cases = [];

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function renderStats(hearingsArray) {
  const stats = computeDashboardStats(hearingsArray);
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

function caseTitle(hearing) {
  return `${hearing.plaintiff || "People of the Philippines"} vs. ${(hearing.accused || []).join(", ") || "Not set"}`;
}

// --- Current Session / Next Hearing card ---------------------------------

function renderSessionCard(todays) {
  const root = document.getElementById("dashboardSessionCard");
  const now = new Date();
  const current = getCurrentHearing(todays, now);

  if (current) {
    root.innerHTML = `
      <p class="session-label">Now Hearing</p>
      <h3 class="session-title">${esc(caseTitle(current))}</h3>
      <p class="session-stage">${esc(current.status)}</p>
      <p class="session-time">${esc(formatHearingTime(current))}</p>
    `;
    return;
  }

  const next = getNextUpcomingHearing(todays, now);
  if (!next) {
    root.innerHTML = `
      <p class="session-label">Now Hearing</p>
      <p class="session-empty">No active hearing.</p>
    `;
    return;
  }

  const mins = minutesUntil(next, now);
  root.innerHTML = `
    <p class="session-label">Next Hearing</p>
    <h3 class="session-title">${esc(formatHearingTime(next))}</h3>
    <p class="session-case">${esc(caseTitle(next))}</p>
    <p class="session-stage">${esc(next.status)}</p>
    <p class="session-countdown">Starts in ${mins} minute${mins === 1 ? "" : "s"}</p>
  `;
}

// --- Today's Summary card --------------------------------------------------

function renderSummaryCard(todays) {
  const root = document.getElementById("dashboardSummaryCard");
  const summary = getTodaysSummary(todays, new Date());
  root.innerHTML = `
    <p class="summary-title">Today's Hearings</p>
    <div class="summary-row"><span class="summary-value">${summary.scheduled}</span><span class="summary-label">Scheduled</span></div>
    <div class="summary-row"><span class="summary-value">${summary.completed}</span><span class="summary-label">Completed</span></div>
    <div class="summary-row"><span class="summary-value">${summary.remaining}</span><span class="summary-label">Remaining</span></div>
  `;
}

// --- Today's Hearings timeline ---------------------------------------------

function renderTimeline(todays) {
  const container = document.getElementById("todaysHearingsList");

  if (!todays.length) {
    container.innerHTML = `<p class="empty-row">No hearings scheduled today.<br>Enjoy the quiet day.</p>`;
    return;
  }

  const annotated = annotateTimelineStatuses(todays, new Date());

  container.innerHTML = `
    <p class="timeline-header">Today</p>
    <ul class="timeline-list">
      ${annotated
        .map(({ hearing: h, status }) => `
          <li class="timeline-item timeline-item--${status}" data-preview-hearing="${h.id}">
            <span class="timeline-rail"><span class="timeline-dot"></span></span>
            <span class="timeline-content">
              <span class="timeline-time">${esc(formatHearingTime(h))}</span>
              <span class="timeline-case">${esc(caseTitle(h))}</span>
              <span class="timeline-stage">${esc(h.status)}</span>
              <span class="timeline-badge timeline-badge--${status}">${STATUS_LABEL[status]}</span>
            </span>
          </li>
        `)
        .join("")}
    </ul>
  `;

  // Opens the existing Hearing Lightbox — the Quick View modal already
  // defined in hearings.js (openPreview(), unchanged) — via a dedicated
  // ?previewHearing=<id> URL param. Deliberately separate from Calendar's
  // ?openHearing=<id> mechanism, which stays completely unchanged.
  container.querySelectorAll("[data-preview-hearing]").forEach((el) => {
    el.addEventListener("click", () => {
      window.location.href = `hearings.html?previewHearing=${encodeURIComponent(el.dataset.previewHearing)}`;
    });
  });
}

// --- Live re-render (data change or plain time passing) --------------------

function renderLive() {
  const todays = getTodaysHearingsSorted(hearings);
  renderSessionCard(todays);
  renderSummaryCard(todays);
  renderTimeline(todays);
}

// --- Quick Actions -----------------------------------------------------

function todayDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function setQuickActionsStatus(text) {
  const el = document.getElementById("quickActionsStatus");
  if (el) el.textContent = text || "";
}

async function handleExportTodayQuickAction() {
  if (!window.docx) {
    setQuickActionsStatus("Could not export: the Word export library failed to load. Check your internet connection and try again.");
    return;
  }

  // Reuses the exact same exportCourtCalendarForDate() every export mode
  // on the Hearings page already calls — no export logic is duplicated.
  const btn = document.getElementById("qaExportTodayBtn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Exporting\u2026";
  setQuickActionsStatus("");
  try {
    await exportCourtCalendarForDate(hearings, cases, todayDateStr());
  } catch (err) {
    setQuickActionsStatus(`Could not export: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

function wireQuickActions() {
  // Reuses the same ?action=add entry point hearings.js now supports —
  // calls the existing openAddForm(), no form logic duplicated here.
  document.getElementById("qaAddHearingBtn").addEventListener("click", () => {
    window.location.href = "hearings.html?action=add";
  });
  // Plain navigation — Calendar itself is completely unmodified.
  document.getElementById("qaOpenCalendarBtn").addEventListener("click", () => {
    window.location.href = "calendar.html";
  });
  document.getElementById("qaExportTodayBtn").addEventListener("click", handleExportTodayQuickAction);
}

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return; // requireAuth already redirected to login

  wireNavAuth(user);
  wireQuickActions();

  // Single live hearings listener shared by the stat cards, the Session/
  // Summary cards, and the Timeline — updates automatically whenever
  // Firestore changes, same as every other subscribeToHearings()
  // consumer in this app.
  subscribeToHearings((data) => {
    hearings = data;
    renderStats(hearings);
    renderLive();
  });

  // Reuses hearings-data.js's existing subscribeToCases() (already used
  // by hearings.js) so "Export Today's Calendar" has case data available
  // — no new Firestore access code, just the same helper called again.
  subscribeToCases((data) => {
    cases = data;
  });

  // Keeps the Session card and Timeline ("Starts in N minutes", current/
  // next highlighting) accurate as real time passes, even between
  // Firestore updates. Pure client-side re-render — no network activity.
  setInterval(renderLive, 30000);
}

init();
