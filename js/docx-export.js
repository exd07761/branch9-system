// ---------------------------------------------------------------------------
// Court Calendar (.docx) export — renderer layer.
//
// STRICTLY ISOLATED: this module never touches Firestore, auth, or any
// business logic. Its only inputs are the plain, section-grouped dataset
// shape produced by export-data.js's prepareExportDataset() — no new
// Firestore queries happen here or there.
//
// Milestone 0.6.2: generalized from a single-hearing-only exporter into a
// shared builder reused by every export mode (This Hearing / Selected
// Date / Current Week / Current Month). The only thing that differs
// between modes is which hearings are in the dataset passed in — the
// letterhead, personnel list, table layout, and per-hearing row rendering
// are built by the exact same code path every time. No document-
// generation logic is duplicated between modes.
//
// Replicates the Branch's actual Word Court Calendar format (letterhead,
// court personnel list, and the shaded 5-column, per-section table
// layout — # / Case No(s). Details / Title-Victim(s) / For-Charge /
// Counsel, with hearing time shown as its own centered row beneath each
// section's table rather than a Status/Hearing column). Source of truth
// for the exact wording/formatting: the uploaded reference documents
// (byte-identical copies of the Branch's real exported Court Calendar).
//
// Known deliberate deviations from a literal Times-New-Roman/Letter-size
// brief, both because "replicate this document exactly" was the later,
// more specific instruction once a real reference file was provided:
//   - Font is Century Schoolbook (the real document's font).
//   - Page size is Legal (8.5in x 14in) with 1in/0.75in/1in/0.75in
//     margins (top/right/bottom/left).
//
// Known gap: the reference document includes per-case notification/
// private-complainant status lines (e.g. "PCAAA C/O ..."). That data
// (pcInfo / accusedNotifiedStatus) was a deliberate simplification
// dropped from this system's schema back in Milestone 3 and doesn't
// exist here — those lines are simply omitted rather than fabricated.
//
// Uses the "docx" library (docx.js.org) via CDN <script> tag in
// hearings.html (currently pinned to v8.0.4 — see hearings.html for the
// version-history note on why that specific version was chosen).
//
// Kept modular so a future PDF exporter could reuse export-data.js's
// prepareExportDataset() output with its own renderer, without touching
// any of this file:
//   - buildLetterhead()        — court name/branch/judge block
//   - buildCourtPersonnel()    — the dot-leader personnel list
//   - buildSectionTable()      — the shaded 5-column table for one
//                                section's hearings (1..N rows), plus a
//                                centered hearing-time row per distinct
//                                time in that section
//   - buildCourtCalendarChildren() — composes letterhead + personnel +
//                                title/subtitle + one section-header +
//                                table pair per section — THE single
//                                shared document body builder every
//                                export mode calls
//   - buildDocumentShell()     — legal-size page + default font wrapper
//   - downloadBlob()           — generic Blob-to-file-download helper
//   - packAndDownload()        — Packer.toBlob + download, shared by
//                                every export mode
//   - exportHearingOrderToWord() / exportCourtCalendarForDate() /
//     exportCourtCalendarForWeek() / exportCourtCalendarForMonth() —
//     thin, mode-specific wrappers; all four call the same builder above
// ---------------------------------------------------------------------------

import {
  getHearingsForDate,
  getHearingsForWeek,
  getHearingsForMonth,
  prepareExportDataset,
} from "./export-data.js?v=1.0.0";

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

// Formats hearing.hearingTime (one of the fixed HEARING_TIMES option
// strings from hearings.js, e.g. "1:30 in the Afternoon") into the
// reference document's "At 1:30PM" wording. No new data field — this is
// purely a display transform of the existing hearingTime string. If a
// hearingTime value doesn't match the expected "<time> in the
// <Morning/Afternoon/Evening>" shape (schema drift, blank, etc.), the raw
// value is still shown rather than silently dropped.
function formatHearingTimeLabel(hearingTime) {
  if (!hearingTime) return "";
  const m = /^(\d{1,2}:\d{2})\s+in\s+the\s+(Morning|Afternoon|Evening)$/i.exec(hearingTime.trim());
  if (!m) return `At ${hearingTime}`;
  const suffix = /morning/i.test(m[2]) ? "AM" : "PM";
  return `At ${m[1]}${suffix}`;
}

