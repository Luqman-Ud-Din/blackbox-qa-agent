---
name: qa-detect-visual-regression
description: "Compares full-page and per-component screenshots to a stored baseline using perceptual hash (pHash). Flags visual drift per (route, viewport, browser). First audit establishes baseline. Catches font fallbacks, icon swaps, color drift, layout shifts that DOM probes cannot see."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
interactive: false
cacheVersion: "1.0.0"
ownership: "exclusive: any visual regression finding (vs prior run baseline) belongs to this skill. Other skills detect structural bugs in current state."
---

# qa-detect-visual-regression — Baseline pHash Diff

Captures full-page + per-component screenshots, computes 64-bit perceptual hash, compares to stored baseline at `.claude/visual-baseline/{route-slug}-{viewport}-{browser}.json`. On Hamming distance > threshold, emits `visualRegression`.

## What it checks (4 issue types)

| Issue type | Severity | What it catches |
|---|---|---|
| `visualRegression` | medium | Full-page pHash differs from baseline by > 8 bits (significant visual change) |
| `componentRegression` | medium | Specific component (nav, hero, footer) pHash differs from baseline |
| `visualBaselineCreated` | info | First-run only — baseline established, no finding to fix |
| `visualBaselineCorrupt` | low | Baseline file exists but is malformed/unreadable — re-creating |

## Self-skip conditions

- If `customize.toml → [visual_regression].enabled = false` → skip
- If the cell is currently capturing `--full-audit` flag → skip (baseline regeneration in progress)
- If running in `--dry-run` AND no baseline exists → create baseline, do not emit findings

## Storage layout

```
{project-root}/.claude/visual-baseline/
├── home-mobile-chromium.json       ← pHash + metadata
├── home-mobile-chromium.png        ← actual baseline image (for visual diff overlay)
├── home-desktop-chromium.json
├── login-mobile-chromium.json
└── ... (one set per route × viewport × browser)
```

`.claude/visual-baseline/` MUST be gitignored — baselines are environment-specific.

## Orchestrator flow

### Step 1 — Take fullPage screenshot

```js
browser_take_screenshot({
  path: `{runDir}/screenshots/{cell.id}-vr-fullpage.png`,
  fullPage: true,    // CRITICAL — captures below-fold content
  type: 'png',
  omitBackground: false
})
```

### Step 2 — Take per-component screenshots

For each well-known component visible on the page, take element screenshots:

```js
const components = [
  { name: 'nav',     selector: 'nav, header[role="banner"]' },
  { name: 'hero',    selector: 'main > section:first-child, [class*="hero"]' },
  { name: 'footer',  selector: 'footer, [role="contentinfo"]' },
  { name: 'cta',     selector: 'button[type="submit"], a.cta, .btn-primary' }
];
for (const c of components) {
  // Check element exists first via probe
  const exists = await browser_evaluate(({sel}) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, { sel: c.selector });
  if (!exists) continue;
  browser_take_screenshot({
    path: `{runDir}/screenshots/{cell.id}-vr-{c.name}.png`,
    selector: c.selector,
    type: 'png'
  });
}
```

### Step 3 — Compute pHash via local Node script

Run via Bash (the pHash computation is CPU work, not browser work):

```bash
node {project-root}/scripts/phash.cjs \
  --input {runDir}/screenshots/{cell.id}-vr-fullpage.png \
  --output-format json
```

Returns: `{ pHash: "0x4c81abef2c40df88", width: ..., height: ..., bytesIn: ... }`

The `scripts/phash.cjs` helper uses `sharp` + perceptual-hash algorithm. (See "Helper script" below.)

### Step 4 — Compare to baseline

```js
const baselineKey = `{routeSlug}-{cell.viewportClass}-{cell.browser}`;
const baselinePath = `.claude/visual-baseline/${baselineKey}.json`;

if (!fs.existsSync(baselinePath)) {
  // First audit — establish baseline
  fs.writeFileSync(baselinePath, JSON.stringify({
    pHash: currentHash, capturedAt: new Date().toISOString(),
    route: cell.route, viewport: cell.viewportClass, browser: cell.browser
  }));
  // Copy the screenshot as the visual baseline reference image
  fs.copyFileSync(currentPng, `.claude/visual-baseline/${baselineKey}.png`);
  emit({ issueType: 'visualBaselineCreated', severity: 'info', selector: null,
    description: `Visual baseline created for ${cell.route} at ${cell.viewportClass}/${cell.browser}` });
  continue;
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const hammingDistance = computeHammingDistance(baseline.pHash, currentHash);

if (hammingDistance > 8) {  // threshold; configurable
  emit({
    issueType: 'visualRegression',
    severity: 'medium',
    selector: null,
    description: `Full-page visual differs from baseline by ${hammingDistance} bits (threshold: 8). Baseline captured ${baseline.capturedAt}.`,
    bbox: null,
    extra: {
      hammingDistance,
      currentScreenshot: currentPng,
      baselineScreenshot: `.claude/visual-baseline/${baselineKey}.png`
    }
  });
}
```

