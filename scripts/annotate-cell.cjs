#!/usr/bin/env node
/**
 * annotate-cell.cjs — DETERMINISTIC annotation. PURE NODE, no MCP, no browser, no model.
 *
 * Produces ONE annotated screenshot PER FINDING — each image highlights only that finding's
 * box, so every ticket shows its own specific issue cleanly (not a page full of boxes).
 * Each finding's `annotatedScreenshotPath` points at its own PNG.
 *
 * Output per cell:  {cellId}-issue-{n}-annotated.png  (one per finding with a bbox)
 * Findings without a bbox keep the base screenshot (nothing to highlight).
 *
 * Usage:  node scripts/annotate-cell.cjs <run-id> <cell-id>
 * Exit:   0 = done (or no-op)   2 = base PNG missing   3 = JSONL missing   5 = no findings
 *
 * Supports 8-bit PNG, colour type 2 (RGB) and 6 (RGBA) — the format MCP screenshots use.
 * Any other format → exit 0 without annotating (file-bugs falls back to the base PNG).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const schema = require('./argus-schema.cjs');

const RUN_ID = process.argv[2];
const CELL_ID = process.argv[3]; // optional — OMIT to annotate EVERY cell in the run (whole-run mode)
if (!RUN_ID) { console.error('Usage: node scripts/annotate-cell.cjs <run-id> [cell-id]   (omit cell-id to annotate the whole run in one pass)'); process.exit(1); }

const PROJECT_ROOT  = path.resolve(__dirname, '..');
const RUN_DIR       = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_DIR    = path.join(RUN_DIR, 'issues');
const SHOTS_DIR     = path.join(RUN_DIR, 'screenshots');

// Annotation style: ALWAYS red box + a red label tag with WHITE issue text on top.
const RED   = [230, 0, 0];
const WHITE = [255, 255, 255];

// ── 5×7 bitmap font (uppercase + digits + symbols) — clean & legible ─────────
// Each glyph = 7 rows of 5 columns. Labels are uppercased; unknown chars → space.
const FONT = {
  'A':[' ### ','#   #','#   #','#####','#   #','#   #','#   #'],
  'B':['#### ','#   #','#   #','#### ','#   #','#   #','#### '],
  'C':[' ####','#    ','#    ','#    ','#    ','#    ',' ####'],
  'D':['#### ','#   #','#   #','#   #','#   #','#   #','#### '],
  'E':['#####','#    ','#    ','#### ','#    ','#    ','#####'],
  'F':['#####','#    ','#    ','#### ','#    ','#    ','#    '],
  'G':[' ####','#    ','#    ','#  ##','#   #','#   #',' ####'],
  'H':['#   #','#   #','#   #','#####','#   #','#   #','#   #'],
  'I':['#####','  #  ','  #  ','  #  ','  #  ','  #  ','#####'],
  'J':['  ###','   # ','   # ','   # ','#  # ','#  # ',' ##  '],
  'K':['#   #','#  # ','# #  ','##   ','# #  ','#  # ','#   #'],
  'L':['#    ','#    ','#    ','#    ','#    ','#    ','#####'],
  'M':['#   #','## ##','# # #','# # #','#   #','#   #','#   #'],
  'N':['#   #','##  #','# # #','# # #','#  ##','#   #','#   #'],
  'O':[' ### ','#   #','#   #','#   #','#   #','#   #',' ### '],
  'P':['#### ','#   #','#   #','#### ','#    ','#    ','#    '],
  'Q':[' ### ','#   #','#   #','#   #','# # #','#  # ',' ## #'],
  'R':['#### ','#   #','#   #','#### ','# #  ','#  # ','#   #'],
  'S':[' ####','#    ','#    ',' ### ','    #','    #','#### '],
  'T':['#####','  #  ','  #  ','  #  ','  #  ','  #  ','  #  '],
  'U':['#   #','#   #','#   #','#   #','#   #','#   #',' ### '],
  'V':['#   #','#   #','#   #','#   #','#   #',' # # ','  #  '],
  'W':['#   #','#   #','#   #','# # #','# # #','## ##','#   #'],
  'X':['#   #','#   #',' # # ','  #  ',' # # ','#   #','#   #'],
  'Y':['#   #','#   #',' # # ','  #  ','  #  ','  #  ','  #  '],
  'Z':['#####','    #','   # ','  #  ',' #   ','#    ','#####'],
  '0':[' ### ','#   #','#  ##','# # #','##  #','#   #',' ### '],
  '1':['  #  ',' ##  ','  #  ','  #  ','  #  ','  #  ','#####'],
  '2':[' ### ','#   #','    #','   # ','  #  ',' #   ','#####'],
  '3':['#####','   # ','  #  ','   # ','    #','#   #',' ### '],
  '4':['   # ','  ## ',' # # ','#  # ','#####','   # ','   # '],
  '5':['#####','#    ','#### ','    #','    #','#   #',' ### '],
  '6':[' ### ','#    ','#    ','#### ','#   #','#   #',' ### '],
  '7':['#####','    #','   # ','  #  ',' #   ',' #   ',' #   '],
  '8':[' ### ','#   #','#   #',' ### ','#   #','#   #',' ### '],
  '9':[' ### ','#   #','#   #',' ####','    #','    #',' ### '],
  ' ':['     ','     ','     ','     ','     ','     ','     '],
  '-':['     ','     ','     ','#####','     ','     ','     '],
  ':':['     ','  #  ','     ','     ','     ','  #  ','     '],
  '.':['     ','     ','     ','     ','     ',' ##  ',' ##  '],
  '/':['    #','    #','   # ','  #  ',' #   ','#    ','#    '],
  '%':['##  #','##  #','   # ','  #  ',' #   ','#  ##','#  ##'],
  '(':['  ## ',' #   ','#    ','#    ','#    ',' #   ','  ## '],
  ')':[' ##  ','   # ','    #','    #','    #','   # ',' ##  '],
  ',':['     ','     ','     ','     ',' ##  ',' ##  ','#    '],
  '#':[' # # ',' # # ','#####',' # # ','#####',' # # ',' # # '],
  '<':['   # ','  #  ',' #   ','#    ',' #   ','  #  ','   # '],
  '>':[' #   ','  #  ','   # ','    #','   # ','  #  ',' #   '],
};

// ── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); t[n]=c>>>0; } return t; })();
function crc32(buf){ let c=0xFFFFFFFF; for(let i=0;i<buf.length;i++) c = CRC_TABLE[(c^buf[i])&0xFF] ^ (c>>>8); return (c^0xFFFFFFFF)>>>0; }
function paeth(a,b,c){ const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; }

// ── Decode an 8-bit RGB/RGBA PNG into raw pixel bytes ────────────────────────
function decodePNG(buf) {
  if (buf.length < 24 || buf.toString('hex',0,8) !== '89504e470d0a1a0a') throw new Error('not a PNG');
  let off = 8, width=0, height=0, bitDepth=0, colorType=0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off+4, off+8); const data = buf.slice(off+8, off+8+len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || bpp === 0) throw new Error(`unsupported (bitDepth ${bitDepth}, colorType ${colorType})`);
  const filtered = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const raw = Buffer.alloc(height * stride);
  let fp = 0;
  for (let y = 0; y < height; y++) {
    const ft = filtered[fp++]; const rowOff = y * stride; const prevOff = (y-1) * stride;
    for (let x = 0; x < stride; x++) {
      const f = filtered[fp++];
      const a = x >= bpp ? raw[rowOff + x - bpp] : 0;
      const b = y > 0 ? raw[prevOff + x] : 0;
      const c = (y > 0 && x >= bpp) ? raw[prevOff + x - bpp] : 0;
      let v;
      if (ft === 0) v = f; else if (ft === 1) v = f + a; else if (ft === 2) v = f + b;
      else if (ft === 3) v = f + ((a + b) >> 1); else if (ft === 4) v = f + paeth(a,b,c); else v = f;
      raw[rowOff + x] = v & 0xFF;
    }
  }
  return { width, height, colorType, bpp, stride, raw };
}

// ── Encode raw pixels back to a PNG (filter 0) ──────────────────────────────
function encodePNG(img) {
  const { width, height, colorType, bpp, stride, raw } = img;
  const out = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) { out[y*(stride+1)] = 0; raw.copy(out, y*(stride+1)+1, y*stride, y*stride+stride); }
  const comp = zlib.deflateSync(out, { level: 6 });
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type,'ascii'), data])), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=colorType; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  return Buffer.concat([ Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR', ihdr), chunk('IDAT', comp), chunk('IEND', Buffer.alloc(0)) ]);
}

// ── Draw a thick rectangle for ONE bbox onto a pixel buffer ─────────────────
function drawBox(img, bb, col, thickness) {
  const { width, height, bpp, stride, raw } = img;
  const setPx = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = y * stride + x * bpp;
    raw[o] = col[0]; raw[o+1] = col[1]; raw[o+2] = col[2]; if (bpp === 4) raw[o+3] = 255;
  };
  const x0 = Math.max(0, Math.round(bb.x)), y0 = Math.max(0, Math.round(bb.y));
  const x1 = Math.min(width-1, Math.round(bb.x + bb.w)), y1 = Math.min(height-1, Math.round(bb.y + bb.h));
  for (let t = 0; t < thickness; t++) {
    for (let x = x0; x <= x1; x++) { setPx(x, y0+t); setPx(x, y1-t); }
    for (let y = y0; y <= y1; y++) { setPx(x0+t, y); setPx(x1-t, y); }
  }
}

// ── Fill a solid rectangle (used as the label background bar) ────────────────
function fillRect(img, x, y, w, h, col) {
  const { width, height, bpp, stride, raw } = img;
  const xe = Math.min(width, x + w), ye = Math.min(height, y + h);
  for (let yy = Math.max(0, y); yy < ye; yy++) for (let xx = Math.max(0, x); xx < xe; xx++) {
    const o = yy * stride + xx * bpp; raw[o] = col[0]; raw[o+1] = col[1]; raw[o+2] = col[2]; if (bpp === 4) raw[o+3] = 255;
  }
}

// ── Draw a text string with the 3×5 font, each font-pixel scaled to s×s ──────
const GLYPH_W = 5, GLYPH_H = 7, GAP = 1;

// Turn a camelCase issueType into readable spaced words: "cardMostlyEmpty" → "card mostly empty".
function humanize(s) {
  return String(s || 'issue')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord boundary
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
function textWidth(text, s) { return text.length * (GLYPH_W + GAP) * s; }
function drawText(img, x, y, text, s, col) {
  const { width, height, bpp, stride, raw } = img;
  const setPx = (px, py) => { if (px<0||py<0||px>=width||py>=height) return; const o = py*stride + px*bpp; raw[o]=col[0]; raw[o+1]=col[1]; raw[o+2]=col[2]; if (bpp===4) raw[o+3]=255; };
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < GLYPH_H; r++) for (let c = 0; c < GLYPH_W; c++) {
      if (g[r][c] === '#') for (let dy=0; dy<s; dy++) for (let dx=0; dx<s; dx++) setPx(cx + c*s + dx, y + r*s + dy);
    }
    cx += (GLYPH_W + GAP) * s;
  }
}

// ── Draw a red label tag (issue text) anchored to a box ──────────────────────
// Placed just above the box; if there isn't room at the top, placed just below.
function drawLabel(img, bb, label, scale) {
  const pad = 2 * scale;
  const th  = GLYPH_H * scale;                 // text height
  const barH = th + pad * 2;
  const barW = textWidth(label, scale) + pad * 2;
  const x0 = Math.max(0, Math.round(bb.x));
  let by = Math.round(bb.y) - barH - 1;        // prefer above the box
  if (by < 0) by = Math.round(bb.y + bb.h) + 1; // not enough room → below
  if (by + barH > img.height) by = Math.max(0, Math.round(bb.y) + 1); // last resort: inside top
  let bx = x0;
  if (bx + barW > img.width) bx = Math.max(0, img.width - barW);
  fillRect(img, bx, by, barW, barH, RED);      // red tag background
  drawText(img, bx + pad, by + pad, label, scale, WHITE);  // white issue text
}

// ── Resolve the base PNG for a cell. ─────────────────────────────────────────
// Tries three locations in order:
//   1. Canonical:  {project-root}/.tmp/{runId}/screenshots/{cellId}-base.png
//   2. From JSONL: the screenshotPath field stored in the first finding (may be
//      an absolute path from a different install location or working directory)
//   3. Basename reconstruction: PROJECT_ROOT/.tmp/{runId}/screenshots/{basename}
// This handles the case where the model saved the screenshot to a wrong absolute
// path (old install dir, wrong CWD) — the file still exists at that path.
function resolveBasePng(cellId, findings) {
  const canonical = path.join(SHOTS_DIR, `${cellId}-base.png`);
  if (fs.existsSync(canonical)) return canonical;

  const stored = findings[0] && findings[0].screenshotPath;
  if (stored) {
    const abs = path.isAbsolute(stored) ? stored : path.join(PROJECT_ROOT, stored);
    if (fs.existsSync(abs)) return abs;
    // Try reconstructing from basename under canonical screenshots dir
    const reconstructed = path.join(SHOTS_DIR, path.basename(stored));
    if (fs.existsSync(reconstructed)) return reconstructed;
  }
  return null;
}

// ── Annotate ONE cell. Returns a status object; never throws. ────────────────
function annotateCell(cellId) {
  const ISSUES_FILE = path.join(ISSUES_DIR, `${cellId}.jsonl`);
  if (!fs.existsSync(ISSUES_FILE)) return { cellId, status: 'no-jsonl' };
  const rawIssues = schema.readJsonl(ISSUES_FILE);
  const findings  = rawIssues.filter(i => i && i.issueType !== '_coverage');
  if (findings.length === 0) return { cellId, status: 'no-findings' };

  const basePngPath = resolveBasePng(cellId, findings);
  if (!basePngPath) return { cellId, status: 'no-base', findings: findings.length };

  try {
    const base    = decodePNG(fs.readFileSync(basePngPath));
    const BASE_PNG = basePngPath;
    const relBase = path.relative(PROJECT_ROOT, BASE_PNG).split(path.sep).join('/');
    const T = 4;

    // Walk every issue line; each finding gets its OWN annotated screenshot.
    let issueIdx = 0, drawn = 0;
    const updated = rawIssues.map(i => {
      if (!i || i.issueType === '_coverage') return i;
      issueIdx++;
      const out = { ...i, screenshotPath: i.screenshotPath || relBase };
      const bb = i.bbox;
      if (bb && typeof bb.x === 'number') {
        // fresh copy of the base pixels, draw ONLY this finding's box (RED) + its issue label
        const img = { ...base, raw: Buffer.from(base.raw) };
        drawBox(img, bb, RED, T);
        // Label = the issue type (what's wrong) as readable spaced words.
        const scale = base.width >= 1200 ? 3 : 2;   // bigger text on wide screenshots
        drawLabel(img, bb, humanize(i.issueType), scale);
        const outPath = path.join(SHOTS_DIR, `${cellId}-issue-${issueIdx}-annotated.png`);
        fs.writeFileSync(outPath, encodePNG(img));
        out.annotatedScreenshotPath = path.relative(PROJECT_ROOT, outPath).split(path.sep).join('/');
        drawn++;
      } else if (i.annotatedScreenshotPath && fs.existsSync(path.isAbsolute(i.annotatedScreenshotPath) ? i.annotatedScreenshotPath : path.join(PROJECT_ROOT, i.annotatedScreenshotPath))) {
        // Already has a real evidence image (e.g. a console / network DevTools panel
        // rendered by the runner) → keep it, do NOT clobber with the plain base shot.
        out.annotatedScreenshotPath = i.annotatedScreenshotPath;
      } else {
        // page-level finding (no bbox) → nothing to highlight; keep the base shot
        out.annotatedScreenshotPath = relBase;
      }
      return out;
    });

    const tmp = ISSUES_FILE + '.tmp';
    fs.writeFileSync(tmp, updated.map(i => JSON.stringify(i)).join('\n') + '\n');
    fs.renameSync(tmp, ISSUES_FILE);
    return { cellId, status: 'ok', drawn, findings: findings.length };
  } catch (e) {
    return { cellId, status: 'error', error: e.message };
  }
}

// ── Dispatch: ONE cell (back-compat) OR the WHOLE run (no cell-id). ───────────
// Whole-run mode collapses N per-cell orchestrator calls into ONE deterministic
// command, so annotation can NEVER be partially skipped — there is nothing
// per-cell for the model to drop.
if (CELL_ID) {
  const r = annotateCell(CELL_ID);
  if (r.status === 'ok')            { console.log(`annotate-cell: ${CELL_ID} → ${r.drawn} per-issue annotated screenshots (${r.findings} findings)`); process.exit(0); }
  if (r.status === 'no-findings')   { console.log(`annotate-cell: ${CELL_ID} no findings — skip`); process.exit(5); }
  if (r.status === 'no-base')       { console.error(`annotate-cell: base PNG missing for ${CELL_ID}`); process.exit(2); }
  if (r.status === 'no-jsonl')      { console.error(`annotate-cell: JSONL missing for ${CELL_ID}`); process.exit(3); }
  console.error(`annotate-cell: ${CELL_ID} failed (${r.error}) — leaving base unannotated`); process.exit(0);
}

// Whole-run mode — annotate every cell-*.jsonl in one process.
if (!fs.existsSync(ISSUES_DIR)) { console.error(`annotate-cell: no issues dir ${ISSUES_DIR}`); process.exit(3); }
const cellIds = fs.readdirSync(ISSUES_DIR)
  .filter(f => /^cell-.*\.jsonl$/.test(f))
  .map(f => f.replace(/\.jsonl$/, ''));
let ok = 0, drawnTotal = 0, noFind = 0; const noBase = [], errors = [];
for (const cid of cellIds) {
  const r = annotateCell(cid);
  if (r.status === 'ok')              { ok++; drawnTotal += r.drawn; }
  else if (r.status === 'no-base')    noBase.push(cid);
  else if (r.status === 'error')      errors.push(`${cid}:${r.error}`);
  else if (r.status === 'no-findings')noFind++;
}
console.log(`annotate-cell [whole-run ${RUN_ID}]: ${ok}/${cellIds.length} cells annotated, ${drawnTotal} boxes drawn, ${noFind} clean.`);
if (noBase.length) console.log(`  ⚠ ${noBase.length} cell(s) have findings but NO base PNG (re-screenshot needed): ${noBase.join(', ')}`);
if (errors.length) console.log(`  ⚠ ${errors.length} error(s): ${errors.join(' | ')}`);
// Non-zero ONLY when a cell that HAS findings is missing its base PNG — the gate signal to re-screenshot.
process.exit(noBase.length ? 2 : 0);
