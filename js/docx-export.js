// ---------------------------------------------------------------------------
// Hearing Order (.docx) export.
//
// STRICTLY ISOLATED: this module never touches Firestore, auth, or any
// business logic. Its only inputs are plain data already loaded elsewhere
// in the app (a hearing object + its array of case objects) — no new
// queries are made to produce an export.
//
// This replicates the Branch's actual Word document format (letterhead,
// court personnel list, and the shaded 6-column table layout), scoped to
// a single hearing instead of a full multi-hearing calendar. Source of
// truth for the exact wording/formatting: the uploaded reference document
// "Branch9_Court_Calendar_2026-07-19.doc".
//
// Two deliberate deviations from the original v0.6.0 brief, both because
// "replicate this document exactly" is the more specific, later
// instruction:
//   - Font is Century Schoolbook (the real document's font), not Times
//     New Roman.
//   - Page size is Legal (8.5in x 14in) with 1in/0.75in/1in/0.75in
//     margins (top/right/bottom/left), matching the real document,
//     rather than a generic "standard" Letter-size margin.
//
// Known gap: the reference document includes per-case notification/
// private-complainant status lines (e.g. "PCAAA C/O ..."). That data
// (pcInfo / accusedNotifiedStatus) was a deliberate simplification
// dropped from this system's schema back in Milestone 3 and doesn't
// exist here — so those lines are simply omitted rather than fabricated.
//
// Uses the "docx" library (docx.js.org) via CDN <script> tag in
// hearings.html, exposing a global `docx` namespace. Pinned to v8.0.4.
//
// Version history: originally pinned to v5.0.2. That version was proven
// to have a broken browser Packer — confirmed via a minimal one-paragraph
// isolation test (window.__docxDiagnosticTest(), see below) that still
// produced a blank .docx despite Packer.toBlob() resolving with a
// correctly-sized, correctly-typed blob. That ruled out this file's
// template-building code as the cause. v8.0.4 was chosen because its own
// published package.json still lists "main": "build/index.js" — the same
// plain-global-exposing entry point v5.0.2 used — while being a much
// later, more mature release. Versions above ~8.2 restructured the
// package around ES module exports and no longer reliably expose a plain
// `window.docx` global from a single <script> tag with no bundler, which
// this project requires, so do not bump past the 8.x line without
// re-verifying that first.
//
// Kept modular so a future template could reuse the shared pieces
// (buildLetterhead, buildCourtPersonnel, buildDocumentShell,
// downloadBlob) without touching this function or any Firestore/auth
// code:
//   - buildLetterhead()      — court name/branch/judge block
//   - buildCourtPersonnel()  — the dot-leader personnel list
//   - buildHearingTable()    — the shaded 6-column table for one hearing
//   - buildDocumentShell()   — legal-size page + default font wrapper
//   - downloadBlob()         — generic Blob-to-file-download helper
//   - exportHearingOrderToWord() — composes the above for one hearing
// ---------------------------------------------------------------------------

const FONT = "Century Schoolbook";
const BLACK = "000000";

// --- TEMPORARY DIAGNOSTICS (module load time) -----------------------------
// Confirms exactly what the CDN actually delivered, before any of our own
// code runs. Logged once, as soon as this module is evaluated (hearings.js
// imports it at page load, so this fires immediately, before any click).
(function logLoadedDocxLibrary() {
  console.log("[docx-diagnostic] typeof window.docx:", typeof window.docx);
  if (typeof window.docx === "undefined") {
    console.error("[docx-diagnostic] window.docx is undefined — the CDN script did not load or did not expose a global. Check the Network tab for the docx@5.0.2 request.");
    return;
  }
  // docx's namespace object doesn't reliably expose a version string across
  // all builds, so try a few known/likely locations defensively rather than
  // assuming one — none of these throw if the path doesn't exist.
  console.log("[docx-diagnostic] docx.version:", docx.version);
  console.log("[docx-diagnostic] docx.default?.version:", docx.default && docx.default.version);
  console.log("[docx-diagnostic] Object.keys(docx) sample:", Object.keys(docx).slice(0, 30));
  console.log("[docx-diagnostic] typeof docx.Document / Paragraph / TextRun / Table / Packer:",
    typeof docx.Document, typeof docx.Paragraph, typeof docx.TextRun, typeof docx.Table, typeof docx.Packer);
})();
// --- END TEMPORARY DIAGNOSTICS ---------------------------------------------

