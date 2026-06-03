---
name: qa-detect-typography-advanced
description: "Comprehensive font + typography quality check — 21 mechanical checks in one probe. Web font loading status, synthetic bold/italic, real WCAG contrast ratio, heading hierarchy, link styling, font consistency, tofu rendering, mixed-content fonts, and more. Complements qa-detect-typography (size/line-height)."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks (21 issue types in 5 categories)

### Font loading & rendering (7)
- `webFontFailed` (high) — @font-face declared but the file failed to load
- `syntheticBold` (medium) — browser is faking 600/700/800 weight because that weight wasn't loaded
- `syntheticItalic` (medium) — same for italic variant
- `noFontDisplay` (medium) — @font-face missing `font-display: swap/fallback/optional` → causes FOIT
- `noGenericFallback` (low) — font-family with no `serif`/`sans-serif`/`monospace` at end of chain
- `tooManyFontFamilies` (low) — page uses >3 different font-families (design system drift)
- `mixedContentFont` (high) — HTTPS page loads HTTP font URL (browser blocks)

### Accessibility (8)
- `contrastFail` (high) — real WCAG ratio < 4.5:1 (normal) or < 3:1 (large text) — uses proper luminance math
- `missingH1` (medium) — page has headings but no `<h1>`
- `multipleH1` (medium) — page has more than one `<h1>`
- `headingSkip` (low) — H2 → H4 (skipped H3)
- `linkNoDecoration` (medium) — inline link inside body text has `text-decoration: none` (WCAG 1.4.1)
- `fontSizePxBased` (medium) — root `font-size` declared in `px` instead of `rem` (WCAG 1.4.4)
- `allCapsBodyCopy` (low) — paragraph-length text with `text-transform: uppercase`
- `italicOnlyEmphasis` (low) — `<em>` with italic but no bold — low-vision users can't perceive slant alone

### Content quality (3)
- `tofuGlyph` (high) — visible `□` or `�` replacement characters (font missing glyph)
- `emptyTextElement` (medium) — heading/button/link with no text, no aria-label, no title
- `extremeLetterSpacing` (low) — `letter-spacing` < -0.5px or > 3px on body text

### Performance (2)
- `noFontPreload` (low) — custom fonts used but no `<link rel="preload" as="font">`
- `unreadableTextShadow` (medium) — text-shadow with blur > 4px making text fuzzy

### Layout (1)
- `inconsistentRhythm` (low) — paragraphs use >3 different line-height ratios (vertical rhythm drift)

## Probe (browser_evaluate)

