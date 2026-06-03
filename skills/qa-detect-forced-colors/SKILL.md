---
name: qa-detect-forced-colors
description: "WCAG 1.4.11 — detects elements that rely solely on background color or images for distinction. Fail Windows High Contrast Mode (forced-colors: active)"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
---

## What it checks

WCAG 1.4.11 (Non-text Contrast): icons and interactive controls must remain distinguishable when Windows High Contrast Mode strips the page's colors. Common failures:
- SVG icons with hardcoded `fill="#XXX"` — disappear in forced colors mode
- Buttons distinguished only by background-color — become invisible
- Borderless inputs — vanish entirely
- No `@media (forced-colors: active)` overrides in stylesheets

## Probe (browser_evaluate)

```js
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    return (el.tagName.toLowerCase() + id).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];

  // 1. Check whether any forced-colors media query exists
  let hasForcedColorsMedia = false;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (_) { continue; }
    if (!rules) continue;
    const walk = (rs) => {
      for (const r of rs) {
        if (r.type === CSSRule.MEDIA_RULE) {
          if (/forced-colors\s*:\s*active/i.test(r.conditionText || '')) hasForcedColorsMedia = true;
          walk(r.cssRules || []);
        }
      }
    };
    walk(rules);
  }

  if (!hasForcedColorsMedia) {
    out.push({
      issueType: 'noForcedColorsSupport',
      severity: 'medium',
      selector: 'stylesheet',
      description: 'No @media (forced-colors: active) media query in stylesheets — page has not been adapted for Windows High Contrast Mode (WCAG 1.4.11)',
      bbox: { x: 0, y: 0, w: 200, h: 60 }
    });
  }

  // 2. Inline SVG icons with hardcoded fill/stroke that aren't CSS-driven
  let svgIconBugs = 0;
  for (const svg of document.querySelectorAll('svg[class*="icon"], svg[width]:not([width="0"])')) {
    if (svgIconBugs >= 3) break;
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.width > 80) continue;  // not an icon
    const hardcodedFill = [...svg.querySelectorAll('[fill]:not([fill="currentColor"]):not([fill="none"]):not([fill="transparent"])')].length;
    if (hardcodedFill > 0) {
      svgIconBugs++;
      if (out.length < 12) {
        out.push({
          issueType: 'svgHardcodedColor',
          severity: 'low',
          selector: sel(svg),
          description: `Icon SVG ${sel(svg)} has ${hardcodedFill} hardcoded fill/stroke values — will disappear in Windows High Contrast Mode. Use fill="currentColor" instead.`,
          bbox: bb(svg)
        });
      }
    }
  }

  // 3. Buttons distinguished only by background-color (no border)
  let buttonBgOnlyCount = 0;
  for (const btn of document.querySelectorAll('button, [role="button"]')) {
    if (buttonBgOnlyCount >= 3) break;
    const r = btn.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(btn);
    const hasNoBorder = style.borderWidth === '0px' || style.borderStyle === 'none';
    const bgIsColored = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                        style.backgroundColor !== 'transparent';
    if (hasNoBorder && bgIsColored) {
      buttonBgOnlyCount++;
      if (out.length < 16) {
        out.push({
          issueType: 'buttonBorderlessWithBg',
          severity: 'low',
          selector: sel(btn),
          description: `Button ${sel(btn)} is borderless with background ${style.backgroundColor} — in forced-colors mode the background is stripped, button becomes invisible. Add a border or outline.`,
          bbox: bb(btn)
        });
      }
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| noForcedColorsSupport | medium | "No @media (forced-colors: active) — WCAG 1.4.11 not addressed" |
| svgHardcodedColor | low | "Icon SVG has hardcoded fill — will disappear in High Contrast Mode" |
| buttonBorderlessWithBg | low | "Borderless button relies on background color only — invisible in forced-colors mode" |
