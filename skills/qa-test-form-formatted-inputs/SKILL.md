---
name: qa-test-form-formatted-inputs
description: "Tests formatted inputs: credit card Luhn check, expiry-date format, phone number, number-type edge cases (negative, decimal, NaN)"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

- Credit card fields accept invalid Luhn-check numbers (e.g., `1234567890123456`)
- Card expiry fields accept past expiry dates (e.g., `01/20`)
- CVV fields accept too few digits or letters
- Phone fields accept obviously-invalid strings (`abc`, single digit)
- Number inputs handle negative values, decimals, and `NaN` / scientific notation appropriately

## Orchestrator flow

1. Run `probe.findFormattedInputs` — returns `{cardFields, expiryFields, cvvFields, phoneFields, numberFields}`. If all arrays empty → **self-skip**.
2. **Credit card:**
   For each card field (max 1):
     - `browser_evaluate` clear, then `browser_type` text=`"1234567890123456"` (fails Luhn)
     - `browser_press_key('Tab')`; wait 400ms
     - Run `probe.checkInputError({selector})` — if no error → emit `cardAcceptsInvalidLuhn` (high)
3. **Expiry:**
   For each expiry field (max 1):
     - `browser_evaluate` clear, then `browser_type` text=`"01/20"` (past)
     - `browser_press_key('Tab')`; wait 400ms
     - Run `probe.checkInputError({selector})` — if no error → emit `expiryAcceptsPastDate` (high)
4. **CVV:**
   For each CVV field (max 1):
     - `browser_evaluate` clear, then `browser_type` text=`"ab"` (letters, too short)
     - `browser_press_key('Tab')`; wait 400ms
     - Run `probe.checkInputError({selector})` — if no error → emit `cvvAcceptsLetters` (medium)
5. **Phone:**
   For each phone field (max 1):
     - `browser_evaluate` clear, then `browser_type` text=`"abc"`
     - `browser_press_key('Tab')`; wait 400ms
     - Run `probe.checkInputError({selector})` — if no error → emit `phoneAcceptsLetters` (medium)
6. **Number-type edge cases:**
   For each `input[type="number"]` (max 1):
     - Test value `-1` if context hints positive-only (price, age, quantity)
     - Test value `1.5` if `step` attribute is integer
     - Run `probe.checkInputError({selector})` — emit appropriate issue (medium)
7. Run `probe.clearFormattedFields` to leave page clean.

## Probes (browser_evaluate)

```js
// probe.findFormattedInputs
() => {
  const sel = el => el.id ? `#${el.id}` : `input[name="${el.name}"]`;
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
  };
  const fieldsBy = (predicate) => [...document.querySelectorAll('input, textarea')]
    .filter(visible).filter(predicate).slice(0, 1)
    .map(el => ({ selector: sel(el), name: el.name || el.id }));

  const cardFields = fieldsBy(el => {
    const ac = el.getAttribute('autocomplete') || '';
    const n = (el.name + el.id).toLowerCase();
    return ac.includes('cc-number') || /card.?number|cardnumber|cc.?num/.test(n);
  });
  const expiryFields = fieldsBy(el => {
    const ac = el.getAttribute('autocomplete') || '';
    const n = (el.name + el.id).toLowerCase();
    return ac.includes('cc-exp') || /expir|cc.?exp/.test(n);
  });
  const cvvFields = fieldsBy(el => {
    const ac = el.getAttribute('autocomplete') || '';
    const n = (el.name + el.id).toLowerCase();
    return ac.includes('cc-csc') || /cvv|cvc|csc|security.?code/.test(n);
  });
  const phoneFields = fieldsBy(el =>
    el.type === 'tel' || /phone|mobile|tel|whatsapp/.test((el.name + el.id).toLowerCase())
  );
  const numberFields = [...document.querySelectorAll('input[type="number"]')]
    .filter(visible).slice(0, 1).map(el => {
      const context = (el.name + el.id + (el.labels && el.labels[0] ? el.labels[0].innerText : '')).toLowerCase();
      return {
        selector: sel(el),
        name: el.name || el.id,
        positiveOnly: /price|amount|cost|age|quantity|qty|count|total/.test(context),
        integerOnly: !el.step || el.step === '1' || el.step === ''
      };
    });
  return { cardFields, expiryFields, cvvFields, phoneFields, numberFields };
}
```

```js
// probe.checkInputError  — args: { selector }
({selector}) => {
  let el;
  try { el = document.querySelector(selector); } catch (_) { return { errorVisible: false }; }
  if (!el) return { errorVisible: false };
  const ariaInvalid = el.getAttribute('aria-invalid') === 'true';
  let cssInvalid = false;
  try { cssInvalid = el.matches(':invalid'); } catch (_) {}
  const container = el.closest('label, div, fieldset, .form-group, .field') || el.parentElement;
  const nearbyError = container && container.querySelector(
    '[role="alert"], .error, .invalid-feedback, [data-testid*="error"], .text-red-500, .text-danger'
  );
  return { errorVisible: ariaInvalid || cssInvalid || !!nearbyError };
}
```

```js
// probe.clearFormattedFields
() => {
  const inputs = document.querySelectorAll('input, textarea');
  for (const el of inputs) {
    if (el.type === 'submit' || el.type === 'button' || el.type === 'hidden') continue;
    try { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| cardAcceptsInvalidLuhn | high | "Card number field accepted '1234567890123456' which fails Luhn check — no client-side validation" |
| expiryAcceptsPastDate | high | "Expiry field accepted past date '01/20' — no validation that expiry must be in the future" |
| cvvAcceptsLetters | medium | "CVV field accepted letters instead of digits-only" |
| phoneAcceptsLetters | medium | "Phone field accepted 'abc' — no numeric validation" |
| numberAcceptsNegative | medium | "Number field on positive-only context ({name}) accepted -1" |
| numberAcceptsDecimal | medium | "Number field with step=1 accepted decimal value 1.5" |
