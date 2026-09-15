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
//                                section's hearings, one row per linked
//                                Case (see buildHearingRows()), plus a
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

// Shared parser for the fixed HEARING_TIMES option strings from
// hearings.js (e.g. "1:30 in the Afternoon"). Returns { time: "1:30",
// suffix: "AM"|"PM" } on a match, or null if the value doesn't match the
// expected "<time> in the <Morning/Afternoon/Evening>" shape (schema
// drift, blank, free text, etc.) — callers fall back to showing the raw
// value rather than silently dropping it.
function parseHearingTimeOfDay(hearingTime) {
  if (!hearingTime) return null;
  const m = /^(\d{1,2}:\d{2})\s+in\s+the\s+(Morning|Afternoon|Evening)$/i.exec(hearingTime.trim());
  if (!m) return null;
  return { time: m[1], suffix: /morning/i.test(m[2]) ? "AM" : "PM" };
}

// Formats hearing.hearingTime into the reference document's "At 1:30PM"
// wording (no space before AM/PM) — used only for the standalone,
// centered hearing-time row beneath a section's table. No new data
// field — this is purely a display transform of the existing
// hearingTime string.
function formatHearingTimeLabel(hearingTime) {
  if (!hearingTime) return "";
  const parsed = parseHearingTimeOfDay(hearingTime);
  if (!parsed) return `At ${hearingTime}`;
  return `At ${parsed.time}${parsed.suffix}`;
}

// Formats a HEARING_TIMES-shaped string into plain "1:30 AM" wording
// (WITH a space before AM/PM, no "At " prefix) — deliberately a
// different format from formatHearingTimeLabel() above: that one
// produces a standalone centered annotation ("At 1:30PM"), this one is
// inline body text read as part of a sentence ("...on October 21, 2026
// at 1:30 AM" — see formatPreviousSetting() below). Keeping these as two
// small functions instead of one shared/parameterized one on purpose:
// the "At 1:30PM" row format was pinned against the physical reference
// document in an earlier revision, and this avoids any chance of a
// future edit to one accidentally changing the other's output.
function formatTimeOfDay12h(hearingTime) {
  if (!hearingTime) return "";
  const parsed = parseHearingTimeOfDay(hearingTime);
  if (!parsed) return hearingTime;
  return `${parsed.time} ${parsed.suffix}`;
}

// Formats hearing.previousSetting — { date: "YYYY-MM-DD", time: one of
// HEARING_TIMES } as saved by hearings.js's form, either part optional —
// into the physical template's "October 21, 2026 at 8:30 AM" wording.
// Returns "" when there's nothing to show (previousSetting missing/null,
// or both date and time blank) so callers can skip rendering entirely
// rather than show an empty "Previous setting:" block. Never invents a
// date or time that wasn't actually saved: date-only and time-only are
// each rendered as just that piece, not padded with guessed data.
function formatPreviousSetting(previousSetting) {
  if (!previousSetting) return "";
  const datePart = fmtLongDate(previousSetting.date);
  const timePart = formatTimeOfDay12h(previousSetting.time);
  if (datePart && timePart) return `${datePart} at ${timePart}`;
  return datePart || timePart || "";
}

