#!/usr/bin/env node
/**
 * annotate-cell-prepare.cjs — MCP-driven annotation pipeline, step 1 of 2.
 *
 * PURE NODE — no external deps, no playwright, no chromium.
 *
 * Reads the cell's findings JSONL, builds the annotation HTML (bbox overlays +
 * legend), and writes it to disk. The orchestrator then uses MCP's
 * browser_navigate + browser_take_screenshot to render the HTML into an
 * annotated PNG. annotate-cell-finalize.cjs writes the path back into the JSONL.
 *
 * Usage:
 *   node scripts/annotate-cell-prepare.cjs <run-id> <cell-id>
 *
 * Output (stdout, JSON, single line):
 *   {
 *     "htmlPath":              "<absolute path to generated HTML>",
 *     "fileUrl":               "<file:// URL the orchestrator should browser_navigate to>",
 *     "expectedAnnotatedPath": "<absolute path the orchestrator should screenshot to>",
 *     "findingCount":          <number>
 *   }
 *
 * Exit codes:
 *   0  — HTML produced, orchestrator must navigate + screenshot
 *   2  — base screenshot missing (cell had none)
 *   3  — JSONL missing
 *   4  — schema validation failed
 *   5  — no findings to annotate (cell is clean — orchestrator should skip)
 */

const fs   = require('fs');
const path = require('path');
const schema = require('./argus-schema.cjs');

const RUN_ID  = process.argv[2];
const CELL_ID = process.argv[3];

if (!RUN_ID || !CELL_ID) {
  console.error('Usage: node scripts/annotate-cell-prepare.cjs <run-id> <cell-id>');
  process.exit(1);
}

const PROJECT_ROOT  = path.resolve(__dirname, '..');
const RUN_DIR       = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_FILE   = path.join(RUN_DIR, 'issues', `${CELL_ID}.jsonl`);
const SHOTS_DIR     = path.join(RUN_DIR, 'screenshots');
const ANNOTATE_DIR  = path.join(RUN_DIR, 'annotate');
const BASE_PNG      = path.join(SHOTS_DIR, `${CELL_ID}-base.png`);
const ANNOTATED_PNG = path.join(SHOTS_DIR, `${CELL_ID}-annotated.png`);
const HTML_FILE     = path.join(ANNOTATE_DIR, `${CELL_ID}.html`);

if (!fs.existsSync(BASE_PNG)) {
  console.error(`annotate-cell-prepare: base screenshot missing at ${BASE_PNG}`);
  process.exit(2);
}
if (!fs.existsSync(ISSUES_FILE)) {
  console.error(`annotate-cell-prepare: no issues JSONL for cell ${CELL_ID} (${ISSUES_FILE})`);
  process.exit(3);
}

const rawIssues = schema.readJsonl(ISSUES_FILE);
if (rawIssues.length === 0) {
  console.log(`annotate-cell-prepare: no findings for ${CELL_ID} — skipping`);
  process.exit(5);
}

const { valid, invalid } = schema.validateMany(rawIssues);
if (invalid.length > 0) {
  console.error(`annotate-cell-prepare: ${invalid.length} of ${rawIssues.length} issues failed schema validation:`);
  for (const { error, field, issue } of invalid.slice(0, 5)) {
    console.error(`  - field "${field}": ${error}`);
    console.error(`    issue: ${JSON.stringify(issue).slice(0, 200)}`);
  }
  process.exit(4);
}

