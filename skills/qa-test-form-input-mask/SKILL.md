---
name: qa-test-form-input-mask
description: "Tests masked input fields (phone (___) ___-____, credit-card #### #### #### ####, IBAN, postal code): paste handles formatting, backspace works through the mask"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Masked inputs apply a format pattern as the user types (e.g., `(555) 123-4567`). Common bugs:
- Pasting `5551234567` does NOT auto-format
- Pasting `(555) 123-4567` (already-formatted) ends up double-formatted or malformed
- Backspace inside the mask gets stuck on a separator character
- HTML5 `pattern=` attribute is present but the input accepts non-matching values

## Orchestrator flow

1. Run `probe.detectMaskedInputs` — returns `[{idx, selector, maskHint, pattern}]`. If empty → **self-skip**.
2. For each masked input (max 2):
   a. **Test A — Pattern attribute enforcement:**
      - If `pattern` is present:
        - `browser_evaluate` to set value to `"INVALID@@@123"` (does not match)
        - `browser_press_key('Tab')`; wait 350ms
        - Run `probe.checkPatternRejection({idx})` — if no error/invalid state → emit `patternNotEnforced` (medium)
   b. **Test B — Paste unformatted value:**
      - If `maskHint` indicates a phone-like or card-like mask:
        - `browser_evaluate` clear field
        - Use `browser_type` text=<unformatted digits matching the mask length, e.g., `"5551234567"`>
        - `browser_press_key('Tab')`; wait 400ms
        - Run `probe.getMaskedValue({idx})` — if returned value lacks any separator chars (`-`, `(`, `)`, ` `, `.`) → emit `maskNotApplied` (medium)
   c. **Test C — Backspace through mask:**
      - Re-focus the input (`browser_click(selector)`)
      - Press Backspace 3 times (`browser_press_key` 'Backspace' three times)
      - Wait 400ms
      - Run `probe.getMaskedValue({idx})` — `valueAfterBackspace`
      - If `valueAfterBackspace.length` did not shrink by approximately 3 → emit `maskBackspaceStuck` (low)
3. Run `probe.clearMaskedInputs` to leave the page clean.

## Probes (browser_evaluate)

```js
// probe.detectMaskedInputs
() => {
  const out = [];
  const candidates = [...document.querySelectorAll('input[type="text"], input[type="tel"], input[type="search"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
    });
  for (let i = 0; i < candidates.length && out.length < 3; i++) {
    const el = candidates[i];
    const placeholder = el.placeholder || '';
    const name = (el.name + el.id).toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    // Mask hints: placeholder containing _, format dashes/parens, attribute hints
    const hasFormatPlaceholder = /[_(){}-]\s*[_({}\-)]|\(?___?\)?|####|####\s*####|XX\s*\/\s*XX|\d{2}\s*\/\s*\d{2}/.test(placeholder);
    const isPhoneish = /phone|mobile|tel/.test(name) || el.type === 'tel' || ac.includes('tel');
    const isCardish  = /card|cc.?num/.test(name) || ac.includes('cc-number');
    const isIban     = /iban|account.?number/.test(name);
    const isPostal   = /postal|zip/.test(name);
    if (!hasFormatPlaceholder && !isPhoneish && !isCardish && !isIban && !isPostal) continue;

    el.setAttribute('data-argus-mask', String(out.length));
    out.push({
      idx: out.length,
      selector: el.id ? `#${el.id}` : `[data-argus-mask="${out.length}"]`,
      maskHint: isPhoneish ? 'phone' : isCardish ? 'card' : isIban ? 'iban' : isPostal ? 'postal' : 'generic',
      pattern: el.pattern || null,
      placeholder
    });
  }
  return out;
}
```

```js
// probe.checkPatternRejection  — args: { idx }
({idx}) => {
  const el = document.querySelector(`[data-argus-mask="${idx}"]`);
  if (!el) return { rejected: false };
  const ariaInvalid = el.getAttribute('aria-invalid') === 'true';
  let cssInvalid = false;
  try { cssInvalid = el.matches(':invalid'); } catch (_) {}
  const container = el.closest('label, div, fieldset, .form-group, .field') || el.parentElement;
  const nearbyError = container && container.querySelector('[role="alert"], .error, .invalid-feedback, [data-testid*="error"]');
  return { rejected: ariaInvalid || cssInvalid || !!nearbyError };
}
```

```js
// probe.getMaskedValue  — args: { idx }
({idx}) => {
  const el = document.querySelector(`[data-argus-mask="${idx}"]`);
  if (!el) return { value: '' };
  return { value: el.value };
}
```

```js
// probe.clearMaskedInputs
() => {
  const inputs = document.querySelectorAll('[data-argus-mask]');
  for (const el of inputs) {
    try {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.removeAttribute('data-argus-mask');
    } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| patternNotEnforced | medium | "Input has pattern attribute but accepted a non-matching value without validation error" |
| maskNotApplied | medium | "Masked input ({maskHint}) accepted raw digits without applying format separators" |
| maskBackspaceStuck | low | "Backspace inside masked input did not shrink the value by the expected amount — may be stuck on separator chars" |
