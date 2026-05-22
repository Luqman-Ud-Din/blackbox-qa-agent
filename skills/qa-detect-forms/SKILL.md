---
name: qa-detect-forms
description: "Detects form fields without labels, forms missing a submit button, and password fields without a show/hide toggle."
---

# Form Detection

## What Claude checks
- `<input>`, `<select>`, and `<textarea>` elements that have **no accessible label** — none of: `<label for=id>`, `aria-label`, `aria-labelledby`, or `placeholder` (placeholder alone is insufficient but is noted separately)
- `<form>` elements that contain no submit mechanism: no `<button type="submit">`, no `<input type="submit">`, and no button whose text matches submit patterns
- `<input type="password">` fields that have no adjacent button or icon to toggle visibility (show/hide password)

## How to detect

```js
// 1. Fields with no label
const unlabelledFields = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea').forEach(el => {
    const hasForLabel = el.id && document.querySelector(`label[for="${el.id}"]`);
    const hasAriaLabel = el.getAttribute('aria-label');
    const hasAriaLabelledBy = el.getAttribute('aria-labelledby');
    const hasPlaceholder = el.getAttribute('placeholder');
    const wrappedInLabel = el.closest('label');
    if (!hasForLabel && !hasAriaLabel && !hasAriaLabelledBy && !wrappedInLabel) {
      results.push({
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase() + '[name="' + (el.name || '') + '"]',
        type: el.type || el.tagName.toLowerCase(),
        hasPlaceholderOnly: !!hasPlaceholder,
        name: el.name || el.id || '(unnamed)'
      });
    }
  });
  return results;
});

// 2. Forms missing a submit button
const formsNoSubmit = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('form').forEach((form, i) => {
    const hasSubmitInput = form.querySelector('input[type="submit"]');
    const hasSubmitButton = form.querySelector('button[type="submit"]');
    const hasButtonDefault = Array.from(form.querySelectorAll('button:not([type="reset"]):not([type="button"])')).length > 0;
    const hasSubmitKeyword = Array.from(form.querySelectorAll('button, input[type="submit"]')).some(el => {
      const text = (el.innerText || el.value || '').toLowerCase();
      return /submit|save|send|continue|next|confirm|sign.?up|log.?in|register/.test(text);
    });
    if (!hasSubmitInput && !hasSubmitButton && !hasButtonDefault && !hasSubmitKeyword) {
      results.push({
        selector: form.id ? `#${form.id}` : `form:nth-of-type(${i + 1})`,
        action: form.action || '(no action)',
        fieldCount: form.querySelectorAll('input, select, textarea').length
      });
    }
  });
  return results;
});

// 3. Password fields without show/hide toggle
const passwordNoToggle = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('input[type="password"]').forEach(el => {
    // Look for adjacent button/icon within the same container
    const container = el.closest('div, fieldset, form') || el.parentElement;
    const toggleButton = container && container.querySelector(
      'button[aria-label*="show" i], button[aria-label*="hide" i], button[aria-label*="password" i], [class*="toggle" i], [class*="eye" i], [class*="show" i]'
    );
    if (!toggleButton) {
      results.push({
        selector: el.id ? `#${el.id}` : 'input[type="password"]',
        name: el.name || el.id || '(unnamed)'
      });
    }
  });
  return results;
});
```

Cross-check with `page.accessibility.snapshot()` to confirm label associations at the accessibility tree level.

## Issue schema
- type: `"fieldNoLabel"` | `"formNoSubmit"` | `"passwordNoToggle"`
- severity: from config (`medium` for all)
- selector: CSS selector of the offending element
- description:
  - fieldNoLabel: `"Form field <selector> (type: <type>) has no associated label — add <label for>, aria-label, or aria-labelledby"` — add note if placeholder-only
  - formNoSubmit: `"Form <selector> (action: <action>) has no submit button"`
  - passwordNoToggle: `"Password field <selector> has no show/hide visibility toggle"`

## Viewport behaviour
- Check on **all viewports**
- On mobile, confirm that any label toggle (show/hide password) remains accessible and not hidden by overflow
- Form layout may differ between mobile (stacked) and desktop (inline) — check labels are still correctly associated in both layouts
