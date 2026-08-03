// ---------------------------------------------------------------------------
// v1.1 Migration Dry Run (IM-4) — standalone developer tool.
//
// Same standing as diagnostics.js: not part of the Clerk-facing app, not
// linked from anywhere in it, no requireAuth() (see diagnostics.js's own
// comment on this — this page is even more isolated, since unlike
// diagnostics.js it makes NO Firestore calls at all, not even a read).
//
// Purpose (IMPLEMENTATION_ROADMAP.md IM-4): read an existing Backup &
// Restore export (backup.html) and report how the current
// hearings/hearingCases data would reconstruct into the new Case entity
// (DECISIONS_v1.1.md Decision 001/005), WITHOUT writing anything anywhere.
// This is diagnostic input for the IM-5 Business Validation Checkpoint —
// it does not resolve Decisions 015/016/017/018 itself, it gathers real
// evidence toward resolving them. Never treat this report's reconstructed
// Case list as ready to use (see IMPLEMENTATION_ROADMAP.md's own warning
// on this point) — that's IM-7's job, after IM-5 closes.
//
// Why this reads a local file instead of "running once and showing the
// result": this app's data is real court records (names, charges, filing
// dates). Rather than that data passing through anywhere else, this tool
// runs entirely in the browser tab against a file the user already has —
// nothing is uploaded, nothing leaves this tab. Run it as many times as
// useful, on whichever backup file is most current.
//
// Grouping logic: a "candidate Case" is every hearingCases row across
// every hearing that shares the same (caseType, normalized caseNo) — the
// same grouping key hearings-data.js's isDuplicateCaseNumber() already
// uses for duplicate detection, reused here rather than inventing a
// different comparison.
// ---------------------------------------------------------------------------

function esc(s) {
  return (s || "").toString().replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

// Local, minimal counterpart to backup-data.js's deserializeValue() — that
// function isn't exported (internal to backup-data.js), and this tool
// only ever needs to recognize the one tagged shape, not deep-walk an
// entire record, so a small dedicated helper is clearer than importing
// the whole file for one shape check.
function tsToDate(v) {
  if (v && typeof v === "object" && v.__type === "timestamp" && typeof v.seconds === "number") {
    return new Date(v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6));
  }
  return null;
}