// Institutional details, hardcoded from the real reference document —
// this system's Firestore schema has no field for any of it.
const COURT_PERSONNEL = [
  ["PROS. ANDREA JASTINE A. GUTIERREZ-CARLOS", "Public Prosecutor (OPP)"],
  ["PROS. SHIERMA F. OCAMPO-PATAWARAN", "Public Prosecutor (OCP)"],
  ["ATTY. JOSHUA ASHLEY D. PANLILIO", "PAO Lawyer"],
  ["ATTY. MARIA ANGELICA A. CABUNGAN", "Clerk of Court V"],
  ["ROWENA M. SABADO", "Court Interpreter III"],
  ["MARIA LUISA G. GARCIA", "Court Stenographer III"],
  ["MARGIE M. SERRANO", "Court Stenographer III"],
];

function esc(s) {
  return (s || "").toString();
}

function fmtLongDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function run(text, opts = {}) {
  return new docx.TextRun({ text: esc(text), font: FONT, color: BLACK, ...opts });
}

function centeredPara(children, opts = {}) {
  return new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children, ...opts });
}

/**
 * The court name / branch / judge block at the top of the document.
 * Matches the reference document's exact wording and sizing.
 */
function buildLetterhead() {
  return [
    centeredPara([run("Republic of the Philippines", { size: 22 })]),
    centeredPara([run("FAMILY COURT", { size: 26, bold: true })]),
    centeredPara([run("Third Judicial Region", { size: 22 })]),
    centeredPara([run("BRANCH 9", { size: 26, bold: true })]),
    centeredPara([run("City of San Fernando, Pampanga", { size: 22 })]),
    centeredPara([
      run("fc1sfp0009@judiciary.gov.ph  |  0970-6461152 / 0955-4724408", { size: 18 }),
    ]),
    centeredPara([run("HON. ROHERMIA J. JAMSANI-RODRIGUEZ", { size: 22, bold: true, underline: {} })], {
      spacing: { before: 200 },
    }),
    centeredPara([run("Presiding Judge", { size: 18 })]),
  ];
}

/**
 * The dot-leader court personnel list, matching the reference document.
 */
function buildCourtPersonnel() {
  return COURT_PERSONNEL.map(([name, title]) => {
    const dots = ".".repeat(Math.max(3, 70 - (name.length + title.length)));
    return centeredPara([run(`${name} ${dots} ${title}`, { size: 18 })], { spacing: { after: 60 } });
  });
}

function tableHeaderCell(text, widthDxa) {
  return new docx.TableCell({
    width: { size: widthDxa, type: docx.WidthType.DXA },
    shading: { fill: "D9D9D9" },
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children: [new docx.Paragraph({ children: [run(text, { bold: true, size: 20 })] })],
  });
}

function tableBodyCell(paragraphs, widthDxa) {
  return new docx.TableCell({
    width: { size: widthDxa, type: docx.WidthType.DXA },
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    verticalAlign: docx.VerticalAlign.TOP,
    children: paragraphs,
  });
}

/**
 * Builds the single-row, 6-column table for one hearing, matching the
 * reference document's "CASE NO(S). / DETAILS", "TITLE / VICTIM(S)",
 * "FOR / CHARGE", "COUNSEL", "STATUS / HEARING" layout — just with one
 * data row instead of a full calendar's worth.
 */
