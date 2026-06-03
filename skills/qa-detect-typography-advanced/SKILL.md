---
name: qa-detect-typography-advanced
description: "Comprehensive font + typography quality check — 21 mechanical checks in one probe. Web font loading status, synthetic bold/italic, real WCAG contrast ratio, heading hierarchy, link styling, font consistency, tofu rendering, mixed-content fonts, and more. Complements qa-detect-typography (size/line-height)."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks (43 issue types in 5 categories — Font gap-fill 2026-06-03)

### Font loading & rendering (12)
- `webFontFailed` (high) — @font-face declared but the file failed to load
- `syntheticWeight` (medium for 700+/italic, low for 300/500/600) — browser is faking ANY weight or style because that face wasn't loaded
- `noFontDisplay` (medium) — @font-face missing `font-display: swap/fallback/optional` → causes FOIT
- `noGenericFallback` (low) — font-family with no `serif`/`sans-serif`/`monospace` at end of chain
- `tooManyFontFamilies` (low) — page uses >5 non-icon font-families (icon fonts auto-detected via unicode-range PUA U+E000–U+F8FF; no hardcoded name list)
- `mixedContentFont` (high) — HTTPS page loads HTTP font URL (browser blocks)
- `variableFontUnsupported` (low) — `font-variation-settings` declared on a font that isn't variable (settings have no effect)
- `variableFontOutOfRange` (medium) — requested axis value outside the variable font's actual range (browser clamps silently)
- `noOpticalSizing` (low) — body uses variable font but `font-optical-sizing` is not `auto` (loses size-appropriate rendering)
- `fontDisplayBlock` (medium) — `@font-face` sets `font-display: block` → text stays invisible until webfont loads (FOIT)
- `unusedFontWeight` (low) — `@font-face` declares a weight that no visible element uses (wasted payload, ~20-40 KB per face)
- `iconFontAsWebFont` (low) — Font Awesome / Material Icons / etc. loaded as webfont (antipattern — use inline SVG)
- `variableFontUnusedAxis` (low) — variable font loaded but no rule uses `font-variation-settings` (paying variable-font cost for static use)

### Accessibility (13)
- `contrastFail` (high) — real WCAG ratio < 4.5:1 (normal) or < 3:1 (large text) — uses proper luminance math
- `missingH1` (medium) — page has headings but no `<h1>`
- `multipleH1` (medium) — page has more than one `<h1>`
- `headingSkip` (low) — H2 → H4 (skipped H3) — now includes nearest landmark + heading text for actionability
- `linkNoDecoration` (medium) — inline link inside body text has `text-decoration: none` (WCAG 1.4.1)
- `fontSizePxBased` (medium) — root `font-size` declared in `px` instead of `rem` (WCAG 1.4.4)
- `allCapsBodyCopy` (low) — paragraph-length text with `text-transform: uppercase`
- `italicOnlyEmphasis` (low) — `<em>` with italic but no bold — low-vision users can't perceive slant alone
- `missingHtmlLang` (medium) — `<html>` missing `lang` attribute (breaks hyphenation, quote glyphs, screen-reader voice)
- `invalidHtmlLang` (low) — `<html lang="...">` value isn't a valid BCP 47 tag
- `deepHeadingHierarchy` (low) — page uses H5/H6 as document structure (sign of improvised hierarchy)
- `h2MissingInHierarchy` (low) — page jumps from H1 to H3+ with no H2 between (broken outline for SR users)
- `languageFontMismatch` (medium) — page contains Arabic/CJK/Cyrillic/etc. chars but no loaded font covers that unicode-range (root cause of tofu)

### Content quality (6)
- `tofuGlyph` (high) — visible `□` or `�` replacement characters (font missing glyph)
- `emptyTextElement` (medium) — heading/button/link with no text, no aria-label, no title
- `extremeLetterSpacing` (low) — `letter-spacing` < -0.5px or > 3px on body text
- `wallOfText` (medium) — content region > 1200 chars with too few structural breaks (~800+ chars per break)
- `unstyledPullQuote` (low) — `<blockquote>` renders identical to body copy (no border/italic/quote marks)
- `tooManyFontSizes` (low) — page uses >12 distinct font-sizes (consolidate into a coherent type scale)

### Performance (7)
- `noFontPreload` (low) — custom fonts used but no `<link rel="preload" as="font">`
- `corsFontPreloadMissing` (medium) — `<link rel="preload" as="font">` is missing the `crossorigin` attribute; browsers silently refuse the preload
- `unreadableTextShadow` (medium) — text-shadow with blur > 4px making text fuzzy
- `fontPayloadCount` (low) — page loads >4 font files (each blocks render)
- `fontPayloadHeavy` (medium) — total font payload >300 KB (blocks LCP / Web Vitals)
- `fallbackMetricMismatch` (low) — `@font-face` has no `size-adjust`/`ascent-override`/`descent-override` → layout shift on swap (hits CLS)
- `fontFileNotSubsetted` (low) — single font file >100 KB (full unicode-range loaded; subset to ~20-30 KB)

