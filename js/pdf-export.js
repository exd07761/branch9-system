// ---------------------------------------------------------------------------
// Court Calendar (.pdf) export — renderer layer.
//
// Sibling to docx-export.js, not a replacement for it. STRICTLY ISOLATED in
// the same way: this module never touches Firestore, auth, or any business
// logic. Its only inputs are the plain, section-grouped dataset shape
// produced by export-data.js's prepareExportDataset() — the exact same
// function docx-export.js calls, imported here unchanged. No calendar
// data-preparation logic is duplicated between the two renderers; the only
// thing this file owns is turning that shared dataset into a PDF instead of
// a .docx.
//
// Content, section ordering, and per-hearing field layout are kept in step
// with docx-export.js's buildDataRow()/buildSectionTable() — same six
// columns (# / Case No(s). / Title-Victims / For-Charge / Counsel /
// Status-Hearing), same letterhead wording, same court personnel list (also
// imported from the shared calendar-format.js, not re-typed here), same
// Legal-size page. If a field is added to one renderer's row, it should be
// added to the other's too.
//
// Known deliberate deviation from docx-export.js: the .docx renders in
// Century Schoolbook (the real reference document's font, embedded via the
// "docx" library). The "pdfmake" library used here only ships its bundled
// Roboto font out of the box (no Century Schoolbook available without
// shipping a licensed font file), so the PDF renders in Roboto instead.
// Everything else — page size, margins, section/table structure, wording,
// data — matches.
//
// Uses the "pdfmake" library (pdfmake.github.io) via CDN <script> tags in
// hearings.html/home.html (pinned to v0.2.20, loaded as two script tags:
// pdfmake.min.js then vfs_fonts.js — the second registers the bundled
// Roboto font onto the global `pdfMake` the first one creates).
// ---------------------------------------------------------------------------

import {
  getHearingsForDate,
  getHearingsForWeek,
  getHearingsForMonth,
  prepareExportDataset,
} from "./export-data.js?v=1.0.0";
import { COURT_PERSONNEL, fmtLongDate, safeFilenamePart } from "./calendar-format.js?v=1.0.0";

// Page geometry mirrors docx-export.js's buildDocumentShell() exactly:
// Legal size (8.5in x 14in) with 1in/0.75in/1in/0.75in margins
// (top/right/bottom/left), just expressed in points (72/inch) instead of
// twips (1440/inch) since that's what pdfmake expects.
const PAGE_WIDTH_PT = 612; // 8.5in
const PAGE_HEIGHT_PT = 1008; // 14in
const MARGINS_PT = [54, 72, 54, 72]; // [left, top, right, bottom] — 0.75in / 1in / 0.75in / 1in

const HEADER_FILL = "#D9D9D9";
const BLACK = "#000000";

function esc(s) {
  return (s || "").toString();
}

function centered(text, opts = {}) {
  return { text: esc(text), alignment: "center", ...opts };
}

/**
 * The court name / branch / judge block at the top of the document.
 * Same wording/sizing as docx-export.js's buildLetterhead() (sizes there
 * are in half-points; divided by 2 here for pdfmake's point-based fontSize).
 */
function buildLetterhead() {
  return [
    centered("Republic of the Philippines", { fontSize: 11 }),
    centered("FAMILY COURT", { fontSize: 13, bold: true }),
    centered("Third Judicial Region", { fontSize: 11 }),
    centered("BRANCH 9", { fontSize: 13, bold: true }),
    centered("City of San Fernando, Pampanga", { fontSize: 11 }),
    centered("fc1sfp0009@judiciary.gov.ph  |  0970-6461152 / 0955-4724408", { fontSize: 9 }),
    centered("HON. ROHERMIA J. JAMSANI-RODRIGUEZ", { fontSize: 11, bold: true, decoration: "underline", margin: [0, 10, 0, 0] }),
    centered("Presiding Judge", { fontSize: 9 }),
  ];
}

/**
 * The dot-leader court personnel list, matching docx-export.js's
 * buildCourtPersonnel() and pulling from the same shared COURT_PERSONNEL
 * list in calendar-format.js.
 */
function buildCourtPersonnel() {
  return COURT_PERSONNEL.map(([name, title]) => {
    const dots = ".".repeat(Math.max(3, 70 - (name.length + title.length)));
    return centered(`${name} ${dots} ${title}`, { fontSize: 9, margin: [0, 0, 0, 3] });
  });
}

const COLUMN_WIDTHS_PT = [25, 121, 101, 81, 76, 101]; // #, Details, Title/Victims, Charge, Counsel, Status — mirrors docx-export.js's COLUMN_WIDTHS proportions