function buildHearingTable(hearing, cases) {
  const headerRow = new docx.TableRow({
    tableHeader: true,
    children: [
      tableHeaderCell("#", 504),
      tableHeaderCell("CASE NO(S). / DETAILS", 2419),
      tableHeaderCell("TITLE / VICTIM(S)", 2016),
      tableHeaderCell("FOR / CHARGE", 1613),
      tableHeaderCell("COUNSEL", 1512),
      tableHeaderCell("STATUS / HEARING", 2016),
    ],
  });

  // --- Column 2: Case No(s). / Details ---
  const detailsParas = [];
  (cases || []).forEach((c) => {
    const caseLabel = [c.caseType, c.caseNo].filter(Boolean).join(" No. ");
    detailsParas.push(new docx.Paragraph({ children: [run(caseLabel, { bold: true, size: 20 })], spacing: { after: 60 } }));
  });
  detailsParas.push(
    new docx.Paragraph({ children: [run(hearing.hearingType, { italics: true, size: 20 })], spacing: { after: 60 } })
  );
  const datesFiled = [...new Set((cases || []).map((c) => c.dateFiled).filter(Boolean))];
  if (datesFiled.length) {
    detailsParas.push(
      new docx.Paragraph({
        children: [run(`Date filed: ${datesFiled.map(fmtLongDate).join(", ")}`, { size: 20 })],
      })
    );
  }

  // --- Column 3: Title / Victim(s) ---
  const titleParas = [
    new docx.Paragraph({ children: [run(hearing.plaintiff, { size: 20 })], spacing: { after: 40 } }),
    new docx.Paragraph({ children: [run("versus", { italics: true, size: 20 })], spacing: { after: 40 } }),
    new docx.Paragraph({
      children: [run((hearing.accused || []).join(", "), { bold: true, size: 20 })],
      spacing: { after: 60 },
    }),
  ];
  if (hearing.detentionStatus) {
    titleParas.push(new docx.Paragraph({ children: [run(hearing.detentionStatus, { size: 20 })], spacing: { after: 60 } }));
  }
  if ((hearing.victims || []).length) {
    titleParas.push(new docx.Paragraph({ children: [run(`Victim(s): ${(hearing.victims || []).join(", ")}`, { size: 20 })] }));
  }

  // --- Column 4: For / Charge ---
  const chargeParas = (cases || []).length
    ? cases.map(
        (c) =>
          new docx.Paragraph({
            children: [run(`${c.caseNo ? c.caseNo + ": " : ""}${c.charge || ""}`, { size: 20 })],
            spacing: { after: 60 },
          })
      )
    : [new docx.Paragraph({ children: [run("Not set", { italics: true, size: 20 })] })];

  // --- Column 5: Counsel ---
  const counselParas = [
    new docx.Paragraph({ children: [run(hearing.counselForPeople, { size: 20 })], spacing: { after: 20 } }),
    new docx.Paragraph({ children: [run("for the People", { italics: true, size: 18 })], spacing: { after: 100 } }),
    new docx.Paragraph({ children: [run(hearing.counselForAccused, { size: 20 })], spacing: { after: 20 } }),
    new docx.Paragraph({ children: [run("for the Accused", { italics: true, size: 18 })] }),
  ];

  // --- Column 6: Status / Hearing ---
  const hearingLine = hearing.hearingTime ? `${fmtLongDate(hearing.hearingDate)} \u2013 ${hearing.hearingTime}` : fmtLongDate(hearing.hearingDate);
  const statusParas = [
    new docx.Paragraph({ children: [run("Status:", { bold: true, size: 18 })] }),
    new docx.Paragraph({ children: [run(hearing.status, { size: 20 })], spacing: { after: 100 } }),
    new docx.Paragraph({ children: [run("Hearing:", { bold: true, size: 18 })] }),
    new docx.Paragraph({ children: [run(hearingLine || "Not set", { size: 20 })] }),
  ];

  const dataRow = new docx.TableRow({
    children: [
      tableBodyCell([new docx.Paragraph({ children: [run("1", { size: 20 })] })], 504),
      tableBodyCell(detailsParas, 2419),
      tableBodyCell(titleParas, 2016),
      tableBodyCell(chargeParas, 1613),
      tableBodyCell(counselParas, 1512),
      tableBodyCell(statusParas, 2016),
    ],
  });

  const dataRowCellParaCounts = {
    details: detailsParas.length,
    title: titleParas.length,
    charge: chargeParas.length,
    counsel: counselParas.length,
    status: statusParas.length,
  };

  // --- TEMPORARY DIAGNOSTICS ---
  console.log("[docx-diagnostic] buildHearingTable: rows =", 2, "(1 header + 1 data)");
  console.log("[docx-diagnostic] buildHearingTable: cases passed in =", (cases || []).length, cases);
  console.log("[docx-diagnostic] buildHearingTable: paragraph count per data-row cell =", dataRowCellParaCounts);
  // --- END TEMPORARY DIAGNOSTICS ---

  return new docx.Table({
    width: { size: 10080, type: docx.WidthType.DXA },
    borders: {
      top: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      left: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      right: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      insideVertical: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
    },
    rows: [headerRow, dataRow],
  });
}

/**
 * Legal-size page (matching the reference document), standard document
 * font, no color set anywhere except explicit black — guarantees
 * black-only text throughout.
 */
