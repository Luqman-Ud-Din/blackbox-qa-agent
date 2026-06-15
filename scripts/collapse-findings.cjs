#!/usr/bin/env node
// PERMANENT. FINAL repeat-collapse over the cell JSONL — covers EVERY skill, including the ones
// that bypass the in-page _collapse (console-errors, network-errors, content-patterns, review-content,
// review-hidden-text, visual-regression, orientation-flip, viewport-parity, fluid-sweep, test-cases).
// A repeated component (same icon button in 50 rows) is ONE bug, not 50. Groups each cell's findings
// by issueType + normalized selector + normalized description; keeps the first (its bbox annotates one
// instance) and tags instanceCount. Idempotent: already-collapsed singletons pass through unchanged.
// Run AFTER apply-keep-issuetypes, BEFORE bug-filing/annotation.
// Usage: node scripts/collapse-findings.cjs <run-dir>
'use strict';
const fs = require('fs');
const path = require('path');

const RUN_DIR = process.argv[2];
if (!RUN_DIR) { console.error('Usage: node scripts/collapse-findings.cjs <run-dir>'); process.exit(1); }
const ISSUES = path.join(RUN_DIR, 'issues');
if (!fs.existsSync(ISSUES)) { console.error('issues dir not found: ' + ISSUES); process.exit(2); }

// Same normalization as the in-page _collapse, so behavior is identical across both paths.
// Strip variable DATA so data-only variants of one bug collapse: hashed-class suffixes + digits
// in the selector, and quoted literals (the specific word/email/label, straight OR curly quotes)
// + digits in the description. e.g. 4 td cells overflowing 4 different emails = ONE wrap-the-td bug.
const QUOTED = /[‘’“”"'][^‘’“”"']*[‘’“”"']/g;
const normSel = s => (s || '').replace(/-[a-z0-9]{5,}/gi, '').replace(/\d+/g, '#').slice(0, 80);
const normDesc = s => (s || '').replace(QUOTED, '').replace(/\d+/g, '#').slice(0, 90);
const TAG = / \(×\d+ instances on this page/;

let cells = 0, before = 0, after = 0;
for (const f of fs.readdirSync(ISSUES).filter(f => /^cell-.*\.jsonl$/.test(f))) {
  const p = path.join(ISSUES, f);
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim());
  const passthrough = [], findings = [];
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { passthrough.push(l); continue; }
    if (!o || o.issueType === '_coverage' || !o.issueType) passthrough.push(l);   // coverage marks / non-findings untouched
    else findings.push(o);
  }
  before += findings.length;
  const groups = {}, order = [];
  for (const o of findings) {
    const k = o.issueType + '|' + normSel(o.selector) + '|' + normDesc(o.description);
    if (!groups[k]) { groups[k] = { o, n: 1 }; order.push(k); } else groups[k].n++;
  }
  const collapsed = order.map(k => {
    const e = groups[k], o = e.o;
    const n = Math.max(e.n, o.instanceCount || 1);   // honor any count already set in-page
    if (n > 1) {
      o.instanceCount = n;
      if (!TAG.test(o.description || '')) o.description = (o.description || '') + ' (×' + n + ' instances on this page — same component, fix once)';
    }
    return o;
  });
  after += collapsed.length;
  fs.writeFileSync(p, passthrough.concat(collapsed.map(o => JSON.stringify(o))).join('\n') + '\n');
  cells++;
}
console.log(`collapse-findings: ${cells} cells, ${before} findings → ${after} (${before - after} repeats collapsed across ALL skills).`);
