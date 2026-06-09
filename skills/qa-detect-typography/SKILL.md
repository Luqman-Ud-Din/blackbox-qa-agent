---
name: qa-detect-typography
section: visual
description: "Detects small fonts, tight line-height, clipped text, oversized headings on mobile, and unbreakable long words causing overflow"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
---

## What it checks
- `smallFont` — font-size < 12px
- `tightLineHeight` — line-height / font-size < 1.2 (and font >= 12px)
- `textClipped` — element with overflow:hidden where scrollHeight > clientHeight + 4
- `oversizedHeading` — H1/H2 font-size > 36px on mobile (≤768px viewport)
- `longWordNoBreak` — leaf text element with word ≥25 chars causing overflow, without word-break/overflow-wrap

## Probe (browser_evaluate)
```js
() => {
  const sel = el => (el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')).slice(0,120);
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vw = innerWidth;
  const isMobile = vw <= 768;
  const q = 'p,span,a,li,td,th,label,button,h1,h2,h3,h4,h5,h6,div';

  for (const el of document.querySelectorAll(q)) {
    if (out.length >= 20) break;
    if (!el.innerText || !el.innerText.trim()) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const s = getComputedStyle(el);
    const fs = parseFloat(s.fontSize);
    const lh = parseFloat(s.lineHeight);

    // 1. smallFont
    if (fs < 12) {
      out.push({ issueType:'smallFont', severity:'medium', selector:sel(el),
        description:`Typography issue on ${sel(el)}: ${fs}px < 12px`, bbox: bb(el) });
    } else if (lh && lh/fs < 1.2) {
      // 2. tightLineHeight
      out.push({ issueType:'tightLineHeight', severity:'low', selector:sel(el),
        description:`Typography issue on ${sel(el)}: line-height/font-size = ${(lh/fs).toFixed(2)} < 1.2`, bbox: bb(el) });
    }

    // 3. textClipped
    if ((s.overflow === 'hidden' || s.textOverflow === 'clip') && el.scrollHeight > el.clientHeight + 4) {
      out.push({ issueType:'textClipped', severity:'low', selector:sel(el),
        description:`Typography issue on ${sel(el)}: Text clipped by overflow:hidden`, bbox: bb(el) });
    }

    // 4. oversizedHeading — H1/H2 with fontSize > 36px on mobile
    if (isMobile && (el.tagName === 'H1' || el.tagName === 'H2') && fs > 36) {
      out.push({ issueType:'oversizedHeading', severity:'medium', selector:sel(el),
        description:`${el.tagName} font-size ${fs}px exceeds 36px on mobile (viewport=${vw}px)`, bbox: bb(el) });
    }

    // 5. longWordNoBreak — leaf elements with very long words causing overflow
    if (el.children.length === 0) {
      const text = el.innerText || '';
      const words = text.split(/\s+/);
      const longWord = words.find(w => w.length >= 25);
      if (longWord && el.scrollWidth > el.clientWidth + 5) {
        const wb = s.wordBreak;
        const ow = s.overflowWrap;
        const allowsBreak = wb === 'break-all' || wb === 'break-word' || ow === 'anywhere' || ow === 'break-word';
        if (!allowsBreak) {
          out.push({ issueType:'longWordNoBreak', severity:'medium', selector:sel(el),
            description:`Long word "${longWord.slice(0,30)}${longWord.length>30?'…':''}" (${longWord.length} chars) overflows container, no word-break/overflow-wrap set`, bbox: bb(el) });
        }
      }
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| smallFont | medium | "Typography issue on {sel}: {fontSize}px < 12px" |
| tightLineHeight | low | "Typography issue on {sel}: line-height/font-size = {ratio} < 1.2" |
| textClipped | low | "Typography issue on {sel}: Text clipped by overflow:hidden" |
| oversizedHeading | medium | "{tag} font-size {fs}px exceeds 36px on mobile" |
| longWordNoBreak | medium | "Long word ({n} chars) overflows container, no word-break/overflow-wrap" |
