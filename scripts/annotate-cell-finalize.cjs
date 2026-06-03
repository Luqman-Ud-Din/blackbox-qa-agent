#!/usr/bin/env node
/**
 * annotate-cell-finalize.cjs — MCP-driven annotation pipeline, step 2 of 2.
 *
 * PURE NODE — no external deps, no playwright, no chromium.
 *
 * Called AFTER the orchestrator has used MCP (browser_navigate +
 * browser_take_screenshot) to render annotate-cell-prepare.cjs's HTML output
 * into an annotated PNG. This script:
 *   1. Verifies the annotated PNG actually exists on disk.
 *   2. Re-reads the cell's JSONL findings.
 *   3. Writes annotatedScreenshotPath into every finding.
 *   4. Replaces the JSONL atomically.
 *
 * Idempotent: re-running on a cell whose findings already have
 * annotatedScreenshotPath is a no-op (returns exit 0, logs "already done").
 *
 * Usage:
 *   node scripts/annotate-cell-finalize.cjs <run-id> <cell-id>
 *
 * Exit codes:
 *   0  — JSONL updated (or was already up-to-date)
 *   2  — annotated PNG missing on disk (orchestrator forgot to screenshot)
 *   3  — JSONL missing
 *   4  — schema validation failed
 */

const fs   = require('fs');
const path = require('path');
const schema = require('./argus-schema.cjs');

const RUN_ID  = process.argv[2];
const CELL_ID = process.argv[3];

if (!RUN_ID || !CELL_ID) {
  console.error('Usage: node scripts/annotate-cell-finalize.cjs <run-id> <cell-id>');
  process.exit(1);
}

const PROJECT_ROOT  = path.resolve(__dirname, '..');
const RUN_DIR       = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_FILE   = path.join(RUN_DIR, 'issues', `${CELL_ID}.jsonl`);
const SHOTS_DIR     = path.join(RUN_DIR, 'screenshots');
const BASE_PNG      = path.join(SHOTS_DIR, `${CELL_ID}-base.png`);
const ANNOTATED_PNG = path.join(SHOTS_DIR, `${CELL_ID}-annotated.png`);

if (!fs.existsSync(ISSUES_FILE)) {
  console.error(`annotate-cell-finalize: no issues JSONL for cell ${CELL_ID} (${ISSUES_FILE})`);
  process.exit(3);
}
if (!fs.existsSync(ANNOTATED_PNG)) {
  console.error(`annotate-cell-finalize: annotated PNG missing at ${ANNOTATED_PNG}`);
  console.error('  The orchestrator must call MCP browser_navigate + browser_take_screenshot before this step.');
  process.exit(2);
}

// ── Sanity-check the annotated PNG (valid PNG header) ─────────────────────
const annBuf = fs.readFileSync(ANNOTATED_PNG);
if (annBuf.length < 24 || annBuf.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
  console.error(`annotate-cell-finalize: ${ANNOTATED_PNG} exists but is not a valid PNG`);
  process.exit(2);
}

// ── Load + validate findings ──────────────────────────────────────────────
const rawIssues = schema.readJsonl(ISSUES_FILE);
if (rawIssues.length === 0) {
  console.log(`annotate-cell-finalize: no findings in ${CELL_ID} — nothing to update`);
  process.exit(0);
}

const { valid, invalid } = schema.validateMany(rawIssues);
if (invalid.length > 0) {
  console.error(`annotate-cell-finalize: ${invalid.length} of ${rawIssues.length} issues failed schema validation`);
  for (const { error, field, issue } of invalid.slice(0, 3)) {
    console.error(`  - field "${field}": ${error}`);
  }
  process.exit(4);
}

// ── Compute project-relative paths (portable across machines) ─────────────
const relAnnotated = path.relative(PROJECT_ROOT, ANNOTATED_PNG).split(path.sep).join('/');
const relBase      = path.relative(PROJECT_ROOT, BASE_PNG).split(path.sep).join('/');

// ── Idempotency check: skip if all findings already annotated ─────────────
const alreadyDone = valid.every(i => i.annotatedScreenshotPath === relAnnotated);
if (alreadyDone) {
  console.log(`annotate-cell-finalize: ${CELL_ID} already finalized (${valid.length} findings) — no-op`);
  process.exit(0);
}

// ── Update every finding ──────────────────────────────────────────────────
const updated = valid.map(i => ({
  ...i,
  screenshotPath:          i.screenshotPath          || relBase,
  annotatedScreenshotPath: relAnnotated
}));

// ── Atomic write (write to temp, rename over original) ────────────────────
const TMP = ISSUES_FILE + '.tmp';
fs.writeFileSync(TMP, updated.map(i => JSON.stringify(i)).join('\n') + '\n');
fs.renameSync(TMP, ISSUES_FILE);

console.log(`annotate-cell-finalize: ${CELL_ID} updated — ${valid.length} findings linked to ${relAnnotated}`);
process.exit(0);
