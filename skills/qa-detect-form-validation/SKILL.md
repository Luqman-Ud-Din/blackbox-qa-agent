---
name: qa-detect-form-validation
description: "Tests empty form submission and invalid email to verify inline validation feedback"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks
Empty form submit and invalid email — verify validation feedback appears.

## Orchestrator flow
1. Run `probe.detectForms` to find forms on page. Skip if none.
2. For each form (up to 3):
   a. **Test 1 (empty submit):**
      - `browser_click` the form's submit button
      - `browser_wait_for(time=500)`
      - Run `probe.checkValidationVisible` — if no errors AND form has required → record `noValidationOnEmptySubmit` (high)
   b. **Test 2 (invalid email):**
      - `browser_type` `'notanemail'` into first `input[type="email"]`
      - `browser_press_key('Tab')` (blur)
      - `browser_wait_for(time=300)`
      - Run `probe.checkEmailInvalid` — if not flagged → record `noEmailValidation` (medium)

## Probes (browser_evaluate)
```js
// probe.detectForms
() => {
  const forms = [...document.querySelectorAll('form')].slice(0, 3);
  return forms.map((f, i) => ({
    idx: i,
    hasRequired: !!f.querySelector('[required], [aria-required="true"]'),
    hasEmail: !!f.querySelector('input[type="email"]'),
    submitSelector: 'form:nth-of-type(' + (i+1) + ') button[type="submit"], form:nth-of-type(' + (i+1) + ') input[type="submit"], form:nth-of-type(' + (i+1) + ') button:not([type])'
  }));
}
```
```js
// probe.checkValidationVisible (run after empty submit click)
(idx) => {
  const f = document.querySelectorAll('form')[idx];
  if (!f) return { errorCount: 0, hasRequired: false };
  const errors = f.querySelectorAll('[role="alert"], .error, .invalid-feedback, [aria-invalid="true"], :invalid, .field-error, [data-testid*="error"]');
  return { errorCount: errors.length, hasRequired: !!f.querySelector('[required], [aria-required="true"]') };
}
```
```js
// probe.checkEmailInvalid (run after typing invalid email + blur)
(idx) => {
  const f = document.querySelectorAll('form')[idx];
  if (!f) return { invalid: false };
  return { invalid: f.querySelectorAll('[aria-invalid="true"], :invalid, .is-invalid').length > 0 };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| noValidationOnEmptySubmit | high | "Form with required fields shows no validation errors when submitted empty" |
| noEmailValidation | medium | "Email field accepts invalid format \"notanemail\" without showing a validation error" |
