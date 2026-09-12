// ---------------------------------------------------------------------------
// Shared DOM utilities.
//
// escapeHtml() is the single authoritative HTML-escaping helper for
// DOM-generated markup across Branch9's page controllers. Phase 3
// (Design System) extracted this from 12 byte-identical, independently
// duplicated `esc()` copies (activity.js, archived.js, backup.js,
// calendar.js, case-detail.js, cases.js, hearings.js, home.js,
// migration-dryrun.js, migration-execute.js, reports.js, users.js) plus
// auth-guard.js's differently-named but logically identical
// escapeHtml(). Every call site kept its original local name via
// `import { escapeHtml as esc } from "./dom-utils.js?v=1.0.0"` so no
// call site needed to change.
//
// NOT related to docx-export.js's or pdf-export.js's own esc() helpers.
// Those serve a different purpose (passing values through unescaped to
// the docx/pdfmake document builders, which do their own text handling)
// and were intentionally left untouched by this refactor — see the
// Phase 3 final report.
// ---------------------------------------------------------------------------

/**
 * Escapes &, <, >, and " so a string can be safely interpolated into
 * innerHTML-assigned markup. Does not escape single quotes — no call site
 * in this codebase interpolates into a single-quoted HTML attribute.
 */
export function escapeHtml(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

// ---------------------------------------------------------------------------
// Phase 11 (Performance, Accessibility & Mobile QA): trapTabKey().
//
// hearings.js's and archived.js's hand-built Quick View dialogs
// (`role="dialog" aria-modal="true"`) render fine visually but had no
// actual focus management — Tab could reach the page content sitting
// behind the overlay while it was open. This is the single shared fix
// for both call sites rather than two copies of the same Tab-wrapping
// logic; it does not move initial focus or restore it afterwards (each
// caller does that itself, since each already tracks its own trigger
// element and close button).
// ---------------------------------------------------------------------------

/**
 * Keydown handler to attach to a dialog's outermost element. Wraps Tab/
 * Shift+Tab between the dialog's first and last focusable children so
 * keyboard focus can't leave the dialog while it's open. Intentionally
 * narrow — not a general focus-trap library, just first/last wrapping.
 */
export function trapTabKey(containerEl, event) {
  if (event.key !== "Tab") return;
  const focusable = containerEl.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
