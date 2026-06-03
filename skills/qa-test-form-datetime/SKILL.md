---
name: qa-test-form-datetime
description: "Tests date/time pickers: past-date acceptance where it shouldn't be, missing min/max, time-input format, range pickers"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

For each `input[type="date"]`, `input[type="time"]`, and `input[type="datetime-local"]` in visible forms:
- Does it accept dates in the past when context suggests it shouldn't (e.g., field name contains "expir", "due", "schedule", "appointment")?
- Does it have `min` / `max` attributes set?
- Does typing a malformed date show a validation error?
- For date-range pairs (two date inputs in same form): does end-before-start show an error?

## Orchestrator flow

1. Run `probe.findDateInputs` — returns `[{idx, type, name, selector, contextHint, hasMin, hasMax}]`. If empty → **self-skip**.
2. For each input (max 3):
   a. Emit `dateInputNoMinMax` (low) if both `hasMin` and `hasMax` are false AND context suggests future-only (e.g., "expir", "due", "appointment")
   b. **Past-date test (if context hints future-only):**
      - `browser_evaluate`: set `el.value = '2020-01-01'; el.dispatchEvent(new Event('change', {bubbles:true}))`
      - `browser_press_key('Tab')`
      - `browser_wait_for(time=400)`
      - Run `probe.checkDateError({idx})` — if no error visible AND context is future-only → emit `dateAllowsPastForFutureField` (medium)
3. **Date range test:**
   - Run `probe.findDateRangePair` — returns `{startSelector, endSelector}` if a pair is detected
   - If found:
     a. Set start = `2026-12-31`, end = `2026-01-01` via `browser_evaluate`
     b. Wait 400ms
     c. Run `probe.checkRangeError` — if no error visible → emit `dateRangeEndBeforeStart` (high)
4. Run `probe.clearDateInputs` to leave the page clean.

## Probes (browser_evaluate)

```js
// probe.findDateInputs
() => {
  const out = [];
  const inputs = [...document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
    })
    .slice(0, 4);
  for (let i = 0; i < inputs.length; i++) {
    const el = inputs[i];
    const name = (el.name || el.id || '').toLowerCase();
    const labelText = (el.labels && el.labels[0] ? el.labels[0].innerText : '').toLowerCase();
    const context = name + ' ' + labelText;
    out.push({
      idx: i,
      type: el.type,
      name: el.name || el.id || `field${i}`,
      selector: el.id ? `#${el.id}` : `input[type="${el.type}"]:nth-of-type(${i+1})`,
      contextHint: /expir|due|appointment|schedule|reservation|booking|deliver|deadline/.test(context) ? 'future-only' :
                   /birth|dob|started|joined|registered|founded/.test(context) ? 'past-only' : 'neutral',
      hasMin: el.hasAttribute('min'),
      hasMax: el.hasAttribute('max')
    });
  }
  return out;
}
```

```js
// probe.checkDateError  — args: { idx }
({idx}) => {
  const inputs = document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"]');
  const el = inputs[idx];
  if (!el) return { errorVisible: false };
  const ariaInvalid = el.getAttribute('aria-invalid') === 'true';
  let cssInvalid = false;
  try { cssInvalid = el.matches(':invalid'); } catch (_) {}
  const container = el.closest('label, div, fieldset, .form-group, .field') || el.parentElement;
  const nearbyError = container && container.querySelector('[role="alert"], .error, .invalid-feedback, [data-testid*="error"]');
  return { errorVisible: ariaInvalid || cssInvalid || !!nearbyError };
}
```

```js
// probe.findDateRangePair
() => {
  const dates = [...document.querySelectorAll('input[type="date"], input[type="datetime-local"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled;
    });
  if (dates.length < 2) return { found: false };
  // Heuristic: first two date inputs in the same form
  for (let i = 0; i < dates.length - 1; i++) {
    if (dates[i].form && dates[i].form === dates[i + 1].form) {
      return {
        found: true,
        startSelector: dates[i].id ? `#${dates[i].id}` : `input[name="${dates[i].name}"]`,
        endSelector: dates[i + 1].id ? `#${dates[i + 1].id}` : `input[name="${dates[i + 1].name}"]`,
        startIdx: i,
        endIdx: i + 1
      };
    }
  }
  return { found: false };
}
```

```js
// probe.checkRangeError  — args: { endIdx }
({endIdx}) => {
  const dates = document.querySelectorAll('input[type="date"], input[type="datetime-local"]');
  const end = dates[endIdx];
  if (!end) return { errorVisible: false };
  const ariaInvalid = end.getAttribute('aria-invalid') === 'true';
  const container = end.closest('form') || end.closest('div, fieldset') || end.parentElement;
  const anyError = container && container.querySelector('[role="alert"], .error, .invalid-feedback, [data-testid*="error"]');
  const errorText = anyError ? anyError.innerText : '';
  return {
    errorVisible: ariaInvalid || (!!anyError && /(end|after|before|range|date)/i.test(errorText))
  };
}
```

```js
// probe.clearDateInputs
() => {
  const inputs = document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"]');
  for (const el of inputs) {
    try { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| dateInputNoMinMax | low | "Date input '{name}' has no min/max attributes — any date in the next 200 years is accepted" |
| dateAllowsPastForFutureField | medium | "Field '{name}' suggests a future date but accepted 2020-01-01 without showing an error" |
| dateRangeEndBeforeStart | high | "Date range accepts end date before start date with no validation error" |
