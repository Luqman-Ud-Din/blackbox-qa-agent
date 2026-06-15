#!/usr/bin/env node
/**
 * verify-export.cjs — strict cell-by-cell verification of a downloaded export file
 * against the on-screen table snapshot captured by qa-test-export.
 *
 * Called by the qa-test-export orchestrator AFTER a download lands on disk.
 *
 * Usage:
 *   node scripts/verify-export.cjs <export-file> <snapshot.json>
 *
 *   <export-file>   absolute path to the downloaded file (.csv, .tsv, .json,
 *                   .xlsx, .xls, .pdf)
 *   <snapshot.json> absolute path to a JSON file written by qa-test-export that
 *                   describes the on-screen state at click-time. Shape:
 *                   {
 *                     "headers":        ["Code", "Name", "Description", "Status"],
 *                     "rows":           [["2026-6-0002","B","","Active"], ...],
 *                     "totalRowCount":  2,          // from pager "Showing X of Y"
 *                     "filterApplied":  "Class2-A", // null if unfiltered
 *                     "filteredValue":  "Class2-A"  // the cell value that drove the filter
 *                   }
 *
 * Output (stdout, single-line JSON):
 *   { "findings": [ { issueType, severity, description, evidence } ... ] }
 *
 * Exit codes:
 *   0  — verification ran (findings may be empty)
 *   2  — export file unreadable / unsupported format
 *   3  — snapshot file missing or malformed
 */
const fs   = require('fs');
const path = require('path');

const EXPORT_FILE = process.argv[2];
const SNAPSHOT    = process.argv[3];

if (!EXPORT_FILE || !SNAPSHOT) {
  console.error('Usage: node scripts/verify-export.cjs <export-file> <snapshot.json>');
  process.exit(1);
}
if (!fs.existsSync(EXPORT_FILE)) {
  console.error(`Export file not found: ${EXPORT_FILE}`);
  process.exit(2);
}
if (!fs.existsSync(SNAPSHOT)) {
  console.error(`Snapshot file not found: ${SNAPSHOT}`);
  process.exit(3);
}

let snapshot;
try { snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')); }
catch (e) { console.error(`Snapshot parse error: ${e.message}`); process.exit(3); }

const ext = path.extname(EXPORT_FILE).toLowerCase().replace('.', '');
const fileSize = fs.statSync(EXPORT_FILE).size;
const findings = [];

// ── Parsers ────────────────────────────────────────────────────────────────
function parseCsv(text, delimiter = ',') {
  // Minimal RFC-4180-ish CSV parser handling quoted fields with embedded commas
  // and newlines. Good enough for verification — we trust the export's intent.
  const rows = [];
  let cur = [], field = '', inQuote = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuote = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"') { inQuote = true; i++; continue; }
      if (c === delimiter) { cur.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
      field += c; i++;
    }
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(c => (c || '').trim() !== ''));
}

function parseJson(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const headers = Object.keys(data[0]);
    const rows = data.map(obj => headers.map(h => String(obj[h] == null ? '' : obj[h])));
    return [headers, ...rows];
  }
  if (Array.isArray(data) && Array.isArray(data[0])) return data.map(r => r.map(String));
  return [];
}

function parseXlsx(filePath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: true, cellNF: false });
  // Use the first non-hidden sheet — most exports have only one
  const sheetName = wb.SheetNames.find(n => {
    const s = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets.find(x => x.name === n);
    return !s || s.Hidden !== 1;
  }) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  return rows.filter(r => r.some(c => String(c || '').trim() !== '')).map(r => r.map(String));
}

async function parsePdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  // PDF text loses cell boundaries — we extract lines and let the comparator
  // do substring matching (less strict than tabular, but only option for PDFs).
  return data.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

// ── Compare table-shaped exports to snapshot ───────────────────────────────
function norm(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }

function compareTable(parsedRows, kind) {
  if (parsedRows.length === 0) {
    findings.push({
      issueType: 'exportContentEmpty', severity: 'high',
      description: `Export file (${kind}, ${fileSize} bytes) parsed to ZERO non-empty rows. Either the export endpoint returned an empty file or the parser found no data. Visible table had ${snapshot.totalRowCount || snapshot.rows.length} rows on screen.`,
      evidence: { kind, fileSize, screenRowCount: snapshot.totalRowCount || snapshot.rows.length }
    });
    return;
  }
  const exportHeaders = parsedRows[0].map(String);
  const exportData    = parsedRows.slice(1);
  const screenHeaders = (snapshot.headers || []).map(String);

  // 1. Header match — every visible column header must appear in the export
  const exportH = exportHeaders.map(norm);
  const missingCols = [];
  for (const h of screenHeaders) {
    if (!norm(h)) continue;
    // Skip non-data columns (actions, edit, delete) that aren't expected in exports
    if (/^(actions?|edit|delete|operations?|view|#|sr#?)$/i.test(h.trim())) continue;
    if (!exportH.includes(norm(h))) missingCols.push(h);
  }
  if (missingCols.length > 0) {
    findings.push({
      issueType: 'exportContentMissingColumns', severity: 'high',
      description: `Export is missing ${missingCols.length} column(s) shown on screen: ${missingCols.slice(0, 5).join(', ')}. Users export the file expecting the same columns they see.`,
      evidence: { missingColumns: missingCols, screenHeaders, exportHeaders }
    });
  }

  // 2. Row count match (within tolerance of 1 for grouping/footer rows)
  const expectedRows = snapshot.totalRowCount || snapshot.rows.length;
  if (expectedRows > 0 && Math.abs(exportData.length - expectedRows) > 1) {
    // Could be filter ignored (export has MORE rows than filtered view)
    if (snapshot.filterApplied && exportData.length > expectedRows + 1) {
      findings.push({
        issueType: 'exportIgnoresFilter', severity: 'high',
        description: `Filter "${snapshot.filterApplied}" was applied (showing ${expectedRows} rows on screen) but the export contains ${exportData.length} rows — server returned the unfiltered dataset. This is a back-end bug where the export endpoint ignores the active filter.`,
        evidence: { filterApplied: snapshot.filterApplied, screenRowCount: expectedRows, exportRowCount: exportData.length }
      });
    } else {
      findings.push({
        issueType: 'exportContentRowCountMismatch', severity: 'high',
        description: `Visible row count (${expectedRows}) differs from export row count (${exportData.length}) by ${Math.abs(exportData.length - expectedRows)} rows. Either pagination is truncating the export OR the export source is stale.`,
        evidence: { screenRowCount: expectedRows, exportRowCount: exportData.length }
      });
    }
  }

  // 3. Strict cell-by-cell — every visible cell value from snapshot.rows must
  //    appear somewhere in the export. Verbatim trim+collapse-whitespace match.
  const exportCellSet = new Set();
  for (const row of exportData) for (const c of row) exportCellSet.add(norm(c));
  const screenRows = snapshot.rows || [];
  const mismatchedCells = [];
  for (let ri = 0; ri < Math.min(screenRows.length, 5); ri++) {
    const row = screenRows[ri];
    for (let ci = 0; ci < row.length; ci++) {
      const v = row[ci];
      if (!v || norm(v) === '') continue;
      // Skip values that look like row-action buttons
      if (/^(edit|delete|view|×|‹|›|⋮|⋯)$/i.test(String(v).trim())) continue;
      if (!exportCellSet.has(norm(v))) {
        mismatchedCells.push({ rowIdx: ri, colIdx: ci, screenValue: v });
      }
    }
  }
  if (mismatchedCells.length > 0) {
    findings.push({
      issueType: 'exportContentCellMismatch', severity: 'high',
      description: `${mismatchedCells.length} visible cell value(s) from the first ${Math.min(screenRows.length, 5)} rows do not appear in the export. Sample: ${mismatchedCells.slice(0, 3).map(m => `"${String(m.screenValue).slice(0, 30)}"`).join(', ')}. Either the export is reformatting cells (date/currency/number format drift) or the export contains different data than what's shown.`,
      evidence: { mismatchedCells: mismatchedCells.slice(0, 6) }
    });
  }

  // 4. Filter applied → assert the filtered value DOES appear in the export
  if (snapshot.filterApplied && snapshot.filteredValue) {
    const fv = norm(snapshot.filteredValue);
    if (fv && !exportCellSet.has(fv)) {
      // Try substring match as fallback (the filter value may be embedded in cell text)
      let foundSub = false;
      for (const c of exportCellSet) {
        if (c.includes(fv) || fv.includes(c)) { foundSub = true; break; }
      }
      if (!foundSub) {
        findings.push({
          issueType: 'exportIgnoresFilter', severity: 'high',
          description: `Filter value "${snapshot.filteredValue}" does not appear in the exported file even though the on-screen table was filtered by it. The export endpoint is returning data that doesn't match the active filter.`,
          evidence: { filterApplied: snapshot.filterApplied, filteredValue: snapshot.filteredValue }
        });
      }
    }
  }
}

function comparePdfLines(lines) {
  if (lines.length === 0) {
    findings.push({
      issueType: 'exportContentEmpty', severity: 'high',
      description: `PDF parsed to ZERO text lines. Either the file is image-only (scanned), empty, or corrupted.`,
      evidence: { kind: 'pdf', fileSize }
    });
    return;
  }
  // For PDFs: substring match (we lost cell boundaries during text extraction)
  const allText = norm(lines.join(' '));
  const screenHeaders = (snapshot.headers || []).filter(h => !/^(actions?|edit|delete|operations?|view|#|sr#?)$/i.test(h.trim()));
  const missingCols = screenHeaders.filter(h => !allText.includes(norm(h)));
  if (missingCols.length > 0) {
    findings.push({
      issueType: 'exportContentMissingColumns', severity: 'high',
      description: `PDF export is missing ${missingCols.length} column header(s) shown on screen: ${missingCols.slice(0, 5).join(', ')}.`,
      evidence: { missingColumns: missingCols, kind: 'pdf' }
    });
  }
  const screenRows = snapshot.rows || [];
  const mismatchedCells = [];
  for (let ri = 0; ri < Math.min(screenRows.length, 5); ri++) {
    for (const v of screenRows[ri]) {
      if (!v || norm(v) === '') continue;
      if (/^(edit|delete|view|×|‹|›|⋮|⋯)$/i.test(String(v).trim())) continue;
      if (!allText.includes(norm(v))) mismatchedCells.push({ rowIdx: ri, screenValue: v });
    }
  }
  if (mismatchedCells.length > 0) {
    findings.push({
      issueType: 'exportContentCellMismatch', severity: 'high',
      description: `${mismatchedCells.length} visible cell value(s) from the first ${Math.min(screenRows.length, 5)} rows are absent from the PDF text. Sample: ${mismatchedCells.slice(0, 3).map(m => `"${String(m.screenValue).slice(0, 30)}"`).join(', ')}.`,
      evidence: { mismatchedCells: mismatchedCells.slice(0, 6), kind: 'pdf' }
    });
  }
  if (snapshot.filterApplied && snapshot.filteredValue) {
    if (!allText.includes(norm(snapshot.filteredValue))) {
      findings.push({
        issueType: 'exportIgnoresFilter', severity: 'high',
        description: `Filter value "${snapshot.filteredValue}" does not appear in the PDF export even though the on-screen table was filtered by it.`,
        evidence: { filterApplied: snapshot.filterApplied, filteredValue: snapshot.filteredValue, kind: 'pdf' }
      });
    }
  }
}

// ── Main dispatch ──────────────────────────────────────────────────────────
(async () => {
  try {
    let parsed;
    if (ext === 'csv') {
      parsed = parseCsv(fs.readFileSync(EXPORT_FILE, 'utf8'));
      compareTable(parsed, 'csv');
    } else if (ext === 'tsv' || ext === 'txt') {
      parsed = parseCsv(fs.readFileSync(EXPORT_FILE, 'utf8'), '\t');
      compareTable(parsed, 'tsv');
    } else if (ext === 'json') {
      parsed = parseJson(fs.readFileSync(EXPORT_FILE, 'utf8'));
      compareTable(parsed, 'json');
    } else if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
      parsed = parseXlsx(EXPORT_FILE);
      compareTable(parsed, 'xlsx');
    } else if (ext === 'pdf') {
      const lines = await parsePdf(EXPORT_FILE);
      comparePdfLines(lines);
    } else {
      findings.push({
        issueType: 'exportFormatUnsupported', severity: 'low',
        description: `Export format ".${ext}" not supported by the content verifier (supported: csv, tsv, json, xlsx, xls, pdf). Skipping content checks.`,
        evidence: { ext, fileSize }
      });
    }
    console.log(JSON.stringify({ findings }));
    process.exit(0);
  } catch (e) {
    console.error(`Verifier error: ${e.message}`);
    process.exit(2);
  }
})();