```js
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];
  const TEXT_SEL = 'p, span, a, li, td, th, label, button, h1, h2, h3, h4, h5, h6, div';
  const sample = [...document.querySelectorAll(TEXT_SEL)]
    .filter(el => el.innerText && el.innerText.trim().length > 5)
    .slice(0, 40);

  // 1. Web font load failures
  try {
    for (const ff of document.fonts) {
      if (ff.status === 'error') {
        out.push({ issueType:'webFontFailed', severity:'high', selector:`@font-face[${ff.family}]`,
          description:`Web font "${ff.family}" (${ff.weight} ${ff.style}) failed to load — users see system fallback.` });
      }
    }
  } catch (_) {}

  // 2 & 3. Synthetic bold + italic
  const seenSynBold = new Set(), seenSynItalic = new Set();
  for (const el of sample) {
    const cs = getComputedStyle(el);
    const family = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    const fs = parseFloat(cs.fontSize) || 16;
    const weight = cs.fontWeight;
    const w = parseInt(weight) || 400;
    if (w >= 600 && !seenSynBold.has(family + w)) {
      try {
        if (!document.fonts.check(`${weight} ${fs}px "${family}"`)) {
          seenSynBold.add(family + w);
          out.push({ issueType:'syntheticBold', severity:'medium', selector:sel(el),
            description:`Browser synthesizing bold for "${family}" weight ${weight} — real bold weight not loaded; appearance is artificial.`, bbox:bb(el) });
        }
      } catch (_) {}
    }
    if (cs.fontStyle === 'italic' && !seenSynItalic.has(family)) {
      try {
        if (!document.fonts.check(`italic ${weight} ${fs}px "${family}"`)) {
          seenSynItalic.add(family);
          out.push({ issueType:'syntheticItalic', severity:'medium', selector:sel(el),
            description:`Browser synthesizing italic for "${family}" — italic variant not loaded; appearance is artificial slant.`, bbox:bb(el) });
        }
      } catch (_) {}
    }
  }

  // 4–6. @font-face font-display, fallback chain (walks stylesheets)
  const declaredFamilies = new Set();
  let noDisp = 0, noFallback = 0;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
    if (!rules) continue;
    const walk = (rs) => {
      for (const r of rs) {
        if (r.type === CSSRule.MEDIA_RULE) { walk(r.cssRules || []); continue; }
        if (r.type === CSSRule.FONT_FACE_RULE && r.style) {
          const fam = (r.style.fontFamily || '').replace(/['"]/g, '').trim();
          if (fam) declaredFamilies.add(fam);
          if (!r.style.fontDisplay && noDisp < 3) {
            noDisp++;
            out.push({ issueType:'noFontDisplay', severity:'medium', selector:`@font-face[${fam}]`,
              description:`@font-face "${fam}" missing font-display — causes invisible text during font load (FOIT). Add font-display: swap.` });
          }
        }
        if (r.type === CSSRule.STYLE_RULE && r.style && r.style.fontFamily && noFallback < 3) {
          const families = r.style.fontFamily.split(',').map(f => f.trim().replace(/['"]/g, ''));
          const last = families[families.length - 1].toLowerCase();
          if (!/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|emoji|math)$/.test(last) && families.length < 5) {
            noFallback++;
            out.push({ issueType:'noGenericFallback', severity:'low', selector:(r.selectorText || '').slice(0,100),
              description:`font-family "${r.style.fontFamily}" has no generic fallback (serif/sans-serif/monospace).` });
          }
        }
      }
    };
    walk(rules);
  }

  // 7. Font consistency on page
  const pageFamilies = new Set();
  for (const el of sample) {
    const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    if (f) pageFamilies.add(f);
  }
  if (pageFamilies.size > 3) {
    out.push({ issueType:'tooManyFontFamilies', severity:'low', selector:'body',
      description:`Page uses ${pageFamilies.size} font families: ${[...pageFamilies].slice(0,5).join(', ')}. Design systems typically use 2–3.` });
  }

  // 8. Real WCAG contrast ratio
  const lin = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  const lum = (r,g,b) => 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
  const parseRgb = s => { const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const effBg = el => {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      const rgb = parseRgb(cs.backgroundColor);
      const am = cs.backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
      const alpha = am ? parseFloat(am[1]) : 1;
      if (rgb && alpha > 0.5) return rgb;
      cur = cur.parentElement;
    }
    return [255, 255, 255];
  };
  let cFails = 0;
  for (const el of sample) {
    if (cFails >= 5) break;
    if (el.children.length > 0) continue;
    const txt = (el.innerText || '').trim();
    if (txt.length < 3) continue;
    const cs = getComputedStyle(el);
    const fg = parseRgb(cs.color);
    if (!fg) continue;
    const bg = effBg(el);
    const L1 = lum(...fg), L2 = lum(...bg);
    const ratio = (Math.max(L1,L2)+0.05) / (Math.min(L1,L2)+0.05);
    const fs = parseFloat(cs.fontSize) || 16;
    const bold = (parseInt(cs.fontWeight) || 400) >= 700;
    const isLarge = fs >= 24 || (fs >= 18.66 && bold);
    const min = isLarge ? 3.0 : 4.5;
    if (ratio < min) {
      cFails++;
      out.push({ issueType:'contrastFail', severity:'high', selector:sel(el),
        description:`WCAG contrast ${ratio.toFixed(2)}:1 < ${min}:1 for ${isLarge?'large':'normal'} text. color=${cs.color} bg=rgb(${bg.join(',')}).`, bbox:bb(el) });
    }
  }

  // 9. Heading hierarchy
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h => h.offsetParent !== null);
  const h1n = headings.filter(h => h.tagName === 'H1').length;
  if (h1n === 0 && headings.length > 0) {
    out.push({ issueType:'missingH1', severity:'medium', selector:'body',
      description:'Page has heading elements but no <h1> — every page should have one primary heading.' });
  } else if (h1n > 1) {
    out.push({ issueType:'multipleH1', severity:'medium', selector:'body',
      description:`Page has ${h1n} <h1> elements — should have exactly one primary heading.` });
  }
  let prev = 0, skips = 0;
  for (const h of headings) {
    const lvl = +h.tagName[1];
    if (prev > 0 && lvl > prev + 1 && skips < 3) {
      skips++;
      out.push({ issueType:'headingSkip', severity:'low', selector:sel(h),
        description:`Heading hierarchy skips H${prev} → H${lvl} (skipped H${prev+1}).`, bbox:bb(h) });
    }
    prev = lvl;
  }

  // 10. Link styling (text-decoration removal)
  let linkNo = 0;
  for (const a of document.querySelectorAll('p a, li a, td a, span a, div > a')) {
    if (linkNo >= 5) break;
    if (a.children.length > 0) continue;
    const t = (a.innerText || '').trim();
    if (t.length < 2) continue;
    const r = a.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(a);
    if (cs.textDecorationLine === 'none') {
      linkNo++;
      out.push({ issueType:'linkNoDecoration', severity:'medium', selector:sel(a),
        description:`Inline link "${t.slice(0,40)}" has text-decoration:none — indistinguishable from text by color alone (WCAG 1.4.1).`, bbox:bb(a) });
    }
  }

  // 11. font-size in px (walking stylesheets)
  let rootPx = false;
  for (const sheet of document.styleSheets) {
    if (rootPx) break;
    let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
    if (!rules) continue;
    for (const r of rules) {
      if (r.type !== CSSRule.STYLE_RULE || !r.selectorText || !r.style || !r.style.fontSize) continue;
      if (/^(html|:root|body)/.test(r.selectorText) && r.style.fontSize.endsWith('px')) { rootPx = true; break; }
    }
  }
  if (rootPx) {
    out.push({ issueType:'fontSizePxBased', severity:'medium', selector:'html / body',
      description:'Root font-size set in px — users who set a larger browser default font cannot scale (WCAG 1.4.4). Use rem/em or unset.' });
  }

  // 12. text-transform: uppercase on body copy
  let upper = 0;
  for (const el of document.querySelectorAll('p, li, td, blockquote, dd')) {
    if (upper >= 3) break;
    if (!el.innerText || el.innerText.length < 40) continue;
    if (getComputedStyle(el).textTransform === 'uppercase') {
      upper++;
      out.push({ issueType:'allCapsBodyCopy', severity:'low', selector:sel(el),
        description:`Long body text (${el.innerText.length} chars) is ALL-CAPS via text-transform — 10–20% harder to read.`, bbox:bb(el) });
    }
  }

  // 13. Italic-only emphasis
  let ital = 0;
  for (const em of document.querySelectorAll('em, i')) {
    if (ital >= 3) break;
    if (!em.innerText) continue;
    const cs = getComputedStyle(em);
    if (cs.fontStyle === 'italic' && (parseInt(cs.fontWeight) || 400) < 600) {
      ital++;
      out.push({ issueType:'italicOnlyEmphasis', severity:'low', selector:sel(em),
        description:'Emphasis uses italic only — some low-vision users can\'t perceive slant; combine with bold or color.', bbox:bb(em) });
    }
  }

  // 14. Unreadable text-shadow
  let shadow = 0;
  for (const el of sample) {
    if (shadow >= 3) break;
    const ts = getComputedStyle(el).textShadow;
    if (!ts || ts === 'none') continue;
    const m = ts.match(/(\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/);
    if (m && parseFloat(m[3]) > 4) {
      shadow++;
      out.push({ issueType:'unreadableTextShadow', severity:'medium', selector:sel(el),
        description:`Text shadow has blur ${m[3]}px (over 4px) — makes text fuzzy and hard to read.`, bbox:bb(el) });
    }
  }

  // 15. text-overflow:ellipsis without overflow:hidden
  let ell = 0;
  for (const el of document.querySelectorAll('[style*="ellipsis"], [class*="ellipsis"], [class*="truncate"]')) {
    if (ell >= 5) break;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' && cs.overflow !== 'hidden' && cs.overflowX !== 'hidden') {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        ell++;
        out.push({ issueType:'ellipsisNoOverflow', severity:'medium', selector:sel(el),
          description:'text-overflow:ellipsis set but overflow is not hidden — ellipsis won\'t appear; truncation silently broken.', bbox:bb(el) });
      }
    }
  }

  // 16. Tofu / missing glyph
  const tofu = /�|□{2,}/;
  let tofuN = 0;
  for (const el of document.querySelectorAll(TEXT_SEL)) {
    if (tofuN >= 3) break;
    if (el.children.length > 0) continue;
    if (el.innerText && tofu.test(el.innerText)) {
      tofuN++;
      out.push({ issueType:'tofuGlyph', severity:'high', selector:sel(el),
        description:`Element contains replacement glyph (□/�) — font doesn't support the character: "${el.innerText.slice(0,40)}"`, bbox:bb(el) });
    }
  }

  // 17. Empty text elements (heading/button/link with no accessible name)
  let emptyN = 0;
  for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6, button, [role="button"], a')) {
    if (emptyN >= 5) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const t = (el.innerText || '').trim();
    const al = el.getAttribute('aria-label');
    const ti = el.getAttribute('title');
    const imgAlt = el.querySelector('img[alt]:not([alt=""])');
    if (!t && !al && !ti && !imgAlt) {
      emptyN++;
      out.push({ issueType:'emptyTextElement', severity:'medium', selector:sel(el),
        description:`${el.tagName} has no text, no aria-label, no title, no labeled image — empty for users and screen readers.`, bbox:bb(el) });
    }
  }

  // 18. Extreme letter-spacing
  let lsN = 0;
  for (const el of document.querySelectorAll('p, li, span, h1, h2, h3')) {
    if (lsN >= 3) break;
    if (!el.innerText || el.innerText.length < 20) continue;
    const ls = parseFloat(getComputedStyle(el).letterSpacing);
    if (!isNaN(ls) && (ls < -0.5 || ls > 3)) {
      lsN++;
      out.push({ issueType:'extremeLetterSpacing', severity:'low', selector:sel(el),
        description:`letter-spacing ${ls}px is ${ls < 0 ? 'too tight' : 'too loose'} for body text — reduces readability.`, bbox:bb(el) });
    }
  }

  // 19. Font preload missing
  const preloaded = [...document.querySelectorAll('link[rel="preload"][as="font"]')].length;
  if (preloaded === 0 && declaredFamilies.size > 0) {
    out.push({ issueType:'noFontPreload', severity:'low', selector:'head',
      description:`${declaredFamilies.size} custom font(s) declared but none preloaded — add <link rel="preload" as="font" type="font/woff2" crossorigin> for above-the-fold fonts.` });
  }

  // 20. Mixed-content fonts (HTTPS page, HTTP @font-face src)
  if (location.protocol === 'https:') {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
      if (!rules) continue;
      for (const r of rules) {
        if (r.type === CSSRule.FONT_FACE_RULE && r.cssText && /url\(\s*['"]?http:\/\//i.test(r.cssText)) {
          out.push({ issueType:'mixedContentFont', severity:'high', selector:'@font-face',
            description:'Font URL uses http:// on an HTTPS page — browsers block mixed-content fonts.' });
          break;
        }
      }
    }
  }

  // 21. Vertical rhythm consistency
  const lhMap = new Map();
  for (const p of document.querySelectorAll('p')) {
    if (!p.innerText || p.innerText.length < 30) continue;
    const cs = getComputedStyle(p);
    const fs = parseFloat(cs.fontSize) || 16;
    const lh = parseFloat(cs.lineHeight);
    if (isNaN(lh)) continue;
    const r = (lh / fs).toFixed(1);
    lhMap.set(r, (lhMap.get(r) || 0) + 1);
  }
  if (lhMap.size > 3) {
    out.push({ issueType:'inconsistentRhythm', severity:'low', selector:'body',
      description:`Paragraphs use ${lhMap.size} different line-height ratios (${[...lhMap.keys()].join(', ')}) — vertical rhythm is inconsistent.` });
  }

  return out;
}
```

## Issue schema

All 21 issue types use the canonical Issue schema:
- `skill`: `qa-detect-typography-advanced`
- `issueType`: one of the 21 listed above
- `severity`: `high` | `medium` | `low` per the table
- `selector`: CSS selector or descriptor (e.g., `@font-face[Foo]`)
- `description`: human-readable explanation with concrete numbers
- `bbox`: present for element-bound findings; omitted for page-level findings

## Notes

- **No overlap with qa-detect-typography** — that skill covers size, line-height ratio, clipping, mobile heading, long-word breaking. This skill covers everything else.
- **All checks are mechanical** — no Sonnet judgment needed, runs in the existing Haiku batch.
- **Caps**: each issue type capped at 3–5 findings per cell to keep JSONL bounded.
- **Cross-origin stylesheets**: gracefully skipped via try/catch (no error, no false negative).
- **Read-only**: never mutates the DOM, never types or clicks, no cleanup needed.