function headerCell(text) {
  return { text: esc(text), bold: true, fontSize: 10, fillColor: HEADER_FILL, margin: [4, 4, 4, 4] };
}

function bodyCell(stackItems) {
  return { stack: stackItems, margin: [4, 4, 4, 4] };
}

function buildTableHeaderRow() {
  return [
    headerCell("#"),
    headerCell("CASE NO(S). / DETAILS"),
    headerCell("TITLE / VICTIM(S)"),
    headerCell("FOR / CHARGE"),
    headerCell("COUNSEL"),
    headerCell("STATUS / HEARING"),
  ];
}

/**
 * Builds one data row for one hearing — same six columns, same field
 * selection and ordering as docx-export.js's buildDataRow().
 */
function buildDataRow(rowNumber, hearing, cases) {
  // --- Column 2: Case No(s). / Details ---
  const detailsStack = [];
  (cases || []).forEach((c) => {
    const caseLabel = [c.caseType, c.caseNo].filter(Boolean).join(" No. ");
    detailsStack.push({ text: esc(caseLabel), bold: true, fontSize: 10, margin: [0, 0, 0, 3] });
  });
  detailsStack.push({ text: esc(hearing.status || "Hearing"), italics: true, fontSize: 10, margin: [0, 0, 0, 3] });
  const datesFiled = [...new Set((cases || []).map((c) => c.dateFiled).filter(Boolean))];
  if (datesFiled.length) {
    detailsStack.push({ text: `Date filed: ${datesFiled.map(fmtLongDate).join(", ")}`, fontSize: 10 });
  }

  // --- Column 3: Title / Victim(s) ---
  const titleStack = [
    { text: esc(hearing.plaintiff), fontSize: 10, margin: [0, 0, 0, 2] },
    { text: "versus", italics: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: esc((hearing.accused || []).join(", ")), bold: true, fontSize: 10, margin: [0, 0, 0, 3] },
  ];
  if (hearing.detentionStatus) {
    titleStack.push({ text: esc(hearing.detentionStatus), fontSize: 10, margin: [0, 0, 0, 3] });
  }
  if ((hearing.victims || []).length) {
    titleStack.push({ text: `Victim(s): ${(hearing.victims || []).join(", ")}`, fontSize: 10 });
  }

  // --- Column 4: For / Charge ---
  const chargeStack = (cases || []).length
    ? cases.map((c) => ({ text: `${c.caseNo ? c.caseNo + ": " : ""}${esc(c.charge)}`, fontSize: 10, margin: [0, 0, 0, 3] }))
    : [{ text: "Not set", italics: true, fontSize: 10 }];

  // --- Column 5: Counsel ---
  const counselStack = [
    { text: esc(hearing.counselForPeople), fontSize: 10, margin: [0, 0, 0, 1] },
    { text: "for the People", italics: true, fontSize: 9, margin: [0, 0, 0, 5] },
    { text: esc(hearing.counselForAccused), fontSize: 10, margin: [0, 0, 0, 1] },
    { text: "for the Accused", italics: true, fontSize: 9 },
  ];

  // --- Column 6: Status / Hearing ---
  const hearingLine = hearing.hearingTime ? `${fmtLongDate(hearing.hearingDate)} \u2013 ${hearing.hearingTime}` : fmtLongDate(hearing.hearingDate);
  const statusStack = [
    { text: "Status:", bold: true, fontSize: 9 },
    { text: esc(hearing.status), fontSize: 10, margin: [0, 0, 0, 5] },
    { text: "Hearing:", bold: true, fontSize: 9 },
    { text: hearingLine || "Not set", fontSize: 10 },
  ];

  return [
    bodyCell([{ text: String(rowNumber), fontSize: 10 }]),
    bodyCell(detailsStack),
    bodyCell(titleStack),
    bodyCell(chargeStack),
    bodyCell(counselStack),
    bodyCell(statusStack),
  ];
}

/**
 * The shaded, bordered 6-column table for one section's hearings — one
 * header row plus one data row per {hearing, cases} pair. Mirrors
 * docx-export.js's buildSectionTable(): full black grid lines, header row
 * repeated if the table breaks across a page.
 */
function buildSectionTable(items) {
  const body = [buildTableHeaderRow(), ...items.map((item, i) => buildDataRow(i + 1, item.hearing, item.cases))];

  return {
    table: {
      headerRows: 1,
      widths: COLUMN_WIDTHS_PT,
      body,
    },
    layout: {
      hLineWidth: () => 0.75,
      vLineWidth: () => 0.75,
      hLineColor: () => BLACK,
      vLineColor: () => BLACK,
    },
    margin: [0, 4, 0, 0],
  };
}