// The distinct, formatted hearing-time labels present among a section's
// hearings (in first-seen order), for the centered time row(s) rendered
// beneath that section's table.
function distinctHearingTimeLabels(items) {
  const seen = new Set();
  const labels = [];
  (items || []).forEach(({ hearing }) => {
    const label = formatHearingTimeLabel(hearing && hearing.hearingTime);
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  });
  return labels;
}

// A full-width row (spanning all 5 data columns) carrying just the
// centered, bold hearing-time label — matches the reference template's
// "At 1:30PM" row beneath a section's table. Built as an extra row of
// the same table (rather than a separate paragraph) so its borders line
// up with the table above it, as in the reference.
function buildHearingTimeRow(label) {
  return new docx.TableRow({
    children: [
      new docx.TableCell({
        columnSpan: 5,
        width: { size: TABLE_WIDTH_DXA, type: docx.WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        children: [centeredPara([run(label, { bold: true, size: 20 })])],
      }),
    ],
  });
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

// Milestone (Court Calendar template revision): the STATUS / HEARING
// column was removed entirely (status already appears inside the Case
// No(s). / Details column via hearing.status; hearing time is now shown
// as its own centered row beneath each section's table — see
// buildHearingTimeRow() / distinctHearingTimeLabels() below).
//
// Column widths below are NOT an arbitrary redistribution toward any one
// column. The "#" column is kept minimal (just enough for a row number).
// The other four content columns (details/title/charge/counsel) are the
// ORIGINAL per-column widths this file used before the Status/Hearing
// column existed here — i.e. the proportions already tuned against the
// real reference document — uniformly scaled up by the same factor
// (~1.3157x) so together they consume the full Legal-portrait printable
// width (page width 12240 minus the 1080/709 right/left margins from
// buildDocumentShell() = 10451 DXA), instead of leaving the ~371 DXA of
// margin slack the old fixed 10080-DXA table width wasted. Every content
// column grows by the same relative amount; none is favored over the
// others. If the page margins in buildDocumentShell() ever change,
// TABLE_WIDTH_DXA (and ideally these column widths) should be
// recalculated the same way — printable width = page width minus left +
// right margins.
const COLUMN_WIDTHS = { num: 504, details: 3183, title: 2653, charge: 2122, counsel: 1989 };
const TABLE_WIDTH_DXA = 10451; // = num + details + title + charge + counsel = full printable width

function buildTableHeaderRow() {
  return new docx.TableRow({
    tableHeader: true,
    children: [
      tableHeaderCell("#", COLUMN_WIDTHS.num),
      tableHeaderCell("CASE NO(S). / DETAILS", COLUMN_WIDTHS.details),
      tableHeaderCell("TITLE / VICTIM(S)", COLUMN_WIDTHS.title),
      tableHeaderCell("FOR / CHARGE", COLUMN_WIDTHS.charge),
      tableHeaderCell("COUNSEL", COLUMN_WIDTHS.counsel),
    ],
  });
}

/**
 * Builds one data row for one hearing (numbered per its position within
 * its section's table). This is the exact same per-hearing rendering
 * used whether the export contains one hearing or a hundred — nothing
 * about a single row depends on how many other rows are in the table.
 */
function buildDataRow(rowNumber, hearing, cases) {
  // --- Column 2: Case No(s). / Details ---
  const detailsParas = [];
  (cases || []).forEach((c) => {
    // NOTE: fixed a pre-existing join bug here, found while testing this
    // revision. c.caseType is stored WITH its trailing "No" already
    // included (see cases.js's CASE_TYPES, e.g. "FC Criminal Cases No" —
    // confirmed via optionsHtml(), whose <option value> is the raw
    // CASE_TYPES string), matching every other place in this app that
    // renders a case label (cases.js's caseLabel(), hearings.js's
    // caseRowSummary()/addCaseLabel(), case-detail.js) — all of which
    // join caseType and caseNo with just ". " to get e.g. "FC Criminal
    // Cases No. 6184". This file was instead joining with " No. ",
    // which double-prints the "No" already in caseType (e.g. "FC
    // Criminal Cases No No. 6184"). Switched to the same ". " join the
    // rest of the app already uses, so the identifier this revision
    // keeps on one line is the correct one.
    const caseLabel = [c.caseType, c.caseNo].filter(Boolean).join(". ");
    // Keep the case number/identifier itself together on one line: swap
    // its regular spaces for non-breaking spaces so Word can't wrap it
    // mid-identifier (e.g. "FC Criminal Case" / "No. 6184"). This only
    // affects this one label run — the case-details/title paragraphs
    // below it still wrap normally. If the identifier is ever wider than
    // the column, widen COLUMN_WIDTHS.details rather than removing this.
    const nonBreakingCaseLabel = caseLabel.replace(/ /g, "\u00A0");
    detailsParas.push(
      new docx.Paragraph({ children: [run(nonBreakingCaseLabel, { bold: true, size: 20 })], spacing: { after: 60 } })
    );
  });
  detailsParas.push(
    new docx.Paragraph({ children: [run(hearing.status || "Hearing", { italics: true, size: 20 })], spacing: { after: 60 } })
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

  // Column 6 (Status / Hearing) removed — hearing.status already appears
  // in the Case No(s). / Details column above (see detailsParas), and
  // hearing.hearingTime is now surfaced once per section as a centered
  // row beneath the section table (see buildHearingTimeRow() /
  // distinctHearingTimeLabels()) rather than duplicated per row here.

  return new docx.TableRow({
    children: [
      tableBodyCell([new docx.Paragraph({ children: [run(String(rowNumber), { size: 20 })] })], COLUMN_WIDTHS.num),
      tableBodyCell(detailsParas, COLUMN_WIDTHS.details),
      tableBodyCell(titleParas, COLUMN_WIDTHS.title),
      tableBodyCell(chargeParas, COLUMN_WIDTHS.charge),
      tableBodyCell(counselParas, COLUMN_WIDTHS.counsel),
    ],
  });
}

/**
 * Builds the shaded, bordered 5-column table for one section's hearings —
 * one header row, one data row per {hearing, cases} pair (numbered 1..N),
 * then one centered full-width row per distinct hearing time present in
 * the section (e.g. "At 1:30PM"), matching the reference template's
 * placement of hearing time beneath the relevant section/table now that
 * the per-row Status/Hearing column is gone. Used for every section in
 * every export mode; a single-hearing export is simply a table with
 * exactly one data row.
 */
function buildSectionTable(items) {
  const rows = [
    buildTableHeaderRow(),
    ...items.map((item, i) => buildDataRow(i + 1, item.hearing, item.cases)),
    ...distinctHearingTimeLabels(items).map((label) => buildHearingTimeRow(label)),
  ];

  return new docx.Table({
    width: { size: TABLE_WIDTH_DXA, type: docx.WidthType.DXA },
    alignment: docx.AlignmentType.CENTER,
    borders: {
      top: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      left: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      right: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
      insideVertical: { style: docx.BorderStyle.SINGLE, size: 4, color: BLACK },
    },
    rows,
  });
}

/**
 * THE single shared document-body builder. Every export mode (This
 * Hearing / Selected Date / Current Week / Current Month) calls this
 * exact function — nothing about section/table rendering is duplicated
 * between modes. Only `title`, `subtitle`, and `groupedSections` differ.
 *
 * @param {string} title - always "COURT CALENDAR", matching the real
 *   reference document, for every export mode including a single hearing.
 * @param {string} subtitle - describes scope, e.g. "Hearing on August 5,
 *   2026", "For August 5, 2026", "Week of August 3 - 9, 2026", "Month of
 *   August 2026".
 * @param {Array} groupedSections - the shape produced by export-data.js's
 *   prepareExportDataset(): [{ section, items: [{hearing, cases}, ...] }]
 */
function buildCourtCalendarChildren(title, subtitle, groupedSections) {
  const children = [
    ...buildLetterhead(),
    ...buildCourtPersonnel(),
    centeredPara([run(title, { bold: true, underline: {}, size: 28 })], { spacing: { before: 100 } }),
    centeredPara([run(subtitle, { size: 20 })], { spacing: { after: 200 } }),
  ];

  if (!groupedSections.length) {
    children.push(new docx.Paragraph({ children: [run("No hearings found for this selection.", { italics: true, size: 20 })] }));
    return children;
  }

  groupedSections.forEach(({ section, items }) => {
    children.push(
      new docx.Paragraph({
        spacing: { before: 360, after: 0 },
        children: [run(`${(section || "").toUpperCase()}:`, { bold: true, italics: true, size: 22 })],
      })
    );
    children.push(buildSectionTable(items));
  });

  return children;
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
            margin: { top: 1440, right: 1080, bottom: 1440, left: 709 }, // 1in / .75in / 1in / .492in
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
 * Shared pack+download step, used by every export mode.
 */
function packAndDownload(title, subtitle, groupedSections, filename) {
  const children = buildCourtCalendarChildren(title, subtitle, groupedSections);
  const doc = buildDocumentShell(children);
  return docx.Packer.toBlob(doc).then((blob) => {
    downloadBlob(blob, filename);
  });
}

// ---------------------------------------------------------------------------
// Mode-specific wrappers. Each one only (a) decides which hearings belong
// in the export and (b) picks a title/subtitle/filename — all of them
// hand off to the exact same buildCourtCalendarChildren()/packAndDownload()
// above. No document-generation logic is duplicated between modes.
// ---------------------------------------------------------------------------

/**
 * Export This Hearing — a single hearing, already loaded in memory.
 * @param {object} hearing
 * @param {Array} cases - that hearing's cases, already loaded in memory
 */
function exportHearingOrderToWord(hearing, cases) {
  const groupedSections = prepareExportDataset([hearing], cases);
  const subtitle = `Hearing on ${fmtLongDate(hearing.hearingDate)}`;
  const firstCaseNo = cases && cases.length ? cases[0].caseNo : "";
  const filename = `Court_Calendar_${safeFilenamePart(hearing.hearingDate) || "undated"}${firstCaseNo ? "_" + safeFilenamePart(firstCaseNo) : ""}.docx`;
  return packAndDownload("COURT CALENDAR", subtitle, groupedSections, filename);
}

/**
 * Export Selected Date — every hearing on one calendar date.
 * @param {Array} allHearings - the full, already-loaded hearings array
 * @param {Array} allCases - the full, already-loaded cases array
 * @param {string} dateStr - "YYYY-MM-DD"
 */
function exportCourtCalendarForDate(allHearings, allCases, dateStr) {
  const hearingsInScope = getHearingsForDate(allHearings, dateStr);
  const groupedSections = prepareExportDataset(hearingsInScope, allCases);
  const subtitle = `For ${fmtLongDate(dateStr)}`;
  const filename = `Court_Calendar_${safeFilenamePart(dateStr) || "undated"}.docx`;
  return packAndDownload("COURT CALENDAR", subtitle, groupedSections, filename);
}

/**
 * Export Current Week — every hearing in the Sun-Sat week containing
 * anchorDate (defaults to today).
 */
function exportCourtCalendarForWeek(allHearings, allCases, anchorDate = new Date()) {
  const hearingsInScope = getHearingsForWeek(allHearings, anchorDate);
  const groupedSections = prepareExportDataset(hearingsInScope, allCases);
  const start = new Date(anchorDate);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const subtitle = `Week of ${start.toLocaleDateString("en-US", { month: "long", day: "numeric" })} \u2013 ${end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  const filename = `Court_Calendar_Week_${start.toISOString().slice(0, 10)}.docx`;
  return packAndDownload("COURT CALENDAR", subtitle, groupedSections, filename);
}

/**
 * Export Current Month — every hearing in the calendar month containing
 * anchorDate (defaults to today).
 */
function exportCourtCalendarForMonth(allHearings, allCases, anchorDate = new Date()) {
  const hearingsInScope = getHearingsForMonth(allHearings, anchorDate);
  const groupedSections = prepareExportDataset(hearingsInScope, allCases);
  const subtitle = `Month of ${anchorDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
  const filename = `Court_Calendar_${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, "0")}.docx`;
  return packAndDownload("COURT CALENDAR", subtitle, groupedSections, filename);
}

export {
  exportHearingOrderToWord,
  exportCourtCalendarForDate,
  exportCourtCalendarForWeek,
  exportCourtCalendarForMonth,
};
