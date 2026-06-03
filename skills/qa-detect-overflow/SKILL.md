---
name: qa-detect-overflow
description: "Detects horizontal content overflow on any element"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
---

## What it checks
Horizontal content overflow on any element where `scrollWidth > clientWidth + 2`,
excluding intentionally clipped elements (`overflow-x: hidden`) and zero-size nodes.

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
  for (const el of document.querySelectorAll('*')) {
    if (out.length >= 20) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (getComputedStyle(el).overflowX === 'hidden') continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      out.push({
        issueType: 'horizontalOverflow',
        severity: 'high',
        selector: sel(el),
        description: `Horizontal overflow on ${sel(el)}: scrollWidth ${el.scrollWidth}px > clientWidth ${el.clientWidth}px`, bbox: bb(el) });
    }
  }
  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| horizontalOverflow | high | "Horizontal overflow on {selector}: scrollWidth {sw}px > clientWidth {cw}px" |