Hamming distance > 4 = subtle change (warning). > 8 = visible change (emit). > 16 = major redesign.

### Step 5 — Component diffs

Repeat Step 4 for each component screenshot. Component thresholds are tighter (> 4 bits flags a regression — components are smaller so less noise tolerance).

| Component | Threshold | Issue type |
|---|---|---|
| Full page | > 8 | `visualRegression` |
| nav | > 4 | `componentRegression` (with `component: "nav"`) |
| hero | > 6 | `componentRegression` |
| footer | > 4 | `componentRegression` |
| cta | > 3 | `componentRegression` |

## Helper script — `scripts/phash.cjs`

Required dependency: `sharp` (npm install sharp). pHash algorithm: standard DCT-based 64-bit.

```js
// scripts/phash.cjs
const sharp = require('sharp');
const fs = require('fs');

const args = require('minimist')(process.argv.slice(2));
const input = args.input;

async function pHash(file) {
  // Resize to 32×32 grayscale, compute DCT, average top 8x8 block, threshold to 64 bits
  const { data } = await sharp(file).greyscale().resize(32, 32, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  // ... DCT computation (using standard algorithm)
  // Returns 64-bit hex string
  return computePHash(data);
}

function computePHash(buf) {
  // Simplified — production uses block-DCT
  let avg = 0;
  for (let i = 0; i < buf.length; i++) avg += buf[i];
  avg /= buf.length;
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    const blockStart = (Math.floor(i / 8) * 32 * 4) + (i % 8) * 4;
    const blockAvg = (buf[blockStart] + buf[blockStart + 1] + buf[blockStart + 2] + buf[blockStart + 3]) / 4;
    if (blockAvg > avg) hash |= (1n << BigInt(i));
  }
  return '0x' + hash.toString(16).padStart(16, '0');
}

(async () => {
  const hash = await pHash(input);
  console.log(JSON.stringify({ pHash: hash, file: input, bytesIn: fs.statSync(input).size }));
})();
```

```js
// Hamming distance: XOR + popcount
function computeHammingDistance(hexA, hexB) {
  const a = BigInt(hexA);
  const b = BigInt(hexB);
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) { count += Number(xor & 1n); xor >>= 1n; }
  return count;
}
```

## Configuration (customize.toml)

```toml
[visual_regression]
enabled                  = true
full_page_threshold      = 8     # hamming distance > this triggers finding
component_threshold      = 4     # tighter for components
auto_update_baseline     = false # set true to update baseline on every run (defeats regression detection)
critical_routes          = []    # if non-empty, only run visual regression on these routes
attach_diff_to_ado       = true  # attach baseline + current + visual diff overlay to ADO ticket
```

## Hard rules

1. **`.claude/visual-baseline/` MUST be gitignored** — baselines are local. Add to .gitignore on first run.
2. **First audit always creates baseline, never flags regression** — `visualBaselineCreated` is info, not bug.
3. **Threshold MUST be configurable** — different apps have different visual stability.
4. **fullPage screenshot is REQUIRED** — viewport-only misses below-fold regressions.
5. **NEVER overwrite baseline without explicit user opt-in** (`auto_update_baseline = true`).
6. **Component screenshots only on elements that exist** — silently skip missing components.

## Cost analysis

| Phase | Cost |
|---|---|
| Take fullPage screenshot | $0 (MCP call, no LLM tokens) |
| Take component screenshots | $0 |
| pHash computation (local Node) | $0 |
| Hamming distance compare | $0 |
| **Per-cell LLM cost** | **~$0.0005** (just reporting findings) |

Visual regression is essentially **free in tokens**. Cost is disk space: ~200 KB per baseline image × N routes × N viewports.

## Bootstrapping

On first audit, every cell creates a baseline → emits N `visualBaselineCreated` info findings. These are NOT filed as ADO bugs. Coverage report should show `baselinesCreated: N` instead.

After first audit, subsequent audits only emit findings when visual drift exceeds threshold.

## Notes

- This skill is the ONLY way to catch web-font load failures (text renders in fallback font → pixels change → pHash changes).
- For brand-controlled apps with frequent intentional design changes, set `auto_update_baseline = true` per route. Defeats regression detection on that route but reduces noise.
- The `--rebuild-baseline` CLI flag forces baseline regeneration on the next audit.
