---
name: qa-detect-orientation
section: responsiveness
description: "Detects layout breakage in landscape orientation on mobile/tablet — swaps viewport dimensions and scans for overflow, cut-off content, and unusable navigation"
model: haiku
applyOn: [mobile, tablet]
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

Mobile/tablet users rotate. Sites tested only in portrait often break in landscape (e.g., header collapses to nothing, modals don't fit, content hides under fixed bars).

This skill swaps the viewport's width and height (portrait → landscape), runs an overflow + obstruction scan, then restores the original orientation.

## Orchestrator flow

**Step 4 (restore) is mandatory.**

1. Run `probe.captureOrientation` — returns `{w, h}`
2. `browser_resize(width=<original.h>, height=<original.w>)` — swap dimensions
3. `browser_wait_for(time=400)`
4. Run `probe.scanLandscape`
5. `browser_resize(width=<original.w>, height=<original.h>)` — RESTORE
6. `browser_wait_for(time=200)`

## Probes (browser_evaluate)

```js
// probe.captureOrientation
() => ({ w: window.innerWidth, h: window.innerHeight })
```

```js
// probe.scanLandscape
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    return (el.tagName.toLowerCase() + id).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 1. Horizontal overflow in landscape (landscape is wider, this should be rarer — flag if happens)
  if (document.documentElement.scrollWidth > vw + 2) {
    out.push({
      issueType: 'landscapeOverflow',
      severity: 'high',
      selector: 'html',
      description: `Horizontal overflow in landscape orientation (${vw}×${vh}) — scrollWidth ${document.documentElement.scrollWidth}px`,
      bbox: { x: 0, y: 0, w: 200, h: 80 }
    });
  }

  // 2. Fixed headers/banners covering too much vertical space (landscape is short — fixed elements crush content)
  for (const el of document.querySelectorAll('header, nav, [class*="sticky"], [class*="fixed"]')) {
    if (out.length >= 10) break;
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.height > vh * 0.40) {
      out.push({
        issueType: 'landscapeFixedTooTall',
        severity: 'high',
        selector: sel(el),
        description: `Fixed/sticky ${sel(el)} is ${Math.round((r.height/vh)*100)}% of landscape viewport height — leaves little room for content`,
        bbox: bb(el)
      });
    }
  }

  // 3. Modals/dialogs that don't fit landscape viewport
  for (const el of document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal, .dialog')) {
    if (out.length >= 15) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height > vh + 4) {
      out.push({
        issueType: 'landscapeModalTooTall',
        severity: 'high',
        selector: sel(el),
        description: `Modal ${sel(el)} (${Math.round(r.height)}px tall) overflows landscape viewport (${vh}px) — buttons may be unreachable`,
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
| landscapeOverflow | high | "Horizontal overflow in landscape orientation" |
| landscapeFixedTooTall | high | "Fixed element occupies >40% of landscape height" |
| landscapeModalTooTall | high | "Modal taller than landscape viewport — buttons unreachable" |