function centeredPara(children, opts = {}) {
  return new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children, ...opts });
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
// Starting point for the other four was the ORIGINAL per-column widths
// this file used before the Status/Hearing column existed here (details
// 2419 / title 2016 / charge 1613 / counsel 1512 — the proportions
// already tuned against the real reference document), uniformly scaled
// up so together with "#" they'd consume the full Legal-portrait
// printable width (page width 12240 minus the 1080/709 right/left
// margins from buildDocumentShell() = 10451 DXA) instead of leaving the
// old fixed 10080-DXA table width's ~371 DXA of margin slack unused.
//
// details was then widened a further ~530 DXA beyond that uniform scale
// (from 3183 to 3700), taken proportionally from title/charge/counsel,
// after real-DOCX rendering (see below) showed the uniformly-scaled
// width still let ordinary Case Numbers visually wrap mid-identifier.
// This was NOT sized from a character-count guess — it was measured by
// hand-building the exact OOXML this file produces (same font/size/cell
// margins/fixed table layout) and rendering it with LibreOffice (which
// resolves "Century Schoolbook" to "TeX Gyre Schola", a metrically-
// compatible clone, so the measurements should track real Word/Century
// Schoolbook closely). That test also revealed something the
// non-breaking-space technique alone can't fix: once an identifier
// doesn't fit the column at all, the renderer falls back to breaking it
// at ANY character (including mid-word), not just at the space it was
// protecting — so "wide enough to need no break at all" is the only
// real guarantee, not the no-break characters by themselves.
//
// Measured fit at details=3700 (content width 3700-240=3460 DXA, after
// the 120+120 DXA left/right cell margins from tableBodyCell()):
//   - "FC Criminal Cases No. 6693"          fits on one line
//   - "FC Criminal Case No. 6184"           fits on one line
//   - "FC Civil Case No. 761"               fits on one line
//   - "FC Criminal Cases No. 6107-6108"     fits on one line (needed
//                                           >=3680; 3700 gives margin)
//   - "FC Special Proceeding Case No. 123456" still wraps — this one
//     needed >4200 DXA (tested up to 4200, still not enough) to fit
//     unbroken, which would eat far more than "smallest practical" from
//     title/charge/counsel. Accepted as a known limitation for this
//     specific combination (the longest CASE_TYPES option + a 6-digit
//     case number) rather than forced at the expense of the other three
//     columns' usability — matches the "one logical visual line where
//     reasonably possible" framing this width was requested under.
// If a real Case Number this long+wide ever shows up in practice,
// COLUMN_WIDTHS.details is the value to revisit (see js/hearings.js's
// CASE_TYPES for the option list this measures against).
const COLUMN_WIDTHS = { num: 504, details: 3700, title: 2450, charge: 1960, counsel: 1837 };
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
 * Column 3 (Title / Victim(s)) content — hearing-level fields only
 * (plaintiff/accused/detentionStatus/victims all live on the Hearing
 * document; there is no per-Case equivalent in this schema — see
 * hearings-data.js's saveHearing(), where a hearingCases row only ever
 * carries { hearingId, caseType, caseNo, charge, dateFiled }). Built
 * once per hearing and reused for every Case row under that hearing,
 * since it's genuinely the same, correct value for all of them — not a
 * duplication of invented data, just the shared field shown on each row
 * (matching the reference document, which repeats this same text on
 * both rows when one hearing has two Cases).
 */
function buildHearingTitleParas(hearing) {
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
  return titleParas;
}

/**
 * Column 5 (Counsel) content — same rationale as buildHearingTitleParas()
 * above: counselForPeople/counselForAccused are Hearing-level fields with
 * no per-Case equivalent, so this is built once per hearing and reused
 * on every Case row under it.
 *
 * lawyerForPeople/lawyerForAccused (optional Hearing-level fields — see
 * hearings.js's form/handleSave()) supplement, rather than replace, the
 * existing counsel value: a counsel value is often a public office (e.g.
 * "Public Prosecutor (OPP)", "PAO Lawyer") and the lawyer field records
 * the specific named lawyer appearing for that office, if known. No new
 * "Lawyer:" label is added — the existing italic "for the People"/"for
 * the Accused" caption already tells the reader which side each name
 * belongs to, and each optional line is simply omitted when blank (never
 * an empty paragraph), matching every other optional field on this
 * column/row (see buildHearingTitleParas()'s detentionStatus/victims and
 * buildCaseDetailsParas()'s previousSetting/dateFiled below).
 */
function buildHearingCounselParas(hearing) {
  const paras = [new docx.Paragraph({ children: [run(hearing.counselForPeople, { size: 20 })], spacing: { after: 20 } })];
  if (hearing.lawyerForPeople) {
    paras.push(new docx.Paragraph({ children: [run(hearing.lawyerForPeople, { size: 20 })], spacing: { after: 20 } }));
  }
  paras.push(new docx.Paragraph({ children: [run("for the People", { italics: true, size: 18 })], spacing: { after: 100 } }));
  paras.push(new docx.Paragraph({ children: [run(hearing.counselForAccused, { size: 20 })], spacing: { after: 20 } }));
  if (hearing.lawyerForAccused) {
    paras.push(new docx.Paragraph({ children: [run(hearing.lawyerForAccused, { size: 20 })], spacing: { after: 20 } }));
  }
  paras.push(new docx.Paragraph({ children: [run("for the Accused", { italics: true, size: 18 })] }));
  return paras;
}

/**
 * Column 2 (Case No(s). / Details) content for ONE Case row: that
 * Case's own caseType/caseNo/dateFiled (genuinely Case-specific fields —
 * see hearingCases' schema in hearings-data.js's saveHearing()), plus
 * the Hearing's status line (Hearing-level, repeated per row — same
 * rationale as the title/counsel columns, and matches the reference
 * document, which repeats the status line on every Case row too).
 * `caseOrNull` is null for a hearing with no linked Cases at all (the
 * pre-existing "Not set" fallback case), never for a real Case row.
 */
