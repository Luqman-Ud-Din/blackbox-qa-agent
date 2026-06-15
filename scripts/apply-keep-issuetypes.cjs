#!/usr/bin/env node
/**
 * apply-keep-issuetypes.cjs — enforces customize.toml [keep_issuetypes] AND
 * [drop_issuetypes] AFTER findings JSONL files are written but BEFORE
 * annotation / bug filing.
 *
 * The two tables in customize.toml look like:
 *   [keep_issuetypes]
 *   qa-detect-ux-icons = ["iconClippedInButton"]     # ALLOW-LIST mode
 *
 *   [drop_issuetypes]
 *   qa-detect-ux-feedback = ["searchNoClearButton"]  # DENY-LIST mode
 *
 * Decision order per finding:
 *   1. If (skill, issueType) is in [drop_issuetypes] → DROP (always wins).
 *   2. Else if skill is in [keep_issuetypes] → KEEP only if issueType is in
 *      its keep array; otherwise DROP.
 *   3. Else (skill not mentioned in either table) → pass through unchanged.
 *
 * Use [keep_issuetypes] when you want only a few issue types from a noisy
 * skill. Use [drop_issuetypes] when you want to mute one or two specific
 * issue types from an otherwise-good skill — saves you from listing every
 * other issue type. Both tables can be present simultaneously.
 *
 * Usage:
 *   node scripts/apply-keep-issuetypes.cjs <run-dir>
 *
 * Walks <run-dir>/issues/*.jsonl, filters each, and rewrites in place.
 * Also writes a single drop-report at <run-dir>/keep-issuetypes-report.json
 * for the orchestrator to log.
 *
 * Exit codes:
 *   0  — filter ran (report file written, even if zero drops)
 *   2  — customize.toml or run-dir missing
 */
const fs   = require('fs');
const path = require('path');

const RUN_DIR = process.argv[2];
if (!RUN_DIR) {
  console.error('Usage: node scripts/apply-keep-issuetypes.cjs <run-dir>');
  process.exit(1);
}
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CUSTOMIZE    = path.join(PROJECT_ROOT, 'skills', 'qa-argus', 'customize.toml');
const ISSUES_DIR   = path.join(RUN_DIR, 'issues');

if (!fs.existsSync(CUSTOMIZE)) { console.error('customize.toml not found'); process.exit(2); }
if (!fs.existsSync(ISSUES_DIR)) { console.error(`issues dir not found: ${ISSUES_DIR}`); process.exit(2); }

// ── Minimal TOML reader: parses [keep_issuetypes] AND [drop_issuetypes] ──
// (Avoids adding a TOML dependency. Handles the schema we control.)
function readTableArrays(file, tableName) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const map = {};
  let inSection = false;
  const target = `[${tableName}]`;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();         // strip comments
    if (!line) continue;
    if (/^\[\s*([\w.]+)\s*\]$/.test(line)) {
      inSection = (line.replace(/\s/g, '') === target);
      continue;
    }
    if (!inSection) continue;
    // Line shape: skill-name = ["a", "b", "c"]
    const m = /^([\w-]+)\s*=\s*\[(.*)\]\s*$/.exec(line);
    if (!m) continue;
    const skill = m[1];
    const items = m[2].split(',').map(s => s.trim()).filter(Boolean)
      .map(s => s.replace(/^["']|["']$/g, ''));
    map[skill] = items;
  }
  return map;
}

const keep = readTableArrays(CUSTOMIZE, 'keep_issuetypes');
const drop = readTableArrays(CUSTOMIZE, 'drop_issuetypes');
const skillsWithKeep = Object.keys(keep);
const skillsWithDrop = Object.keys(drop);
if (skillsWithKeep.length === 0 && skillsWithDrop.length === 0) {
  console.log(JSON.stringify({ filtered: false, reason: 'no [keep_issuetypes] or [drop_issuetypes] entries' }));
  process.exit(0);
}

// ── Walk JSONL files and filter ─────────────────────────────────────────
const jsonlFiles = fs.readdirSync(ISSUES_DIR).filter(f => f.endsWith('.jsonl'));
const report = { perSkillDropped: {}, perSkillKept: {}, totalDropped: 0, totalKept: 0, cellsProcessed: 0 };

for (const f of jsonlFiles) {
  const full = path.join(ISSUES_DIR, f);
  const raw = fs.readFileSync(full, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const out = [];
  let modified = false;
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { out.push(line); continue; }
    const skill = obj.skill;
    const issueType = obj.issueType;
    if (!skill || !issueType) { out.push(line); continue; }

    // (a) Explicit drop list — wins over keep. If issueType is in drop[skill], drop it.
    if (drop.hasOwnProperty(skill) && drop[skill].includes(issueType)) {
      modified = true;
      report.perSkillDropped[skill] = (report.perSkillDropped[skill] || 0) + 1;
      report.totalDropped++;
      continue;
    }
    // (b) Keep list — if the skill has a keep entry, drop everything not on it.
    if (keep.hasOwnProperty(skill)) {
      if (keep[skill].includes(issueType)) {
        out.push(line);
        report.perSkillKept[skill] = (report.perSkillKept[skill] || 0) + 1;
        report.totalKept++;
      } else {
        modified = true;
        report.perSkillDropped[skill] = (report.perSkillDropped[skill] || 0) + 1;
        report.totalDropped++;
      }
      continue;
    }
    // (c) Skill has no keep AND no drop entry — pass through as-is.
    out.push(line);
  }
  if (modified) {
    fs.writeFileSync(full, out.join('\n') + (out.length ? '\n' : ''));
  }
  report.cellsProcessed++;
}

const reportPath = path.join(RUN_DIR, 'keep-issuetypes-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  filtered: true,
  totalDropped: report.totalDropped,
  totalKept: report.totalKept,
  cellsProcessed: report.cellsProcessed,
  reportPath
}));
process.exit(0);
