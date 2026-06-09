---
name: qa-form-a11y
section: interactive
description: "Consolidated form accessibility skill. Owns labels, aria, fieldset legend, error announcement, required-field indication, focus order, password show/hide. Replaces qa-detect-form-a11y plus a11y-portions of qa-detect-forms."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: false
cacheVersion: "1.0.0"
ownership: "exclusive: any accessibility finding on a form input/label/error/fieldset belongs to this skill"
replaces:
  - qa-detect-form-a11y
  - "portions of qa-detect-forms (fieldWithoutLabel, passwordNoToggle)"
---

# qa-form-a11y — Consolidated Form Accessibility Skill

Single skill owning ALL form-related accessibility findings. No other skill emits a11y findings on form elements.

## What it checks (6 issue types)

| issueType | severity | catches |
|---|---|---|
| `fieldWithoutLabel` | high | Input/textarea/select with no label, aria-label, aria-labelledby, title, or placeholder |
| `errorNotAnnounced` | high | Error container missing `role="alert"` or `aria-live` — screen readers don't announce |
| `requiredNotIndicated` | medium | Required field with no visible asterisk AND no `aria-required="true"` |
| `fieldsetNoLegend` | medium | `<fieldset>` without `<legend>` — radio/checkbox group label invisible |
| `focusOrderMismatch` | medium | Tab focus order does not match visual top-to-bottom order |
| `passwordNoToggle` | medium | Password field has no show/hide toggle nearby |

## Self-skip
Single passive `browser_evaluate`. Returns `[]` if no forms / inputs / errors found.

