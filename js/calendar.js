// ---------------------------------------------------------------------------
// Calendar page controller.
//
// STRICTLY READ-ONLY. This file never creates, edits, deletes, or
// validates a hearing — all of that logic lives only in hearings.js /
// hearings-data.js. Selecting a hearing anywhere in this page navigates
// to hearings.html?openHearing=<id>, which reuses the existing edit form
// there (see the small addition in hearings.js's init()). Nothing here
// duplicates that logic.
//
// Structure, kept modular on purpose so future features (color coding,
// filters, drag-and-drop, printable views) can be added without
// rewriting this core:
//   - Pure date-math helpers (no Firestore, no DOM)
//   - One render function per view (renderMonthView / renderWeekView / renderDayView)
//   - One shared range-fetch + dispatch function (refresh())
//   - Day View's on-demand case loading is isolated to its own small block
// ---------------------------------------------------------------------------

import { requireAuth } from "./auth-guard.js";
import { subscribeToHearingsInRange, fetchCasesForHearing } from "./calendar-data.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// --- State ---------------------------------------------------------------

let viewMode = "month"; // "month" | "week" | "day"
let anchorDate = atMidnight(new Date());
let hearingsInRange = [];
let unsubscribeCurrent = null;

// Day View only: which hearings are expanded, and a cache of fetched
// cases so re-expanding the same hearing doesn't refetch. Session-only —
// resets on page reload, which is fine since this is just a convenience
// cache, not a source of truth.
const expandedHearingIds = new Set();
const caseCache = new Map(); // hearingId -> cases[]

// --- Pure date helpers (no Firestore, no DOM) -----------------------------

function atMidnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfWeek(date) {
  const d = atMidnight(date);
  return addDays(d, -d.getDay()); // getDay(): Sunday = 0
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Exclusive [start, end) range covering the full weeks a month's grid needs. */
function getMonthGridRange(anchor) {
  const start = startOfWeek(startOfMonth(anchor));
  const end = addDays(startOfWeek(endOfMonth(anchor)), 7);
  return { start, end };
}

function getWeekRange(anchor) {
  const start = startOfWeek(anchor);
  return { start, end: addDays(start, 7) };
}

function getDayRange(anchor) {
  const start = atMidnight(anchor);
  return { start, end: addDays(start, 1) };
}

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

// --- Shared formatting (used by more than one view) -----------------------

/** Compact one-line label for Month/Week cells. */
function hearingCompactLabel(h) {
  const time = h.hearingTime || "No time";
  const accused = (h.accused || []).join(", ") || "(no accused listed)";
  return `${esc(time)} &mdash; ${esc(accused)}`;
}

function rangeLabelText() {
  if (viewMode === "month") {
    return `${MONTH_NAMES[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`;
  }
  if (viewMode === "week") {
    const { start } = getWeekRange(anchorDate);
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}`;
    const endStr = sameMonth
      ? `${end.getDate()}, ${end.getFullYear()}`
      : `${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
    return `${startStr} \u2013 ${endStr}`;
  }
  // day
  return `${DAY_NAMES_FULL[anchorDate.getDay()]}, ${MONTH_NAMES[anchorDate.getMonth()]} ${anchorDate.getDate()}, ${anchorDate.getFullYear()}`;
}

// --- Month View ------------------------------------------------------------

function renderMonthView() {
  const { start, end } = getMonthGridRange(anchorDate);
  const byDate = {};
  hearingsInRange.forEach((h) => {
    if (!h.hearingDate) return;
    (byDate[h.hearingDate] = byDate[h.hearingDate] || []).push(h);
  });

  const currentMonth = anchorDate.getMonth();
  const cells = [];
  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const dateStr = isoDate(d);
    const dayHearings = byDate[dateStr] || [];
    const inCurrentMonth = d.getMonth() === currentMonth;
    const isToday = isoDate(atMidnight(new Date())) === dateStr;
    const shown = dayHearings.slice(0, 3);
    const extra = dayHearings.length - shown.length;

    cells.push(`
      <div class="cal-month-cell ${inCurrentMonth ? "" : "cal-month-cell-muted"} ${isToday ? "cal-month-cell-today" : ""}" data-date="${dateStr}">
        <div class="cal-month-daynum">${d.getDate()}</div>
        <div class="cal-month-entries">
          ${shown
            .map(
              (h) =>
                `<div class="cal-month-entry" data-open-hearing="${h.id}">${hearingCompactLabel(h)}</div>`
            )
            .join("")}
          ${extra > 0 ? `<div class="cal-month-more">+${extra} more</div>` : ""}
        </div>
      </div>
    `);
  }

  return `
    <div class="cal-month-grid">
      ${DAY_NAMES.map((n) => `<div class="cal-month-headcell">${n}</div>`).join("")}
      ${cells.join("")}
    </div>
  `;
}

