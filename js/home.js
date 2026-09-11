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
// The dashboard redesign further adds one subscribeToCaseRecords() call
// (cases-data.js) for the Total Cases / Active Cases stat cards — again
// reusing an existing IM-1 function, not new Firestore logic.
//
// Computation: dashboard-stats.js (stat cards, today's-hearings
// filter+sort) and dashboard-live.js (current/next hearing, today's
// summary, timeline status) are both pure, no-DOM modules, unchanged in
// v0.8.1 — this file only changed how their results are painted. It
// stays a thin wiring layer: subscribe -> compute -> paint, plus one
// setInterval so the cards/Timeline stay current as real time passes
// even between Firestore updates.
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js?v=1.0.0";
import { wireNavAuth } from "./nav-auth.js?v=1.0.0";
import { subscribeToHearings, subscribeToCases } from "./hearings-data.js?v=1.0.0";
import { subscribeToCaseRecords, isActiveCase } from "./cases-data.js?v=1.0.0";
import { computeDashboardStats, getTodaysHearingsSorted, getUpcomingHearingsSorted } from "./dashboard-stats.js?v=1.0.0";
import {
  getCurrentHearing,
  getNextUpcomingHearing,
  getTodaysSummary,
  minutesUntil,
  annotateTimelineStatuses,
} from "./dashboard-live.js?v=1.0.0";
import { exportCourtCalendarForDate } from "./docx-export.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { can, PERMISSIONS, ROLE_LABELS } from "./permissions.js?v=1.0.0";
import { escapeHtml as esc } from "./dom-utils.js?v=1.0.0";
import { showNotice, clearNotice } from "./notify.js?v=1.0.0";

const STATUS_LABEL = { now: "Now", next: "Next", completed: "Completed", upcoming: "Upcoming" };

let hearings = [];
let cases = [];
let currentRole = null;
let unsubscribeHearings = null;
let unsubscribeCaseStats = null;

function renderStats(hearingsArray) {
  const stats = computeDashboardStats(hearingsArray);
  document.getElementById("statHearingsToday").textContent = stats.hearingsToday;
  // hearingsNext7 was already computed by computeDashboardStats() but
  // nothing surfaced it — used here as supporting context on the same
  // card, per the Phase 5 KPI guidance ("appropriate supporting context
  // if available"), rather than adding a fourth stat card.
  const subEl = document.getElementById("statHearingsTodaySub");
  if (subEl) {
    subEl.textContent = `Scheduled today \u00b7 ${stats.hearingsNext7} in the next 7 days`;
  }
}

// v2 dashboard redesign: Total Cases / Active Cases now come from the real
// `cases` collection (cases-data.js, built in the v1.1 Case redesign) via
// its existing subscribeToCaseRecords()/isActiveCase() — not new logic,
// just a new consumer of functions cases.js already uses. This replaces
// the old "Active Cases" number on this dashboard, which was actually a
// sum of each hearing's own caseCount field (see dashboard-stats.js) —
// a pre-v1.1 proxy metric, not an actual count of Case documents. Total
// Cases intentionally includes archived (but non-deleted) Cases — "all
// time" — while Active Cases excludes them, matching isActiveCase().
function renderCaseStats(allCases) {
  document.getElementById("statTotalCases").textContent = allCases.length;
  document.getElementById("statActiveCases").textContent = allCases.filter(isActiveCase).length;
}

// Greeting + current date — both computed client-side from real data
// (the signed-in user's email, the browser's clock), never hardcoded.
// There's no display-name field anywhere in this app's data model (only
// email + role — see nav-auth.js), so the greeting uses the email's
// local part as a stand-in for a name. Shared by both the greeting and
// the header user chip below, so the derivation lives in one place.
function deriveNameFromEmail(email) {
  const namePart = (email || "").split("@")[0];
  return namePart ? namePart.charAt(0).toUpperCase() + namePart.slice(1) : "there";
}

function renderGreeting(user) {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  document.getElementById("dashboardGreeting").textContent = `Good ${timeOfDay}, ${deriveNameFromEmail(user.email)}.`;
}

function renderDateBadge() {
  const el = document.getElementById("dashboardDateDay");
  if (el) el.textContent = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

// Header user chip: same real email/role this app already shows in the
// sidebar (nav-auth.js's #userEmail), just surfaced a second time up
// here to match the mockup's top-right identity area. The dropdown's
// only action is Log out, wired via nav-auth.js's data-logout-trigger
// support (added alongside this) — reuses the exact same signOut()
// logic as the sidebar's own Logout button, not a second copy of it.
function renderUserChip(user) {
  const name = deriveNameFromEmail(user.email);
  document.getElementById("dashboardUserAvatar").textContent = name.charAt(0).toUpperCase();
  document.getElementById("dashboardUserName").textContent = name;
  document.getElementById("dashboardUserRole").textContent = ROLE_LABELS[user.role] || ROLE_LABELS.branch_clerk;
}

function wireUserMenu() {
  const btn = document.getElementById("dashboardUserMenuBtn");
  const menu = document.getElementById("dashboardUserMenu");
  if (!btn || !menu) return;

  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open(); else close();
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) close();
  });
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

