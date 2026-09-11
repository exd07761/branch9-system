// ---------------------------------------------------------------------------
// Shared nav UI helper.
//
// This does NOT duplicate authentication logic — auth-guard.js's
// requireAuth()/redirectIfAuthenticated() remain the only functions that
// talk to Firebase Auth's onAuthStateChanged, exactly as before. Every
// page still calls requireAuth() itself, on its own, to decide whether to
// render at all.
//
// What this file adds is much narrower: once a page already has the user
// object requireAuth() resolved, wireNavAuth(user) does the small,
// identical things every authenticated page's nav bar needs — show the
// signed-in email, make the Logout button actually sign out, mark which
// link is "current," and wire the sidebar collapse toggle — in one place
// instead of copy-pasted into home.js/hearings.js/calendar.js/etc.
//
// Phase 4 (app shell): markActiveNavLink() and wireSidebarToggle() were
// added here specifically so the active-page highlight and the sidebar
// collapse control are consistent across every authenticated page, since
// every one of those pages already calls wireNavAuth(user) as its single
// nav-wiring call site — no page's own JS needed to change.
//
// All target elements are optional: each helper below checks for its
// element(s) before touching anything, so it's safe to call from any page
// regardless of exactly which nav/shell elements that page happens to
// include.
// ---------------------------------------------------------------------------

import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "./firebase-init.js?v=1.0.0";
import { logActivity } from "./activity-data.js?v=1.0.0";
import { can } from "./permissions.js?v=1.0.0";

// v0.9.2 (RBAC): nav links a role can't use are hidden here, in the one
// place every page already calls to wire its nav — this is the reusable
// permission helper's single call site for "which nav links show," so no
// page repeats this check itself. A link opts in by adding
// data-permission="<permission>" (see permissions.js for the list); links
// with no data-permission attribute (Home, Hearings, Calendar) are always
// shown, since every role has access to those.
function applyNavPermissions(role) {
  document.querySelectorAll(".app-nav-links [data-permission]").forEach((link) => {
    link.hidden = !can(role, link.dataset.permission);
  });
}

// Derives the active link from the URL rather than trusting each HTML
// file's hand-set class="active", so a page whose markup drifts out of
// sync still highlights correctly — but only when the current page IS one
// of the primary nav destinations. Sub-pages like case-detail.html aren't
// themselves a nav link; that page's markup deliberately marks "Cases" as
// active instead (case-detail belongs to the Cases section), and there's
// no reliable way to infer that from the URL alone, so when nothing
// matches exactly this leaves whatever the page already set untouched.
// aria-current="page" is applied to whichever link ends up active either
// way, so the current page is exposed to assistive tech too.
function markActiveNavLink() {
  const links = document.querySelectorAll(".app-nav-links .app-nav-link");
  if (!links.length) return;

  const currentPage = location.pathname.split("/").pop() || "home.html";
  const hasExactMatch = Array.from(links).some(
    (link) => link.getAttribute("href") === currentPage
  );

  links.forEach((link) => {
    if (hasExactMatch) {
      link.classList.toggle("active", link.getAttribute("href") === currentPage);
    }
    if (link.classList.contains("active")) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

// Sidebar collapse toggle (desktop sidebar tier only — see styles.css).
// State is persisted so it stays collapsed/expanded as the user moves
// between pages instead of resetting on every navigation. The class
// itself is applied as early as possible via a small inline snippet at
// the top of <body> (before the nav markup renders) so there's no visible
// flash of an expanded sidebar before this module loads; this function
// only needs to sync the button's own ARIA state and wire the click.
const SIDEBAR_COLLAPSED_KEY = "branch9SidebarCollapsed";

function wireSidebarToggle() {
  const btn = document.getElementById("sidebarToggleBtn");
  if (!btn) return;

  const syncButton = (collapsed) => {
    btn.setAttribute("aria-pressed", String(collapsed));
    btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  };

  syncButton(document.body.classList.contains("sidebar-collapsed"));

  btn.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    syncButton(collapsed);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Private-browsing / storage-disabled: collapse still works for the
      // current page, it just won't persist across navigation.
    }
  });
}

export function wireNavAuth(user, { loginPage = "login.html" } = {}) {
  markActiveNavLink();
  wireSidebarToggle();

  const emailEl = document.getElementById("userEmail");
  if (emailEl && user) {
    emailEl.textContent = user.email;
  }

  if (user) applyNavPermissions(user.role);

  const doLogout = async () => {
    // Logged before signOut() — auth.currentUser is cleared once
    // signOut() resolves, and logActivity() falls back to "unknown"
    // without it. Not awaited: never delay the redirect over logging.
    logActivity({
      action: "Logout",
      module: "Authentication",
      description: `${user.email} logged out`,
    });
    await signOut(auth);
    window.location.replace(loginPage);
  };

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", doLogout);

  // Additive, opt-in: any element carrying data-logout-trigger gets the
  // exact same sign-out behavior as the main #logoutBtn above, so a page
  // can offer a second logout entry point (e.g. the dashboard's header
  // user menu) without duplicating the signOut()/logActivity() logic.
  // No page had any such elements before this, so this is a no-op
  // everywhere except where one is deliberately added.
  document.querySelectorAll("[data-logout-trigger]").forEach((el) => {
    el.addEventListener("click", doLogout);
  });
}