// ── Read PNG dimensions ────────────────────────────────────────────────────
function readPngSize(buf) {
  if (buf.length < 24) throw new Error('base PNG too small');
  const sig = buf.toString('hex', 0, 8);
  if (sig !== '89504e470d0a1a0a') throw new Error('base file is not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
const imageBuffer = fs.readFileSync(BASE_PNG);
const imageB64    = imageBuffer.toString('base64');
const IMG         = readPngSize(imageBuffer);

const COLORS = {
  critical: '#b91c1c',
  high:     '#ef4444',
  medium:   '#f97316',
  low:      '#3b82f6'
};

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Bbox clipping ──────────────────────────────────────────────────────────
const MARKER_SIZE = 24;
function clipBbox(b, img) {
  const x  = Math.max(0, Math.min(b.x, img.width));
  const y  = Math.max(0, Math.min(b.y, img.height));
  const r  = Math.max(0, Math.min(b.x + b.w, img.width));
  const bb = Math.max(0, Math.min(b.y + b.h, img.height));
  const cw = Math.max(2, r - x);
  const ch = Math.max(2, bb - y);
  return {
    x, y, w: cw, h: ch,
    clippedRight:  (b.x + b.w) > img.width  + 0.5,
    clippedBottom: (b.y + b.h) > img.height + 0.5,
    clippedLeft:   b.x < 0,
    clippedTop:    b.y < 0,
    offscreen:     r <= 0 || bb <= 0 || x >= img.width || y >= img.height
  };
}

// ── Build bbox markers ─────────────────────────────────────────────────────
const findings = valid;
const markers = findings.map((f, i) => {
  if (!f.bbox) return '';
  const clip  = clipBbox(f.bbox, IMG);
  const color = COLORS[f.severity] || COLORS.medium;
  const num   = i + 1;

  if (clip.offscreen) {
    const ax = Math.max(0, Math.min(f.bbox.x, IMG.width  - MARKER_SIZE));
    const ay = Math.max(0, Math.min(f.bbox.y, IMG.height - MARKER_SIZE));
    return `
      <div style="position:absolute;left:${ax}px;top:${ay}px;width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;
        background:${color};color:#fff;font:bold 14px/${MARKER_SIZE}px system-ui,sans-serif;
        text-align:center;border-radius:${MARKER_SIZE/2}px;box-shadow:0 1px 3px rgba(0,0,0,0.45);
        border:2px dashed white;pointer-events:none;opacity:0.85;">${num}</div>`;
  }

  const clipMarks = [];
  if (clip.clippedTop)    clipMarks.push(`<div style="position:absolute;left:50%;top:-1px;transform:translateX(-50%);width:0;height:0;border:5px solid transparent;border-bottom-color:${color}"></div>`);
  if (clip.clippedBottom) clipMarks.push(`<div style="position:absolute;left:50%;bottom:-1px;transform:translateX(-50%);width:0;height:0;border:5px solid transparent;border-top-color:${color}"></div>`);
  if (clip.clippedLeft)   clipMarks.push(`<div style="position:absolute;top:50%;left:-1px;transform:translateY(-50%);width:0;height:0;border:5px solid transparent;border-right-color:${color}"></div>`);
  if (clip.clippedRight)  clipMarks.push(`<div style="position:absolute;top:50%;right:-1px;transform:translateY(-50%);width:0;height:0;border:5px solid transparent;border-left-color:${color}"></div>`);

  const markerX = Math.max(0, Math.min(clip.x, IMG.width  - MARKER_SIZE));
  const markerY = Math.max(0, Math.min(clip.y, IMG.height - MARKER_SIZE));

  return `
    <div style="position:absolute;left:${clip.x}px;top:${clip.y}px;width:${clip.w}px;height:${clip.h}px;
      border:3px solid ${color};box-sizing:border-box;pointer-events:none;box-shadow:0 0 0 1px white;">${clipMarks.join('')}</div>
    <div style="position:absolute;left:${markerX}px;top:${markerY}px;width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;
      background:${color};color:#fff;font:bold 14px/${MARKER_SIZE}px system-ui,sans-serif;
      text-align:center;border-radius:${MARKER_SIZE/2}px;box-shadow:0 1px 3px rgba(0,0,0,0.45);
      border:2px solid white;pointer-events:none;">${num}</div>`;
}).join('');

// ── Build legend ───────────────────────────────────────────────────────────
const legendRows = findings.map((f, i) => {
  const color = COLORS[f.severity] || COLORS.medium;
  const num   = i + 1;
  const desc  = escape(f.description || '');
  const sel   = f.selector ? `<span style="font-family:ui-monospace,monospace;color:#475569;font-size:12px"> &nbsp;·&nbsp; ${escape(f.selector).slice(0,80)}</span>` : '';
  return `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top">
        <span style="display:inline-block;width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;
          background:${color};color:#fff;font:bold 14px/${MARKER_SIZE}px system-ui,sans-serif;
          text-align:center;border-radius:${MARKER_SIZE/2}px;">${num}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;white-space:nowrap">
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:3px;
          font:bold 11px/1.4 ui-monospace,monospace;text-transform:uppercase;">${escape(f.severity)}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top">
        <div style="font:600 13px/1.4 system-ui,sans-serif;color:#0f172a">${escape(f.issueType)}</div>
        ${desc ? `<div style="font:13px/1.4 system-ui,sans-serif;color:#334155;margin-top:2px">${desc}${sel}</div>` : sel}
      </td>
    </tr>`;
}).join('');

// ── Compose final HTML ─────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#f8fafc;font-family:system-ui,sans-serif}
  .stack{display:inline-block}
  .shot-wrap{position:relative;line-height:0}
  .shot-wrap img{display:block;width:${IMG.width}px;height:${IMG.height}px}
  .legend{background:#fff;border:1px solid #cbd5e1;border-top:none}
  .legend-header{background:#0f172a;color:#fff;padding:10px 12px;font:bold 13px/1.2 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase}
  table{width:100%;border-collapse:collapse}
</style></head>
<body><div class="stack">
  <div class="shot-wrap"><img src="data:image/png;base64,${imageB64}"/>${markers}</div>
  <div class="legend"><div class="legend-header">${findings.length} finding${findings.length===1?'':'s'} — argus-qa</div><table>${legendRows}</table></div>
</div></body></html>`;

// ── Write HTML + report paths back to orchestrator ─────────────────────────
fs.mkdirSync(ANNOTATE_DIR, { recursive: true });
fs.writeFileSync(HTML_FILE, html, 'utf8');

// URL-encode the path. encodeURI preserves slashes/colons but escapes spaces,
// brackets, parens, etc. — required for browser_navigate to accept the URL on
// WebKit + strict Chromium. Critical when plugin lives in a path with spaces.
const fileUrl = 'file:///' + encodeURI(HTML_FILE.replace(/\\/g, '/').replace(/^\//, ''));

console.log(JSON.stringify({
  htmlPath: HTML_FILE,
  fileUrl: fileUrl,
  expectedAnnotatedPath: ANNOTATED_PNG,
  findingCount: findings.length
}));
process.exit(0);
