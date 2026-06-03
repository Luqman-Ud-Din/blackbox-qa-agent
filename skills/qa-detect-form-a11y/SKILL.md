---
name: qa-detect-form-a11y
description: "Detects form accessibility issues: missing aria-live on errors, no asterisk/aria-required, fieldsets without legend, focus order mismatch"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks

- Error containers without `role="alert"` or `aria-live` — screen readers don't announce inline errors
- Required fields with neither a visible asterisk nor `aria-required="true"` — users don't know they're required
- `<fieldset>` without `<legend>` — radio groups have no group label for screen readers
- Tab focus order does not match the visual top-to-bottom order

## Probe (browser_evaluate)

```js
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    return (el.tagName.toLowerCase() + id).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];

  // 1. Error containers without aria-live / role=alert
  const errorContainers = document.querySelectorAll(
    '.error, .invalid-feedback, .field-error, .error-message, .form-error, [class*="error-msg"]'
  );
  for (const e of errorContainers) {
    if (out.length >= 8) break;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const role = e.getAttribute('role');
    const ariaLive = e.getAttribute('aria-live');
    if (role !== 'alert' && role !== 'status' && !ariaLive) {
      out.push({
        issueType: 'errorNotAnnounced',
        severity: 'high',
        selector: sel(e),
        description: `Error container ${sel(e)} is missing role="alert" or aria-live — screen readers will not announce the error to users`,
        bbox: bb(e)
      });
    }
  }

  // 2. Required fields without visual asterisk or aria-required
  for (const input of document.querySelectorAll('input[required], textarea[required], select[required]')) {
    if (out.length >= 16) break;
    const r = input.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (input.type === 'hidden') continue;

    const hasAriaRequired = input.getAttribute('aria-required') === 'true';
    // Look for asterisk in nearby label
    const label = (input.labels && input.labels[0]) || input.closest('label') || (input.id && document.querySelector(`label[for="${input.id}"]`));
    const labelText = label ? label.innerText : '';
    const hasAsterisk = /\*|\(required\)/i.test(labelText);

    if (!hasAriaRequired && !hasAsterisk) {
      out.push({
        issueType: 'requiredNotIndicated',
        severity: 'medium',
        selector: sel(input),
        description: `Required field ${sel(input)} has no visual asterisk in its label AND no aria-required — users can't tell it's required`,
        bbox: bb(input)
      });
    }
  }

  // 3. Fieldsets without legend
  for (const fs of document.querySelectorAll('fieldset')) {
    if (out.length >= 20) break;
    const r = fs.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const legend = fs.querySelector(':scope > legend');
    if (!legend || !legend.innerText.trim()) {
      out.push({
        issueType: 'fieldsetNoLegend',
        severity: 'medium',
        selector: sel(fs),
        description: `Fieldset ${sel(fs)} has no <legend> — radio/checkbox groups lack a screen-reader-announced group label`,
        bbox: bb(fs)
      });
    }
  }

  // 4. Tab focus order — sample first 10 focusable elements, compare DOM order to visual y-position
  const focusables = [...document.querySelectorAll(
    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .slice(0, 10);
  if (focusables.length >= 3) {
    let orderViolations = 0;
    for (let i = 1; i < focusables.length; i++) {
      const prev = focusables[i - 1].getBoundingClientRect();
      const curr = focusables[i].getBoundingClientRect();
      // If current element is significantly ABOVE the previous one (more than one row), DOM order ≠ visual order
      if (curr.top + 8 < prev.top) orderViolations++;
    }
    if (orderViolations >= 2) {
      out.push({
        issueType: 'focusOrderMismatch',
        severity: 'medium',
        selector: 'form',
        description: `Tab focus order does not match visual top-to-bottom order — ${orderViolations} elements appear above their DOM-previous sibling`,
        bbox: { x: 0, y: 0, w: 200, h: 80 }
      });
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| errorNotAnnounced | high | "Error container missing role=alert / aria-live — screen readers won't announce errors" |
| requiredNotIndicated | medium | "Required field has no visual asterisk AND no aria-required" |
| fieldsetNoLegend | medium | "Fieldset missing <legend> — radio/checkbox group label invisible to screen readers" |
| focusOrderMismatch | medium | "Tab focus order does not match visual top-to-bottom order" |
