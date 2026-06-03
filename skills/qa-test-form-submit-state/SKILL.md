---
name: qa-test-form-submit-state
description: "Tests submit-button state management: disabled when invalid, shows loading on click, and beforeunload warns on dirty form"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

- Submit button is **disabled** when required fields are empty (best-practice UX)
- Clicking submit shows a **loading/spinner state** so users don't double-click
- Navigating away from a dirty form triggers a **beforeunload warning**

## Orchestrator flow

1. Run `probe.findSubmitContext` — returns `{found, submitSelector, formIdx, hasRequiredEmpty, submitDisabled}`. If `found` is false → **self-skip**.
2. **Test A — Submit-disabled-when-invalid:**
   - If `hasRequiredEmpty` is true AND `submitDisabled` is false → emit `submitNotDisabledWhenInvalid` (medium)
3. **Test B — Submit loading state:**
   - Fill required fields with safe placeholder values via `browser_evaluate` (don't actually submit a real form)
   - `browser_click` the submit button — but DO NOT wait for navigation. We're testing the immediate visual state.
   - `browser_wait_for(time=300)`
   - Run `probe.checkSubmitLoadingState({submitSelector})` — if no loading indicator AND button is still enabled → emit `submitNoLoadingState` (low)
   - **Important:** if the click triggered a navigation, the orchestrator's natural error handling will catch it; we do not navigate back here. The next skill will navigate fresh.
4. **Test C — Beforeunload warning:**
   - Run `probe.makeFormDirty` — type a marker into the first text input
   - Run `probe.testBeforeUnloadHandler` — returns `{hasHandler}`. If `hasHandler` is false → emit `noBeforeUnloadWarning` (low)
5. Run `probe.cleanupSubmitTest` — clears the marker.

## Probes (browser_evaluate)

```js
// probe.findSubmitContext
() => {
  const forms = [...document.querySelectorAll('form')].slice(0, 1);
  if (!forms.length) return { found: false };
  const f = forms[0];
  const submit = f.querySelector('button[type="submit"], input[type="submit"]') ||
                 [...f.querySelectorAll('button')].find(b => !b.type || b.type === 'submit');
  if (!submit) return { found: false };
  const r = submit.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { found: false };
  const required = [...f.querySelectorAll('[required], [aria-required="true"]')];
  const hasRequiredEmpty = required.some(el => {
    if (el.type === 'checkbox' || el.type === 'radio') return !el.checked;
    return !el.value || el.value.trim() === '';
  });
  return {
    found: true,
    formIdx: 0,
    submitSelector: submit.id ? `#${submit.id}` : 'form button[type="submit"]',
    hasRequiredEmpty,
    submitDisabled: submit.disabled || submit.getAttribute('aria-disabled') === 'true'
  };
}
```

```js
// probe.checkSubmitLoadingState  — args: { submitSelector }
({submitSelector}) => {
  let submit;
  try { submit = document.querySelector(submitSelector); } catch (_) { return { hasLoading: false, stillEnabled: true }; }
  if (!submit) return { hasLoading: false, stillEnabled: true };
  // Loading detection: disabled state, spinner inside button, aria-busy, or "loading" text
  const disabled = submit.disabled || submit.getAttribute('aria-disabled') === 'true';
  const ariaBusy = submit.getAttribute('aria-busy') === 'true';
  const spinner = submit.querySelector('.spinner, .loader, [class*="loading"], svg.animate-spin, [data-loading="true"]');
  const loadingText = /loading|please wait|submitting|saving|sending/i.test(submit.innerText);
  return {
    hasLoading: disabled || ariaBusy || !!spinner || loadingText,
    stillEnabled: !disabled
  };
}
```

```js
// probe.makeFormDirty
() => {
  const input = document.querySelector('form input[type="text"], form input[type="email"], form textarea');
  if (!input) return { marked: false };
  input.value = 'argusDirty';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { marked: true, selector: input.id ? `#${input.id}` : 'form input' };
}
```

```js
// probe.testBeforeUnloadHandler
() => {
  // Trigger a synthetic beforeunload — if a handler exists, it should call preventDefault or set returnValue
  let handlerFired = false;
  const probe = (e) => {
    if (e.defaultPrevented || (typeof e.returnValue === 'string' && e.returnValue !== '')) {
      handlerFired = true;
    }
  };
  window.addEventListener('beforeunload', probe, true);
  const evt = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(evt);
  window.removeEventListener('beforeunload', probe, true);
  return { hasHandler: handlerFired || evt.defaultPrevented };
}
```

```js
// probe.cleanupSubmitTest
() => {
  const input = document.querySelector('form input[type="text"], form input[type="email"], form textarea');
  if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| submitNotDisabledWhenInvalid | medium | "Submit button is enabled while required fields are empty — users get a confusing error on click" |
| submitNoLoadingState | low | "Submit button shows no loading state on click — users may double-submit" |
| noBeforeUnloadWarning | low | "Dirty form (data entered, not submitted) has no beforeunload warning — users lose data accidentally" |
