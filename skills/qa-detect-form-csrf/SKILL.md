---
name: qa-detect-form-csrf
description: "Detects forms that POST without a CSRF token — a basic Cross-Site Request Forgery protection"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks

Forms that submit via POST should include a CSRF token (hidden field, header, or per-form synchronizer token) to prevent CSRF attacks. Public-facing forms — especially login, register, account-change, and money-moving forms — must have one.

## Probe (browser_evaluate)

```js
() => {
  const sel = f => f.id ? `#${f.id}` : (f.action ? `form[action="${f.action.slice(0,80)}"]` : `form:nth-of-type(${[...document.querySelectorAll('form')].indexOf(f)+1})`);
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];

  // Look at global meta CSRF token (common in Rails/Laravel)
  const metaCsrf = document.querySelector('meta[name*="csrf" i], meta[name="_token"], meta[name*="xsrf" i]');
  const hasGlobalCsrf = !!metaCsrf && metaCsrf.getAttribute('content');

  for (const f of document.querySelectorAll('form')) {
    if (out.length >= 8) break;
    const method = (f.method || 'get').toLowerCase();
    if (method === 'get' || method === '') continue;  // GET forms don't need CSRF
    const r = f.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Check 1: hidden input named csrf/_csrf/_token/authenticity_token/xsrf
    const csrfField = f.querySelector(
      'input[type="hidden"][name*="csrf" i], ' +
      'input[type="hidden"][name="_token"], ' +
      'input[type="hidden"][name="authenticity_token"], ' +
      'input[type="hidden"][name*="xsrf" i]'
    );
    const hasFieldCsrf = !!csrfField && csrfField.value && csrfField.value.length >= 8;

    // Check 2: data attribute on the form pointing to a token
    const dataCsrf = f.dataset && (f.dataset.csrf || f.dataset.csrfToken || f.dataset.token);
    const hasDataCsrf = !!dataCsrf && dataCsrf.length >= 8;

    if (!hasFieldCsrf && !hasDataCsrf && !hasGlobalCsrf) {
      out.push({
        issueType: 'csrfTokenMissing',
        severity: 'high',
        selector: sel(f),
        description: `POST form ${sel(f)} action=${f.action || '(empty)'} has no CSRF token (no hidden input, no data attribute, no meta tag) — vulnerable to cross-site request forgery`,
        bbox: bb(f)
      });
    } else if (!hasFieldCsrf && !hasDataCsrf && hasGlobalCsrf) {
      // Has meta but no per-form token — soft warning. Many frameworks inject from meta at submit time.
      // No finding emitted to avoid false positives on Rails/Laravel.
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| csrfTokenMissing | high | "POST form has no CSRF token — vulnerable to cross-site request forgery" |
