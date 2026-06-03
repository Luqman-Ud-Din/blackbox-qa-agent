---
name: qa-detect-forms
description: "Detects unlabelled fields, password fields without show/hide toggle, forms without submit, narrow form fields on mobile, and tiny input height"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
---

## What it checks
- `fieldWithoutLabel` — input/textarea/select with no label/aria/title/placeholder
- `passwordNoToggle` — password input without a show/hide toggle nearby
- `formNoSubmit` — form without any visible submit button
- `formFieldNotFullWidth` — on mobile (≤768px viewport), form input rendered <70% of parent width AND <300px wide
- `inputHeightTooSmall` — on mobile/tablet (≤1024px viewport), input height <44px (below touch target minimum)

## Probe (browser_evaluate)
```js
() => {
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const skipTypes = new Set(['hidden','submit','reset','button','image','checkbox','radio']);
  const vw = innerWidth;
  const isMobile = vw <= 768;
  const isMobileOrTablet = vw <= 1024;

  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (out.length >= 20) break;
    if (el.type && skipTypes.has(el.type)) continue;
    const sel = `${el.tagName.toLowerCase()}${el.id?`#${el.id}`:''}${el.name?`[name="${el.name}"]`:''}`;

    // 1. fieldWithoutLabel
    const labelled = (el.labels && el.labels.length > 0) || el.hasAttribute('aria-label') ||
      el.hasAttribute('aria-labelledby') || el.title || el.placeholder;
    if (!labelled) {
      out.push({ issueType:'fieldWithoutLabel', severity:'high', selector:sel,
        description:'Form field has no label, aria-label, aria-labelledby, title, or placeholder', bbox: bb(el) });
    }

    // 2. passwordNoToggle
    if (el.type === 'password') {
      const parent = el.closest('div, fieldset, form');
      const toggle = parent && parent.querySelector('[aria-label*="show" i], [aria-label*="hide" i], [data-testid*="toggle"]');
      if (!toggle) {
        out.push({ issueType:'passwordNoToggle', severity:'medium', selector:sel,
          description:'Password field has no show/hide toggle button', bbox: bb(el) });
      }
    }

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // 3. inputHeightTooSmall — only on mobile/tablet
    if (isMobileOrTablet && r.height < 44) {
      out.push({ issueType:'inputHeightTooSmall', severity:'medium', selector:sel,
        description:`Input height ${Math.round(r.height)}px is below 44px touch-target minimum (viewport=${vw}px)`, bbox: bb(el) });
    }

    // 4. formFieldNotFullWidth — only on mobile
    if (isMobile) {
      const parent = el.closest('.form-group, .field, .form-field, fieldset, form > div, form');
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (pr.width > 0) {
          const widthRatio = r.width / pr.width;
          if (widthRatio < 0.7 && r.width < 300) {
            out.push({ issueType:'formFieldNotFullWidth', severity:'medium', selector:sel,
              description:`Form field ${Math.round(r.width)}px is only ${Math.round(widthRatio*100)}% of parent (${Math.round(pr.width)}px) on mobile — should be full-width`, bbox: bb(el) });
          }
        }
      }
    }
  }

  // 5. formNoSubmit
  for (const form of document.querySelectorAll('form')) {
    if (out.length >= 20) break;
    const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type]), [role="button"]');
    if (!submit) {
      const sel = `form${form.id?`#${form.id}`:''}`;
      out.push({ issueType:'formNoSubmit', severity:'medium', selector:sel,
        description:'Form has no visible submit button', bbox: bb(form) });
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| fieldWithoutLabel | high | "Form field has no label, aria-label, aria-labelledby, title, or placeholder" |
| passwordNoToggle | medium | "Password field has no show/hide toggle button" |
| formNoSubmit | medium | "Form has no visible submit button" |
| inputHeightTooSmall | medium | "Input height {h}px below 44px touch-target minimum" |
| formFieldNotFullWidth | medium | "Form field {pct}% of parent width on mobile — should be full-width" |
