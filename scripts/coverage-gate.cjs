#!/usr/bin/env node
/**
 * coverage-gate.cjs — PERMANENT, EVIDENCE-BASED coverage gate.
 *
 * WHY THIS EXISTS
 *   The old finish-gate trusted model-WRITTEN ledger marks. A worker could run
 *   9 of 92 skills, then stamp every (cell × skill) row "done" based on the cell
 *   having any output file — reporting 100% coverage while 80+ skills never ran.
 *   (Confirmed in run qa-20260605-001: 9 distinct skills in findings, ledger said
 *   5967/5967 done.)
 *
 *   This gate does NOT trust marks. It derives coverage from HARD EVIDENCE — two
 *   per-cell receipts the worker dumps:
 *     • issues/{cellId}-probes.json      — PASSIVE skills: raw browser_evaluate `out`,
 *                                           keyed by every passive skill name it ran.
 *     • issues/{cellId}-interactive.json — INTERACTIVE skills: keyed by every
 *                                           interactive skill it drove, value
 *                                           { ran, interacted, findings, skipReason? }.
 *   A (cell × skill) pair is COVERED iff the matching receipt contains that skill's
 *   key. No key = the skill never executed on that cell, no matter what the ledger
 *   says. EVERY enabled skill (passive AND interactive) is gated — nothing is exempt.
 *
 * USAGE
 *   node scripts/coverage-gate.cjs <run-id>
 *
 * READS
 *   .tmp/<run-id>/skill-probes.json          — the 92-skill bundle (bundle-probes.cjs)
 *   .tmp/<run-id>/audit-plan.json            — cells
 *   .tmp/<run-id>/issues/<cellId>-probes.json — per-cell probe receipts (worker)
 *
 * WRITES
 *   .tmp/<run-id>/coverage-missing.json      — exact (cell × skill) pairs to re-run
 *
 * EXIT CODES
 *   0 — every applicable (cell × skill) pair is evidenced → COMPLETE
 *       (passive: probe-receipt key present; interactive: receipt key present AND evidenced
 *        via interacted:true / findings>0 / non-empty skipReason — a bare stub does NOT count)
 *   1 — one or more pairs missing or stubbed → INCOMPLETE (coverage-missing.json lists them)
 *   3 — inputs missing (skill-probes.json / audit-plan.json not found) → cannot gate
 */

const fs   = require('fs');
const path = require('path');

const RUN_ID = process.argv[2];
if (!RUN_ID) { console.error('Usage: node scripts/coverage-gate.cjs <run-id>'); process.exit(3); }

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUN_DIR      = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_DIR   = path.join(RUN_DIR, 'issues');
const PROBES_FILE  = path.join(RUN_DIR, 'skill-probes.json');
const PLAN_FILE    = path.join(RUN_DIR, 'audit-plan.json');
const OUT_FILE     = path.join(RUN_DIR, 'coverage-missing.json');

if (!fs.existsSync(PROBES_FILE)) { console.error(`✗ skill-probes.json missing (${PROBES_FILE}) — run bundle-probes.cjs first. Cannot verify coverage.`); process.exit(3); }
if (!fs.existsSync(PLAN_FILE))   { console.error(`✗ audit-plan.json missing (${PLAN_FILE}) — cannot verify coverage.`); process.exit(3); }

const probes = JSON.parse(fs.readFileSync(PROBES_FILE, 'utf8'));
const plan   = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
const skills = probes.skills || [];
const cells  = plan.cells || [];

// EVERY enabled skill is gated — passive AND interactive. A skill is "interactive"
// if its frontmatter sets interactive:true (it's driven via MCP tool sequences and
// verified through the interactive receipt); otherwise it's passive (probe batch).
const passiveSkills     = skills.filter(s => !s.interactive);   // probe-batch skills
const interactiveSkills = skills.filter(s =>  s.interactive);   // MCP-driven skills

// Viewport-leader logic — MUST match gen-ledger / the orchestrator's applicable set.
const vpOrder = ['mobile', 'tablet', 'laptop', 'desktop'];
const leaderMap = new Set();
const routeBrowserSeen = new Set();
for (const vp of vpOrder) {
  for (const cell of cells) {
    const key = `${cell.route}|${cell.browser}`;
    if (cell.viewportClass === vp && !routeBrowserSeen.has(key)) {
      routeBrowserSeen.add(key);
      leaderMap.add(`${cell.route}|${cell.browser}|${vp}`);
    }
  }
}

function appliesTo(skill, cell) {
  const applyOn = skill.applyOn;
  const ok = applyOn === 'all' || (Array.isArray(applyOn) && applyOn.includes(cell.viewportClass));
  if (!ok) return false;
  if (skill.viewportSensitive === false &&
      !leaderMap.has(`${cell.route}|${cell.browser}|${cell.viewportClass}`)) return false;
  return true;
}