/**
 * THE single shared document-body builder for the PDF renderer — the exact
 * PDF-side counterpart of docx-export.js's buildCourtCalendarChildren().
 * Every export mode calls this; only title/subtitle/groupedSections differ.
 */
function buildCourtCalendarContent(title, subtitle, groupedSections) {
  const content = [
    ...buildLetterhead(),
    ...buildCourtPersonnel(),
    centered(title, { fontSize: 14, bold: true, decoration: "underline", margin: [0, 6, 0, 0] }),
    centered(subtitle, { fontSize: 10, margin: [0, 0, 0, 10] }),
  ];

  if (!groupedSections.length) {
    content.push({ text: "No hearings found for this selection.", italics: true, fontSize: 10 });
    return content;
  }

  groupedSections.forEach(({ section, items }) => {
    content.push({ text: `${(section || "").toUpperCase()}:`, bold: true, italics: true, fontSize: 11, margin: [0, 18, 0, 0] });
    content.push(buildSectionTable(items));
  });

  return content;
}

/**
 * Legal-size page (matching docx-export.js's buildDocumentShell()),
 * default font Roboto (pdfmake's bundled font — see file header for why
 * this differs from the .docx's Century Schoolbook), black-only text.
 */
function buildDocDefinition(content) {
  return {
    pageSize: { width: PAGE_WIDTH_PT, height: PAGE_HEIGHT_PT },
    pageMargins: MARGINS_PT,
    defaultStyle: { color: BLACK },
    content,
  };
}

/**
 * Shared build+download step, used by every export mode.
 */
function buildAndDownload(title, subtitle, groupedSections, filename) {
  const content = buildCourtCalendarContent(title, subtitle, groupedSections);
  const docDefinition = buildDocDefinition(content);
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(docDefinition).download(filename, resolve);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Mode-specific wrappers — the PDF-side counterparts of docx-export.js's
// exportHearingOrderToWord()/exportCourtCalendarForDate()/...Week()/...Month().
// Each one only decides which hearings are in scope and picks a
// title/subtitle/filename; the shared builders above do the rest. No
// calendar-generation logic is duplicated between DOCX and PDF, or between
// modes — this file's only difference from docx-export.js's equivalent
// wrappers is the renderer they hand off to.
// ---------------------------------------------------------------------------

function exportHearingOrderToPdf(hearing, cases) {
  const groupedSections = prepareExportDataset([hearing], cases);
  const subtitle = `Hearing on ${fmtLongDate(hearing.hearingDate)}`;
  const firstCaseNo = cases && cases.length ? cases[0].caseNo : "";
  const filename = `Court_Calendar_${safeFilenamePart(hearing.hearingDate) || "undated"}${firstCaseNo ? "_" + safeFilenamePart(firstCaseNo) : ""}.pdf`;
  return buildAndDownload("COURT CALENDAR", subtitle, groupedSections, filename);
}

function exportCourtCalendarForDatePdf(allHearings, allCases, dateStr) {
  const hearingsInScope = getHearingsForDate(allHearings, dateStr);
  const groupedSections = prepareExportDataset(hearingsInScope, allCases);
  const subtitle = `For ${fmtLongDate(dateStr)}`;
  const filename = `Court_Calendar_${safeFilenamePart(dateStr) || "undated"}.pdf`;
  return buildAndDownload("COURT CALENDAR", subtitle, groupedSections, filename);
}

function exportCourtCalendarForWeekPdf(allHearings, allCases, anchorDate = new Date()) {
  const hearingsInScope = getHearingsForWeek(allHearings, anchorDate);
  const groupedSections = prepareExportDataset(hearingsInScope, allCases);
  const start = new Date(anchorDate);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const subtitle = `Week of ${start.toLocaleDateString("en-US", { month: "long", day: "numeric" })} \u2013 ${end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  const filename = `Court_Calendar_Week_${start.toISOString().slice(0, 10)}.pdf`;
  return buildAndDownload("COURT CALENDAR", subtitle, groupedSections, filename);
}

function exportCourtCalendarForMonthPdf(allHearings, allCases, anchorDate = new Date()) {
  const hearingsInScope = getHearingsForMonth(allHearings, anchorDate);
  const groupedSections = prepareExportDataset(hearingsInScope, allCases);
  const subtitle = `Month of ${anchorDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
  const filename = `Court_Calendar_${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, "0")}.pdf`;
  return buildAndDownload("COURT CALENDAR", subtitle, groupedSections, filename);
}

export {
  exportHearingOrderToPdf,
  exportCourtCalendarForDatePdf,
  exportCourtCalendarForWeekPdf,
  exportCourtCalendarForMonthPdf,
};
