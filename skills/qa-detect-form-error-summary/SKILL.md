---
name: qa-detect-form-error-summary
description: "Detects forms missing an error summary container (WCAG 3.3.1 pattern) and form fields with hint text not linked via aria-describedby"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks

- **Error summary** (WCAG 3.3.1): long forms (5+ fields) should render an error summary block at the top after a failed submit. The summary should have `role="alert"` and link (via in-page anchors) to each invalid field.
- **Help text association**: hint text near a field (e.g., "Must be 8+ characters") should be linked to the field via `aria-describedby` so screen readers announce it on focus.

This is a passive detection skill — runs probes only, no interaction.

## Probe (browser_evaluate)

```js
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    return (el.tagName.toLowerCase() + id).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];

  // 1. Error summary container check — look at every form with 5+ fields
  for (const form of document.querySelectorAll('form')) {
    if (out.length >= 6) break;
    const r = form.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const fieldCount = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea').length;
    if (fieldCount < 5) continue;

    // Has a top-of-form error summary? Look for role=alert OR a list of errors at the start of the form
    const firstChild = form.firstElementChild;
    const hasTopSummary =
      !!form.querySelector(':scope > [role="alert"], :scope > .error-summary, :scope > [class*="error-summary"], :scope > [data-testid*="error-summary"]') ||
      (firstChild && /error|invalid|alert/i.test(firstChild.className) && firstChild.querySelector('ul, ol, li'));

    if (!hasTopSummary) {
      out.push({
        issueType: 'noErrorSummary',
        severity: 'medium',
        selector: sel(form),
        description: `Form with ${fieldCount} fields has no error-summary container at the top — WCAG 3.3.1 pattern recommends a summary listing all errors with anchor links to each invalid field`,
        bbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.min(Math.round(r.width), 400), h: 60 }
      });
    }
  }

  // 2. Help-text / hint text association via aria-describedby
  // Pattern: small text element AFTER an input that's not a label — should be referenced by aria-describedby
  for (const input of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    if (out.length >= 18) break;
    const r = input.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (input.type === 'submit' || input.type === 'button') continue;

    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy && describedBy.trim().length > 0) {
      // Verify the IDs actually exist in the DOM
      const ids = describedBy.trim().split(/\s+/);
      const missingIds = ids.filter(id => !document.getElementById(id));
      if (missingIds.length > 0) {
        out.push({
          issueType: 'ariaDescribedByBrokenRef',
          severity: 'medium',
          selector: sel(input),
          description: `Field ${sel(input)} has aria-describedby="${describedBy}" but ID(s) "${missingIds.join(', ')}" don't exist in the DOM — screen reader won't announce hint`,
          bbox: bb(input)
        });
      }
      continue;  // has aria-describedby with valid refs — no further check
    }

    // No aria-describedby — look for nearby hint text within the same container
    const container = input.closest('label, div, fieldset, .form-group, .field') || input.parentElement;
    if (!container) continue;
    const hintCandidates = container.querySelectorAll('small, .help-text, .hint, .form-text, .help-block, [class*="description"], p[class*="hint"]');
    for (const hint of hintCandidates) {
      if (hint === input || input.contains(hint)) continue;
      const ht = (hint.innerText || '').trim();
      if (ht.length < 5 || ht.length > 200) continue;
      // The hint exists but is not associated. Emit one finding per orphaned hint.
      out.push({
        issueType: 'helpTextNotAssociated',
        severity: 'low',
        selector: sel(input),
        description: `Field ${sel(input)} has nearby hint text "${ht.slice(0, 60)}…" but no aria-describedby reference — screen readers won't announce it on focus`,
        bbox: bb(input)
      });
      break;  // one hint finding per field
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| noErrorSummary | medium | "Long form (5+ fields) has no error-summary container — WCAG 3.3.1 best practice" |
| helpTextNotAssociated | low | "Hint/help text near field is not linked via aria-describedby — screen readers won't announce it" |
| ariaDescribedByBrokenRef | medium | "Field has aria-describedby but the referenced ID does not exist" |
