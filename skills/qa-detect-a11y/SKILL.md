---
name: qa-detect-a11y
description: "Detects missing H1, unnamed buttons, missing lang attribute, absent skip-to-content link, and missing/disabled viewport meta."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks
- No `<h1>` on page
- Button or `[role=button]` with no accessible name (text/aria-label/title/aria-labelledby)
- `<html>` missing `lang` attribute
- No skip-to-content link (`<a href="#...">` with skip/jump/content text)
- Icon-sized `<img>` (<48px or src matches icon pattern) without alt
- **`viewportMetaMissing`** — `<meta name="viewport">` missing, OR has `user-scalable=no`, OR `maximum-scale=1` (zoom disabled). Catastrophic — breaks all mobile rendering.

## Probe (browser_evaluate)
```js
() => {
  const sel = el => {
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return (el.id ? `#${el.id}` : el.tagName.toLowerCase() + cls).slice(0,120);
  };
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };

  // viewportMetaMissing
  const vp = document.querySelector('meta[name="viewport"]');
  if (!vp) {
    out.push({ issueType:'viewportMetaMissing', severity:'high', selector:'head',
      description:'No <meta name="viewport"> tag — page will not scale correctly on mobile devices. Add <meta name="viewport" content="width=device-width, initial-scale=1">' });
  } else {
    const content = (vp.getAttribute('content') || '').toLowerCase();
    if (content.includes('user-scalable=no') || content.includes('user-scalable=0')) {
      out.push({ issueType:'viewportMetaMissing', severity:'high', selector:'meta[name="viewport"]',
        description:`Viewport meta has user-scalable=no — users cannot zoom (accessibility violation). content="${content}"` });
    } else if (/maximum-scale\s*=\s*1(?![\d.])/.test(content)) {
      out.push({ issueType:'viewportMetaMissing', severity:'high', selector:'meta[name="viewport"]',
        description:`Viewport meta has maximum-scale=1 — restricts pinch zoom (accessibility violation). content="${content}"` });
    }
  }

  if (document.querySelectorAll('h1').length === 0) {
    out.push({ issueType:'noH1', severity:'high', selector:null,
      description:'Page has no <h1> heading — add a single H1 as the primary page title' });
  }
  if (!document.documentElement.hasAttribute('lang')) {
    out.push({ issueType:'missingLang', severity:'high', selector:'html',
      description:"<html> element is missing the lang attribute — add lang='en' (or appropriate language code)" });
  }
  let skipFound = false;
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    if (/skip|jump|main.?content|content/i.test(a.innerText)) { skipFound = true; break; }
  }
  if (!skipFound) {
    out.push({ issueType:'noSkipLink', severity:'medium', selector:null,
      description:"Page has no skip-to-content link — add <a href='#main' class='sr-only focus:not-sr-only'>Skip to content</a> as the first focusable element" });
  }
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    if (out.length >= 20) break;
    const text = (el.innerText || '').trim();
    const aria = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const labelledBy = el.getAttribute('aria-labelledby');
    const labelText = labelledBy ? ((document.getElementById(labelledBy) || {}).innerText || '') : '';
    if (!text && !aria && !title && !labelText) {
      out.push({ issueType:'buttonNoName', severity:'high', selector:sel(el),
        description:`Button ${sel(el)} has no accessible name — add text content, aria-label, or title`, bbox: bb(el) });
    }
  }
  for (const img of document.querySelectorAll('img')) {
    if (out.length >= 20) break;
    const src = img.src || '';
    const isIcon = /icon|ico|sprite|glyph/i.test(src) || (img.width < 48 && img.height < 48);
    if (isIcon && !img.hasAttribute('alt') && !img.getAttribute('aria-hidden')) {
      out.push({ issueType:'iconNoAlt', severity:'medium', selector:sel(img),
        description:`Icon image ${src.slice(0,80)} has no alt text`, bbox: bb(img) });
    }
  }
  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| noH1 | high | "Page has no <h1> heading" |
| buttonNoName | high | "Button {sel} has no accessible name" |
| missingLang | high | "<html> missing lang attribute" |
| noSkipLink | medium | "No skip-to-content link" |
| iconNoAlt | medium | "Icon image missing alt" |
| viewportMetaMissing | high | "Viewport meta missing OR scaling disabled (user-scalable=no / maximum-scale=1)" |