// --- Upcoming Hearings (beyond today) ---------------------------------------
//
// Uses getUpcomingHearingsSorted() (dashboard-stats.js) against the same
// already-loaded `hearings` array the rest of the dashboard uses — no
// second hearings query. Compact by design (5 hearings max); "View all
// hearings" in the markup points at the existing hearings.html page for
// anything beyond that.

function renderUpcoming(hearingsArray) {
  const container = document.getElementById("upcomingHearingsList");
  const subEl = document.getElementById("upcomingHearingsSub");
  if (!container) return;

  const stats = computeDashboardStats(hearingsArray);
  if (subEl) {
    subEl.textContent = stats.hearingsNext7 > 0
      ? `${stats.hearingsNext7} scheduled in the next 7 days`
      : "None scheduled in the next 7 days";
  }

  const upcoming = getUpcomingHearingsSorted(hearingsArray);

  if (!upcoming.length) {
    container.innerHTML = `<p class="empty-row">No upcoming hearings scheduled.</p>`;
    return;
  }

  container.innerHTML = `
    <ul class="upcoming-list">
      ${upcoming
        .map((h) => `
          <li class="upcoming-item" data-preview-hearing="${h.id}" tabindex="0" role="button" aria-label="View hearing: ${esc(caseTitle(h))}, ${esc(formatHearingDate(h))}">
            <span class="upcoming-date">${esc(formatHearingDate(h))}</span>
            <span class="upcoming-case">${esc(caseTitle(h))}</span>
            <span class="upcoming-stage">${esc(h.status || "")}</span>
          </li>
        `)
        .join("")}
    </ul>
  `;

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

function formatHearingDate(hearing) {
  if (hearing.hearingDateTime && typeof hearing.hearingDateTime.toDate === "function") {
    const d = hearing.hearingDateTime.toDate();
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  return hearing.hearingDate || "Date not set";
}

// --- Error states ------------------------------------------------------
//
// subscribeToHearings()/subscribeToCaseRecords() (hearings-data.js/
// cases-data.js) now accept an optional onError callback — additive to
// those existing functions, not a new query. Wired here for the
// dashboard's two live listeners so a Firestore failure (offline,
// permission-denied, etc.) is shown to the user instead of leaving stat
// cards and the Today's Hearings panel stuck on "Loading…" forever.

function renderHearingsError(err) {
  console.error("Dashboard: hearings listener failed", err);
  const noticeHost = document.getElementById("dashboardHearingsError");
  const list = document.getElementById("todaysHearingsList");
  if (list) list.innerHTML = "";
  if (noticeHost) {
    showNotice(noticeHost, "Could not load today's hearings. Check your connection and try again.", "error");
    const closeBtn = noticeHost.querySelector(".inline-notice-close");
    if (closeBtn) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "inline-notice-retry";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", startHearingsSubscription);
      noticeHost.querySelector(".inline-notice")?.insertBefore(retryBtn, closeBtn);
    }
  }
  ["dashboardNowCard", "dashboardNextCard", "dashboardSummaryCard", "upcomingHearingsList"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<p class="muted">Unavailable.</p>`;
  });
  const statEl = document.getElementById("statHearingsToday");
  if (statEl) statEl.textContent = "\u2014";
  const subEl = document.getElementById("statHearingsTodaySub");
  if (subEl) subEl.textContent = "Unavailable";
}

function renderCaseStatsError(err) {
  console.error("Dashboard: case records listener failed", err);
  document.getElementById("statTotalCases").textContent = "\u2014";
  document.getElementById("statActiveCases").textContent = "\u2014";
  const el = document.getElementById("dashboardStatsError");
  if (el) {
    el.hidden = false;
    el.textContent = "Could not load case statistics. Check your connection and try again.";
  }
}

// --- Live re-render (data change or plain time passing) --------------------

function renderLive() {
  const todays = getTodaysHearingsSorted(hearings);
  renderNowCard(todays);
  renderNextCard(todays);
  renderSummaryCard(todays);
  renderTimeline(todays);
  renderUpcoming(hearings);
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
  if (!can(currentRole, PERMISSIONS.EXPORT)) return;
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
  // Reuses the same ?action=add entry point cases.js now supports —
  // calls the existing openAddForm() on the Cases page, no case-creation
  // form logic duplicated here. Mirrors qaAddHearingBtn below exactly.
  const addCaseBtn = document.getElementById("qaAddCaseBtn");
  if (can(currentRole, PERMISSIONS.CASES_CREATE)) {
    addCaseBtn.addEventListener("click", () => {
      window.location.href = "cases.html?action=add";
    });
  } else {
    addCaseBtn.hidden = true;
  }

  // Reuses the same ?action=add entry point hearings.js now supports —
  // calls the existing openAddForm(), no form logic duplicated here.
  const addBtn = document.getElementById("qaAddHearingBtn");
  if (can(currentRole, PERMISSIONS.HEARINGS_CREATE)) {
    addBtn.addEventListener("click", () => {
      window.location.href = "hearings.html?action=add";
    });
  } else {
    addBtn.hidden = true;
  }

  // Plain navigation — Calendar itself is completely unmodified.
  document.getElementById("qaOpenCalendarBtn").addEventListener("click", () => {
    window.location.href = "calendar.html";
  });

  const exportBtn = document.getElementById("qaExportTodayBtn");
  if (can(currentRole, PERMISSIONS.EXPORT)) {
    exportBtn.addEventListener("click", handleExportTodayQuickAction);
  } else {
    exportBtn.hidden = true;
  }

  updateQuickActionsLayout();
}

// The mobile 2-column grid (css/styles.css, "Quick Actions" media query)
// spans a lone leftover button full-width via :last-child — but that
// targets DOM position, not visibility. Once a permission hides one or
// two of these three buttons, the DOM's last child may no longer be the
// last *visible* one (e.g. Read Only: only Open Calendar remains, but
// it's the middle child, not :last-child), which would leave it stuck in
// column 1 with an empty column 2 beside it. This finds whichever button
// is actually last among the visible ones and marks it directly, rather
// than relying on DOM order.
function updateQuickActionsLayout() {
  const buttons = [
    document.getElementById("qaAddCaseBtn"),
    document.getElementById("qaAddHearingBtn"),
    document.getElementById("qaOpenCalendarBtn"),
    document.getElementById("qaExportTodayBtn"),
  ];
  buttons.forEach((b) => b.classList.remove("quick-action-last-visible"));
  const visible = buttons.filter((b) => !b.hidden);
  if (visible.length % 2 === 1) visible[visible.length - 1].classList.add("quick-action-last-visible");
}

// Single live hearings listener shared by the stat cards, the Session/
// Summary cards, the Timeline, and Upcoming Hearings — updates
// automatically whenever Firestore changes, same as every other
// subscribeToHearings() consumer in this app. Wrapped in its own
// function (rather than called once inline) so the error state's Retry
// button can re-run it after a listener failure.
function startHearingsSubscription() {
  clearNotice(document.getElementById("dashboardHearingsError"));
  if (typeof unsubscribeHearings === "function") unsubscribeHearings();
  unsubscribeHearings = subscribeToHearings(
    (data) => {
      hearings = data;
      renderStats(hearings);
      renderLive();
    },
    {},
    renderHearingsError
  );
}

// Total Cases / Active Cases stat cards: reuses cases-data.js's existing
// subscribeToCaseRecords() (already used by cases.js), called with
// includeArchived so a single listener can answer both "all time"
// (Total) and "currently ongoing" (Active, filtered client-side with
// the same isActiveCase() cases.js already uses).
function startCaseStatsSubscription() {
  const errEl = document.getElementById("dashboardStatsError");
  if (errEl) errEl.hidden = true;
  if (typeof unsubscribeCaseStats === "function") unsubscribeCaseStats();
  unsubscribeCaseStats = subscribeToCaseRecords(
    (data) => {
      renderCaseStats(data);
    },
    { includeArchived: true },
    renderCaseStatsError
  );
}

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return; // requireAuth already redirected to login

  currentRole = user.role;
  wireNavAuth(user);
  wireQuickActions();
  renderGreeting(user);
  renderDateBadge();
  renderUserChip(user);
  wireUserMenu();

  startHearingsSubscription();
  startCaseStatsSubscription();

  // Reuses hearings-data.js's existing subscribeToCases() (already used
  // by hearings.js) so "Export Today's Calendar" has case data available
  // — no new Firestore access code, just the same helper called again.
  // A failure here only affects the export quick action (handled there
  // via its own error message), so it doesn't need a dedicated dashboard
  // error state.
  subscribeToCases((data) => {
    cases = data;
  });

  // Keeps the Session card and Timeline ("Starts in N minutes", current/
  // next highlighting) accurate as real time passes, even between
  // Firestore updates. Pure client-side re-render — no network activity.
  setInterval(renderLive, 30000);
}

init();
