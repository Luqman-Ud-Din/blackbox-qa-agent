---
name: qa-test-form-realtime
description: "Tests whether form fields validate as the user types (inline validation) — flags fields that only validate on submit"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Modern forms validate as the user types/blurs (e.g., "email must contain @" appears the moment they tab out of the field). Forms that wait until submit to validate are poor UX. This skill types an obviously-invalid value into each field, blurs, and checks for inline feedback.

## Orchestrator flow

1. Run `probe.findValidatableFields` — returns array of `{formIdx, fieldIdx, type, name, selector}`. If empty → **self-skip**.
2. For each field (max 5):
   a. `browser_evaluate`: clear field
   b. `browser_type` text=<invalid-value-for-type>:
      - For `type=email` → type `abc`
      - For `type=number` → type `xyz`
      - For `type=url` → type `not a url`
      - For `type=tel` → type `letters here`
      - Otherwise → type a single character
   c. `browser_press_key` 'Tab' (blur the field)
   d. `browser_wait_for(time=450)` — allow JS-based validation to run
   e. Run `probe.checkInlineFeedback({formIdx, fieldIdx})`
      - If `errorVisible` is false → emit `noRealtimeValidation` (medium) for this field
3. Run `probe.clearAllTestedFields` to leave the page clean.

## Probes (browser_evaluate)

```js
// probe.findValidatableFields
() => {
  const forms = [...document.querySelectorAll('form')].slice(0, 2);
  const out = [];
  for (let fi = 0; fi < forms.length; fi++) {
    const inputs = [...forms[fi].querySelectorAll(
      'input[type="email"], input[type="url"], input[type="tel"], input[type="number"], input[type="text"]'
    )]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
      })
      .slice(0, 5);
    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i];
      out.push({
        formIdx: fi,
        fieldIdx: i,
        type: el.type,
        name: el.name || el.id || `field${i}`,
        selector: el.id ? `#${el.id}` : `form:nth-of-type(${fi+1}) [name="${el.name}"]`
      });
    }
  }
  return out;
}
```

```js
// probe.checkInlineFeedback  — args: { formIdx, fieldIdx }
({formIdx, fieldIdx}) => {
  const f = document.querySelectorAll('form')[formIdx];
  if (!f) return { errorVisible: false };
  const inputs = f.querySelectorAll(
    'input[type="email"], input[type="url"], input[type="tel"], input[type="number"], input[type="text"]'
  );
  const field = inputs[fieldIdx];
  if (!field) return { errorVisible: false };
  const ariaInvalid = field.getAttribute('aria-invalid') === 'true';
  let cssInvalid = false;
  try { cssInvalid = field.matches(':invalid'); } catch (_) {}
  const container = field.closest('label, div, fieldset, .form-group, .field') || field.parentElement;
  const nearbyError = container && container.querySelector(
    '[role="alert"], .error, .invalid-feedback, [data-testid*="error"], ' +
    '.text-red-500, .text-danger, .field-error, .error-message, .form-error'
  );
  return { errorVisible: ariaInvalid || cssInvalid || !!nearbyError };
}
```

```js
// probe.clearAllTestedFields  — args: { fieldCount }
({fieldCount}) => {
  const forms = [...document.querySelectorAll('form')].slice(0, 2);
  for (const f of forms) {
    const inputs = f.querySelectorAll(
      'input[type="email"], input[type="url"], input[type="tel"], input[type="number"], input[type="text"]'
    );
    for (let i = 0; i < Math.min(inputs.length, fieldCount); i++) {
      try { inputs[i].value = ''; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| noRealtimeValidation | medium | "Field '{name}' (type={type}) accepts invalid value with no inline feedback after blur — validation only on submit" |
