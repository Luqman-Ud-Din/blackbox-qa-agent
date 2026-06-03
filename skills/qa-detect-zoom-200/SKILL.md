---
name: qa-detect-zoom-200
description: "WCAG 1.4.4 — verifies text and layout remain functional at 200% zoom. Detects overflow, clipped text, and inaccessible content at high zoom levels"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

WCAG 1.4.4 (Resize Text) requires content to remain usable when zoomed to 200%. Many sites break at this zoom level — text gets cut off, fixed elements overlap, navigation becomes unreachable.

## Orchestrator flow

**Step 4 (zoom reset) is mandatory.** Without it, every downstream skill runs at 2x zoom.

1. Run `probe.applyZoom200` — sets `document.body.style.zoom = '2'` and returns previous value
2. `browser_wait_for(time=500)` — let reflow happen
3. Run `probe.scanAtZoom`
4. Run `probe.resetZoom` — restores original zoom (always run, even if step 3 errored)
5. `browser_wait_for(time=200)`

## Probes (browser_evaluate)

```js
// probe.applyZoom200
() => {
  const prev = document.body.style.zoom || '';
  document.body.style.zoom = '2';
  return { previousZoom: prev };
}
```

```js
// probe.scanAtZoom
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    return (el.tagName.toLowerCase() + id).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];
  const vw = window.innerWidth;

  // 1. Horizontal scroll at zoom — content does not reflow
  if (document.documentElement.scrollWidth > vw + 4) {
    out.push({
      issueType: 'zoomOverflow',
      severity: 'high',
      selector: 'html',
      description: `Page requires horizontal scrolling at 200% zoom — WCAG 1.4.4 violation. scrollWidth ${document.documentElement.scrollWidth}px vs viewport ${vw}px`,
      bbox: { x: 0, y: 0, w: 200, h: 80 }
    });
  }

  // 2. Sticky/fixed elements that cover most of the viewport at zoom
  for (const el of document.querySelectorAll('[class*="sticky"], [class*="fixed"], header, nav')) {
    if (out.length >= 10) break;
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.height > window.innerHeight * 0.5) {
      out.push({
        issueType: 'zoomFixedElementOversized',
        severity: 'high',
        selector: sel(el),
        description: `Fixed/sticky ${sel(el)} occupies ${Math.round((r.height/window.innerHeight)*100)}% of viewport at 200% zoom — blocks content access`,
        bbox: bb(el)
      });
    }
  }

  // 3. Interactive elements that became unreachable (offscreen to the right)
  for (const el of document.querySelectorAll('button, a, input, [role="button"]')) {
    if (out.length >= 15) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left > vw - 4) {
      out.push({
        issueType: 'zoomElementUnreachable',
        severity: 'medium',
        selector: sel(el),
        description: `Interactive element ${sel(el)} sits at x=${Math.round(r.left)}px at 200% zoom — offscreen without horizontal scroll`,
        bbox: bb(el)
      });
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
| zoomOverflow | high | "Page requires horizontal scroll at 200% zoom — WCAG 1.4.4 violation" |
| zoomFixedElementOversized | high | "Fixed/sticky element covers >50% of viewport at 200% zoom" |
| zoomElementUnreachable | medium | "Interactive element offscreen at 200% zoom" |
