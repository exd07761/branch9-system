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
import { computeDashboardStats, getTodaysHearingsSorted } from "./dashboard-stats.js?v=1.0.0";
import {
  getCurrentHearing,
  getNextUpcomingHearing,
  getTodaysSummary,
  minutesUntil,
  annotateTimelineStatuses,
} from "./dashboard-live.js?v=1.0.0";
import { exportCourtCalendarForDate, exportCourtCalendarForWeek, exportCourtCalendarForMonth } from "./docx-export.js?v=1.0.0";
import { exportCourtCalendarForDatePdf, exportCourtCalendarForWeekPdf, exportCourtCalendarForMonthPdf } from "./pdf-export.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { can, PERMISSIONS, ROLE_LABELS } from "./permissions.js?v=1.0.0";

const STATUS_LABEL = { now: "Now", next: "Next", completed: "Completed", upcoming: "Upcoming" };

let hearings = [];
let cases = [];
let currentRole = null;

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function renderStats(hearingsArray) {
  const stats = computeDashboardStats(hearingsArray);
  document.getElementById("statHearingsToday").textContent = stats.hearingsToday;
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

function wireSidebarToggle() {
  const btn = document.getElementById("sidebarToggleBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    btn.setAttribute("aria-pressed", String(collapsed));
    btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  });
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

// --- Export Calendar dropdown ------------------------------------------
// Same dropdown/format-choice UI as the Hearings page's Export Calendar
// button (export-dropdown/export-dropdown-menu CSS, DOCX + PDF per scope),
// wired independently here since this is a different page/DOM, but every
// button below calls the exact same shared exportCourtCalendarForX() /
// exportCourtCalendarForXPdf() functions the Hearings page uses — neither
// the calendar dataset preparation (export-data.js) nor either renderer
// (docx-export.js / pdf-export.js) is duplicated for the Dashboard.

function closeDashExportDropdown() {
  const menu = document.getElementById("dashExportDropdownMenu");
  const toggle = document.getElementById("dashExportDropdownToggle");
  menu.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
}

function wireDashExportDropdown() {
  const toggle = document.getElementById("dashExportDropdownToggle");
  const menu = document.getElementById("dashExportDropdownMenu");
  const dropdown = document.getElementById("dashExportDropdown");

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !menu.hidden;
    menu.hidden = isOpen;
    toggle.setAttribute("aria-expanded", String(!isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !dropdown.contains(e.target)) closeDashExportDropdown();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) closeDashExportDropdown();
  });

  menu.addEventListener("click", (e) => e.stopPropagation());
}

async function withDashExportButton(buttonId, format, task, onSuccess) {
  if (!can(currentRole, PERMISSIONS.EXPORT)) return;
  if (format === "pdf" && !window.pdfMake) {
    setQuickActionsStatus("Could not export: the PDF export library failed to load. Check your internet connection and try again.");
    return;
  }
  if (format === "docx" && !window.docx) {
    setQuickActionsStatus("Could not export: the Word export library failed to load. Check your internet connection and try again.");
    return;
  }
  const btn = document.getElementById(buttonId);
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Exporting\u2026";
  setQuickActionsStatus("");
  try {
    await task();
    if (onSuccess) logActivity(onSuccess());
    closeDashExportDropdown();
  } catch (err) {
    setQuickActionsStatus(`Could not export: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

async function handleDashExportSelectedDate(format) {
  const dateStr = document.getElementById("dashExportDateInput").value;
  if (!dateStr) {
    setQuickActionsStatus("Pick a date first.");
    return;
  }
  const exporter = format === "pdf" ? exportCourtCalendarForDatePdf : exportCourtCalendarForDate;
  await withDashExportButton(
    format === "pdf" ? "dashExportDatePdfBtn" : "dashExportDateDocxBtn",
    format,
    () => exporter(hearings, cases, dateStr),
    () => ({
      action: `Export Selected Date's Calendar (${format.toUpperCase()})`,
      module: "Dashboard",
      entityId: dateStr,
      entityType: "calendarExport",
      description: `Exported calendar (${format.toUpperCase()}) for ${dateStr}`,
    })
  );
}

async function handleDashExportCurrentWeek(format) {
  const anchorDate = new Date();
  const exporter = format === "pdf" ? exportCourtCalendarForWeekPdf : exportCourtCalendarForWeek;
  await withDashExportButton(
    format === "pdf" ? "dashExportWeekPdfBtn" : "dashExportWeekDocxBtn",
    format,
    () => exporter(hearings, cases, anchorDate),
    () => ({
      action: `Export Weekly Calendar (${format.toUpperCase()})`,
      module: "Dashboard",
      entityId: todayDateStr(anchorDate),
      entityType: "calendarExport",
      description: `Exported calendar (${format.toUpperCase()}) for the week of ${todayDateStr(anchorDate)}`,
    })
  );
}

async function handleDashExportCurrentMonth(format) {
  const anchorDate = new Date();
  const exporter = format === "pdf" ? exportCourtCalendarForMonthPdf : exportCourtCalendarForMonth;
  await withDashExportButton(
    format === "pdf" ? "dashExportMonthPdfBtn" : "dashExportMonthDocxBtn",
    format,
    () => exporter(hearings, cases, anchorDate),
    () => ({
      action: `Export Monthly Calendar (${format.toUpperCase()})`,
      module: "Dashboard",
      entityId: todayDateStr(anchorDate),
      entityType: "calendarExport",
      description: `Exported calendar (${format.toUpperCase()}) for the month of ${anchorDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    })
  );
}

function wireQuickActions() {
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

  if (can(currentRole, PERMISSIONS.EXPORT)) {
    document.getElementById("dashExportDateDocxBtn").addEventListener("click", () => handleDashExportSelectedDate("docx"));
    document.getElementById("dashExportDatePdfBtn").addEventListener("click", () => handleDashExportSelectedDate("pdf"));
    document.getElementById("dashExportWeekDocxBtn").addEventListener("click", () => handleDashExportCurrentWeek("docx"));
    document.getElementById("dashExportWeekPdfBtn").addEventListener("click", () => handleDashExportCurrentWeek("pdf"));
    document.getElementById("dashExportMonthDocxBtn").addEventListener("click", () => handleDashExportCurrentMonth("docx"));
    document.getElementById("dashExportMonthPdfBtn").addEventListener("click", () => handleDashExportCurrentMonth("pdf"));
    wireDashExportDropdown();
  } else {
    document.getElementById("dashExportDropdown").hidden = true;
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
    document.getElementById("qaAddHearingBtn"),
    document.getElementById("qaOpenCalendarBtn"),
    document.getElementById("dashExportDropdown"),
  ];
  buttons.forEach((b) => b.classList.remove("quick-action-last-visible"));
  const visible = buttons.filter((b) => !b.hidden);
  if (visible.length % 2 === 1) visible[visible.length - 1].classList.add("quick-action-last-visible");
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
  wireSidebarToggle();

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

  // Total Cases / Active Cases stat cards: reuses cases-data.js's
  // existing subscribeToCaseRecords() (already used by cases.js),
  // called with includeArchived so a single listener can answer both
  // "all time" (Total) and "currently ongoing" (Active, filtered
  // client-side with the same isActiveCase() cases.js already uses).
  subscribeToCaseRecords((data) => {
    renderCaseStats(data);
  }, { includeArchived: true });

  // Keeps the Session card and Timeline ("Starts in N minutes", current/
  // next highlighting) accurate as real time passes, even between
  // Firestore updates. Pure client-side re-render — no network activity.
  setInterval(renderLive, 30000);
}

init();
