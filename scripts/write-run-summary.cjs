#!/usr/bin/env node
/**
 * write-run-summary.cjs — compute accurate run-summary.json from actual files.
 *
 * Usage:
 *   node scripts/write-run-summary.cjs <run-id>
 *
 * Reads:
 *   .tmp/<run-id>/audit-plan.json      — routes, viewports, app info
 *   .tmp/<run-id>/issues/*.jsonl       — actual findings (one per line)
 *   .tmp/<run-id>/bugs-filed.jsonl     — filed ADO bugs
 *   .tmp/<run-id>/screenshots/*.png    — screenshot files
 *
 * Writes:
 *   .tmp/<run-id>/run-summary.json     — overwrites any model-fabricated version
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const RUN_ID = process.argv[2];
if (!RUN_ID) { console.error('Usage: node scripts/write-run-summary.cjs <run-id>'); process.exit(1); }

const PROJECT_ROOT    = path.resolve(__dirname, '..');
const RUN_DIR         = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_DIR      = path.join(RUN_DIR, 'issues');
const SCREENSHOTS_DIR = path.join(RUN_DIR, 'screenshots');
const PLAN_FILE       = path.join(RUN_DIR, 'audit-plan.json');
const BUGS_LOG        = path.join(RUN_DIR, 'bugs-filed.jsonl');
const SUMMARY_FILE    = path.join(RUN_DIR, 'run-summary.json');

if (!fs.existsSync(RUN_DIR)) { console.error(`Run dir missing: ${RUN_DIR}`); process.exit(1); }

// ── Load audit-plan ───────────────────────────────────────────────────────────
const plan = fs.existsSync(PLAN_FILE)
  ? JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'))
  : { app: RUN_ID, baseUrl: '', browsers: [], viewports: [], cells: [], totalCells: 0 };

// ── Count findings from actual JSONL files ────────────────────────────────────
const findings        = [];
const findingsBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
const issueTypeCounts = {};
let   cellsWithFindings = 0;

if (fs.existsSync(ISSUES_DIR)) {
  for (const f of fs.readdirSync(ISSUES_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(ISSUES_DIR, f), 'utf8')
      .split('\n').filter(l => l.trim());
    if (lines.length > 0) cellsWithFindings++;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        findings.push(obj);
        const sev = (obj.severity || 'medium').toLowerCase();
        if (sev in findingsBySeverity) findingsBySeverity[sev]++;
        const it = obj.issueType || 'unknown';
        issueTypeCounts[it] = (issueTypeCounts[it] || 0) + 1;
      } catch (_) { /* malformed line — skip */ }
    }
  }
}

// ── Top issues (sorted by count) ─────────────────────────────────────────────
const topIssues = Object.entries(issueTypeCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([issueType, count]) => {
    const sample = findings.find(f => f.issueType === issueType);
    return {
      issueType,
      count,
      severity:    sample ? (sample.severity || 'medium') : 'medium',
      description: sample ? (sample.description || '') : '',
    };
  });

// ── Count screenshots ─────────────────────────────────────────────────────────
let screenshotsCaptured = 0;
let annotatedCells      = 0;
if (fs.existsSync(SCREENSHOTS_DIR)) {
  const pngs = fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png'));
  screenshotsCaptured = pngs.filter(f => f.endsWith('-base.png')).length;
  annotatedCells      = pngs.filter(f => f.endsWith('-annotated.png')).length;
}

// ── Count filed ADO bugs ──────────────────────────────────────────────────────
const adoBugIds = [];
if (fs.existsSync(BUGS_LOG)) {
  for (const line of fs.readFileSync(BUGS_LOG, 'utf8').split('\n').filter(l => l.trim())) {
    try {
      const obj = JSON.parse(line);
      if (obj.adoBugId) adoBugIds.push(String(obj.adoBugId));
    } catch (_) { /* skip */ }
  }
}

// ── Build summary ─────────────────────────────────────────────────────────────
const config = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, '.claude/automation.config.json'), 'utf8')); }
  catch (_) { return {}; }
})();

const summary = {
  runId:               RUN_ID,
  app:                 plan.app  || 'unknown',
  baseUrl:             plan.baseUrl || '',
  completedAt:         new Date().toISOString(),
  cellsTotal:          plan.totalCells || (plan.cells || []).length,
  cellsRun:            cellsWithFindings,
  routesDiscovered:    [...new Set((plan.cells || []).map(c => c.route))].length,
  browsers:            plan.browsers || [],
  viewports:           (plan.viewports || []).map(v => v.width && v.height ? `${v.name || v.class} (${v.width}×${v.height})` : (v.name || v.class)),
  rawFindings:         findings.length,
  validatedFindings:   findings.filter(f => f.severity !== 'info').length,
  adoBugsFiled:        adoBugIds.length,
  adoBugIds,
  screenshotsCaptured,
  annotatedCells,
  cleanCells:          (plan.totalCells || 0) - cellsWithFindings,
  findingsBySeverity,
  topIssues,
  adoUrl:              (config.ado && config.ado.org && config.ado.project)
                         ? `${config.ado.org}/${config.ado.project}`
                         : '',
};

fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

console.log(`✅ run-summary.json written`);
console.log(`   app:              ${summary.app}`);
console.log(`   cells:            ${summary.cellsRun}/${summary.cellsTotal} ran`);
console.log(`   rawFindings:      ${summary.rawFindings}`);
console.log(`   validatedFindings:${summary.validatedFindings}`);
console.log(`   adoBugsFiled:     ${summary.adoBugsFiled}`);
console.log(`   screenshots:      ${summary.screenshotsCaptured} base, ${summary.annotatedCells} annotated`);
