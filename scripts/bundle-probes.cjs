#!/usr/bin/env node
/**
 * bundle-probes.cjs — Pre-reads EVERY enabled skill's probe before any worker starts.
 *
 * Problem solved: LLM workers forget most of the 91 enabled skills and run only ~12
 * they recall from training. New skills (like qa-detect-ux-*) are skipped entirely
 * because the model has no memory of them.
 *
 * Solution: this script reads customize.toml + every skill's SKILL.md RIGHT NOW,
 * extracts probe expressions and frontmatter, and writes them to skill-probes.json.
 * Workers read ONE file and execute ALL probes — model memory is not involved.
 *
 * Usage:  node scripts/bundle-probes.cjs <run-id>
 * Output: .tmp/<run-id>/skill-probes.json
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const RUN_ID = process.argv[2];
if (!RUN_ID) { console.error('Usage: node scripts/bundle-probes.cjs <run-id>'); process.exit(1); }

const PROJECT_ROOT   = path.resolve(__dirname, '..');
const SKILLS_DIR     = path.join(PROJECT_ROOT, 'skills');
const CUSTOMIZE_TOML = path.join(SKILLS_DIR, 'qa-argus', 'customize.toml');
const RUN_DIR        = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const OUT_FILE       = path.join(RUN_DIR, 'skill-probes.json');

if (!fs.existsSync(CUSTOMIZE_TOML)) {
  console.error(`customize.toml not found: ${CUSTOMIZE_TOML}`);
  process.exit(1);
}
if (!fs.existsSync(RUN_DIR)) fs.mkdirSync(RUN_DIR, { recursive: true });

// ── 1. Parse customize.toml → collect every enabled skill name ────────────
function parseEnabledSkills(toml) {
  const enabled = [];
  for (const raw of toml.split('\n')) {
    const line = raw.split('#')[0].trim();           // strip inline comments
    const m = line.match(/^(qa-[\w-]+)\s*=\s*true/);
    if (m) enabled.push(m[1]);
  }
  return enabled;
}

// ── 2. Parse YAML-style frontmatter from SKILL.md ────────────────────────
function parseFrontmatter(content) {
  const start = content.indexOf('---');
  if (start === -1) return {};
  const end = content.indexOf('---', start + 3);
  if (end === -1) return {};
  const block = content.slice(start + 3, end);
  const fm = {};
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val  = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (val === 'true')  val = true;
    else if (val === 'false') val = false;
    else if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    fm[key] = val;
  }
  return fm;
}

// ── 3. Extract first ```js ... ``` block from SKILL.md ───────────────────
function extractProbe(content) {
  const start = content.indexOf('```js');
  if (start === -1) return null;
  const end = content.indexOf('```', start + 5);
  if (end === -1) return null;
  return content.slice(start + 5, end).trim();
}

// ── 3b. Extract the set of REAL issueTypes a skill can emit ───────────────
// Source of truth = the `issueType: '...'` string literals inside the probe,
// PLUS the first column of the `## Issues` markdown table (covers interactive
// skills with no probe). Workers may ONLY emit issueTypes in this set — anything
// else is a model-invented (fabricated) finding and is rejected at filing time.
function extractIssueTypes(content) {
  const types = new Set();
  // (a) from probe source: issueType:'foo' / issueType: "foo"
  const re = /issueType\s*:\s*['"]([A-Za-z0-9_]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) types.add(m[1]);
  // (b) from the `## Issues` table rows: | issueType | severity | ... |
  const issuesIdx = content.indexOf('## Issues');
  if (issuesIdx !== -1) {
    const after = content.slice(issuesIdx);
    for (const raw of after.split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('|')) continue;
      const firstCol = line.split('|')[1] ? line.split('|')[1].trim() : '';
      // skip header/separator rows
      if (!firstCol || firstCol.toLowerCase() === 'issuetype' || /^-+$/.test(firstCol)) continue;
      if (/^[A-Za-z0-9_]+$/.test(firstCol)) types.add(firstCol);
    }
  }
  return [...types];
}

// ── 4. Build probe bundle ─────────────────────────────────────────────────
const toml = fs.readFileSync(CUSTOMIZE_TOML, 'utf8');
const enabledNames = parseEnabledSkills(toml);

console.log(`\nbundle-probes [${RUN_ID}]`);
console.log(`  Enabled in customize.toml: ${enabledNames.length} skills\n`);

const skills = [];
const missing = [], noProbe = [];

for (const name of enabledNames) {
  const mdPath = path.join(SKILLS_DIR, name, 'SKILL.md');
  if (!fs.existsSync(mdPath)) { missing.push(name); continue; }

  const content = fs.readFileSync(mdPath, 'utf8');
  const fm      = parseFrontmatter(content);
  const probe   = extractProbe(content);
  const issueTypes = extractIssueTypes(content);

  // applyOn: normalise to array or 'all'
  let applyOn = fm.applyOn || 'all';
  if (applyOn !== 'all' && !Array.isArray(applyOn)) applyOn = [applyOn];

  skills.push({
    name,
    model:             fm.model             || 'haiku',
    applyOn,
    viewportSensitive: fm.viewportSensitive === true,
    interactive:       fm.interactive       === true,
    needsSetup:        fm.needsSetup        === true,
    issueTypes,                                      // allowlist — workers may emit ONLY these
    probe                                            // null for interactive skills (no passive probe)
  });

  if (!probe) noProbe.push(name);
}

const passive     = skills.filter(s => s.probe && !s.interactive);
const interactive = skills.filter(s => s.interactive);
const noProbePassive = noProbe.filter(n => !skills.find(s => s.name === n && s.interactive));

// ── 5. Write output ───────────────────────────────────────────────────────
const out = {
  runId:       RUN_ID,
  generatedAt: new Date().toISOString(),
  source:      CUSTOMIZE_TOML,
  counts: {
    total:       skills.length,
    passive:     passive.length,
    interactive: interactive.length,
    missing:     missing.length
  },
  skills
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

// ── 6. Report ─────────────────────────────────────────────────────────────
console.log(`  ✓ passive skills  (have probe): ${passive.length}`);
console.log(`  ✓ interactive     (MCP-driven): ${interactive.length}`);
if (missing.length)      console.log(`  ⚠ skill folder missing        : ${missing.length}  →  ${missing.join(', ')}`);
if (noProbePassive.length) console.log(`  ⚠ non-interactive, no probe   : ${noProbePassive.length}  →  ${noProbePassive.join(', ')}`);
console.log(`\n  Output: ${OUT_FILE}`);
console.log(`  Workers must read this file and execute EVERY probe — not use model memory.\n`);
