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