// Load a cell's receipt file. Presence of a skill KEY = that skill executed on that
// cell. We accept any value (findings, [], {error}, {ran,skipReason}) as proof of
// execution — only a MISSING key means it never ran.
function loadReceipt(cellId, suffix) {
  const p = path.join(ISSUES_DIR, `${cellId}-${suffix}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    return o && o.skills && typeof o.skills === 'object' ? o.skills : o;   // tolerate {skills:{...}}
  } catch (_) { return null; }
}

const passiveReceipts     = new Map();   // cellId → passive probe receipt
const interactiveReceipts = new Map();   // cellId → interactive receipt
const cellsWithoutReceipt = [];          // no passive receipt at all (worker never dumped)
for (const cell of cells) {
  const pr = loadReceipt(cell.id, 'probes');
  const ir = loadReceipt(cell.id, 'interactive');
  if (pr === null && ir === null) cellsWithoutReceipt.push(cell.id);
  passiveReceipts.set(cell.id, pr);
  interactiveReceipts.set(cell.id, ir);
}

let expected = 0, covered = 0, expPassive = 0, expInteractive = 0;
const missingPairs = [];
const missingBySkill = {};

// An INTERACTIVE skill key being PRESENT is not enough — a context-starved worker can
// stub every key as {ran:false} (or {ran:true,interacted:false,findings:0}) without ever
// driving the control, and the run would falsely report full coverage. So for interactive
// skills we require EVIDENCE the skill actually did something:
//   • interacted:true            — it drove the control, OR
//   • findings > 0               — it produced findings, OR
//   • a non-empty skipReason     — a legit precondition-absent skip (no form / no table / no tabs)
// A present key with none of these = a stub → NOT covered → re-dispatched.
// Passive skills are unchanged: a probe returning [] is a valid self-skip, so key-presence
// alone proves the passive probe executed.
function interactiveEvidenced(v) {
  if (v == null) return false;
  if (typeof v !== 'object') return true;                                   // back-compat: bare truthy mark
  if (v.skipped === 'scout') return true;                                   // page-scout intentional skip — counts as covered
  if (typeof v.skipReason === 'string' && v.skipReason.trim() !== '') return true;
  if (v.interacted === true) return true;
  if (typeof v.findings === 'number' && v.findings > 0) return true;
  return false;                                                             // present but stubbed, no evidence
}

function gate(skill, cell, receipt, kind) {
  if (!appliesTo(skill, cell)) return;
  expected++; if (kind === 'passive') expPassive++; else expInteractive++;
  const present = receipt && Object.prototype.hasOwnProperty.call(receipt, skill.name);
  const ran = kind === 'interactive'
    ? present && interactiveEvidenced(receipt[skill.name])   // interactive needs EVIDENCE, not just a key
    : present;                                               // passive: key-presence proves execution
  if (ran) { covered++; return; }
  missingPairs.push({
    cellId: cell.id, route: cell.route, viewport: cell.viewport,
    viewportClass: cell.viewportClass, browser: cell.browser, skill: skill.name, kind,
    reason: (kind === 'interactive' && present) ? 'interactive-stub-no-evidence' : 'no-receipt-key',
  });
  missingBySkill[skill.name] = (missingBySkill[skill.name] || 0) + 1;
}

for (const cell of cells) {
  const pr = passiveReceipts.get(cell.id);
  const ir = interactiveReceipts.get(cell.id);
  for (const skill of passiveSkills)     gate(skill, cell, pr, 'passive');
  for (const skill of interactiveSkills) gate(skill, cell, ir, 'interactive');
}

const pct = expected === 0 ? 100 : ((covered / expected) * 100);

fs.writeFileSync(OUT_FILE, JSON.stringify({
  runId: RUN_ID,
  expected, covered,
  coveragePct: Number(pct.toFixed(1)),
  passiveSkillsGated: passiveSkills.length,
  interactiveSkillsGated: interactiveSkills.length,
  expectedPassive: expPassive,
  expectedInteractive: expInteractive,
  cellsWithoutReceipt,
  missingBySkill,
  missingPairs,
}, null, 2));

console.log('\n🔍 Coverage gate (evidence-based — ALL skills, passive + interactive)');
console.log(`   Skills gated         : ${skills.length}  (${passiveSkills.length} passive + ${interactiveSkills.length} interactive)`);
console.log(`   Cells                : ${cells.length}  (${cellsWithoutReceipt.length} with NO receipt at all)`);
console.log(`   Expected pairs       : ${expected}  (${expPassive} passive + ${expInteractive} interactive)`);
console.log(`   Covered (have receipt): ${covered}  (${pct.toFixed(1)}%)`);
console.log(`   MISSING              : ${missingPairs.length}`);

if (missingPairs.length > 0) {
  const top = Object.entries(missingBySkill).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('   Skills never executed (top 20):');
  for (const [name, n] of top) console.log(`      ${name}  ×${n} cells`);
  if (cellsWithoutReceipt.length > 0)
    console.log(`   Cells with NO receipt at all (worker did not dump probe output): ${cellsWithoutReceipt.slice(0, 15).join(', ')}${cellsWithoutReceipt.length > 15 ? ' …' : ''}`);
  console.log(`   → ${OUT_FILE}`);
  console.log('   ✗ INCOMPLETE — re-dispatch the missing (cell × skill) pairs above, then re-run this gate.\n');
  process.exit(1);
}

console.log('   ✓ COMPLETE — every applicable PASSIVE skill has a probe receipt, and every applicable INTERACTIVE skill has an evidenced receipt (interacted / findings / skipReason), on every applicable cell.\n');

// Write .gate-pass token so file-bugs.cjs can verify receipts haven't been edited since this gate ran.
// The token holds a SHA-256 hash of all receipt files. file-bugs.cjs re-hashes and compares — a mismatch
// means someone hand-edited a receipt after the gate passed, which is the known fabrication vector.
const crypto = require('crypto');
const gh = crypto.createHash('sha256');
for (const f of fs.readdirSync(ISSUES_DIR).sort()) {
  if (!/-(probes|interactive|sequence)\.json$/.test(f)) continue;
  gh.update(f); gh.update(fs.readFileSync(path.join(ISSUES_DIR, f)));
}
const receiptsHash = gh.digest('hex');
fs.writeFileSync(path.join(RUN_DIR, '.gate-pass'), JSON.stringify({ runId: RUN_ID, receiptsHash, passedAt: new Date().toISOString() }));
console.log(`   🔒 .gate-pass token written (receipts hash ${receiptsHash.slice(0, 12)}…) — file-bugs.cjs may now run.\n`);
process.exit(0);