function buildCaseDetailsParas(hearing, caseOrNull) {
  const detailsParas = [];
  if (caseOrNull) {
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
    const caseLabel = [caseOrNull.caseType, caseOrNull.caseNo].filter(Boolean).join(". ");
    // Keep the case number/identifier itself together on one line: swap
    // its regular spaces for non-breaking spaces (and any hyphens, e.g.
    // a consolidated-case range like "6107-6108", for a non-breaking
    // hyphen) so Word can't wrap it mid-identifier. This only affects
    // this one label run — the case-details/title paragraphs below it
    // still wrap normally.
    //
    // IMPORTANT — this substitution alone is NOT sufficient by itself;
    // it's paired with COLUMN_WIDTHS.details above being wide enough
    // that a realistic identifier never actually needs to break. Real
    // rendering (see COLUMN_WIDTHS' comment) showed that once an
    // identifier is too wide for the column regardless, the renderer
    // ignores these no-break characters and force-splits at any
    // character (not even at a word boundary) — so if a longer
    // CASE_TYPES option or case number ever gets added, widen
    // COLUMN_WIDTHS.details (verified by real rendering, not guessed)
    // rather than assuming this substitution alone will protect it.
    const nonBreakingCaseLabel = caseLabel.replace(/ /g, "\u00A0").replace(/-/g, "\u2011");
    detailsParas.push(
      new docx.Paragraph({ children: [run(nonBreakingCaseLabel, { bold: true, size: 20 })], spacing: { after: 60 } })
    );
  }
  detailsParas.push(
    new docx.Paragraph({ children: [run(hearing.status || "Hearing", { italics: true, size: 20 })], spacing: { after: 60 } })
  );
  if (caseOrNull && caseOrNull.dateFiled) {
    detailsParas.push(
      new docx.Paragraph({ children: [run(`Date filed: ${fmtLongDate(caseOrNull.dateFiled)}`, { size: 20 })] })
    );
  }
  // Previous Setting — Hearing-level (see hearings.js's form and
  // hearings-data.js's saveHearing(): previousSetting lives on the
  // Hearing document, not on the Case/hearingCases row, since the same
  // Case can have multiple Hearings and a previous setting belongs to
  // one particular hearing being recorded). Rendered last in this cell,
  // per the physical reference template. Repeated identically on every
  // Case row under this hearing, same as the status line above and the
  // Title/Counsel columns — this file has no cell-merging mechanism for
  // shared hearing-level content (confirmed by inspection: the physical
  // reference document itself repeats shared hearing info per Case row
  // rather than merging cells), so repeating here is the existing,
  // established, correct behavior, not new duplication. Renders nothing
  // if the hearing has no previousSetting (or its date/time are both
  // blank) — never invents a value.
  const previousSettingText = formatPreviousSetting(hearing.previousSetting);
  if (previousSettingText) {
    detailsParas.push(
      new docx.Paragraph({ children: [run("Previous setting:", { italics: true, size: 20 })], spacing: { before: 60 } })
    );
    detailsParas.push(new docx.Paragraph({ children: [run(previousSettingText, { size: 20 })] }));
  }
  return detailsParas;
}

/**
 * Column 4 (For / Charge) content for ONE Case row: that Case's own
 * charge field (Case-specific — see hearingCases' schema above), or the
 * pre-existing "Not set" fallback when the hearing has no linked Cases
 * at all.
 */
function buildCaseChargeParas(caseOrNull) {
  return caseOrNull
    ? [
        new docx.Paragraph({
          children: [run(`${caseOrNull.caseNo ? caseOrNull.caseNo + ": " : ""}${caseOrNull.charge || ""}`, { size: 20 }),
          ],
        }),
      ]
    : [new docx.Paragraph({ children: [run("Not set", { italics: true, size: 20 })] })];
}

/**
 * Builds one table row for exactly one Case (or, when a hearing has no
 * linked Cases at all, the single pre-existing "Not set" placeholder
 * row) — titleParas/counselParas are precomputed once per hearing by
 * the caller and passed in, since they're identical across every row
 * for the same hearing.
 */
function buildCaseRow(rowNumber, hearing, caseOrNull, titleParas, counselParas) {
  return new docx.TableRow({
    children: [
      tableBodyCell([new docx.Paragraph({ children: [run(String(rowNumber), { size: 20 })] })], COLUMN_WIDTHS.num),
      tableBodyCell(buildCaseDetailsParas(hearing, caseOrNull), COLUMN_WIDTHS.details),
      tableBodyCell(titleParas, COLUMN_WIDTHS.title),
      tableBodyCell(buildCaseChargeParas(caseOrNull), COLUMN_WIDTHS.charge),
      tableBodyCell(counselParas, COLUMN_WIDTHS.counsel),
    ],
  });
}

