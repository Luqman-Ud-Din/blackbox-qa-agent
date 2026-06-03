---
name: qa-form-structure
description: "Consolidated form structure skill. Owns submit-button presence, input touch-target height on mobile/tablet, full-width form fields on mobile, and structural form HTML. Replaces structural portion of qa-detect-forms."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
interactive: false
cacheVersion: "1.0.0"
ownership: "exclusive: any structural finding (form/submit/fieldset/input dimensions) belongs to this skill"
replaces:
  - "portions of qa-detect-forms (formNoSubmit, inputHeightTooSmall, formFieldNotFullWidth)"
---

# qa-form-structure — Consolidated Form Structure Skill

Single skill owning structural form HTML and physical input dimensions. Separates from accessibility (qa-form-a11y) and content (qa-form-validation). Pure passive — no interaction.

## What it checks (3 issue types)

| issueType | severity | catches |
|---|---|---|
| `formNoSubmit` | medium | Form has no visible submit button (no `button[type="submit"]`, `input[type="submit"]`, or `button:not([type])`) |
| `inputHeightTooSmall` | medium | On mobile/tablet (vw ≤ 1024), input rendered height < 44px (below touch-target minimum) |
| `formFieldNotFullWidth` | medium | On mobile (vw ≤ 768), form input rendered < 70% of parent width AND < 300px wide |

## Self-skip
If no `<form>` elements visible → return `[]`.

## Probe (browser_evaluate)
```js
() => {
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const skipTypes = new Set(['hidden','submit','reset','button','image','checkbox','radio']);
  const vw = innerWidth;
  const isMobile = vw <= 768;
  const isMobileOrTablet = vw <= 1024;

  // 1. formNoSubmit
  for (const form of document.querySelectorAll('form')) {
    if (out.length >= 6) break;
    const r = form.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type]), [role="button"]');
    if (!submit) {
      const sel = `form${form.id ? `#${form.id}` : ''}`;
      out.push({ issueType: 'formNoSubmit', severity: 'medium', selector: sel,
        description: 'Form has no visible submit button', bbox: bb(form) });
    }
  }

  // 2. inputHeightTooSmall + 3. formFieldNotFullWidth (per-input)
  if (!isMobileOrTablet && !isMobile) return out;  // skip if desktop-only

  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (out.length >= 24) break;
    if (el.type && skipTypes.has(el.type)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const sel = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.name ? `[name="${el.name}"]` : ''}`;

    // inputHeightTooSmall — mobile/tablet only
    if (isMobileOrTablet && r.height < 44) {
      out.push({ issueType: 'inputHeightTooSmall', severity: 'medium', selector: sel,
        description: `Input height ${Math.round(r.height)}px is below 44px touch-target minimum (viewport=${vw}px)`,
        bbox: bb(el) });
    }

    // formFieldNotFullWidth — mobile only
    if (isMobile) {
      const parent = el.closest('.form-group, .field, .form-field, fieldset, form > div, form');
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (pr.width > 0) {
          const widthRatio = r.width / pr.width;
          if (widthRatio < 0.7 && r.width < 300) {
            out.push({ issueType: 'formFieldNotFullWidth', severity: 'medium', selector: sel,
              description: `Form field ${Math.round(r.width)}px is only ${Math.round(widthRatio*100)}% of parent (${Math.round(pr.width)}px) on mobile — should be full-width`,
              bbox: bb(el) });
          }
        }
      }
    }
  }

  return out;
}
```

## Migration

`qa-detect-forms` is the only skill being PARTIALLY replaced — the structural checks move here, the a11y checks (`fieldWithoutLabel`, `passwordNoToggle`) move to `qa-form-a11y`. After cutover, `qa-detect-forms` itself is disabled.

```toml
[detectors]
qa-form-structure  = true   # NEW (formNoSubmit + inputHeightTooSmall + formFieldNotFullWidth)
qa-form-a11y       = true   # NEW (fieldWithoutLabel + passwordNoToggle + 4 more)
qa-detect-forms    = false  # REPLACED entirely (split between qa-form-structure and qa-form-a11y)
```

## Notes
- This skill is INTENTIONALLY small (3 issue types). Form structure is a small ownership boundary.
- Future structural checks (e.g., `formInScrollContainer`, `inputOverlappingLabel`, `inlineFormBreaksOnMobile`) belong here.
- `viewportSensitive: true` — runs per viewport because findings depend on `innerWidth`.