// --- Week View --------------------------------------------------------------

function renderWeekView() {
  const { start } = getWeekRange(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const byDate = {};
  hearingsInRange.forEach((h) => {
    if (!h.hearingDate) return;
    (byDate[h.hearingDate] = byDate[h.hearingDate] || []).push(h);
  });

  return `
    <div class="cal-week-grid">
      ${days
        .map((d) => {
          const dateStr = isoDate(d);
          const dayHearings = byDate[dateStr] || [];
          const isToday = isoDate(atMidnight(new Date())) === dateStr;
          return `
            <div class="cal-week-col">
              <div class="cal-week-colhead ${isToday ? "cal-week-colhead-today" : ""}">
                ${DAY_NAMES[d.getDay()]} ${d.getDate()}
              </div>
              <div class="cal-week-entries">
                ${
                  dayHearings.length
                    ? dayHearings
                        .map(
                          (h) => `
                          <div class="cal-week-entry" data-open-hearing="${h.id}">
                            <div class="cal-week-entry-time">${esc(h.hearingTime || "No time")}</div>
                            <div class="cal-week-entry-section">${esc(h.section)}</div>
                            <div class="cal-week-entry-accused">${esc((h.accused || []).join(", "))}</div>
                            <div class="cal-week-entry-count">${h.caseCount ?? 0} case(s)</div>
                          </div>
                        `
                        )
                        .join("")
                    : `<p class="cal-week-empty">No hearings</p>`
                }
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

// --- Day View ----------------------------------------------------------------

function renderDayView() {
  if (!hearingsInRange.length) {
    return `<p class="empty-row">No hearings scheduled for this day.</p>`;
  }

  return `
    <div class="cal-day-list">
      ${hearingsInRange.map((h) => dayHearingCardHtml(h)).join("")}
    </div>
  `;
}

function dayHearingCardHtml(h) {
  const isExpanded = expandedHearingIds.has(h.id);
  const cached = caseCache.get(h.id);

  let casesHtml = "";
  if (isExpanded) {
    if (cached) {
      casesHtml = cached.length
        ? `<ul class="cal-case-list">${cached
            .map((c) => `<li>${esc(c.caseType)}. ${esc(c.caseNo)} &mdash; ${esc(c.charge || "No charge on file")}</li>`)
            .join("")}</ul>`
        : `<p class="cal-case-empty">No case numbers on file.</p>`;
    } else {
      casesHtml = `<p class="cal-case-loading">Loading cases&hellip;</p>`;
    }
  }

  return `
    <div class="cal-day-card">
      <div class="cal-day-card-main">
        <div class="cal-day-card-time">${esc(h.hearingTime || "No time set")}</div>
        <div class="cal-day-card-body">
          <p class="cal-day-card-title">${esc(h.hearingType)}</p>
          <p class="cal-day-card-meta">${esc(h.section)} &middot; ${esc(h.status)}</p>
          <p class="cal-day-card-meta">${esc((h.accused || []).join(", "))}</p>
        </div>
        <div class="cal-day-card-actions">
          <button type="button" class="btn-small" data-toggle-expand="${h.id}">
            ${isExpanded ? "Hide cases" : `Show cases (${h.caseCount ?? 0})`}
          </button>
          <a class="btn-small cal-details-link" href="hearings.html?openHearing=${encodeURIComponent(h.id)}">Details</a>
        </div>
      </div>
      ${isExpanded ? `<div class="cal-day-card-cases">${casesHtml}</div>` : ""}
    </div>
  `;
}

// --- Rendering dispatch + event wiring ---------------------------------------

function renderCurrentView() {
  const content = document.getElementById("calendarContent");
  if (viewMode === "month") {
    content.innerHTML = renderMonthView();
  } else if (viewMode === "week") {
    content.innerHTML = renderWeekView();
  } else {
    content.innerHTML = renderDayView();
  }
  wireContentEvents();
  document.getElementById("rangeLabel").textContent = rangeLabelText();
  document.querySelectorAll(".cal-view-btn").forEach((btn) => {
    btn.classList.toggle("cal-view-btn-active", btn.dataset.view === viewMode);
  });
}

function wireContentEvents() {
  // Clicking a hearing entry (Month/Week) navigates straight to its
  // details on the Hearings page — no logic is duplicated here.
  document.querySelectorAll("[data-open-hearing]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.href = `hearings.html?openHearing=${encodeURIComponent(el.dataset.openHearing)}`;
    });
  });

  // Clicking a Month cell's date area (not a specific entry) drills into
  // Day View for that date.
  document.querySelectorAll(".cal-month-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      anchorDate = atMidnight(new Date(cell.dataset.date + "T00:00:00"));
      viewMode = "day";
      refresh();
    });
  });

  // Day View: expand/collapse a hearing's case list, fetching on demand
  // only the first time it's expanded.
  document.querySelectorAll("[data-toggle-expand]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const hearingId = btn.dataset.toggleExpand;
      if (expandedHearingIds.has(hearingId)) {
        expandedHearingIds.delete(hearingId);
        renderCurrentView();
        return;
      }
      expandedHearingIds.add(hearingId);
      renderCurrentView(); // shows "Loading cases…" immediately

      if (!caseCache.has(hearingId)) {
        try {
          const cases = await fetchCasesForHearing(hearingId);
          caseCache.set(hearingId, cases);
        } catch (err) {
          caseCache.set(hearingId, []); // fail safe — show "no case numbers" rather than hang
        }
        // Only re-render if still expanded (Clerk might have collapsed
        // it again while the fetch was in flight).
        if (expandedHearingIds.has(hearingId)) renderCurrentView();
      }
    });
  });
}

