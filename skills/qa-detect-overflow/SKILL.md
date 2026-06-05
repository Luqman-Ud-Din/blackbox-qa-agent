---
name: qa-detect-overflow
description: "Detects horizontal content overflow on any element"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
---

## What it checks
Horizontal content overflow that is actually visible to the user:
- `scrollWidth > clientWidth` by a meaningful margin (≥ 20px absolute)
- The element itself is not `overflow-x: hidden/clip`
- No ancestor clips the overflow — if a parent hides it, the user never sees any scroll
- Zero-size nodes excluded

Small component-internal deltas (< 20px) from CSS framework toggles, MDC components,
Bootstrap buttons, etc. are intentionally ignored — they do not cause visible page scroll.

## Probe (browser_evaluate)
```js
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.')
      : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 120);
  };
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };

  // Returns true if any ancestor (up to <html>) clips overflow-x,
  // meaning the user will never see this element's overflow as horizontal scroll.
  const ancestorClips = el => {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === 'hidden' || ox === 'clip') return true;
      node = node.parentElement;
    }
    return false;
  };

  for (const el of document.querySelectorAll('*')) {
    if (out.length >= 20) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Skip elements that clip their own overflow
    const ox = getComputedStyle(el).overflowX;
    if (ox === 'hidden' || ox === 'clip') continue;

    // Require a meaningful delta — ignore tiny CSS-framework internal layout noise
    // (e.g. MDC switch track, Bootstrap toggle at 26px vs 20px).
    // 20px minimum catches real container overflows while skipping component math.
    const delta = el.scrollWidth - el.clientWidth;
    if (delta < 20) continue;

    // Skip if a parent clips the overflow — user never sees horizontal scroll
    if (ancestorClips(el)) continue;

    out.push({
      issueType: 'horizontalOverflow',
      severity: 'high',
      selector: sel(el),
      description: `Horizontal overflow on ${sel(el)}: scrollWidth ${el.scrollWidth}px > clientWidth ${el.clientWidth}px`,
      bbox: bb(el)
    });
  }
  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| horizontalOverflow | high | "Horizontal overflow on {selector}: scrollWidth {sw}px > clientWidth {cw}px" |