function buildDocumentShell(bodyChildren) {
  return new docx.Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20, color: BLACK } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 20160 }, // 8.5in x 14in (legal), in twips
            margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 }, // 1in / .75in / 1in / .75in
          },
        },
        children: bodyChildren,
      },
    ],
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFilenamePart(s) {
  return (s || "").toString().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Builds and downloads the Hearing Order .docx for a single hearing.
 *
 * @param {object} hearing - a hearing document already loaded in memory
 *   (e.g. hearings.find(h => h.id === editingHearingId) in hearings.js)
 * @param {Array} cases - that hearing's case documents, already loaded in
 *   memory (e.g. casesForHearing(hearingId) in hearings.js) — no new
 *   Firestore read happens here.
 */
function exportHearingOrderToWord(hearing, cases) {
  const today = new Date();
  const generatedLine = `Generated ${today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const children = [
    ...buildLetterhead(),
    ...buildCourtPersonnel(),
    centeredPara([run("HEARING ORDER", { bold: true, underline: {}, size: 28 })], { spacing: { before: 100 } }),
    centeredPara([run(generatedLine, { size: 20 })], { spacing: { after: 200 } }),

    new docx.Paragraph({
      spacing: { before: 360, after: 0 },
      children: [run(`${(hearing.section || "").toUpperCase()}:`, { bold: true, italics: true, size: 22 })],
    }),
    buildHearingTable(hearing, cases),
  ];

  // --- TEMPORARY DIAGNOSTICS ---
  const paragraphCount = children.filter((c) => c instanceof docx.Paragraph).length;
  const tableCount = children.filter((c) => c instanceof docx.Table).length;
  console.log("[docx-diagnostic] exportHearingOrderToWord: total top-level children =", children.length);
  console.log("[docx-diagnostic] exportHearingOrderToWord: of which Paragraphs =", paragraphCount, ", Tables =", tableCount);
  console.log("[docx-diagnostic] exportHearingOrderToWord: hearing input =", hearing);
  console.log("[docx-diagnostic] exportHearingOrderToWord: cases input =", cases);
  // --- END TEMPORARY DIAGNOSTICS ---

  const doc = buildDocumentShell(children);

  // --- TEMPORARY DIAGNOSTICS ---
  console.log("[docx-diagnostic] Constructed Document instance:", doc);
  console.log("[docx-diagnostic] Document instanceof docx.Document:", doc instanceof docx.Document);
  // Best-effort introspection of docx's internal tree — property names are
  // not part of docx's public API and may not exist on every version, so
  // every access below is optional-chained and never assumed to be correct.
  console.log("[docx-diagnostic] doc.Document (internal, if present):", doc && doc.Document);
  console.log("[docx-diagnostic] doc.sections (internal, if present):", doc && doc.sections);
  console.log("[docx-diagnostic] Own enumerable keys on doc instance:", Object.keys(doc));
  // --- END TEMPORARY DIAGNOSTICS ---

  const firstCaseNo = cases && cases.length ? cases[0].caseNo : "";
  const filename = `Hearing_Order_${safeFilenamePart(hearing.hearingDate) || "undated"}${firstCaseNo ? "_" + safeFilenamePart(firstCaseNo) : ""}.docx`;

  // --- TEMPORARY DIAGNOSTICS ---
  // Packer.toBlob wrapped in its own try/catch so a rejection/exception is
  // guaranteed to be logged here in full (message + stack), rather than
  // only surfacing as hearings.js's generic "Could not export: <message>"
  // banner, which would hide the actual cause.
  return docx.Packer.toBlob(doc)
    .then((blob) => {
      console.log("[docx-diagnostic] Packer.toBlob resolved. Blob size (bytes):", blob.size, "type:", blob.type);
      if (blob.size < 2000) {
        console.warn("[docx-diagnostic] Blob is suspiciously small for a document with a full letterhead + table — likely evidence the document body did not actually get packed.");
      }
      downloadBlob(blob, filename);
    })
    .catch((err) => {
      console.error("[docx-diagnostic] Packer.toBlob threw/rejected:", err);
      console.error("[docx-diagnostic] Error message:", err && err.message);
      console.error("[docx-diagnostic] Error stack:", err && err.stack);
      throw err; // re-throw so hearings.js's existing catch still shows a message to the Clerk
    });
  // --- END TEMPORARY DIAGNOSTICS ---
}

/**
 * TEMPORARY DIAGNOSTIC ONLY — not part of the Hearing Order feature.
 *
 * Builds and downloads the smallest possible .docx (one paragraph, no
 * letterhead, no table) to isolate whether the docx library / Packer
 * itself works at all in this environment, independent of our template.
 *
 * Not wired into any button or hearings.js — trigger it manually from the
 * browser DevTools console on hearings.html:
 *   window.__docxDiagnosticTest()
 *
 * If this produces a working, non-blank .docx: the library and packer are
 * fine, and the bug is inside our template-building code above.
 * If this ALSO comes out blank: the problem is the library version or
 * Packer usage itself, not our layout — stop looking at buildHearingTable/
 * buildLetterhead and focus on the docx CDN version or Packer call.
 */
function exportMinimalTestDocx() {
  const doc = new docx.Document({
    sections: [
      {
        children: [
          new docx.Paragraph({
            children: [new docx.TextRun({ text: "DOCX TEST", font: FONT, size: 24 })],
          }),
        ],
      },
    ],
  });

  console.log("[docx-diagnostic:minimal] Constructed minimal Document:", doc);

  return docx.Packer.toBlob(doc)
    .then((blob) => {
      console.log("[docx-diagnostic:minimal] Packer.toBlob resolved. Blob size (bytes):", blob.size);
      downloadBlob(blob, "docx_minimal_test.docx");
    })
    .catch((err) => {
      console.error("[docx-diagnostic:minimal] Packer.toBlob threw/rejected:", err);
      throw err;
    });
}
if (typeof window !== "undefined") {
  window.__docxDiagnosticTest = exportMinimalTestDocx;
}

export { exportHearingOrderToWord };
