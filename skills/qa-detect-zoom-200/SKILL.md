---
name: qa-detect-zoom-200
section: responsiveness
description: "WCAG 1.4.4 — verifies text and layout remain functional at 150% zoom (OS Display Scale approximation) and 200% zoom. Detects overflow, clipped text, and inaccessible content at both zoom levels."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

WCAG 1.4.4 (Resize Text) requires content to remain usable when zoomed to 200%. Additionally, OS-level Display Scale at 125–150% (Windows Display Settings) is approximated by testing at 150% zoom — a common enterprise/accessibility setting that often exposes issues missed by the 200% test.

## Orchestrator flow

**Zoom reset after EACH pass is mandatory.** Without it, every downstream skill runs at the wrong zoom.

**Pass 1 — 150% zoom (OS Display Scale approximation):**
1. Run `probe.applyZoom` with `{level: '1.5'}` — sets `document.body.style.zoom = '1.5'`
2. `browser_wait_for(time=400)`
3. Run `probe.scanAtZoom` with `{zoomLabel: '150%'}`
4. Run `probe.resetZoom` — **always run, even on error**
5. `browser_wait_for(time=200)`

**Pass 2 — 200% zoom (WCAG 1.4.4):**
6. Run `probe.applyZoom` with `{level: '2'}`
7. `browser_wait_for(time=500)`
8. Run `probe.scanAtZoom` with `{zoomLabel: '200%'}`
9. Run `probe.resetZoom` — **always run, even on error**
10. `browser_wait_for(time=200)`

## Probes (browser_evaluate)

```js
// probe.applyZoom — args: { level }
({level}) => {
  const prev = document.body.style.zoom || '';
  document.body.style.zoom = level;
  return { previousZoom: prev };
}
```

```js
// probe.scanAtZoom — args: { zoomLabel }
({zoomLabel}) => {
  const selFn = el => (el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')).slice(0, 120);
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const label = zoomLabel || '200%';
  const is200 = label === '200%';

  // 1. Horizontal scroll at zoom
  if (document.documentElement.scrollWidth > vw + 4) {
    out.push({ issueType: 'zoomOverflow', severity: 'high', selector: 'html',
      description: `Page requires horizontal scrolling at ${label} zoom${is200 ? ' — WCAG 1.4.4 violation' : ' (OS Display Scale approximation)'}. scrollWidth ${document.documentElement.scrollWidth}px vs viewport ${vw}px`,
      bbox: { x: 0, y: 0, w: 200, h: 80 } });
  }

  // 2. Fixed/sticky element covers >50% of viewport
  for (const el of document.querySelectorAll('*')) {
    if (out.length >= 10) break;
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height > vh * 0.5) {
      out.push({ issueType: 'zoomFixedElementOversized', severity: 'high', selector: selFn(el),
        description: `Fixed/sticky ${selFn(el)} occupies ${Math.round((r.height/vh)*100)}% of viewport at ${label} zoom — blocks content access`,
        bbox: bb(el) });
    }
  }

  // 3. Interactive elements offscreen to the right
  for (const el of document.querySelectorAll('button, a, input, [role="button"]')) {
    if (out.length >= 15) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left > vw - 4) {
      out.push({ issueType: 'zoomElementUnreachable', severity: 'medium', selector: selFn(el),
        description: `Interactive element sits at x=${Math.round(r.left)}px at ${label} zoom — offscreen without horizontal scroll`,
        bbox: bb(el) });
    }
  }

  return out;
}
```

```js
// probe.resetZoom  — args: { previousZoom }
({previousZoom}) => {
  document.body.style.zoom = previousZoom || '';
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| zoomOverflow | high | "Page requires horizontal scroll at {label} zoom — WCAG 1.4.4 violation / OS Display Scale issue" |
| zoomFixedElementOversized | high | "Fixed/sticky element covers >50% of viewport at {label} zoom — blocks content access" |
| zoomElementUnreachable | medium | "Interactive element offscreen at {label} zoom" |

**Note:** 150% pass approximates Windows Display Settings at 125–150% scale. Issues appearing only at 150% (not 200%) are severity `medium` — they affect enterprise users but not strict WCAG compliance.
