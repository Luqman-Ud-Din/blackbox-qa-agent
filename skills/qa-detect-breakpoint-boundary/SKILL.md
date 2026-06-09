---
name: qa-detect-breakpoint-boundary
section: responsiveness
description: "Detects layout breakage at common CSS breakpoint boundaries (767px, 1023px, 1279px) — widths bugs typically hide between standard test viewports"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

Bugs hide at the exact pixel where CSS media queries fire. Standard viewports (390/820/1440) skip these. This skill resizes the page to 767, 1023, and 1279 — one boundary at a time — runs an overflow + cut-off scan, then restores the original viewport.

## Orchestrator flow

**Step 5 is mandatory even if any test errors.** Otherwise the page is left at a wrong size for downstream skills.

1. Run `probe.captureOriginalSize` — save `{w, h}` for restoration
2. For each boundary in `[767, 1023, 1279]`:
   a. `browser_resize(width=boundary, height=720)`
   b. `browser_wait_for(time=400)` — media queries settle
   c. Run `probe.scanBoundary({width: boundary})` — collect findings
3. `browser_resize(width=<saved.w>, height=<saved.h>)` — RESTORE
4. `browser_wait_for(time=200)`

## Probes (browser_evaluate)

```js
// probe.captureOriginalSize
() => ({ w: window.innerWidth, h: window.innerHeight })
```

```js
// probe.scanBoundary  — args: { width }
({width}) => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];

  // 1. Horizontal scroll at boundary
  if (document.documentElement.scrollWidth > width + 2) {
    out.push({
      issueType: 'breakpointOverflow',
      severity: 'high',
      selector: 'html',
      description: `Horizontal overflow at ${width}px boundary — scrollWidth ${document.documentElement.scrollWidth}px (page-level)`,
      bbox: { x: 0, y: 0, w: Math.min(width, window.innerWidth), h: 80 }
    });
  }

  // 2. Elements cut off at right edge of viewport
  for (const el of document.querySelectorAll('header, nav, button, a, input, [role="button"], [class*="card"], [class*="menu"]')) {
    if (out.length >= 12) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > width + 2 && r.left < width) {
      out.push({
        issueType: 'breakpointElementCutOff',
        severity: 'medium',
        selector: sel(el),
        description: `Element ${sel(el)} extends past ${width}px viewport edge at this breakpoint (right edge ${Math.round(r.right)}px)`,
        bbox: bb(el)
      });
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| breakpointOverflow | high | "Horizontal overflow at {width}px breakpoint boundary" |
| breakpointElementCutOff | medium | "Element {selector} cut off at {width}px boundary" |
