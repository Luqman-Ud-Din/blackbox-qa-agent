---
name: qa-test-form-boundaries
description: "Tests form inputs with boundary values (whitespace-only, oversize, maxlength enforcement) to detect crashes, silent acceptance of invalid input, and missing length limits"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

For each text-like field in the visible forms:
- **Whitespace-only input** — should be treated as empty by required-field validation
- **10,000-character input** — should not crash the page or break the form
- **Maxlength enforcement** — if the field has a `maxlength` attribute, oversize input should be truncated

Verifies the page does not enter an error state, validation feedback appears where expected, and length attributes are honored.

## Orchestrator flow

**Page-state-safe rules:**
- This skill ONLY types into form fields. It does NOT click submit. Form state is restored at the end.
- The final cleanup step (step 6) clears every tested field so the next skill in the cell sees a clean page.

1. Run `probe.findTestableForms` — returns up to 2 forms × up to 5 fields each.
   - If zero fields are returned, **self-skip** the cell with no findings.
2. Capture initial error-page state via `probe.checkPageHealth`. Save `initialBodyHash` for comparison.
3. For each form (max 2):
   For each field in that form (max 5):

   **Test A — whitespace-only**
   - `browser_evaluate`: clear the field via `el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true}))`
   - `browser_type` text=`"     "` (5 spaces) into the field
   - `browser_press_key` 'Tab' (blur)
   - `browser_wait_for(time=350)`
   - Run `probe.checkFieldErrors({formIdx, fieldIdx})`
   - If `formHasRequired` is true AND `errorVisible` is false → emit `whitespaceAccepted` (medium)

   **Test B — 10,000-character overflow**
   - `browser_evaluate`: set `el.value = 'x'.repeat(10000); el.dispatchEvent(new Event('input', {bubbles:true}))`
     (Direct value assignment is intentional — `browser_type` for 10k chars is impractical.)
   - `browser_press_key` 'Tab' (blur)
   - `browser_wait_for(time=500)`
   - Run `probe.checkPageHealth`
   - If `hasErrorPage` is true OR `hasBody` is false → emit `pageCrashOnLargeInput` (high)
   - Run `probe.checkFieldLength({formIdx, fieldIdx})`
   - If `maxLength` is set AND `actualLength` > `maxLength` → emit `maxLengthNotEnforced` (medium)

4. Run `probe.clearAllTestedFields` — empties every field that was modified, so the next skill in the cell starts from a clean state.
5. Run `probe.checkPageHealth` one final time. If `hasErrorPage` is true → emit `pageCrashOnLargeInput` (high) once for the cell with `selector: 'form'`, then stop further tests on this cell (it is in a broken state).

## Probes (browser_evaluate)

```js
// probe.findTestableForms
() => {
  const forms = [...document.querySelectorAll('form')].slice(0, 2);
  return forms.map((f, fi) => {
    const fields = [...f.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="number"], ' +
      'input[type="search"], input[type="tel"], input[type="url"], ' +
      'input:not([type]), textarea'
    )]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
      })
      .slice(0, 5)
      .map((el, fieldIdx) => ({
        fieldIdx,
        type: el.type || 'textarea',
        name: el.name || el.id || `field${fieldIdx}`,
        maxLength: el.maxLength > 0 ? el.maxLength : null,
        required: el.required || el.getAttribute('aria-required') === 'true',
        selector: el.id ? `#${el.id}` : `form:nth-of-type(${fi+1}) [name="${el.name}"]`
      }));
    return { formIdx: fi, formHasRequired: !!f.querySelector('[required], [aria-required="true"]'), fields };
  }).filter(f => f.fields.length > 0);
}
```

```js
// probe.checkFieldErrors  — args: { formIdx, fieldIdx }
({formIdx, fieldIdx}) => {
  const f = document.querySelectorAll('form')[formIdx];
  if (!f) return { errorVisible: false, formHasRequired: false };
  const inputs = f.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="number"], ' +
    'input[type="search"], input[type="tel"], input[type="url"], ' +
    'input:not([type]), textarea'
  );
  const field = inputs[fieldIdx];
  if (!field) return { errorVisible: false, formHasRequired: false };
  const ariaInvalid = field.getAttribute('aria-invalid') === 'true';
  let cssInvalid = false;
  try { cssInvalid = field.matches(':invalid'); } catch (_) {}
  const container = field.closest('label, div, fieldset, .form-group, .field') || field.parentElement;
  const nearbyError = container && container.querySelector(
    '[role="alert"], .error, .invalid-feedback, [data-testid*="error"], ' +
    '.text-red-500, .text-danger, .field-error, .error-message'
  );
  return {
    errorVisible: ariaInvalid || cssInvalid || !!nearbyError,
    formHasRequired: !!f.querySelector('[required], [aria-required="true"]'),
    fieldName: field.name || field.id || `field${fieldIdx}`
  };
}
```

```js
// probe.checkPageHealth
() => {
  const bodyText = (document.body && document.body.innerText || '').slice(0, 500);
  return {
    hasBody: !!document.body,
    bodyChildCount: document.body ? document.body.children.length : 0,
    hasErrorPage:
      !!document.querySelector('.error-page, [data-error], #__next-error, .next-error-h1') ||
      /Application error|Internal Server Error|500|something went wrong|Uncaught/i.test(bodyText)
  };
}
```

```js
// probe.checkFieldLength  — args: { formIdx, fieldIdx }
({formIdx, fieldIdx}) => {
  const f = document.querySelectorAll('form')[formIdx];
  if (!f) return { actualLength: 0, maxLength: null };
  const inputs = f.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="number"], ' +
    'input[type="search"], input[type="tel"], input[type="url"], ' +
    'input:not([type]), textarea'
  );
  const field = inputs[fieldIdx];
  if (!field) return { actualLength: 0, maxLength: null };
  return {
    actualLength: field.value.length,
    maxLength: field.maxLength > 0 ? field.maxLength : null,
    fieldName: field.name || field.id || `field${fieldIdx}`
  };
}
```

```js
// probe.clearAllTestedFields  — args: { formCount, fieldCount }
({formCount, fieldCount}) => {
  const forms = [...document.querySelectorAll('form')].slice(0, formCount);
  let cleared = 0;
  for (const f of forms) {
    const inputs = f.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="number"], ' +
      'input[type="search"], input[type="tel"], input[type="url"], ' +
      'input:not([type]), textarea'
    );
    for (let i = 0; i < Math.min(inputs.length, fieldCount); i++) {
      try {
        inputs[i].value = '';
        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
        cleared++;
      } catch (_) {}
    }
  }
  return { cleared };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| whitespaceAccepted | medium | "Field '{name}' on a required form accepts whitespace-only input without showing a validation error" |
| pageCrashOnLargeInput | high | "Page entered an error state or crashed after entering 10,000 chars into field '{name}'" |
| maxLengthNotEnforced | medium | "Field '{name}' has maxlength={max} but field value reached {actual} chars" |

## Notes
- Skill is **non-destructive**: never clicks submit, never navigates away, always cleans up its own input.
- Skips cells with no eligible forms — no false positives on landing pages, marketing routes, etc.
- Caps at 2 forms × 5 fields per cell to keep run time bounded (max 20 typed inputs per cell).
