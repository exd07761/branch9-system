// ---------------------------------------------------------------------------
// Shared inline notification component (Phase 3 design system).
//
// showNotice(container, message, type) renders a single dismissible inline
// notice into `container` (a DOM element), replacing whatever notice was
// already shown there. It exists to replace the app's three native
// alert() call sites (hearings.js "Could not archive", archived.js
// "Could not restore", cases.js "Could not archive" — Phase 2 audit,
// Error Handling) with something styled consistently with the rest of the
// app's inline feedback (.form-error, users.js's setStatus()), rather
// than a blocking, unstyled browser dialog.
//
// This changes presentation only: the same message that previously went
// to alert() is passed straight through to showNotice() unchanged, and
// the surrounding try/catch/logActivity logic in each caller is untouched.
// ---------------------------------------------------------------------------

import { escapeHtml } from "./dom-utils.js?v=1.0.0";

/**
 * @param {HTMLElement|null} container element to render the notice into
 * @param {string} message text to show (escaped — safe with error.message)
 * @param {"error"|"success"|"warning"|"info"} [type]
 */
export function showNotice(container, message, type = "error") {
  if (!container) return;
  container.innerHTML =
    `<div class="inline-notice inline-notice-${type}" role="alert">` +
      `<span class="inline-notice-message">${escapeHtml(message)}</span>` +
      `<button type="button" class="inline-notice-close" aria-label="Dismiss">&times;</button>` +
    `</div>`;
  const closeBtn = container.querySelector(".inline-notice-close");
  if (closeBtn) closeBtn.addEventListener("click", () => clearNotice(container));
}

/** Clears whatever notice showNotice() previously rendered into container. */
export function clearNotice(container) {
  if (container) container.innerHTML = "";
}