// Same normalization as hearings-data.js's isDuplicateCaseNumber().
function normalizeCaseNo(s) {
  return (s || "").trim().toLowerCase();
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

// --- Analysis --------------------------------------------------------------

// IM-7A note: buildAnalysis() below is exported (only change from the
// frozen IM-4 version — everything else in this file is byte-identical)
// so js/migration-execute.js can reuse this exact, already-tested
// grouping/ambiguity logic against live Firestore reads, instead of
// re-implementing the same grouping key a second time. This file's own
// behavior is completely unchanged — it still only ever reads a local
// file and never touches Firestore.
export function buildAnalysis(parsed) {
  const collections = parsed.collections || {};
  const hearings = Array.isArray(collections.hearings) ? collections.hearings : [];
  const hearingCases = Array.isArray(collections.hearingCases) ? collections.hearingCases : [];

  const hearingsById = new Map();
  for (const h of hearings) {
    if (h && h.id) hearingsById.set(h.id, h);
  }

  const orphanedRows = []; // hearingCases rows whose hearingId doesn't resolve to a known hearing
  const rowsWithoutCaseNo = []; // rows with an empty/missing caseNo — can't be grouped into a Case at all
  const joined = []; // { row, hearing, hearingDate }

  for (const row of hearingCases) {
    if (!row || typeof row !== "object") continue;
    const hearing = row.hearingId ? hearingsById.get(row.hearingId) : null;
    if (!hearing) {
      orphanedRows.push(row);
      continue;
    }
    if (!(row.caseNo || "").trim()) {
      rowsWithoutCaseNo.push(row);
      continue;
    }
    joined.push({ row, hearing, hearingDate: tsToDate(hearing.hearingDateTime) });
  }

  // --- Group into candidate Cases ---
  const groups = new Map();
  for (const j of joined) {
    const key = `${j.row.caseType || ""}||${normalizeCaseNo(j.row.caseNo)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }

  const reconstructed = [];
  for (const entries of groups.values()) {
    entries.sort((a, b) => {
      if (!a.hearingDate && !b.hearingDate) return 0;
      if (!a.hearingDate) return 1;
      if (!b.hearingDate) return -1;
      return a.hearingDate - b.hearingDate;
    });

    const charges = new Set(entries.map((e) => (e.row.charge || "").trim()).filter(Boolean));
    const datesFiled = new Set(entries.map((e) => (e.row.dateFiled || "").trim()).filter(Boolean));
    const undated = entries.filter((e) => !e.hearingDate).length;
    const emptyStatus = entries.filter((e) => !(e.hearing.status || "").trim()).length;

    const reasons = [];
    if (charges.size > 1) reasons.push(`${charges.size} different "charge" values across its hearings`);
    if (datesFiled.size > 1) reasons.push(`${datesFiled.size} different "dateFiled" values across its hearings`);
    if (undated) reasons.push(`${undated} hearing(s) with no usable hearingDateTime`);
    if (emptyStatus) reasons.push(`${emptyStatus} hearing(s) with an empty "status" field`);

    const latest = entries[entries.length - 1];

    reconstructed.push({
      caseType: entries[0].row.caseType || "",
      caseNo: entries[0].row.caseNo || "",
      charge: [...charges][0] || "",
      dateFiled: [...datesFiled][0] || "",
      hearingCount: entries.length,
      currentStatus: latest.hearing.status || "",
      currentStatusDate: latest.hearingDate ? latest.hearingDate.toISOString() : null,
      clean: reasons.length === 0,
      reasons,
      timeline: entries.map((e) => ({
        hearingId: e.hearing.id,
        hearingDate: e.hearingDate ? e.hearingDate.toISOString() : null,
        status: e.hearing.status || "",
        hearingType: e.hearing.hearingType || "",
        section: e.hearing.section || "",
      })),
    });
  }

  // --- Cross-case signal: the same case number appearing under more than
  // one caseType — worth a human's eyes (typo vs. genuinely two cases).
  const caseNoToTypes = new Map();
  for (const c of reconstructed) {
    const no = normalizeCaseNo(c.caseNo);
    if (!caseNoToTypes.has(no)) caseNoToTypes.set(no, new Set());
    caseNoToTypes.get(no).add(c.caseType);
  }
  const caseNoUnderMultipleTypes = [...caseNoToTypes.entries()]
    .filter(([, types]) => types.size > 1)
    .map(([caseNo, types]) => ({ caseNo, caseTypes: [...types] }));

  // --- Decision 015 evidence: how many hearings have more than one case
  // row attached (the multi-case-per-hearing-session question) ---
  const rowsPerHearing = new Map();
  for (const j of joined) {
    rowsPerHearing.set(j.hearing.id, (rowsPerHearing.get(j.hearing.id) || 0) + 1);
  }
  const hearingCaseCounts = [...rowsPerHearing.values()];
  const multiCaseHearings = [...rowsPerHearing.entries()].filter(([, n]) => n > 1);

  // --- Decision 009 evidence: real vocabulary actually in use ---
  function frequency(field) {
    const m = new Map();
    for (const h of hearings) {
      const v = (h && h[field] ? h[field] : "").toString().trim();
      if (!v) continue;
      m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  // --- Decision 017/018 evidence: targeted keyword search, not a full
  // dump — only hearings whose status/hearingType mention Plea
  // Bargaining or (Provisional) Dismissal, for manual inspection ---
  const keywordHits = [];
  const keywords = ["plea", "provisional", "dismiss"];
  for (const h of hearings) {
    if (!h) continue;
    for (const field of ["status", "hearingType"]) {
      const v = (h[field] || "").toString();
      const lower = v.toLowerCase();
      const hit = keywords.find((k) => lower.includes(k));
      if (hit) {
        const d = tsToDate(h.hearingDateTime);
        keywordHits.push({ hearingId: h.id, field, value: v, matchedKeyword: hit, hearingDateTime: d ? d.toISOString() : null });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceBackup: { backupVersion: parsed.backupVersion, systemVersion: parsed.systemVersion, createdAt: parsed.createdAt },
    counts: {
      hearingsTotal: hearings.length,
      hearingCasesTotal: hearingCases.length,
      orphanedRows: orphanedRows.length,
      rowsWithoutCaseNo: rowsWithoutCaseNo.length,
      reconstructedCases: reconstructed.length,
      cleanCases: reconstructed.filter((c) => c.clean).length,
      ambiguousCases: reconstructed.filter((c) => !c.clean).length,
    },
    reconstructed,
    caseNoUnderMultipleTypes,
    cardinality: {
      hearingsWithCases: hearingCaseCounts.length,
      hearingsWithExactlyOneCase: hearingCaseCounts.filter((n) => n === 1).length,
      hearingsWithMultipleCases: multiCaseHearings.length,
      examples: multiCaseHearings.slice(0, 10).map(([hearingId, n]) => ({ hearingId, caseCount: n })),
    },
    vocabulary: {
      statusFrequency: frequency("status"),
      hearingTypeFrequency: frequency("hearingType"),
      sectionFrequency: frequency("section"),
    },
    keywordHits,
    orphanedRows,
    rowsWithoutCaseNo,
  };
}

// --- Rendering ---------------------------------------------------------

function freqTable(rows, limit = 20) {
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  return `
    <ul>
      ${shown.map(([v, n]) => `<li>${esc(v)} — ${n}</li>`).join("")}
      ${rest > 0 ? `<li class="muted">&hellip; and ${rest} more distinct value(s)</li>` : ""}
    </ul>
  `;
}

function renderReport(analysis) {
  const root = document.getElementById("reportRoot");
  const c = analysis.counts;

  const ambiguousList = analysis.reconstructed
    .filter((r) => !r.clean)
    .slice(0, 50)
    .map(
      (r) => `<li><strong>${esc(r.caseType)}. ${esc(r.caseNo)}</strong> (${r.hearingCount} hearing(s)): ${r.reasons.map(esc).join("; ")}</li>`
    )
    .join("");
  const ambiguousOverflow = c.ambiguousCases - Math.min(c.ambiguousCases, 50);

  const multiCaseExamples = analysis.cardinality.examples
    .map((e) => `<li>Hearing ${esc(e.hearingId)}: ${e.caseCount} case(s) attached</li>`)
    .join("");

  const crossTypeList = analysis.caseNoUnderMultipleTypes
    .map((e) => `<li>Case no. "${esc(e.caseNo)}" appears under: ${e.caseTypes.map(esc).join(", ")}</li>`)
    .join("");

  const keywordList = analysis.keywordHits
    .map(
      (k) => `<li>Hearing ${esc(k.hearingId)} (${k.hearingDateTime ? esc(k.hearingDateTime.slice(0, 10)) : "no date"}) — <code>${esc(k.field)}</code>: "${esc(k.value)}" (matched "${esc(k.matchedKeyword)}")</li>`
    )
    .join("");

  root.innerHTML = `
    <section class="card">
      <h2>Summary</h2>
      <ul>
        <li>${c.hearingsTotal} hearing(s), ${c.hearingCasesTotal} case row(s) read from the file</li>
        <li>${c.orphanedRows} case row(s) reference a hearing that no longer exists (orphaned — excluded below)</li>
        <li>${c.rowsWithoutCaseNo} case row(s) have no case number at all (excluded below — nothing to group them by)</li>
        <li><strong>${c.reconstructedCases} candidate Case(s) reconstructed</strong>: ${c.cleanCases} clean, ${c.ambiguousCases} need a human look</li>
      </ul>
      <p class="muted">Nothing above has been written anywhere. This is a report, not a migration.</p>
    </section>

    <section class="card">
      <h2>Ambiguous reconstructions (need a human look)</h2>
      ${c.ambiguousCases ? `<ul>${ambiguousList}</ul>${ambiguousOverflow > 0 ? `<p class="muted">&hellip; and ${ambiguousOverflow} more.</p>` : ""}` : `<p class="muted">None found.</p>`}
    </section>

    <section class="card">
      <h2>Decision 015 evidence — hearings covering more than one case</h2>
      <p>Of ${analysis.cardinality.hearingsWithCases} hearing(s) with at least one case row: ${analysis.cardinality.hearingsWithExactlyOneCase} have exactly one, <strong>${analysis.cardinality.hearingsWithMultipleCases} have more than one</strong>.</p>
      ${analysis.cardinality.hearingsWithMultipleCases ? `<p>Examples:</p><ul>${multiCaseExamples}</ul>` : ""}
    </section>

    <section class="card">
      <h2>Cross-case signal — same case number under more than one case type</h2>
      ${analysis.caseNoUnderMultipleTypes.length ? `<ul>${crossTypeList}</ul>` : `<p class="muted">None found.</p>`}
    </section>

    <section class="card">
      <h2>Decision 009 evidence — real field vocabulary in use</h2>
      <p><strong>status</strong> (${analysis.vocabulary.statusFrequency.length} distinct value(s)):</p>
      ${freqTable(analysis.vocabulary.statusFrequency)}
      <p><strong>hearingType</strong> (${analysis.vocabulary.hearingTypeFrequency.length} distinct value(s)):</p>
      ${freqTable(analysis.vocabulary.hearingTypeFrequency)}
      <p><strong>section</strong> (${analysis.vocabulary.sectionFrequency.length} distinct value(s)):</p>
      ${freqTable(analysis.vocabulary.sectionFrequency)}
    </section>

    <section class="card">
      <h2>Decision 017/018 evidence — Plea Bargaining / (Provisional) Dismissal mentions</h2>
      ${analysis.keywordHits.length ? `<ul>${keywordList}</ul>` : `<p class="muted">No hearing's "status" or "hearingType" mentions plea bargaining, provisional status, or dismissal.</p>`}
    </section>

    <section class="card">
      <h2>Rows excluded from reconstruction</h2>
      <p>${analysis.orphanedRows.length} orphaned case row(s), ${analysis.rowsWithoutCaseNo.length} row(s) with no case number. Both counts are also in the Summary above — full record dumps are in the downloadable JSON, not repeated here.</p>
      <button type="button" class="btn-secondary" id="downloadBtn">Download full report (JSON)</button>
    </section>
  `;

  const downloadBtn = document.getElementById("downloadBtn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: "application/json" });
      downloadBlob(blob, `migration-dryrun-report-${new Date().toISOString().slice(0, 10)}.json`);
    });
  }
}

// --- File input --------------------------------------------------------
//
// Bug fix (IM-7A first execution): this file is now also imported by
// migration-execute.js (for its exported buildAnalysis()), which has no
// #fileInput element on its own page — the code below used to run
// unconditionally at import time and threw
// "Cannot read properties of null (reading 'addEventListener')" as a
// result. Guarded the same way below: this file-input wiring only runs
// on a page that actually has a #fileInput element (i.e.
// migration-dryrun.html itself). No change to buildAnalysis() or any
// analysis/migration logic — this is the only change in this file.

const fileInput = document.getElementById("fileInput");
if (fileInput) {
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    const errorEl = document.getElementById("fileError");
    document.getElementById("reportRoot").innerHTML = "";
    errorEl.textContent = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        errorEl.textContent = `File is not valid JSON (${err.message}).`;
        return;
      }
      if (!parsed || typeof parsed !== "object" || !parsed.collections) {
        errorEl.textContent = 'This doesn\'t look like a Backup & Restore export — expected a "collections" object.';
        return;
      }
      renderReport(buildAnalysis(parsed));
    };
    reader.onerror = () => {
      errorEl.textContent = "Could not read the selected file.";
    };
    reader.readAsText(file);
  });
}