// --- Range subscription (re-runs whenever viewMode or anchorDate changes) ---

function currentRange() {
  if (viewMode === "month") return getMonthGridRange(anchorDate);
  if (viewMode === "week") return getWeekRange(anchorDate);
  return getDayRange(anchorDate);
}

function refresh() {
  if (unsubscribeCurrent) {
    unsubscribeCurrent();
    unsubscribeCurrent = null;
  }
  const { start, end } = currentRange();
  unsubscribeCurrent = subscribeToHearingsInRange(start, end, (data) => {
    hearingsInRange = data;
    renderCurrentView();
  });
}

// --- Toolbar wiring -----------------------------------------------------------

function wireToolbar() {
  document.querySelectorAll(".cal-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      viewMode = btn.dataset.view;
      refresh();
    });
  });

  document.getElementById("prevBtn").addEventListener("click", () => {
    if (viewMode === "month") {
      anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
    } else if (viewMode === "week") {
      anchorDate = addDays(anchorDate, -7);
    } else {
      anchorDate = addDays(anchorDate, -1);
    }
    refresh();
  });

  document.getElementById("nextBtn").addEventListener("click", () => {
    if (viewMode === "month") {
      anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
    } else if (viewMode === "week") {
      anchorDate = addDays(anchorDate, 7);
    } else {
      anchorDate = addDays(anchorDate, 1);
    }
    refresh();
  });

  document.getElementById("todayBtn").addEventListener("click", () => {
    anchorDate = atMidnight(new Date());
    refresh();
  });
}

// --- Init ---------------------------------------------------------------------

async function init() {
  const user = await requireAuth({ loginPage: "login.html" });
  if (!user) return;

  wireToolbar();
  refresh();
}

init();
