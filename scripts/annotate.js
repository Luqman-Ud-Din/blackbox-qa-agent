#!/usr/bin/env node
/**
 * annotate.js — shared annotator for all QA skills.
 *
 * Draws color-coded bounding boxes on a screenshot for every finding.
 *   Red   = high
 *   Amber = medium
 *   Blue  = low
 *
 * Usage:
 *   node annotate.js --screenshot <path> --findings <json-array> --output <path>
 *
 * The findings JSON array must match the standard finding schema:
 *   [{ "type": "...", "severity": "high|medium|low", "bbox": {"x","y","w","h"} }]
 *
 * Findings without a bbox are included in the label list but draw no box.
 */

const { chromium } = require('playwright');
const fs = require('fs');
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

const findings = JSON.parse(findingsArg);
const imageBuffer = fs.readFileSync(screenshotPath);
const imageB64 = imageBuffer.toString('base64');
const ext = path.extname(screenshotPath).replace('.', '') || 'png';

const COLORS = {
  high:   '#ef4444',
  medium: '#f97316',
  low:    '#3b82f6',
};

function escape(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const boxes = findings.map((f, i) => {
  if (!f.bbox) return '';
  const { x, y, w, h } = f.bbox;
  const color = COLORS[f.severity] || '#888888';
  const label = escape((f.type || 'issue') + (f.severity ? ` [${f.severity}]` : ''));
  return `
    <div style="
      position:absolute;
      left:${x}px;top:${y}px;width:${Math.max(w,2)}px;height:${Math.max(h,2)}px;
      border:2px solid ${color};
      box-sizing:border-box;
      pointer-events:none;
    ">
      <span style="
        position:absolute;top:-22px;left:0;
        background:${color};color:#fff;
        font:bold 11px/1.4 monospace;
        padding:1px 5px;
        white-space:nowrap;max-width:260px;
        overflow:hidden;text-overflow:ellipsis;
        border-radius:2px 2px 0 0;
      ">${i + 1}. ${label}</span>
    </div>`;
}).join('');

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}</style></head>
<body>
<div style="position:relative;display:inline-block;line-height:0">
  <img src="data:image/${ext};base64,${imageB64}" style="display:block;max-width:100%;height:auto"/>
  ${boxes}
</div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const container = await page.$('div');
    if (!container) throw new Error('Container element not found in annotate HTML');
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