/**
 * Builds ALL table rows for one hearing: one row per linked Case (so a
 * hearing with 4 linked Cases produces 4 separate rows, each with its
 * own Case Number/Details and Charge — not one giant row with every
 * Case Number stacked into a single cell), or exactly one placeholder
 * row if the hearing has no linked Cases at all (the pre-existing
 * behavior, unchanged). Title/Victim(s) and Counsel are Hearing-level
 * fields with no per-Case equivalent in this schema, so they're built
 * once here and repeated identically on every row for this hearing —
 * see buildHearingTitleParas()/buildHearingCounselParas() above.
 *
 * @param {number} startRowNumber - the # this hearing's first row gets;
 *   the # column increments per rendered Case row across the whole
 *   section table, not per hearing (see buildSectionTable()).
 * @returns {Array<docx.TableRow>}
 */
function buildHearingRows(startRowNumber, hearing, cases) {
  const titleParas = buildHearingTitleParas(hearing);
  const counselParas = buildHearingCounselParas(hearing);
  const caseList = cases && cases.length ? cases : [null]; // null = no linked Cases; one placeholder row
  return caseList.map((c, i) => buildCaseRow(startRowNumber + i, hearing, c, titleParas, counselParas));
}

/**
 * Builds the shaded, bordered 5-column table for one section's hearings —
 * one header row, then one data row per linked Case across all of the
 * section's hearings (a hearing with 4 linked Cases contributes 4 rows,
 * not 1 — see buildHearingRows()), with the # column running
 * consecutively across the whole section regardless of which hearing
 * each row belongs to, then one centered full-width row per distinct
 * hearing time present in the section (e.g. "At 1:30PM"), matching the
 * reference template's placement of hearing time beneath the relevant
 * section/table now that the per-row Status/Hearing column is gone.
 * Used for every section in every export mode; a single-hearing,
 * single-Case export is simply a table with exactly one data row.
 */
function buildSectionTable(items) {
  const dataRows = [];
  let nextRowNumber = 1;
  items.forEach((item) => {
    const hearingRows = buildHearingRows(nextRowNumber, item.hearing, item.cases);
    dataRows.push(...hearingRows);
    nextRowNumber += hearingRows.length;
  });

  const rows = [
    buildTableHeaderRow(),
    ...dataRows,
    ...distinctHearingTimeLabels(items).map((label) => buildHearingTimeRow(label)),
  ];

  return new docx.Table({
    width: { size: TABLE_WIDTH_DXA, type: docx.WidthType.DXA },
    // ROOT CAUSE of the "extremely tall TRIAL rows" bug: without an
    // explicit columnWidths array here, docx.js defaults <w:tblGrid> to
    // a placeholder 100 DXA per column (confirmed by inspecting the
    // actual generated XML: docx's own Table constructor literally does
    // `columnWidths = Array(...).fill(100)` when none is passed) — a
    // grid totaling ~500 DXA, wildly inconsistent with the real ~10451
    // DXA of per-cell tcW widths each TableCell already declares
    // correctly. Every table built here had this mismatch, not just
    // TRIAL's. LibreOffice tolerates it (it recovers the real widths
    // from each cell's own tcW and silently ignores the wrong grid), so
    // it didn't show up in this project's LibreOffice-based rendering
    // checks — but Word, especially under the tblLayout="fixed" set
    // below, is expected to treat <w:tblGrid> as the authoritative
    // column-boundary map. A grid collapsed to ~100 DXA per column would
    // make Word lay out cell content against an effectively tiny column
    // width regardless of tcW, forcing even short text (like a Trial
    // row's brief "Case No. 761 / Presentation of Prosecution's
    // Evidence") to wrap character-by-character into a very tall row —
    // matching the reported symptom exactly (short content, huge row),
    // and matching why it reads as most dramatic on Trial specifically:
    // Trial rows have the shortest natural content of any section here,
    // so the collapse is the most visually obvious there, even though
    // the same wrong grid was being generated for every section's table.
    columnWidths: [COLUMN_WIDTHS.num, COLUMN_WIDTHS.details, COLUMN_WIDTHS.title, COLUMN_WIDTHS.charge, COLUMN_WIDTHS.counsel],
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
