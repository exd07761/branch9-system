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
// hearings.html, exposing a global `docx` namespace. Pinned to v5.0.2 —
// later major versions restructured their package around ES module
// exports and no longer reliably expose a plain `window.docx` global
// from a single <script> tag with no bundler, which this project needs.
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

function tableHeaderCell(text, widthPercent) {
  return new docx.TableCell({
    width: { size: widthPercent, type: docx.WidthType.PERCENTAGE },
    shading: { fill: "D9D9D9" },
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children: [new docx.Paragraph({ children: [run(text, { bold: true, size: 20 })] })],
  });
}

function tableBodyCell(paragraphs, widthPercent) {
  return new docx.TableCell({
    width: { size: widthPercent, type: docx.WidthType.PERCENTAGE },
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
      tableHeaderCell("#", 5),
      tableHeaderCell("CASE NO(S). / DETAILS", 24),
      tableHeaderCell("TITLE / VICTIM(S)", 20),
      tableHeaderCell("FOR / CHARGE", 16),
      tableHeaderCell("COUNSEL", 15),
      tableHeaderCell("STATUS / HEARING", 20),
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
      tableBodyCell([new docx.Paragraph({ children: [run("1", { size: 20 })] })], 5),
      tableBodyCell(detailsParas, 24),
      tableBodyCell(titleParas, 20),
      tableBodyCell(chargeParas, 16),
      tableBodyCell(counselParas, 15),
      tableBodyCell(statusParas, 20),
    ],
  });

  return new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    borders: {
      top: { style: docx.BorderStyle.SINGLE, size: 2, color: BLACK },
      bottom: { style: docx.BorderStyle.SINGLE, size: 2, color: BLACK },
      left: { style: docx.BorderStyle.SINGLE, size: 2, color: BLACK },
      right: { style: docx.BorderStyle.SINGLE, size: 2, color: BLACK },
      insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 2, color: BLACK },
      insideVertical: { style: docx.BorderStyle.SINGLE, size: 2, color: BLACK },
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
      spacing: { before: 200, after: 0 },
      children: [run(`${(hearing.section || "").toUpperCase()}:`, { bold: true, italics: true, size: 22 })],
    }),
    buildHearingTable(hearing, cases),
  ];

  const doc = buildDocumentShell(children);

  const firstCaseNo = cases && cases.length ? cases[0].caseNo : "";
  const filename = `Hearing_Order_${safeFilenamePart(hearing.hearingDate) || "undated"}${firstCaseNo ? "_" + safeFilenamePart(firstCaseNo) : ""}.docx`;

  return docx.Packer.toBlob(doc).then((blob) => {
    downloadBlob(blob, filename);
  });
}

export { exportHearingOrderToWord };
