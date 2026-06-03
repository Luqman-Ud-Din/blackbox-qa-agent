#!/usr/bin/env node
/**
 * annotate.js — production-grade screenshot annotator.
 *
 * Layout: numbered marker on each bbox + descriptive legend below the screenshot.
 * This eliminates label overlap with page content (previous layout placed labels
 * directly above/below boxes and frequently covered nearby labels like "Username").
 *
 * Color scale:
 *   critical = #b91c1c
 *   high     = #ef4444
 *   medium   = #f97316
 *   low      = #3b82f6
 *
 * Usage:
 *   node annotate.js --screenshot <path> --findings <json-array> --output <path>
 *
 * Finding schema (canonical — NO fallbacks, fail-fast on missing fields):
 *   {
 *     "issueType":   "string (required)",
 *     "severity":    "critical|high|medium|low (required)",
 *     "bbox":        { "x":num, "y":num, "w":num, "h":num }  // optional
 *     "description": "string (optional; rendered in legend)",
 *     "selector":    "string (optional; rendered in legend)"
 *   }
 *
 * Findings without bbox: still listed in legend but no marker drawn.
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}

const screenshotPath = arg('--screenshot');
const findingsArg    = arg('--findings');
const outputPath     = arg('--output');

if (!screenshotPath || !findingsArg || !outputPath) {
  console.error('Usage: node annotate.js --screenshot <path> --findings <json> --output <path>');
  process.exit(1);
}

const findings    = JSON.parse(findingsArg);
const imageBuffer = fs.readFileSync(screenshotPath);
const imageB64    = imageBuffer.toString('base64');
const ext         = path.extname(screenshotPath).replace('.', '') || 'png';

// Read actual PNG pixel dimensions from the file header.
// PNG signature is 8 bytes, then IHDR chunk has width@16-19 and height@20-23 (big-endian uint32).
function readPngSize(buf) {
  if (buf.length < 24) throw new Error('annotate.js: screenshot file too small to be a PNG');
  const sig = buf.toString('hex', 0, 8);
  if (sig !== '89504e470d0a1a0a') throw new Error('annotate.js: screenshot is not a PNG (signature mismatch). For non-PNG, extend readPngSize.');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
const IMG = readPngSize(imageBuffer);
console.log(`annotate.js: screenshot size ${IMG.width}×${IMG.height}px, ${findings.length} finding(s) to plot`);

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

// Schema enforcement — never silently fall back.
function assertCanonical(f, i) {
  if (!f.issueType) {
    throw new Error(`annotate.js: finding[${i}] missing required field "issueType". Got: ${JSON.stringify(f).slice(0,200)}.`);
  }
  if (!f.severity) {
    throw new Error(`annotate.js: finding[${i}] missing required field "severity". Got: ${JSON.stringify(f).slice(0,200)}.`);
  }
  if (!COLORS[f.severity]) {
    throw new Error(`annotate.js: finding[${i}] invalid severity "${f.severity}". Must be one of: ${Object.keys(COLORS).join(', ')}.`);
  }
}
findings.forEach(assertCanonical);

// ── Markers: clipped to actual image dimensions ───────────────────────────
//
// CRITICAL: bboxes from probes use document coordinates. Screenshots may be
// viewport-only (cropped) OR fullPage. If a bbox extends past the image,
// drawing it raw produces visible misalignment. We CLIP every box to the
// actual image bounds and annotate when truncation occurred.
//
const MARKER_SIZE = 24;

function clipBbox(b, img) {
  const x  = Math.max(0, Math.min(b.x, img.width));
  const y  = Math.max(0, Math.min(b.y, img.height));
  const r  = Math.max(0, Math.min(b.x + b.w, img.width));   // clipped right edge
  const bb = Math.max(0, Math.min(b.y + b.h, img.height));  // clipped bottom edge
  const cw = Math.max(2, r - x);
  const ch = Math.max(2, bb - y);
  const clippedRight  = (b.x + b.w) > img.width  + 0.5;
  const clippedBottom = (b.y + b.h) > img.height + 0.5;
  const clippedLeft   = b.x < 0;
  const clippedTop    = b.y < 0;
  const offscreen     = r <= 0 || bb <= 0 || x >= img.width || y >= img.height;
  return { x, y, w: cw, h: ch, clippedRight, clippedBottom, clippedLeft, clippedTop, offscreen };
}

const markers = findings.map((f, i) => {
  if (!f.bbox) return '';
  const clip  = clipBbox(f.bbox, IMG);
  const color = COLORS[f.severity];
  const num   = i + 1;

  // Element entirely off-screen — anchor a marker to the nearest edge so the user
  // still sees the finding is registered, with an arrow pointing off-image.
  if (clip.offscreen) {
    const ax = Math.max(0, Math.min(f.bbox.x, IMG.width  - MARKER_SIZE));
    const ay = Math.max(0, Math.min(f.bbox.y, IMG.height - MARKER_SIZE));
    return `
      <div style="
        position:absolute;
        left:${ax}px;top:${ay}px;
        width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;
        background:${color};color:#fff;
        font:bold 14px/${MARKER_SIZE}px system-ui,sans-serif;
        text-align:center;
        border-radius:${MARKER_SIZE/2}px;
        box-shadow:0 1px 3px rgba(0,0,0,0.45);
        border:2px dashed white;
        pointer-events:none;
        opacity:0.85;
      ">${num}</div>`;
  }

  // Indicators for partial clipping — small triangles on the edge that was cut.
  const clipMarks = [];
  if (clip.clippedTop)    clipMarks.push(`<div style="position:absolute;left:50%;top:-1px;transform:translateX(-50%);width:0;height:0;border:5px solid transparent;border-bottom-color:${color}"></div>`);
  if (clip.clippedBottom) clipMarks.push(`<div style="position:absolute;left:50%;bottom:-1px;transform:translateX(-50%);width:0;height:0;border:5px solid transparent;border-top-color:${color}"></div>`);
  if (clip.clippedLeft)   clipMarks.push(`<div style="position:absolute;top:50%;left:-1px;transform:translateY(-50%);width:0;height:0;border:5px solid transparent;border-right-color:${color}"></div>`);
  if (clip.clippedRight)  clipMarks.push(`<div style="position:absolute;top:50%;right:-1px;transform:translateY(-50%);width:0;height:0;border:5px solid transparent;border-left-color:${color}"></div>`);

  // Marker anchored to clipped top-left so it's always visible inside the image
  const markerX = Math.max(0, Math.min(clip.x, IMG.width  - MARKER_SIZE));
  const markerY = Math.max(0, Math.min(clip.y, IMG.height - MARKER_SIZE));

  return `
    <div style="
      position:absolute;
      left:${clip.x}px;top:${clip.y}px;width:${clip.w}px;height:${clip.h}px;
      border:3px solid ${color};
      box-sizing:border-box;
      pointer-events:none;
      box-shadow:0 0 0 1px white;
    ">${clipMarks.join('')}</div>
    <div style="
      position:absolute;
      left:${markerX}px;top:${markerY}px;
      width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;
      background:${color};color:#fff;
      font:bold 14px/${MARKER_SIZE}px system-ui,sans-serif;
      text-align:center;
      border-radius:${MARKER_SIZE/2}px;
      box-shadow:0 1px 3px rgba(0,0,0,0.45);
      border:2px solid white;
      pointer-events:none;
    ">${num}</div>`;
}).join('');

// ── Legend: descriptive table below screenshot ────────────────────────────
const legendRows = findings.map((f, i) => {
  const color = COLORS[f.severity];
  const num   = i + 1;
  const desc  = escape(f.description || '');
  const sel   = f.selector ? `<span style="font-family:ui-monospace,monospace;color:#475569;font-size:12px"> &nbsp;·&nbsp; ${escape(f.selector).slice(0,80)}</span>` : '';
  return `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top">
        <span style="
          display:inline-block;
          width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;
          background:${color};color:#fff;
          font:bold 14px/${MARKER_SIZE}px system-ui,sans-serif;
          text-align:center;border-radius:${MARKER_SIZE/2}px;
        ">${num}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;white-space:nowrap">
        <span style="
          background:${color};color:#fff;
          padding:2px 8px;border-radius:3px;
          font:bold 11px/1.4 ui-monospace,monospace;
          text-transform:uppercase;
        ">${escape(f.severity)}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top">
        <div style="font:600 13px/1.4 system-ui,sans-serif;color:#0f172a">${escape(f.issueType)}</div>
        ${desc ? `<div style="font:13px/1.4 system-ui,sans-serif;color:#334155;margin-top:2px">${desc}${sel}</div>` : sel}
      </td>
    </tr>`;
}).join('');

// ── Compose final HTML ────────────────────────────────────────────────────
const LEGEND_WIDTH_PX = 'auto'; // legend matches screenshot width via container

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#f8fafc; font-family:system-ui,sans-serif; }
  .stack { display:inline-block; }
  .shot-wrap { position:relative; line-height:0; }
  /* CRITICAL: render image at its natural pixel size so bbox coords (which are CSS pixels)
     line up 1:1 with the image. max-width:100% would scale the image and break alignment. */
  .shot-wrap img { display:block; width:${IMG.width}px; height:${IMG.height}px; }
  .legend {
    background:#fff;
    border:1px solid #cbd5e1;
    border-top:none;
  }
  .legend-header {
    background:#0f172a;color:#fff;
    padding:10px 12px;
    font:bold 13px/1.2 system-ui,sans-serif;
    letter-spacing:0.04em;
    text-transform:uppercase;
  }
  table { width:100%; border-collapse:collapse; }
</style>
</head>
<body>
<div class="stack">
  <div class="shot-wrap">
    <img src="data:image/${ext};base64,${imageB64}"/>
    ${markers}
  </div>
  <div class="legend">
    <div class="legend-header">${findings.length} finding${findings.length===1?'':'s'} — argus-qa</div>
    <table>${legendRows}</table>
  </div>
</div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const container = await page.$('.stack');
    if (!container) throw new Error('Container .stack not found in annotate HTML');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await container.screenshot({ path: outputPath });
    console.log(`annotate.js: wrote ${outputPath} (${findings.length} finding(s))`);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('annotate.js failed:', err.message);
  process.exit(1);
});
