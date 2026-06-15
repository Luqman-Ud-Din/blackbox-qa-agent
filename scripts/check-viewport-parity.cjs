#!/usr/bin/env node
/**
 * check-viewport-parity.cjs — post-run cross-viewport parity pass for qa-detect-viewport-parity.
 *
 * The per-cell worker cannot compare viewports (it only sees one). Each cell dumps a feature
 * fingerprint to issues/{cellId}-parity.json ({ route, viewportClass, navItems, tableCols,
 * actionButtons }). This script groups those by route and flags features present on the
 * desktop/laptop fingerprint but missing (or materially reduced) on mobile — i.e. functionality
 * silently dropped on small screens, NOT merely relocated into a drawer.
 *
 * Emits findings (issueType: featureHiddenOnSmallViewport) appended to issues/parity-findings.jsonl
 * so the existing collapse/annotate/file-bugs pipeline picks them up like any other finding.
 *
 * Usage: node scripts/check-viewport-parity.cjs <runId>
 * Exit 0 always (advisory pass — never blocks the run). Prints a one-line summary.
 */
const fs = require('fs');
const path = require('path');

const RUN_ID = process.argv[2];
if (!RUN_ID) { console.error('Usage: node scripts/check-viewport-parity.cjs <run-id>'); process.exit(1); }

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ISSUES_DIR = path.join(PROJECT_ROOT, '.tmp', RUN_ID, 'issues');
if (!fs.existsSync(ISSUES_DIR)) { console.log(`check-viewport-parity [${RUN_ID}]: no issues dir — nothing to compare.`); process.exit(0); }

// 1. Load every per-cell parity fingerprint.
const prints = [];
for (const f of fs.readdirSync(ISSUES_DIR)) {
  if (!f.endsWith('-parity.json')) continue;
  try {
    const o = JSON.parse(fs.readFileSync(path.join(ISSUES_DIR, f), 'utf8'));
    if (o && o.route && o.viewportClass) prints.push({ ...o, cellId: f.replace('-parity.json', '') });
  } catch (_) { /* skip malformed */ }
}
if (!prints.length) { console.log(`check-viewport-parity [${RUN_ID}]: 0 parity fingerprints — skill produced no data (workers may not have dumped them).`); process.exit(0); }

// 2. Group by route.
const byRoute = {};
for (const p of prints) (byRoute[p.route] = byRoute[p.route] || []).push(p);

// 3. For each route, compare the widest viewport (desktop > laptop) to mobile.
const order = { desktop: 4, laptop: 3, tablet: 2, mobile: 1 };
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
const findings = [];
const FIELDS = [
  { key: 'tableCols',     label: 'table columns' },
  { key: 'actionButtons', label: 'action buttons' },
  { key: 'navItems',      label: 'navigation items' },
];

for (const route of Object.keys(byRoute)) {
  const cells = byRoute[route];
  const mobile = cells.find(c => c.viewportClass === 'mobile');
  if (!mobile) continue; // need a mobile baseline to detect a drop
  const wide = cells.filter(c => c.viewportClass === 'desktop' || c.viewportClass === 'laptop')
                    .sort((a, b) => order[b.viewportClass] - order[a.viewportClass])[0];
  if (!wide) continue;

  for (const { key, label } of FIELDS) {
    const w = num(wide[key]), m = num(mobile[key]);
    // "dropped" = present on desktop, materially reduced on mobile (not 1-2 fewer, and not a drawer).
    // navItems are expected to collapse into a hamburger on mobile, so only flag when mobile shows ZERO.
    const dropped = key === 'navItems'
      ? (w >= 3 && m === 0)
      : (w >= 2 && m < Math.ceil(w / 2));
    if (dropped) {
      findings.push({
        runId: RUN_ID,
        cellId: mobile.cellId,
        skill: 'qa-detect-viewport-parity',
        issueType: 'featureHiddenOnSmallViewport',
        severity: 'high',
        route,
        viewport: 'mobile',
        viewportClass: 'mobile',
        browser: (mobile.browser || 'chromium'),
        selector: null,
        description: `${label} reduced on mobile vs ${wide.viewportClass}: ${w} on ${wide.viewportClass} → ${m} on mobile (functionality may be lost, not just relocated)`,
      });
    }
  }
}

// 4. Write findings (one JSON object per line) for the existing pipeline to pick up.
const outPath = path.join(ISSUES_DIR, 'parity-findings.jsonl');
if (findings.length) {
  fs.writeFileSync(outPath, findings.map(f => JSON.stringify(f)).join('\n') + '\n');
}
console.log(`check-viewport-parity [${RUN_ID}]: ${Object.keys(byRoute).length} routes compared, ${findings.length} featureHiddenOnSmallViewport finding(s)${findings.length ? ' → parity-findings.jsonl' : ''}.`);
process.exit(0);
