#!/usr/bin/env node
/**
 * annotate-cell.cjs — DETERMINISTIC annotation. PURE NODE, no MCP, no browser, no model.
 *
 * Draws colored bounding boxes for every finding directly onto the cell's base PNG
 * and writes {cellId}-annotated.png, then stamps annotatedScreenshotPath into the JSONL.
 *
 * Replaces the old prepare→MCP-render→finalize pipeline. Because there is no model
 * step, annotation CANNOT be silently skipped — the finish-gate just runs this script.
 *
 * Usage:  node scripts/annotate-cell.cjs <run-id> <cell-id>
 * Exit:   0 = annotated (or no-op)   2 = base PNG missing   3 = JSONL missing   5 = no findings
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
const ANNOTATED_PNG = path.join(SHOTS_DIR, `${CELL_ID}-annotated.png`);

if (!fs.existsSync(BASE_PNG))    { console.error(`annotate-cell: base PNG missing ${BASE_PNG}`); process.exit(2); }
if (!fs.existsSync(ISSUES_FILE)) { console.error(`annotate-cell: JSONL missing ${ISSUES_FILE}`); process.exit(3); }

const rawIssues = schema.readJsonl(ISSUES_FILE);
const findings = rawIssues.filter(i => i && i.issueType !== '_coverage');
if (findings.length === 0) { console.log(`annotate-cell: ${CELL_ID} no findings — skip`); process.exit(5); }

const COLORS = { critical: [185,28,28], high: [239,68,68], medium: [249,115,22], low: [59,130,246] };

// ── CRC32 (PNG chunks) ───────────────────────────────────────────────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); t[n]=c>>>0; } return t; })();
function crc32(buf){ let c=0xFFFFFFFF; for(let i=0;i<buf.length;i++) c = CRC_TABLE[(c^buf[i])&0xFF] ^ (c>>>8); return (c^0xFFFFFFFF)>>>0; }
function paeth(a,b,c){ const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; }

try {
  const buf = fs.readFileSync(BASE_PNG);
  if (buf.length < 24 || buf.toString('hex',0,8) !== '89504e470d0a1a0a') throw new Error('not a PNG');

  // ── Parse chunks ──
  let off = 8, width=0, height=0, bitDepth=0, colorType=0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off+4, off+8); const data = buf.slice(off+8, off+8+len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || bpp === 0) { console.log(`annotate-cell: unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType}) — leaving base unannotated`); process.exit(0); }

  // ── Inflate + un-filter into raw RGB(A) rows ──
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

  // ── Draw boxes ──
  const T = 3; // border thickness
  const setPx = (x, y, col) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = y * stride + x * bpp;
    raw[o] = col[0]; raw[o+1] = col[1]; raw[o+2] = col[2]; if (bpp === 4) raw[o+3] = 255;
  };
  let drawn = 0;
  for (const f of findings) {
    const bb = f.bbox; if (!bb || typeof bb.x !== 'number') continue;
    const col = COLORS[f.severity] || COLORS.medium;
    const x0 = Math.max(0, Math.round(bb.x)), y0 = Math.max(0, Math.round(bb.y));
    const x1 = Math.min(width-1, Math.round(bb.x + bb.w)), y1 = Math.min(height-1, Math.round(bb.y + bb.h));
    for (let t = 0; t < T; t++) {
      for (let x = x0; x <= x1; x++) { setPx(x, y0+t, col); setPx(x, y1-t, col); }
      for (let y = y0; y <= y1; y++) { setPx(x0+t, y, col); setPx(x1-t, y, col); }
    }
    drawn++;
  }

  // ── Re-encode (filter 0 None) ──
  const out = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) { out[y*(stride+1)] = 0; raw.copy(out, y*(stride+1)+1, y*stride, y*stride+stride); }
  const comp = zlib.deflateSync(out, { level: 6 });
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type,'ascii'), data])), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=colorType; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  const png = Buffer.concat([ Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR', ihdr), chunk('IDAT', comp), chunk('IEND', Buffer.alloc(0)) ]);
  fs.writeFileSync(ANNOTATED_PNG, png);

  // ── Stamp JSONL ──
  const relAnn = path.relative(PROJECT_ROOT, ANNOTATED_PNG).split(path.sep).join('/');
  const relBase = path.relative(PROJECT_ROOT, BASE_PNG).split(path.sep).join('/');
  const updated = rawIssues.map(i => (i && i.issueType !== '_coverage')
    ? { ...i, screenshotPath: i.screenshotPath || relBase, annotatedScreenshotPath: relAnn } : i);
  const tmp = ISSUES_FILE + '.tmp';
  fs.writeFileSync(tmp, updated.map(i => JSON.stringify(i)).join('\n') + '\n');
  fs.renameSync(tmp, ISSUES_FILE);

  console.log(`annotate-cell: ${CELL_ID} → ${drawn} boxes drawn, ${ANNOTATED_PNG}`);
  process.exit(0);
} catch (e) {
  console.error(`annotate-cell: ${CELL_ID} failed (${e.message}) — leaving base unannotated`);
  process.exit(0); // never block the run; file-bugs falls back to base
}