## Probe (browser_evaluate)
```js
() => {
  const sel = el => (el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')).slice(0,120);
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];
  const skipTypes = new Set(['hidden','submit','reset','button','image','checkbox','radio']);

  // Detect floating/contextual labels used by UI component libraries.
  // These libraries position a <label> visually inside the input (looks like placeholder),
  // which floats up on focus. The label IS there — just not always linked via for/id.
  // Without this check, every MUI / Ant Design / Chakra / Vuetify input fires a false positive.
  const hasContextualLabel = el => {
    // 1. MUI: <FormControl class="MuiFormControl-root"><label class="MuiFormLabel-root">...</label>...<input>
    const muiControl = el.closest('.MuiFormControl-root, .MuiTextField-root, .MuiInputBase-root');
    if (muiControl) {
      const lbl = muiControl.closest('.MuiFormControl-root, .MuiTextField-root');
      if (lbl) {
        const label = lbl.querySelector('.MuiFormLabel-root, .MuiInputLabel-root');
        if (label && label.innerText.trim()) return true;
      }
    }
    // 2. Ant Design: <Form.Item><label class="ant-form-item-label">...</label>...<input>
    const antItem = el.closest('.ant-form-item');
    if (antItem && antItem.querySelector('.ant-form-item-label label, .ant-form-item-label')) return true;
    // 3. Chakra UI: <FormControl class="chakra-form-control"><FormLabel class="chakra-form__label">
    const chakra = el.closest('.chakra-form-control');
    if (chakra && chakra.querySelector('.chakra-form__label')) return true;
    // 4. Vuetify: <v-text-field> renders <label class="v-label">
    const vuetify = el.closest('.v-input, .v-field');
    if (vuetify && vuetify.querySelector('.v-label, .v-field-label')) return true;
    // 5. Angular Material: <mat-form-field><mat-label> or <label class="mdc-floating-label">
    const matField = el.closest('mat-form-field, .mat-mdc-form-field, .mat-form-field');
    if (matField && matField.querySelector('mat-label, .mdc-floating-label, .mat-mdc-floating-label')) return true;
    // 6. Bootstrap 5 floating labels: <div class="form-floating"><input><label>
    const bsFloat = el.closest('.form-floating');
    if (bsFloat && bsFloat.querySelector('label')) return true;
    // 7. PrimeReact / PrimeFaces: <span class="p-float-label"><input><label>
    const prime = el.closest('.p-float-label, .p-inputwrapper');
    if (prime && prime.querySelector('label')) return true;
    // 8. Quasar: <q-input> renders <label class="q-field__label">
    const quasar = el.closest('.q-field, .q-input');
    if (quasar && quasar.querySelector('.q-field__label')) return true;
    // 9. Generic: any wrapping element with a <label> that has text
    const genericWrap = el.closest('.form-group, .form-field, .field, .input-wrapper, .input-group');
    if (genericWrap) {
      const lbl = genericWrap.querySelector('label');
      if (lbl && lbl.innerText.trim()) return true;
    }
    return false;
  };

  // 1. fieldWithoutLabel
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (out.length >= 16) break;
    if (el.type && skipTypes.has(el.type)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const labelled = (el.labels && el.labels.length > 0) ||
      el.hasAttribute('aria-label') ||
      el.hasAttribute('aria-labelledby') ||
      el.title ||
      el.placeholder ||
      hasContextualLabel(el);
    if (!labelled) {
      out.push({ issueType:'fieldWithoutLabel', severity:'high', selector:sel(el),
        description:'Form field has no label, aria-label, aria-labelledby, title, or placeholder', bbox: bb(el) });
    }
  }

  // 2. errorNotAnnounced
  for (const e of document.querySelectorAll('.error, .invalid-feedback, .field-error, .error-message, .form-error, [class*="error-msg"]')) {
    if (out.length >= 20) break;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const role = e.getAttribute('role');
    const ariaLive = e.getAttribute('aria-live');
    if (role !== 'alert' && role !== 'status' && !ariaLive) {
      out.push({ issueType:'errorNotAnnounced', severity:'high', selector:sel(e),
        description:`Error container ${sel(e)} missing role="alert" or aria-live — screen readers won't announce the error`, bbox: bb(e) });
    }
  }

  // 3. requiredNotIndicated
  for (const input of document.querySelectorAll('input[required], textarea[required], select[required]')) {
    if (out.length >= 24) break;
    const r = input.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || input.type === 'hidden') continue;
    const hasAriaRequired = input.getAttribute('aria-required') === 'true';
    const label = (input.labels && input.labels[0]) || input.closest('label') || (input.id && document.querySelector(`label[for="${input.id}"]`));
    const labelText = label ? label.innerText : '';
    const hasAsterisk = /\*|\(required\)/i.test(labelText);
    if (!hasAriaRequired && !hasAsterisk) {
      out.push({ issueType:'requiredNotIndicated', severity:'medium', selector:sel(input),
        description:`Required field ${sel(input)} has no visual asterisk AND no aria-required — users can't tell it's required`, bbox: bb(input) });
    }
  }

  // 4. fieldsetNoLegend
  for (const fs of document.querySelectorAll('fieldset')) {
    if (out.length >= 28) break;
    const r = fs.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const legend = fs.querySelector(':scope > legend');
    if (!legend || !legend.innerText.trim()) {
      out.push({ issueType:'fieldsetNoLegend', severity:'medium', selector:sel(fs),
        description:`Fieldset ${sel(fs)} has no <legend> — radio/checkbox groups lack a screen-reader-announced group label`, bbox: bb(fs) });
    }
  }

  // 5. passwordNoToggle
  for (const pwd of document.querySelectorAll('input[type="password"]')) {
    if (out.length >= 30) break;
    const r = pwd.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const parent = pwd.closest('div, fieldset, form');
    const toggle = parent && parent.querySelector('[aria-label*="show" i], [aria-label*="hide" i], [data-testid*="toggle"]');
    if (!toggle) {
      out.push({ issueType:'passwordNoToggle', severity:'medium', selector:sel(pwd),
        description:'Password field has no show/hide toggle button', bbox: bb(pwd) });
    }
  }

  // 6. focusOrderMismatch
  const focusables = [...document.querySelectorAll(
    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, 10);
  if (focusables.length >= 3) {
    let violations = 0;
    for (let i = 1; i < focusables.length; i++) {
      const prev = focusables[i-1].getBoundingClientRect();
      const curr = focusables[i].getBoundingClientRect();
      if (curr.top + 8 < prev.top) violations++;
    }
    if (violations >= 2) {
      out.push({ issueType:'focusOrderMismatch', severity:'medium', selector:'form',
        description:`Tab focus order does not match visual top-to-bottom — ${violations} elements appear above their DOM-previous sibling`,
        bbox: { x:0, y:0, w:200, h:80 } });
    }
  }

  return out;
}
```

## Migration
```toml
[detectors]
qa-form-a11y           = true   # NEW
qa-detect-form-a11y    = false  # REPLACED entirely
# qa-detect-forms retains the structural checks (formNoSubmit, inputHeightTooSmall, formFieldNotFullWidth) → moved to qa-form-structure
```
