---
name: qa-detect-breakpoint-edge
section: responsiveness
description: "Detects layout bugs at exact CSS breakpoint boundaries by extracting the page's actual @media values and probing at (boundary - 1px) vs (boundary + 1px). Catches CSS transitions that work at 390px and 1440px but break at 767/768 or 1023/1024."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any finding about layout breakage AT or NEAR a media-query boundary belongs to this skill"
---

# qa-detect-breakpoint-edge — Breakpoint Boundary Testing

Single skill that catches the most common class of responsive bug: CSS that works at typical viewports (390, 768, 1440) but breaks at the transition (767, 1024). Uses MCP `browser_resize` to test at exact breakpoint values within a single cell.

## What it checks (3 issue types)

| Issue type | Severity | What it catches |
|---|---|---|
| `breakpointEdgeBreaks` | high | Layout/overflow finding appears at breakpoint+1px that wasn't at breakpoint-1px |
| `breakpointTransitionShift` | medium | Element position shifts by > 100px between boundary-1 and boundary+1 (CLS at breakpoint) |
| `breakpointMissingMatch` | low | Page has elements with viewport-dependent styles but no @media query found in CSS (likely inline / JS-based — fragile) |

## Self-skip conditions

- Run on desktop viewport only (this skill DRIVES the resize; it doesn't need to run per viewport)
- Self-skip if `probe.detectMediaQueryBreakpoints` returns zero breakpoints (static layout, no media queries)
- Self-skip if browser_resize MCP tool not available (Bash fallback mode)

## Orchestrator flow

This skill is unusual: it runs once per route at the desktop cell, then drives viewport resize internally to test all breakpoints.

### Step 1 — Discover the page's actual breakpoints

Run `probe.detectMediaQueryBreakpoints`. Reads every loaded stylesheet's `@media` rules and extracts numeric breakpoint values.

```js
// Returns: { breakpoints: [768, 1024, 1280], containerQueries: [...] }
```

Cap at 6 breakpoints (test the smallest 6 if more found).

### Step 2 — For each breakpoint B, test the edge

For each B in `breakpoints`:

```
a. browser_resize({ width: B - 1, height: 800 })
b. browser_wait_for({ time: 600 })  // allow layout/reflow + any JS resize handlers
c. minusFindings = browser_evaluate(probe.snapshotLayoutState)
   Returns: { findings: [...], elementPositions: { selector → bbox } }

d. browser_resize({ width: B + 1, height: 800 })
e. browser_wait_for({ time: 600 })
f. plusFindings = browser_evaluate(probe.snapshotLayoutState)

g. Compare:
   - Findings in plusFindings NOT in minusFindings → emit breakpointEdgeBreaks (high)
     description: "Layout bug appears at {B+1}px that doesn't exist at {B-1}px — CSS transition broken"
   - Elements whose bbox.left/top differs by > 100px between minus and plus → emit breakpointTransitionShift
     description: "Element {selector} jumps {N}px at breakpoint {B}px"
```

### Step 3 — Mismatch detection

If `breakpoints.length === 0` BUT page has visible elements whose `getComputedStyle` differs across resizes → emit `breakpointMissingMatch` (low).

### Step 4 — Restore (MANDATORY)

```
browser_resize({ width: originalWidth, height: originalHeight })
browser_wait_for({ time: 500 })
```

Pass the cell's original viewport in via `cell.viewport`. Restoration is non-negotiable — next skill in the cell expects original viewport.

## Probes (browser_evaluate)

```js
// probe.detectMediaQueryBreakpoints — reads ALL @media rules from loaded stylesheets
() => {
  const breakpoints = new Set();
  const containerQueries = new Set();
  let inaccessibleSheets = 0;
  for (const sheet of document.styleSheets) {
    try {
      // Walk through all rules including nested ones
      const walkRules = (rules) => {
        for (const rule of rules) {
          if (rule.type === CSSRule.MEDIA_RULE) {
            // Extract numeric pixel breakpoints
            for (const m of rule.conditionText.matchAll(/(min|max)-width\s*:\s*(\d+)px/g)) {
              breakpoints.add(parseInt(m[2]));
            }
            if (rule.cssRules) walkRules(rule.cssRules);
          } else if (rule.type === CSSRule.SUPPORTS_RULE && rule.cssRules) {
            walkRules(rule.cssRules);
          } else if (rule.constructor.name === 'CSSContainerRule' || rule.type === 11) {
            containerQueries.add(rule.conditionText || rule.containerName || 'unnamed');
          }
        }
      };
      walkRules(sheet.cssRules);
    } catch (_) {
      inaccessibleSheets++;
    }
  }
  // Sort and cap at 6 most common (smallest first to test mobile-up flow)
  const sorted = [...breakpoints].sort((a, b) => a - b).slice(0, 6);
  return {
    breakpoints: sorted,
    containerQueries: [...containerQueries],
    inaccessibleSheets,
    totalFound: breakpoints.size
  };
}
```

```js
// probe.snapshotLayoutState — captures layout state at current viewport
() => {
  const sel = el => (el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')).slice(0, 120);
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = { findings: [], positions: {}, vw: innerWidth, vh: innerHeight };

  // Overflow check (similar to qa-detect-overflow but inline for self-contained)
  for (const el of document.querySelectorAll('main, section, header, footer, nav, [class*="container"], [class*="content"]')) {
    if (out.findings.length >= 15) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.overflowX === 'hidden' || style.overflowX === 'scroll' || style.overflowX === 'auto') continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      out.findings.push({ type: 'overflow', sel: sel(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
    }
  }

  // Position snapshot of key elements
  for (const el of document.querySelectorAll('h1, h2, header, nav, main, footer, button[type="submit"], .cta, .btn-primary')) {
    if (Object.keys(out.positions).length >= 30) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.positions[sel(el)] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  return out;
}
```

```js
// probe.compareLayoutStates — args: { minus, plus, boundary }
// Called CLIENT-SIDE in orchestrator (not in browser); pure JS comparison logic
// Documentation: the orchestrator should run this as a regular JS comparison after
// receiving both snapshots, NOT via browser_evaluate.
```

The orchestrator does the diff itself (not in-browser) since it has both snapshots in memory:

```js
function diffSnapshots(minus, plus, B) {
  const findings = [];
  // 1. New overflow findings in plus not in minus
  const minusOverflows = new Set(minus.findings.filter(f => f.type === 'overflow').map(f => f.sel));
  for (const f of plus.findings) {
    if (f.type === 'overflow' && !minusOverflows.has(f.sel)) {
      findings.push({
        issueType: 'breakpointEdgeBreaks',
        severity: 'high',
        selector: f.sel,
        description: `Overflow on ${f.sel} appears at viewport ${B+1}px but not at ${B-1}px — CSS breakpoint transition broken (scrollWidth ${f.scrollW}px > clientWidth ${f.clientW}px)`,
        bbox: null,
        breakpoint: B
      });
    }
  }
  // 2. Position shift > 100px
  for (const [sel, plusBox] of Object.entries(plus.positions)) {
    const minusBox = minus.positions[sel];
    if (!minusBox) continue;
    const dx = Math.abs(plusBox.x - minusBox.x);
    const dy = Math.abs(plusBox.y - minusBox.y);
    if (dx > 100 || dy > 100) {
      findings.push({
        issueType: 'breakpointTransitionShift',
        severity: 'medium',
        selector: sel,
        description: `Element ${sel} shifts by (Δx=${dx}px, Δy=${dy}px) between viewport ${B-1}px and ${B+1}px — visible layout jump at breakpoint`,
        bbox: plusBox,
        breakpoint: B
      });
    }
  }
  return findings;
}
```

## Hard rules

1. **MUST restore original viewport before exit** — even on partial failure. The next skill expects `cell.viewport.width × cell.viewport.height`.
2. **Cap at 6 breakpoints** — if the page defines more, test only the 6 smallest. Bounded time.
3. **600 ms wait between resize and snapshot** — less risks catching transitional state. More is wasteful.
4. **Run on desktop cell only** — this skill drives all viewports internally. Running on mobile would resize from mobile, doubling cost.
5. **Self-skip if no @media rules** — sites with purely fluid CSS (or table-based) have no breakpoints to test.

## Cost analysis

| Phase | Round-trips | Cost |
|---|---|---|
| Detect breakpoints | 1 evaluate | ~$0.0002 |
| Per-breakpoint test (resize×2 + evaluate×2) | 4 MCP calls × N breakpoints | ~$0.001 per breakpoint |
| Final restore | 1 resize | ~$0.0001 |
| **Typical (3-4 breakpoints)** | ~14 MCP calls | **~$0.005** |

Vs current state where breakpoint-edge bugs go undetected → infinite false-negative cost. The skill pays for itself when it catches one bug.

## Notes

- This skill MUST run AFTER all per-viewport detectors in the cell. Otherwise it resizes and probes that already ran would be invalidated.
- Container queries (modern `@container`) are detected but not yet tested for edges. Future enhancement.
- The skill replaces nothing — it adds a dimension current skills don't cover (transitions). No migration needed.