### Layout (5)
- `inconsistentRhythm` (low) — paragraphs use >3 different line-height ratios (vertical rhythm drift)
- `measureTooLong` (low) — paragraph width yields > 90 chars per line (readability sweet spot 45-75)
- `measureTooShort` (low) — paragraph width yields < 30 chars per line (eye flicks back too often)
- `baselineGridOff` (low) — computed line-height is not on a 4px baseline grid (vertical alignment drifts vs adjacent UI)
- `widowLine` (low) — paragraph ends with a single short word on its own line (typographic widow)

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

  // 2 & 3. Synthetic weight + style matrix — flag ANY missing weight/style
  // (was: only checked w >= 600; missed silent synthesis at 300/500/600)
  const seenSynth = new Set();
  for (const el of sample) {
    const cs = getComputedStyle(el);
    const family = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    if (!family) continue;
    const fs = parseFloat(cs.fontSize) || 16;
    const w = parseInt(cs.fontWeight) || 400;
    const style = cs.fontStyle;
    // Skip the default (weight 400, style normal) — always available
    if (w === 400 && style === 'normal') continue;
    const key = `${family}|${w}|${style}`;
    if (seenSynth.has(key)) continue;
    seenSynth.add(key);
    try {
      if (!document.fonts.check(`${style} ${w} ${fs}px "${family}"`)) {
        // Severity: 700+ and italic are visually obvious; 300/500/600 subtler but real
        const sev = (w >= 700 || style === 'italic') ? 'medium' : 'low';
        const styleLabel = style === 'italic' ? 'italic ' : '';
        out.push({
          issueType: 'syntheticWeight', severity: sev, selector: sel(el),
          description: `Browser synthesizing ${styleLabel}weight ${w} for "${family}" — not loaded. Render is interpolated/algorithmic, not the real face.`,
          bbox: bb(el)
        });
      }
    } catch (_) {}
  }

  // 4–6. @font-face font-display, fallback chain, icon-font detection (walks stylesheets)
  // Icon fonts declare unicode-range in PUA (U+E000-U+F8FF). Body fonts don't.
  // This structural signal replaces hardcoded name allow-lists ("Material Icons", "FontAwesome", ...).
  const declaredFamilies = new Set();
  const iconFamilies     = new Set();   // detected via unicode-range PUA signature
  const variableFonts    = new Map();   // family -> { wMin, wMax } from FontFace API later
  let noDisp = 0, noFallback = 0;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
    if (!rules) continue;
    const walk = (rs) => {
      for (const r of rs) {
        if (r.type === CSSRule.MEDIA_RULE) { walk(r.cssRules || []); continue; }
        if (r.type === CSSRule.FONT_FACE_RULE && r.style) {
          const fam = (r.style.fontFamily || '').replace(/['"]/g, '').trim();
          if (fam) {
            declaredFamilies.add(fam);
            // PUA detection: unicode-range covering U+E000-U+F8FF
            const range = (r.style.unicodeRange || '').toUpperCase();
            if (/U\+E[0-9A-F]{3}|U\+F[0-8][0-9A-F]{2}/.test(range)) {
              iconFamilies.add(fam.toLowerCase());
            }
          }
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

  // 7. Font consistency on page — exclude icon fonts via structural signal
  // (no hardcoded "Material Icons" list — uses unicodeRange PUA detection above)
  const pageFamilies = new Set();
  for (const el of sample) {
    const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    if (!f) continue;
    if (iconFamilies.has(f)) continue;   // skip detected icon fonts
    pageFamilies.add(f);
  }
  const MAX_TEXT_FAMILIES = 5;   // was 3 — too noisy for real apps (Material UI, Tailwind UI, etc.)
  if (pageFamilies.size > MAX_TEXT_FAMILIES) {
    out.push({ issueType:'tooManyFontFamilies', severity:'low', selector:'body',
      description:`Page uses ${pageFamilies.size} non-icon font families: ${[...pageFamilies].slice(0,5).join(', ')}. Most apps use 2-4 (icon fonts excluded via unicode-range PUA signature).` });
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
  let prevHText = '';
  for (const h of headings) {
    const lvl = +h.tagName[1];
    if (prev > 0 && lvl > prev + 1 && skips < 3) {
      skips++;
      // Find nearest landmark to make finding actionable
      const landmark = h.closest('main,section,article,aside,nav,header,footer,[role="region"],[role="main"]');
      const landmarkLabel = landmark ? (landmark.getAttribute('aria-label') || landmark.tagName.toLowerCase()) : 'page';
      const hText = (h.innerText || '').trim().slice(0, 40);
      out.push({
        issueType: 'headingSkip', severity: 'low', selector: sel(h),
        description: `Heading hierarchy skips H${prev} → H${lvl} (skipped H${prev+1}) in <${landmarkLabel}>. ` +
                     `Previous heading: "${prevHText.slice(0,40)}". Current heading: "${hText}".`,
        bbox: bb(h)
      });
    }
    prev = lvl;
    prevHText = (h.innerText || '').trim();
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

  // 19. Font preload missing AND CORS-missing on existing preloads
  const preloadLinks = [...document.querySelectorAll('link[rel="preload"][as="font"]')];
  if (preloadLinks.length === 0 && declaredFamilies.size > 0) {
    out.push({ issueType:'noFontPreload', severity:'low', selector:'head',
      description:`${declaredFamilies.size} custom font(s) declared but none preloaded — add <link rel="preload" as="font" type="font/woff2" crossorigin> for above-the-fold fonts.` });
  }
  // CORS-missing: browsers SILENTLY REFUSE the preloaded font without crossorigin attribute.
  // No console warning. Font appears "loaded" via the standard request, but the preload is wasted.
  let corsMissingN = 0;
  for (const link of preloadLinks) {
    if (corsMissingN >= 3) break;
    if (!link.hasAttribute('crossorigin')) {
      corsMissingN++;
      const href = (link.href || link.getAttribute('href') || '').split('/').pop().slice(0, 60);
      out.push({
        issueType: 'corsFontPreloadMissing', severity: 'medium', selector: 'link[rel="preload"][as="font"]',
        description: `Font preload <link href="...${href}"> is missing the crossorigin attribute. Browsers silently refuse the preloaded font — preload is wasted; font is re-fetched. Add crossorigin="anonymous".`
      });
    }
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

  // 22. Variable font validation — font-variation-settings vs FontFace weight range
  // FontFace.weight returns "100 900" (range) for variable, "400" (single) for static.
  try {
    for (const ff of document.fonts) {
      if (ff.weight && /^\s*\d+\s+\d+\s*$/.test(ff.weight)) {
        // Range format = variable font
        const [a, b] = ff.weight.trim().split(/\s+/).map(Number);
        variableFonts.set((ff.family || '').replace(/['"]/g, '').toLowerCase(), { wMin: Math.min(a,b), wMax: Math.max(a,b) });
      }
    }
  } catch (_) {}
  let varN = 0;
  for (const sheet of document.styleSheets) {
    if (varN >= 4) break;
    let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
    if (!rules) continue;
    const vwalk = (rs) => {
      for (const r of rs) {
        if (varN >= 4) return;
        if (r.type === CSSRule.MEDIA_RULE) { vwalk(r.cssRules || []); continue; }
        if (r.type !== CSSRule.STYLE_RULE || !r.style) continue;
        const fvs = r.style.fontVariationSettings;
        if (!fvs || fvs === 'normal') continue;
        const famFromRule = (r.style.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
        if (!famFromRule) continue;
        const vf = variableFonts.get(famFromRule);
        if (!vf) {
          varN++;
          out.push({
            issueType: 'variableFontUnsupported', severity: 'low',
            selector: (r.selectorText || '').slice(0, 100),
            description: `font-variation-settings "${fvs}" declared but "${famFromRule}" is not a variable font (FontFace.weight is not a range). Settings have no effect.`
          });
          continue;
        }
        // Check 'wght' axis specifically
        const wghtMatch = fvs.match(/['"]?wght['"]?\s+(\d+)/i);
        if (wghtMatch) {
          const requested = parseInt(wghtMatch[1]);
          if (requested < vf.wMin || requested > vf.wMax) {
            varN++;
            out.push({
              issueType: 'variableFontOutOfRange', severity: 'medium',
              selector: (r.selectorText || '').slice(0, 100),
              description: `font-variation-settings 'wght' ${requested} is outside "${famFromRule}"'s axis range [${vf.wMin}-${vf.wMax}] — browser clamps silently to ${requested < vf.wMin ? vf.wMin : vf.wMax}.`
            });
          }
        }
      }
    };
    vwalk(rules);
  }

  // 23. Font payload metrics — count + total bytes via Resource Timing API
  try {
    const resources = performance.getEntriesByType('resource');
    const fontRes = resources.filter(r => {
      const url = r.name || '';
      const type = (r.initiatorType || '').toLowerCase();
      return type === 'font' || /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(url);
    });
    const fontCount = fontRes.length;
    const fontBytes = fontRes.reduce((sum, r) => sum + (r.encodedBodySize || r.transferSize || 0), 0);
    const fontKB = Math.round(fontBytes / 1024);
    if (fontCount > 4) {
      out.push({
        issueType: 'fontPayloadCount', severity: 'low', selector: 'head',
        description: `Page loaded ${fontCount} font files (recommended ≤ 4). Each blocks render until font-display swap; consider subsetting or fewer faces.`
      });
    }
    if (fontKB > 300) {
      out.push({
        issueType: 'fontPayloadHeavy', severity: 'medium', selector: 'head',
        description: `Total font payload ${fontKB} KB across ${fontCount} files (recommended ≤ 300 KB). Blocks LCP; reduces Web Vitals score. Subset fonts or drop unused weights.`
      });
    }
  } catch (_) {}

  // 24. Measure (line length) — flag paragraphs whose effective character-per-line
  // is outside the readability range [45, 75]. Approximation: paragraph width ÷ (font-size × 0.5).
  // 0.5 is the standard avg-glyph-width factor used in print typography.
  let measureFlagged = 0;
  for (const para of document.querySelectorAll('p, li, blockquote')) {
    if (measureFlagged >= 5) break;
    const txt = (para.innerText || '').trim();
    if (txt.length < 60) continue;
    const rect = para.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 20) continue;
    const cs = getComputedStyle(para);
    const fs2 = parseFloat(cs.fontSize) || 16;
    const cpl = Math.round(rect.width / (fs2 * 0.5));
    if (cpl > 90 || cpl < 30) {
      measureFlagged++;
      out.push({
        issueType: cpl > 90 ? 'measureTooLong' : 'measureTooShort',
        severity: 'low', selector: sel(para), bbox: bb(para),
        description: `Measure (chars per line) ≈ ${cpl} — readability range is 45-75. ${cpl > 90 ? 'Too long: eye loses line at end' : 'Too short: rhythm broken, eye flicks back too often'}.`
      });
    }
  }

  // 25. Vertical-rhythm baseline-grid — line-height should land on an 8px (or 4px) baseline grid
  // to keep adjacent blocks aligned. Computed line-height that is not an integer multiple of 4 with
  // ≥10% rounding error is flagged.
  let rhythmFlagged = 0;
  for (const para of document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')) {
    if (rhythmFlagged >= 4) break;
    const cs = getComputedStyle(para);
    const lh = parseFloat(cs.lineHeight);
    if (isNaN(lh) || lh < 8) continue;
    const remainder = lh % 4;
    const drift = Math.min(remainder, 4 - remainder);
    if (drift > 0.4) { // > 10% off the 4px grid
      rhythmFlagged++;
      out.push({
        issueType: 'baselineGridOff', severity: 'low', selector: sel(para),
        description: `Computed line-height ${lh.toFixed(2)}px is off the 4px baseline grid by ${drift.toFixed(2)}px. Round to nearest multiple of 4 (or 8) for vertical alignment with adjacent UI.`
      });
    }
  }

  // 26. Paragraph density — large text regions with no <p>/<br>/<hr> breaks (wall of text).
  for (const region of document.querySelectorAll('article, main, section, .content, .post, [role="article"], [role="main"]')) {
    const txt = (region.innerText || '').trim();
    if (txt.length < 1200) continue;
    const breakCount = region.querySelectorAll('p, br, hr, h2, h3, h4, ul, ol, blockquote').length;
    const charsPerBreak = breakCount > 0 ? txt.length / breakCount : txt.length;
    if (charsPerBreak > 800) {
      out.push({
        issueType: 'wallOfText', severity: 'medium', selector: sel(region),
        description: `Content region has ${txt.length} chars but only ${breakCount} structural breaks (~${Math.round(charsPerBreak)} chars per break). Add paragraph breaks, subheadings, or bullet lists every ~300-500 chars.`
      });
      break; // one finding per cell is enough
    }
  }

  // 27. Widow detection — paragraph's last line has 1 word (a "widow").
  // Use getClientRects() — each rect is a visual line. If the last rect width < 25% of the
  // paragraph width AND the last word is < 12 chars, it's a widow.
  let widowFlagged = 0;
  for (const para of document.querySelectorAll('p')) {
    if (widowFlagged >= 4) break;
    const rects = para.getClientRects();
    if (rects.length < 2) continue;
    const last = rects[rects.length - 1];
    const first = rects[0];
    if (!last || !first) continue;
    if (last.width / first.width > 0.25) continue;
    const txt = (para.innerText || '').trim();
    const words = txt.split(/\s+/);
    const lastWord = words[words.length - 1] || '';
    if (lastWord.length === 0 || lastWord.length > 14) continue;
    widowFlagged++;
    out.push({
      issueType: 'widowLine', severity: 'low', selector: sel(para), bbox: bb(para),
      description: `Paragraph ends with a widow (single short word "${lastWord}" on the last line). Adjust copy or use \`text-wrap: pretty\` / non-breaking space.`
    });
  }

  // 28. Optical sizing — variable fonts gain readability from font-optical-sizing: auto.
  // If body uses a variable font but optical-sizing is "none" (or unset and computed to "none"),
  // emit a low-severity hint. Only flag once per page.
  try {
    let bodyVariableFont = null;
    for (const ff of document.fonts) {
      if (ff.weight && /^\s*\d+\s+\d+\s*$/.test(ff.weight)) {
        const fam = (ff.family || '').replace(/['"]/g, '').toLowerCase();
        const bodyFamily = (getComputedStyle(document.body).fontFamily || '').toLowerCase();
        if (bodyFamily.includes(fam)) { bodyVariableFont = fam; break; }
      }
    }
    if (bodyVariableFont) {
      const bodyOS = getComputedStyle(document.body).fontOpticalSizing;
      if (bodyOS && bodyOS !== 'auto') {
        out.push({
          issueType: 'noOpticalSizing', severity: 'low', selector: 'body',
          description: `Body uses variable font "${bodyVariableFont}" but font-optical-sizing is "${bodyOS}". Set \`font-optical-sizing: auto\` for crisper rendering across sizes.`
        });
      }
    }
  } catch (_) {}

  // 29. Drop-cap / pull-quote rendering — <blockquote> with no visual distinction from body
  // (same font-size, no border, no italic, no quote marks) reads as plain paragraph.
  let quoteFlagged = 0;
  for (const bq of document.querySelectorAll('blockquote, q, .pullquote, .pull-quote, [role="blockquote"]')) {
    if (quoteFlagged >= 3) break;
    if (!bq.innerText || bq.innerText.trim().length < 30) continue;
    const cs = getComputedStyle(bq);
    const fs2 = parseFloat(cs.fontSize) || 16;
    const bodyFs = parseFloat(getComputedStyle(document.body).fontSize) || 16;
    const hasBorder = cs.borderLeftWidth && parseFloat(cs.borderLeftWidth) > 1;
    const isItalic = (cs.fontStyle || '').includes('italic');
    const hasMargin = parseFloat(cs.marginLeft) > 8 || parseFloat(cs.paddingLeft) > 8;
    const sizeDiff = Math.abs(fs2 - bodyFs) > 1;
    const hasQuoteContent = (cs.content || '').includes('"') || (cs.content || '').includes("'");
    const distinct = hasBorder || isItalic || hasMargin || sizeDiff || hasQuoteContent;
    if (!distinct) {
      quoteFlagged++;
      out.push({
        issueType: 'unstyledPullQuote', severity: 'low', selector: sel(bq), bbox: bb(bq),
        description: `<${bq.tagName.toLowerCase()}> renders identical to body copy (same size ${fs2}px, no border/italic/indent/quote marks). Reader cannot perceive it as a quotation.`
      });
    }
  }

  // 30. <html lang> presence — browser hyphenation, quote orientation, and SR voice all depend on it.
  const htmlLang = document.documentElement.getAttribute('lang');
  if (!htmlLang || !htmlLang.trim()) {
    out.push({
      issueType: 'missingHtmlLang', severity: 'medium', selector: 'html',
      description: 'Missing <html lang="..."> attribute. Browsers cannot pick the right hyphenation rules, quote glyphs, or screen-reader voice. Add the page language (e.g. lang="en").'
    });
  } else if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(htmlLang.trim())) {
    out.push({
      issueType: 'invalidHtmlLang', severity: 'low', selector: 'html',
      description: `<html lang="${htmlLang}"> is not a valid BCP 47 language tag. Use a form like "en", "en-US", "ar-AE".`
    });
  }

  // 31. Heading-hierarchy depth + structure audit.
  // Two checks: (a) any heading deeper than H4 used as actual document structure (not just styling)
  //             (b) heading tree without an H2 between H1 and H3+ (signals improvised hierarchy)
  const allHeadings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter(h => h.innerText && h.innerText.trim() && getComputedStyle(h).display !== 'none');
  if (allHeadings.length >= 3) {
    const levels = allHeadings.map(h => parseInt(h.tagName.slice(1), 10));
    const maxDepth = Math.max(...levels);
    const hasH1 = levels.includes(1);
    const hasH2 = levels.includes(2);
    if (maxDepth >= 5) {
      out.push({
        issueType: 'deepHeadingHierarchy', severity: 'low', selector: 'body',
        description: `Page uses H${maxDepth} (${levels.filter(l => l === maxDepth).length}×). 5+ levels of structural heading usually means design-only headings — switch to <p class="h-...">/aria-level=N or restructure.`
      });
    }
    if (hasH1 && !hasH2 && levels.some(l => l >= 3)) {
      out.push({
        issueType: 'h2MissingInHierarchy', severity: 'low', selector: 'body',
        description: `Heading tree has H1 and H${Math.min(...levels.filter(l => l >= 3))}+ but no H2. Screen-reader users get a broken outline. Insert H2 section headings before H3+.`
      });
    }
  }

  // 32. font-display: block (FOIT cause) — text is invisible until font loads.
  // noFontDisplay catches missing declarations; this catches explicit "block".
  try {
    let blockFontFlagged = 0;
    for (const sheet of document.styleSheets) {
      if (blockFontFlagged >= 4) break;
      let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
      if (!rules) continue;
      const walkBlock = (rs) => {
        for (const r of rs) {
          if (blockFontFlagged >= 4) return;
          if (r.type === CSSRule.MEDIA_RULE) { walkBlock(r.cssRules || []); continue; }
          if (r.type !== CSSRule.FONT_FACE_RULE) continue;
          const fd = (r.style && r.style.fontDisplay) || '';
          if (fd.trim().toLowerCase() === 'block') {
            const fam = (r.style.fontFamily || 'unknown').replace(/['"]/g, '');
            blockFontFlagged++;
            out.push({
              issueType: 'fontDisplayBlock', severity: 'medium',
              selector: `@font-face[${fam}]`,
              description: `Font "${fam}" uses font-display: block — text stays INVISIBLE until the webfont loads (FOIT). Use "swap" for text-first or "optional" for performance-first.`
            });
          }
        }
      };
      walkBlock(rules);
    }
  } catch (_) {}

  // 33. Unused declared weights — @font-face declares weight that page never uses.
  // Wastes payload. Cross-references all loaded @font-face weights against actual
  // computed font-weights observed on visible text elements.
  try {
    const declaredWeights = new Map(); // family -> Set of weights
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
      if (!rules) continue;
      const walkFF = (rs) => {
        for (const r of rs) {
          if (r.type === CSSRule.MEDIA_RULE) { walkFF(r.cssRules || []); continue; }
          if (r.type !== CSSRule.FONT_FACE_RULE) continue;
          const fam = (r.style.fontFamily || '').replace(/['"]/g, '').toLowerCase().trim();
          const w   = (r.style.fontWeight || '400').trim();
          if (!fam) continue;
          // Skip variable fonts (weight is a range)
          if (/^\s*\d+\s+\d+\s*$/.test(w)) continue;
          if (!declaredWeights.has(fam)) declaredWeights.set(fam, new Set());
          declaredWeights.get(fam).add(w);
        }
      };
      walkFF(rules);
    }
    const usedWeights = new Map(); // family -> Set of weights
    const sampleTextEls = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, a, button, td, th, label');
    let scanned = 0;
    for (const el of sampleTextEls) {
      if (scanned >= 300) break;
      if (!el.innerText || el.innerText.trim().length < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const fam = (cs.fontFamily || '').split(',')[0].replace(/['"]/g, '').toLowerCase().trim();
      const w   = cs.fontWeight || '400';
      if (!fam) continue;
      if (!usedWeights.has(fam)) usedWeights.set(fam, new Set());
      usedWeights.get(fam).add(w);
      scanned++;
    }
    let unusedFlagged = 0;
    for (const [fam, declared] of declaredWeights) {
      if (unusedFlagged >= 4) break;
      const used = usedWeights.get(fam) || new Set();
      for (const w of declared) {
        if (used.has(w)) continue;
        unusedFlagged++;
        out.push({
          issueType: 'unusedFontWeight', severity: 'low',
          selector: `@font-face[${fam}]`,
          description: `Font "${fam}" weight ${w} is loaded but never used on visible text. Remove the weight from @font-face to cut payload (~20-40KB per face).`
        });
        if (unusedFlagged >= 4) break;
      }
    }
  } catch (_) {}

  // 34. Icon font as web font — Font Awesome / Material Icons / Glyphicons etc.
  // are best replaced by inline SVG (lighter, accessible, no FOUT).
  // Detect by: (a) family name match, (b) unicode-range entirely in PUA U+E000-F8FF.
  try {
    const ICON_FONT_PATTERNS = /(font.?awesome|material.?icons?|glyphicons|bootstrap.?icons|feather|octicons|ionicons|fontello|streamline|tabler)/i;
    let iconFlagged = 0;
    const seenIcon = new Set();
    for (const ff of document.fonts) {
      if (iconFlagged >= 3) break;
      const fam = (ff.family || '').replace(/['"]/g, '');
      if (!fam || seenIcon.has(fam.toLowerCase())) continue;
      let isIcon = false;
      let reason = '';
      if (ICON_FONT_PATTERNS.test(fam)) { isIcon = true; reason = 'name matches known icon-font family'; }
      else {
        const ur = (ff.unicodeRange || '').toUpperCase();
        // PUA range U+E000-F8FF is the icon-font heartland
        if (/U\+E[0-9A-F]{3}|U\+F[0-7][0-9A-F]{2}|U\+F8[0-9A-F]{2}/.test(ur)) {
          isIcon = true; reason = `unicode-range ${ur.slice(0, 40)} sits in PUA (icon-font convention)`;
        }
      }
      if (isIcon) {
        seenIcon.add(fam.toLowerCase());
        iconFlagged++;
        out.push({
          issueType: 'iconFontAsWebFont', severity: 'low',
          selector: `@font-face[${fam}]`,
          description: `Font "${fam}" appears to be an icon font (${reason}). Best practice: replace with inline SVG icons (lighter, accessible, no FOUT, color-controllable).`
        });
      }
    }
  } catch (_) {}

  // 35. Fallback metric mismatch — no size-adjust / ascent-override / descent-override
  // on a webfont causes a visible layout SHIFT when the font loads (CLS hit).
  // Modern best practice: set these CSS Font Metric Override props to match
  // fallback metrics to the webfont so the swap is invisible.
  try {
    let fallbackFlagged = 0;
    for (const sheet of document.styleSheets) {
      if (fallbackFlagged >= 4) break;
      let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
      if (!rules) continue;
      const walkFM = (rs) => {
        for (const r of rs) {
          if (fallbackFlagged >= 4) return;
          if (r.type === CSSRule.MEDIA_RULE) { walkFM(r.cssRules || []); continue; }
          if (r.type !== CSSRule.FONT_FACE_RULE) continue;
          const st = r.style;
          if (!st) continue;
          // Skip fonts that explicitly opt out (font-display: optional won't cause CLS)
          const fd = (st.fontDisplay || '').toLowerCase();
          if (fd === 'optional') continue;
          const hasOverride = (st.sizeAdjust && st.sizeAdjust !== 'normal') ||
                              (st.ascentOverride && st.ascentOverride !== 'normal') ||
                              (st.descentOverride && st.descentOverride !== 'normal') ||
                              (st.lineGapOverride && st.lineGapOverride !== 'normal');
          if (hasOverride) continue;
          const fam = (st.fontFamily || 'unknown').replace(/['"]/g, '');
          fallbackFlagged++;
          out.push({
            issueType: 'fallbackMetricMismatch', severity: 'low',
            selector: `@font-face[${fam}]`,
            description: `@font-face "${fam}" has no size-adjust / ascent-override / descent-override. Fallback font's metrics differ → layout shift when webfont loads (hits CLS). Use a tool like Fontaine or @font-face metric-override to match.`
          });
        }
      };
      walkFM(rules);
    }
  } catch (_) {}

  // 36. Too many font sizes — design-system consistency. Pages with 12+ distinct
  // font-sizes in visible text usually have ad-hoc styling instead of a scale.
  try {
    const sizeSet = new Set();
    let sampled = 0;
    for (const el of document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, a, button, td, th, label, div')) {
      if (sampled >= 500) break;
      if (!el.innerText || el.innerText.trim().length < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const fs2 = parseFloat(cs.fontSize);
      if (isNaN(fs2)) continue;
      // Round to 0.5px to avoid sub-pixel noise
      sizeSet.add((Math.round(fs2 * 2) / 2).toFixed(1));
      sampled++;
    }
    if (sizeSet.size > 12) {
      out.push({
        issueType: 'tooManyFontSizes', severity: 'low', selector: 'body',
        description: `Page uses ${sizeSet.size} distinct font-sizes (recommended ≤ 8 for a coherent type scale). Sizes: ${[...sizeSet].sort((a,b)=>parseFloat(a)-parseFloat(b)).slice(0, 12).join(', ')}${sizeSet.size > 12 ? '…' : ''}. Consolidate into a design-system scale.`
      });
    }
  } catch (_) {}

  // 37. Variable font loaded but axes never exercised. variableFonts (Map) was
  // built in check 22; usedWeights (Map) was built in check 33. Cross-reference:
  // any variable font whose only used weight matches its static default is wasted.
  try {
    let unusedAxisFlagged = 0;
    for (const [fam, range] of variableFonts) {
      if (unusedAxisFlagged >= 3) break;
      // Look for any style rule with font-variation-settings on this family
      let usesAxis = false;
      for (const sheet of document.styleSheets) {
        if (usesAxis) break;
        let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
        if (!rules) continue;
        const walkVS = (rs) => {
          for (const r of rs) {
            if (usesAxis) return;
            if (r.type === CSSRule.MEDIA_RULE) { walkVS(r.cssRules || []); continue; }
            if (r.type !== CSSRule.STYLE_RULE || !r.style) continue;
            const fvs = (r.style.fontVariationSettings || '').trim();
            if (!fvs || fvs === 'normal') continue;
            const famFromRule = (r.style.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
            if (famFromRule === fam) { usesAxis = true; return; }
          }
        };
        walkVS(rules);
      }
      if (!usesAxis) {
        unusedAxisFlagged++;
        out.push({
          issueType: 'variableFontUnusedAxis', severity: 'low',
          selector: `@font-face[${fam}]`,
          description: `Variable font "${fam}" is loaded with weight range [${range.wMin}-${range.wMax}] but no rule uses font-variation-settings to exercise an axis. You are paying the variable-font cost (~50% larger file) for static-font use. Either drop the variable variant or add font-variation-settings.`
        });
      }
    }
  } catch (_) {}

  // 38. Language vs font coverage — page text contains characters outside the
  // loaded fonts' unicode-range coverage. Root cause of tofuGlyph at scale.
  try {
    // Detect scripts present in the page body
    const SCRIPT_RANGES = [
      { name: 'Arabic',     re: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/ },
      { name: 'Hebrew',     re: /[\u0590-\u05FF]/ },
      { name: 'Cyrillic',   re: /[\u0400-\u04FF]/ },
      { name: 'Greek',      re: /[\u0370-\u03FF]/ },
      { name: 'Devanagari', re: /[\u0900-\u097F]/ },
      { name: 'CJK',        re: /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/ },
      { name: 'Thai',       re: /[\u0E00-\u0E7F]/ }
    ];
    const bodyText = (document.body.innerText || '').slice(0, 5000);
    const detectedScripts = SCRIPT_RANGES.filter(s => s.re.test(bodyText));

    if (detectedScripts.length > 0) {
      // Build coverage map from @font-face unicode-range
      const coveredScripts = new Set();
      // Latin is assumed covered by the default browser fallback so always add it
      coveredScripts.add('Latin');
      for (const ff of document.fonts) {
        const ur = ff.unicodeRange || '';
        // U+0-10FFFF means "all"
        if (/U\+0-10FFFF|U\+0-1?0?ffff/i.test(ur) || ur === '') {
          for (const s of detectedScripts) coveredScripts.add(s.name);
          break;
        }
        // Heuristic: detect by range
        if (/U\+0[678][0-9A-F]{2}|U\+0[678][0-9A-F]{3}/i.test(ur)) coveredScripts.add('Arabic');
        if (/U\+05[8-9A-F][0-9A-F]/i.test(ur)) coveredScripts.add('Hebrew');
        if (/U\+04[0-9A-F]{2}/i.test(ur)) coveredScripts.add('Cyrillic');
        if (/U\+03[7-9A-F][0-9A-F]/i.test(ur)) coveredScripts.add('Greek');
        if (/U\+09[0-7][0-9A-F]/i.test(ur)) coveredScripts.add('Devanagari');
        if (/U\+4E00|U\+9F[0-9A-F]{2}|U\+30[4-9A-F]{2}/i.test(ur)) coveredScripts.add('CJK');
        if (/U\+0E[0-7][0-9A-F]/i.test(ur)) coveredScripts.add('Thai');
      }
      let langFlagged = 0;
      for (const s of detectedScripts) {
        if (langFlagged >= 3) break;
        if (!coveredScripts.has(s.name)) {
          langFlagged++;
          out.push({
            issueType: 'languageFontMismatch', severity: 'medium',
            selector: 'body',
            description: `Page contains ${s.name} characters but no loaded @font-face declares a unicode-range covering them. Browser falls back to system font for that script → mixed typography or tofu glyphs. Load a font that includes ${s.name} unicode-range.`
          });
        }
      }
    }
  } catch (_) {}

  // 39. Font not subsetted — large font file (> 100KB) loading the full
  // unicode-range. Each large font blocks render. Recommend subsetting via
  // Glyphhanger or Google Fonts &text= parameter.
  try {
    const resources = performance.getEntriesByType('resource');
    const fontRes = resources.filter(r => {
      const url = r.name || '';
      const type = (r.initiatorType || '').toLowerCase();
      return type === 'font' || /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(url);
    });
    let bigFontFlagged = 0;
    for (const r of fontRes) {
      if (bigFontFlagged >= 3) break;
      const kb = Math.round((r.encodedBodySize || r.transferSize || 0) / 1024);
      if (kb < 100) continue;
      const fname = (r.name || '').split('/').pop().split('?')[0];
      bigFontFlagged++;
      out.push({
        issueType: 'fontFileNotSubsetted', severity: 'low', selector: 'head',
        description: `Font file "${fname}" is ${kb} KB. Files this large usually contain the full unicode-range (Latin + Cyrillic + Greek + symbols, ~3000 glyphs). Subset to just the characters your page uses (typically ~250 glyphs = ~20-30 KB).`
      });
    }
  } catch (_) {}


  return out;
}
```

## Issue schema

All 43 issue types use the canonical Issue schema:
- `skill`: `qa-detect-typography-advanced`
- `issueType`: one of the 43 listed above
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
