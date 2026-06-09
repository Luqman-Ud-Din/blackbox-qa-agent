---
name: qa-detect-touch
section: responsiveness
description: "Detects tap targets smaller than 44×44px and interactive elements too close together"
model: haiku
applyOn: [mobile, tablet]
needsSetup: false
viewportSensitive: true
---

## What it checks
Touch targets <44px and interactive elements <8px apart. Mobile + tablet only.

## Probe (browser_evaluate)
```js
() => {
  const sel = el => (el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')).slice(0,120);
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const q = 'a,button,[role="button"],input,select,textarea,[tabindex]';
  const els = [...document.querySelectorAll(q)].map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(x => x.r.width > 0 && x.r.height > 0 && x.r.top >= 0 && x.r.bottom <= innerHeight*3);

  for (const {el, r} of els) {
    if (out.length >= 20) break;
    if (r.width < 44 || r.height < 44) {
      out.push({ issueType:'smallTapTarget', severity:'high', selector:sel(el),
        description:`Touch target issue: ${Math.round(r.width)}×${Math.round(r.height)}px — minimum is 44×44px`, bbox: bb(el) });
    }
  }
  const top = els.slice(0, 50);
  outer: for (let i = 0; i < top.length; i++) {
    for (let j = i+1; j < top.length; j++) {
      const a = top[i].r, b = top[j].r;
      const dx = Math.max(0, Math.max(a.left,b.left) - Math.min(a.right,b.right));
      const dy = Math.max(0, Math.max(a.top,b.top) - Math.min(a.bottom,b.bottom));
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d > 0 && d < 8) {
        if (out.length >= 20) break outer;
        out.push({ issueType:'tapTargetsTooClose', severity:'medium', selector:sel(top[i].el),
          description:`Touch target issue: ${Math.round(d)}px gap < minimum 8px between interactive elements` });
        break;
      }
    }
  }
  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| smallTapTarget | high | "Touch target issue: {detail}" |
| tapTargetsTooClose | medium | "Touch target issue: {detail}" |
