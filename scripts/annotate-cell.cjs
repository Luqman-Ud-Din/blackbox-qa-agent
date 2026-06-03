#!/usr/bin/env node
/**
 * annotate-cell.cjs — PERMANENT cell-evidence annotation pipeline.
 *
 * DO NOT regenerate this file at runtime. The qa-argus orchestrator calls it
 * directly. Historically, the orchestrator's runtime-generated annotate calls
 * passed findings with the wrong field name (`type` instead of `issueType`),
 * causing every label to read literally "issue [medium]" instead of the real
 * defect name. This script eliminates that class of bug by reading the issue
 * JSONL directly (which already has the canonical schema) and constructing
 * the annotate.js call from validated data.
 *
 * Usage:
 *   node scripts/annotate-cell.cjs <run-id> <cell-id>
 *
 * Reads:
 *   .tmp/<run-id>/issues/<cell-id>.jsonl       — findings for the cell
 *   .tmp/<run-id>/screenshots/<cell-id>-base.png — the raw screenshot
 *                                                  (must exist before this runs;
 *                                                   captured by the cell runner)
 *
 * Writes:
 *   .tmp/<run-id>/screenshots/<cell-id>-annotated.png
 *
 * Then UPDATES every issue in the JSONL with `annotatedScreenshotPath` so
 * downstream skills (file-bugs.cjs, qa-vision-review) can find it.
 *
 * Exit codes:
 *   0  — annotated png written and JSONL updated
 *   2  — base screenshot missing (orchestrator forgot to capture it)
 *   3  — JSONL missing or empty (no findings for this cell)
 *   4  — schema validation failed (upstream bug in probe output)
 *   5  — annotate.js failed (annotation rendering error)
 */

const fs    = require('fs');
const path  = require('path');
const { execFileSync } = require('child_process');
const schema = require('./argus-schema.cjs');

const RUN_ID  = process.argv[2];
const CELL_ID = process.argv[3];

if (!RUN_ID || !CELL_ID) {
  console.error('Usage: node scripts/annotate-cell.cjs <run-id> <cell-id>');
  process.exit(1);
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUN_DIR      = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_FILE  = path.join(RUN_DIR, 'issues', `${CELL_ID}.jsonl`);
const SHOTS_DIR    = path.join(RUN_DIR, 'screenshots');
const BASE_PNG     = path.join(SHOTS_DIR, `${CELL_ID}-base.png`);
const ANNOTATED    = path.join(SHOTS_DIR, `${CELL_ID}-annotated.png`);

// ── Preconditions ──────────────────────────────────────────────────────────
if (!fs.existsSync(BASE_PNG)) {
  console.error(`annotate-cell: base screenshot missing at ${BASE_PNG}`);
  console.error('  The cell runner must capture the base screenshot before calling this script.');
  process.exit(2);
}
if (!fs.existsSync(ISSUES_FILE)) {
  console.error(`annotate-cell: no issues JSONL for cell ${CELL_ID} (${ISSUES_FILE})`);
  process.exit(3);
}

// ── Load findings ──────────────────────────────────────────────────────────
const rawIssues = schema.readJsonl(ISSUES_FILE);
if (rawIssues.length === 0) {
  console.log(`annotate-cell: no findings for ${CELL_ID} — nothing to annotate`);
  process.exit(0);
}

// ── Validate ───────────────────────────────────────────────────────────────
const { valid, invalid } = schema.validateMany(rawIssues);
if (invalid.length > 0) {
  console.error(`annotate-cell: ${invalid.length} of ${rawIssues.length} issues failed schema validation:`);
  for (const { error, field, issue } of invalid.slice(0, 5)) {
    console.error(`  - field "${field}": ${error}`);
    console.error(`    issue: ${JSON.stringify(issue).slice(0, 200)}`);
  }
  process.exit(4);
}

// ── Build the annotate.js findings array (canonical schema) ───────────────
// annotate.js requires { issueType, severity, bbox? } and uses
// description + selector for the legend below the screenshot.
const annotateFindings = valid.map(i => ({
  issueType:   i.issueType,
  severity:    i.severity,
  bbox:        i.bbox || null,
  description: i.description || '',
  selector:    i.selector    || ''
}));

// ── Run annotate.js (fail-fast — no fallback) ─────────────────────────────
const ANNOTATE_SCRIPT = path.join(__dirname, 'annotate.js');
try {
  execFileSync('node', [
    ANNOTATE_SCRIPT,
    '--screenshot', BASE_PNG,
    '--findings',   JSON.stringify(annotateFindings),
    '--output',     ANNOTATED
  ], { stdio: 'inherit' });
} catch (e) {
  console.error(`annotate-cell: annotate.js failed for ${CELL_ID}: ${e.message}`);
  process.exit(5);
}

if (!fs.existsSync(ANNOTATED)) {
  console.error(`annotate-cell: annotate.js exited 0 but ${ANNOTATED} was not produced`);
  process.exit(5);
}

// ── Update each issue with the annotated screenshot path ──────────────────
const relAnnotated = path.relative(PROJECT_ROOT, ANNOTATED).split(path.sep).join('/');
const relBase      = path.relative(PROJECT_ROOT, BASE_PNG).split(path.sep).join('/');
const updated = valid.map(i => ({
  ...i,
  screenshotPath:          i.screenshotPath          || relBase,
  annotatedScreenshotPath: relAnnotated
}));

// Re-write the JSONL atomically (write to temp file then rename)
const TMP = ISSUES_FILE + '.tmp';
fs.writeFileSync(TMP, updated.map(i => JSON.stringify(i)).join('\n') + '\n');
fs.renameSync(TMP, ISSUES_FILE);

console.log(`annotate-cell: ${CELL_ID} — ${valid.length} finding(s) annotated → ${path.basename(ANNOTATED)}`);
console.log(`  JSONL updated with annotatedScreenshotPath for all findings`);
