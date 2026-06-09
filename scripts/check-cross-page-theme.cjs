#!/usr/bin/env node
/**
 * check-cross-page-theme.cjs — Aggregates per-cell color fingerprints from
 * qa-detect-ux-cross-page-theme and emits cross-page drift findings.
 *
 * Reads:   .tmp/<runId>/issues/cell-*.jsonl
 * Filters: records where issueType === "_meta_colorFingerprint"
 * Writes:  .tmp/<runId>/issues/_cross-page-theme.jsonl  (drift findings)
 *
 * Usage:   node scripts/check-cross-page-theme.cjs <run-id>
 *
 * Exit codes:
 *   0  — analysis complete (may have written 0+ findings)
 *   2  — runId dir missing
 *   3  — no fingerprint records found (skill not run, audit empty)
 */

const fs   = require('fs');
const path = require('path');

const RUN_ID = process.argv[2];
if (!RUN_ID) {
  console.error('Usage: node scripts/check-cross-page-theme.cjs <run-id>');
  process.exit(1);
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUN_DIR      = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_DIR   = path.join(RUN_DIR, 'issues');
const OUT_PATH     = path.join(ISSUES_DIR, '_cross-page-theme.jsonl');

if (!fs.existsSync(ISSUES_DIR)) {
  console.error('check-cross-page-theme: no issues dir at ' + ISSUES_DIR);
  process.exit(2);
}

// ── Helpers ──────────────────────────────────────────────────────────────
function hueDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function rgbStr(rgb) {
  if (!rgb) return 'null';
  if (Array.isArray(rgb)) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

// ── Read all cell JSONL files ───────────────────────────────────────────
const fingerprints = [];   // { cellId, route, viewport, viewportClass, fingerprint }
const cellFiles = fs.readdirSync(ISSUES_DIR).filter(f => /^cell-.*\.jsonl$/.test(f));

for (const fname of cellFiles) {
  const p = path.join(ISSUES_DIR, fname);
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim().length > 0);
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    if (rec.issueType !== '_meta_colorFingerprint') continue;
    if (!rec.metadata) continue;
    fingerprints.push({
      cellId: rec.cellId,
      route: rec.route,
      viewport: rec.viewport,
      viewportClass: rec.viewportClass,
      fingerprint: rec.metadata
    });
  }
}

if (fingerprints.length === 0) {
  console.log('check-cross-page-theme: no fingerprint records found. Either the skill is disabled or no cells captured fingerprints.');
  process.exit(3);
}

console.log(`check-cross-page-theme: aggregating ${fingerprints.length} fingerprints from ${cellFiles.length} cells`);

// ── Group by viewportClass (compare like for like) ──────────────────────
const groups = {};
for (const fp of fingerprints) {
  const key = fp.viewportClass || 'unknown';
  if (!groups[key]) groups[key] = [];
  groups[key].push(fp);
}

// ── For each (viewportClass, slot) — find hue variance ──────────────────
const findings = [];
const SLOTS = [
  { key: 'sidebar', issueType: 'sidebarColorDriftAcrossPages', severityThresholds: { high: 15, medium: 8 } },
  { key: 'header', issueType: 'headerColorDriftAcrossPages', severityThresholds: { high: 15, medium: 8 } },
  { key: 'themePrimary', issueType: 'themePrimaryDriftAcrossPages', severityThresholds: { high: 15, medium: 8 } },
  { key: 'activeNav', issueType: 'activeNavColorDriftAcrossPages', severityThresholds: { high: 20, medium: 12 } }
];

