// ---------------------------------------------------------------------------
// Shared formatting + institutional-detail constants for Court Calendar
// export renderers (docx-export.js and pdf-export.js).
//
// Pure, renderer-agnostic values only: no docx, no pdfmake, no DOM. Pulled
// out of docx-export.js (unchanged, byte-for-byte) so the PDF renderer added
// alongside it doesn't need its own copy of the court personnel list or the
// date/filename formatting helpers — both renderers import the same values
// from here instead of each hardcoding them.
// ---------------------------------------------------------------------------

// Institutional details, hardcoded from the real reference document — this
// system's Firestore schema has no field for any of it.
export const COURT_PERSONNEL = [
  ["PROS. ANDREA JASTINE A. GUTIERREZ-CARLOS", "Public Prosecutor (OPP)"],
  ["PROS. SHIERMA F. OCAMPO-PATAWARAN", "Public Prosecutor (OCP)"],
  ["ATTY. JOSHUA ASHLEY D. PANLILIO", "PAO Lawyer"],
  ["ATTY. MARIA ANGELICA A. CABUNGAN", "Clerk of Court V"],
  ["ROWENA M. SABADO", "Court Interpreter III"],
  ["MARIA LUISA G. GARCIA", "Court Stenographer III"],
  ["MARGIE M. SERRANO", "Court Stenographer III"],
];

export function fmtLongDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function safeFilenamePart(s) {
  return (s || "").toString().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
