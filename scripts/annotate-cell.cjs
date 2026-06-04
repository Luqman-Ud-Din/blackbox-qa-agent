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
const CELL_ID = process.argv[3];
if (!RUN_ID || !CELL_ID) { console.error('Usage: node scripts/annotate-cell.cjs <run-id> <cell-id>'); process.exit(1); }

const PROJECT_ROOT  = path.resolve(__dirname, '..');
const RUN_DIR       = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_FILE   = path.join(RUN_DIR, 'issues', `${CELL_ID}.jsonl`);
const SHOTS_DIR     = path.join(RUN_DIR, 'screenshots');
const BASE_PNG      = path.join(SHOTS_DIR, `${CELL_ID}-base.png`);

if (!fs.existsSync(BASE_PNG))    { console.error(`annotate-cell: base PNG missing ${BASE_PNG}`); process.exit(2); }
if (!fs.existsSync(ISSUES_FILE)) { console.error(`annotate-cell: JSONL missing ${ISSUES_FILE}`); process.exit(3); }

const rawIssues = schema.readJsonl(ISSUES_FILE);
const findings = rawIssues.filter(i => i && i.issueType !== '_coverage');
if (findings.length === 0) { console.log(`annotate-cell: ${CELL_ID} no findings — skip`); process.exit(5); }

const COLORS = { critical: [185,28,28], high: [239,68,68], medium: [249,115,22], low: [59,130,246] };

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

try {
  const base = decodePNG(fs.readFileSync(BASE_PNG)); // decode ONCE
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
      // fresh copy of the base pixels, draw ONLY this finding's box
      const img = { ...base, raw: Buffer.from(base.raw) };
      drawBox(img, bb, COLORS[i.severity] || COLORS.medium, T);
      const outPath = path.join(SHOTS_DIR, `${CELL_ID}-issue-${issueIdx}-annotated.png`);
      fs.writeFileSync(outPath, encodePNG(img));
      out.annotatedScreenshotPath = path.relative(PROJECT_ROOT, outPath).split(path.sep).join('/');
      drawn++;
    } else {
      // page-level finding (no bbox) → nothing to highlight; keep the base shot
      out.annotatedScreenshotPath = relBase;
    }
    return out;
  });

  const tmp = ISSUES_FILE + '.tmp';
  fs.writeFileSync(tmp, updated.map(i => JSON.stringify(i)).join('\n') + '\n');
  fs.renameSync(tmp, ISSUES_FILE);

  console.log(`annotate-cell: ${CELL_ID} → ${drawn} per-issue annotated screenshots (${findings.length} findings)`);
  process.exit(0);
} catch (e) {
  console.error(`annotate-cell: ${CELL_ID} failed (${e.message}) — leaving base unannotated`);
  process.exit(0); // never block the run
}
