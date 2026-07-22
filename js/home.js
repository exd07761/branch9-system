// ---------------------------------------------------------------------------
// Home page logic — post-login dashboard: summary stat cards, the Now
// Hearing / Next Hearing cards, Today's Summary, Quick Actions, and the
// Today's Hearings timeline (the dashboard's visual centerpiece as of
// v0.8.1).
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
// summary, timeline status) are both pure, no-DOM modules, unchanged in
// v0.8.1 — this file only changed how their results are painted. It
// stays a thin wiring layer: subscribe -> compute -> paint, plus one
// setInterval so the cards/Timeline stay current as real time passes
// even between Firestore updates.
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
import { logActivity } from "./activity-data.js";

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

// --- Now Hearing / Next Hearing cards --------------------------------------
//
// v0.8.1: these were a single card that toggled between "Now" and "Next"
// display, with the Next state only shown when nothing was active. They're
// now two independent cards — a Clerk mid-hearing can still see what's
// coming up next — each with its own compact empty state so an idle card
// doesn't reserve as much space as one showing real hearing details.
// Same getCurrentHearing()/getNextUpcomingHearing()/minutesUntil() calls
// from dashboard-live.js as before — no computation changes.

function renderNowCard(todays) {
  const root = document.getElementById("dashboardNowCard");
  const current = getCurrentHearing(todays, new Date());

  if (!current) {
    root.classList.add("session-card--compact");
    root.innerHTML = `
      <p class="session-label"><i data-lucide="gavel" aria-hidden="true"></i>Now Hearing</p>
      <p class="session-empty">No active hearing.</p>
    `;
  } else {
    root.classList.remove("session-card--compact");
    root.innerHTML = `
      <p class="session-label"><i data-lucide="gavel" aria-hidden="true"></i>Now Hearing</p>
      <h3 class="session-title">${esc(caseTitle(current))}</h3>
      <p class="session-stage">${esc(current.status)}</p>
      <p class="session-time">${esc(formatHearingTime(current))}</p>
    `;
  }
  if (window.lucide) lucide.createIcons();
}

function renderNextCard(todays) {
  const root = document.getElementById("dashboardNextCard");
  const now = new Date();
  const next = getNextUpcomingHearing(todays, now);

  if (!next) {
    root.classList.add("session-card--compact");
    root.innerHTML = `
      <p class="session-label"><i data-lucide="clock" aria-hidden="true"></i>Next Hearing</p>
      <p class="session-empty">No upcoming hearings today.</p>
    `;
  } else {
    root.classList.remove("session-card--compact");
    const mins = minutesUntil(next, now);
    root.innerHTML = `
      <p class="session-label"><i data-lucide="clock" aria-hidden="true"></i>Next Hearing</p>
      <h3 class="session-title">${esc(formatHearingTime(next))}</h3>
      <p class="session-case">${esc(caseTitle(next))}</p>
      <p class="session-stage">${esc(next.status)}</p>
      <p class="session-countdown">Starts in ${mins} minute${mins === 1 ? "" : "s"}</p>
    `;
  }
  if (window.lucide) lucide.createIcons();
}

// --- Today's Summary card --------------------------------------------------

function renderSummaryCard(todays) {
  const root = document.getElementById("dashboardSummaryCard");
  const summary = getTodaysSummary(todays, new Date());
  root.innerHTML = `
    <p class="summary-title"><i data-lucide="clipboard-list" aria-hidden="true"></i>Today's Summary</p>
    <div class="summary-columns">
      <div class="summary-col"><span class="summary-label">Scheduled</span><span class="summary-value">${summary.scheduled}</span></div>
      <div class="summary-col"><span class="summary-label">Completed</span><span class="summary-value">${summary.completed}</span></div>
      <div class="summary-col"><span class="summary-label">Remaining</span><span class="summary-value">${summary.remaining}</span></div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

// --- Today's Hearings timeline ---------------------------------------------

function renderTimeline(todays) {
  const container = document.getElementById("todaysHearingsList");
  const card = document.getElementById("dashboardTimelineCard");

  if (!todays.length) {
    if (card) card.classList.add("dashboard-timeline-card--empty");
    container.innerHTML = `
      <div class="timeline-empty">
        <i data-lucide="calendar-check" aria-hidden="true"></i>
        <p class="timeline-empty-title">No hearings scheduled for today.</p>
        <p class="timeline-empty-sub">Use <strong>Add Hearing</strong> or open the Calendar to schedule one.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (card) card.classList.remove("dashboard-timeline-card--empty");

  const annotated = annotateTimelineStatuses(todays, new Date());

  container.innerHTML = `
    <p class="timeline-header">Today</p>
    <ul class="timeline-list">
      ${annotated
        .map(({ hearing: h, status }) => `
          <li class="timeline-item timeline-item--${status}" data-preview-hearing="${h.id}" tabindex="0" role="button" aria-label="View hearing: ${esc(caseTitle(h))}, ${esc(formatHearingTime(h))}">
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
  // ?openHearing=<id> mechanism, which stays completely unchanged. Rows
  // are keyboard-reachable (tabindex/role above) and Enter/Space trigger
  // the same navigation as a click, so no behavior is duplicated.
  container.querySelectorAll("[data-preview-hearing]").forEach((el) => {
    const openPreview = () => {
      window.location.href = `hearings.html?previewHearing=${encodeURIComponent(el.dataset.previewHearing)}`;
    };
    el.addEventListener("click", openPreview);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPreview();
      }
    });
  });
}

// --- Live re-render (data change or plain time passing) --------------------

function renderLive() {
  const todays = getTodaysHearingsSorted(hearings);
  renderNowCard(todays);
  renderNextCard(todays);
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
    // Not awaited: logging must never block the UI.
    logActivity({
      action: "Export Today's Calendar",
      module: "Dashboard",
      entityId: todayDateStr(),
      entityType: "calendarExport",
      description: `Exported calendar for ${todayDateStr()}`,
    });
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