for (const [vpClass, vpFingerprints] of Object.entries(groups)) {
  if (vpFingerprints.length < 2) continue;

  for (const slot of SLOTS) {
    // Collect cells where this slot has a fingerprint
    const cells = vpFingerprints
      .map(fp => ({ cellId: fp.cellId, route: fp.route, slot: fp.fingerprint[slot.key] }))
      .filter(c => c.slot && c.slot.hsl);
    if (cells.length < 2) continue;

    // Find the most-drifted pair across all 3 HSL axes:
    //   hue:        Δ° between colors (max 180)
    //   lightness:  Δ% lightness — same hue, different shade = "dark navy vs bright blue"
    //   saturation: Δ% saturation
    // Composite distance gives a perceptual score; we also flag if any single axis is severe.
    let maxScore = 0;
    let maxPair = null;
    let metric = null;
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const hd = hueDelta(cells[i].slot.hsl.h, cells[j].slot.hsl.h);
        const ld = Math.abs(cells[i].slot.hsl.l - cells[j].slot.hsl.l);
        const sd = Math.abs(cells[i].slot.hsl.s - cells[j].slot.hsl.s);
        // Combined score: max of (hue, lightness*0.8, saturation*0.6).
        // This treats a 25% lightness delta as ~equivalent to a 20° hue delta.
        const score = Math.max(hd, ld * 0.8, sd * 0.6);
        if (score > maxScore) {
          maxScore = score;
          maxPair = { a: cells[i], b: cells[j] };
          metric = { hueDelta: hd, lightnessDelta: ld, saturationDelta: sd };
        }
      }
    }
    if (!maxPair) continue;

    let severity = null;
    if (maxScore >= slot.severityThresholds.high) severity = 'high';
    else if (maxScore >= slot.severityThresholds.medium) severity = 'medium';
    else continue;

    findings.push({
      runId: RUN_ID,
      cellId: 'cross-page',
      skill: 'qa-detect-ux-cross-page-theme',
      issueType: slot.issueType,
      severity,
      route: 'cross-page',
      viewport: 'cross-page',
      viewportClass: vpClass,
      browser: 'cross-page',
      selector: 'body',
      description: `${slot.key} background drifts between routes "${maxPair.a.route}" (${rgbStr(maxPair.a.slot.rgb)}, HSL ${maxPair.a.slot.hsl.h}°/${maxPair.a.slot.hsl.s}%/${maxPair.a.slot.hsl.l}%) and "${maxPair.b.route}" (${rgbStr(maxPair.b.slot.rgb)}, HSL ${maxPair.b.slot.hsl.h}°/${maxPair.b.slot.hsl.s}%/${maxPair.b.slot.hsl.l}%) on ${vpClass}. Drift: hue Δ${metric.hueDelta.toFixed(0)}°, lightness Δ${metric.lightnessDelta.toFixed(0)}%, saturation Δ${metric.saturationDelta.toFixed(0)}%. Brand identity is unstable as users navigate. Standardize the ${slot.key} color across all pages.`,
      evidence: {
        slot: slot.key,
        viewportClass: vpClass,
        cellsCompared: cells.length,
        score: Math.round(maxScore),
        hueDelta: Math.round(metric.hueDelta),
        lightnessDelta: Math.round(metric.lightnessDelta),
        saturationDelta: Math.round(metric.saturationDelta),
        from: { cellId: maxPair.a.cellId, route: maxPair.a.route, hsl: maxPair.a.slot.hsl, rgb: maxPair.a.slot.rgb },
        to:   { cellId: maxPair.b.cellId, route: maxPair.b.route, hsl: maxPair.b.slot.hsl, rgb: maxPair.b.slot.rgb }
      },
      dedupCount: 1,
      alsoDetectedBy: [],
      screenshotPath: '',
      annotatedScreenshotPath: ''
    });
  }

  // ── Card background tone drift (low-saturation off-whites) ────────────
  const allCardBgs = new Map();   // "r,g,b" → Set(routes)
  for (const fp of vpFingerprints) {
    if (!fp.fingerprint.cardBgTones) continue;
    for (const tone of fp.fingerprint.cardBgTones) {
      const key = tone.rgb.join(',');
      if (!allCardBgs.has(key)) allCardBgs.set(key, new Set());
      allCardBgs.get(key).add(fp.route);
    }
  }
  if (allCardBgs.size >= 3) {
    const tonesArr = [...allCardBgs.keys()].slice(0, 5);
    findings.push({
      runId: RUN_ID,
      cellId: 'cross-page',
      skill: 'qa-detect-ux-cross-page-theme',
      issueType: 'cardBgDriftAcrossPages',
      severity: 'low',
      route: 'cross-page',
      viewport: 'cross-page',
      viewportClass: vpClass,
      browser: 'cross-page',
      selector: 'body',
      description: `Card backgrounds use ${allCardBgs.size} distinct off-white tones across ${vpClass} pages: ${tonesArr.map(t => 'rgb(' + t + ')').join(', ')}. Pick one card surface color.`,
      evidence: { viewportClass: vpClass, distinctTones: allCardBgs.size, samples: tonesArr },
      dedupCount: 1,
      alsoDetectedBy: [],
      screenshotPath: '',
      annotatedScreenshotPath: ''
    });
  }
}

// ── Write findings ──────────────────────────────────────────────────────
if (findings.length === 0) {
  console.log('check-cross-page-theme: no cross-page drift detected (all fingerprints aligned). 0 findings written.');
  process.exit(0);
}

fs.writeFileSync(OUT_PATH, findings.map(f => JSON.stringify(f)).join('\n') + '\n');
console.log(`check-cross-page-theme: ${findings.length} cross-page drift findings written to ${OUT_PATH}`);
for (const f of findings) {
  console.log(`  [${f.severity}] ${f.issueType} on ${f.viewportClass}`);
}
process.exit(0);
