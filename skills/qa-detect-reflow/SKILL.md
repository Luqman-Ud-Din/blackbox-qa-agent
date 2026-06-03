---
name: qa-detect-reflow
description: "WCAG 1.4.10 — detects content that requires horizontal scroll at 320×568, fixed-width elements, non-shrinking tables, and oversized images"
model: haiku
applyOn: [mobile]
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

WCAG 1.4.10 (Reflow) requires content to be presentable at 320 CSS pixels wide without horizontal scrolling.
This skill temporarily resizes the viewport to 320×568, runs the reflow scan, then RESTORES the original viewport so subsequent skills in the same cell are not affected.

Catches:
- Page-level horizontal scroll at 320px
- Tables that don't fit / don't wrap
- Images without `max-width: 100%`
- Block elements with explicit fixed pixel widths > 320px

## Orchestrator flow

**CRITICAL: every numbered step must execute. Step 5 (restore) is not optional.**

1. Run `probe.captureOriginalSize` — returns `{w, h}`. Save these values; you'll need them in step 5.
2. `browser_resize(width=320, height=568)`
3. `browser_wait_for(time=450)` — give CSS media queries and layout time to settle
4. Run `probe.scanReflow` — returns findings array
5. `browser_resize(width=<saved.w>, height=<saved.h>)` — **RESTORE viewport. Do not skip even if step 4 errored.**
6. `browser_wait_for(time=200)` — let layout settle before the next skill runs

If `browser_resize` is unavailable in the active MCP session, set every emitted finding's `screenshotSkipReason` to `"viewport resize unsupported"` and emit zero findings — do not run the probe at the wrong viewport.

## Probes (browser_evaluate)

```js
// probe.captureOriginalSize
() => ({ w: window.innerWidth, h: window.innerHeight })
```

```js
// probe.scanReflow
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];
  const VP = 320;

  // 1. Page-level horizontal scroll — primary reflow violation
  if (document.documentElement.scrollWidth > VP + 2) {
    out.push({
      issueType: 'reflowHorizontalScroll',
      severity: 'high',
      selector: 'html',
      description: `Page requires horizontal scroll at 320px viewport (document scrollWidth ${document.documentElement.scrollWidth}px) — WCAG 1.4.10 Reflow violation`,
      bbox: { x: 0, y: 0, w: Math.min(320, window.innerWidth), h: Math.min(80, window.innerHeight) }
    });
  }

  // 2. Tables that overflow 320px
  for (const tbl of document.querySelectorAll('table')) {
    if (out.length >= 15) break;
    const r = tbl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (tbl.scrollWidth > VP + 2 || r.width > VP + 2) {
      out.push({
        issueType: 'tableNotResponsive',
        severity: 'high',
        selector: sel(tbl),
        description: `Table ${sel(tbl)} is ${Math.round(r.width)}px wide at 320px viewport — wrap in overflow-x:auto container or use stacked-row pattern`,
        bbox: bb(tbl)
      });
    }
  }

  // 3. Images that exceed viewport (likely missing max-width:100%)
  for (const img of document.querySelectorAll('img')) {
    if (out.length >= 15) break;
    const r = img.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.width > VP + 2) {
      const style = getComputedStyle(img);
      const responsive = style.maxWidth === '100%' || style.maxWidth.includes('%') || style.width.includes('%');
      if (!responsive) {
        out.push({
          issueType: 'imageNotResponsive',
          severity: 'medium',
          selector: sel(img),
          description: `Image ${sel(img)} is ${Math.round(r.width)}px wide at 320px viewport — add max-width:100% or use srcset/picture`,
          bbox: bb(img)
        });
      }
    }
  }

  // 4. Block elements with fixed px width > viewport
  const blockTags = ['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'form', 'fieldset'];
  for (const el of document.querySelectorAll(blockTags.join(','))) {
    if (out.length >= 20) break;
    const style = getComputedStyle(el);
    const widthStr = style.width || '';
    if (!widthStr.endsWith('px')) continue;
    const w = parseFloat(widthStr);
    if (w <= VP + 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({
      issueType: 'fixedWidthOverflow',
      severity: 'medium',
      selector: sel(el),
      description: `Element ${sel(el)} has fixed width ${widthStr} exceeding 320px viewport — convert to %, rem, em, or use max-width`,
      bbox: bb(el)
    });
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| reflowHorizontalScroll | high | "Page requires horizontal scroll at 320px width — WCAG 1.4.10 violation" |
| tableNotResponsive | high | "Table {selector} overflows 320px viewport — wrap in overflow-x:auto or use stacked rows" |
| imageNotResponsive | medium | "Image {selector} too wide at 320px — add max-width:100% or srcset" |
| fixedWidthOverflow | medium | "Element {selector} has fixed px width exceeding 320px — use relative units" |

## Notes
- `applyOn: [mobile]` — runs only on the mobile viewport cell (already a small viewport, so the temporary resize to 320px is a small additional cost).
- Does not interfere with other detection skills because step 5 always restores the original viewport before the cell continues.
- The orchestrator already has overflow detection at native viewports via `qa-detect-overflow`; this skill is specifically the 320px reflow gate.
