---
name: qa-test-form-password-rules
description: "Tests password fields for: weak-password acceptance, strength meter presence, and confirm-password mismatch detection"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

For signup/registration forms with password fields:
- Typing a weak password (`123`) does NOT show a "strong" indicator or pass validation
- A visible strength indicator or rule list is present
- If a confirm-password field exists, mismatching values triggers a visible error

## Orchestrator flow

1. Run `probe.findPasswordFields` — returns `{passwordCount, primary, confirm}`. If `passwordCount` < 1 → **self-skip**.
2. **Test A — weak password**
   - `browser_evaluate` clear primary field
   - `browser_type` text=`"123"` into primary
   - `browser_press_key` 'Tab'
   - `browser_wait_for(time=400)`
   - Run `probe.checkPasswordWeakIndicator` — if no strength indicator OR no error → emit `passwordNoStrengthFeedback` (medium)
3. **Test B — confirm-password mismatch** (only if `confirm` selector is present)
   - `browser_evaluate` clear both fields
   - `browser_type` text=`"Password123!"` into primary
   - `browser_press_key` 'Tab'
   - `browser_type` text=`"different456!"` into confirm
   - `browser_press_key` 'Tab'
   - `browser_wait_for(time=400)`
   - Run `probe.checkConfirmMismatchError` — if no mismatch error visible → emit `confirmPasswordNoMismatchError` (high)
4. Run `probe.clearPasswordFields` to leave the page clean.

## Probes (browser_evaluate)

```js
// probe.findPasswordFields
() => {
  const pwds = [...document.querySelectorAll('input[type="password"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled;
    });
  if (pwds.length === 0) return { passwordCount: 0 };
  const sel = el => el.id ? `#${el.id}` : `input[name="${el.name}"]`;
  const primary = pwds[0];
  const confirm = pwds.length >= 2 ? pwds[1] : null;
  return {
    passwordCount: pwds.length,
    primary: { selector: sel(primary), name: primary.name || primary.id || 'password' },
    confirm: confirm ? { selector: sel(confirm), name: confirm.name || confirm.id || 'confirm-password' } : null
  };
}
```

```js
// probe.checkPasswordWeakIndicator
() => {
  // 1. Look for strength indicator components
  const strengthEls = document.querySelectorAll(
    '[class*="strength"], [data-testid*="strength"], [aria-label*="strength" i], ' +
    '[class*="password-meter"], [role="progressbar"][aria-label*="password" i]'
  );
  if (strengthEls.length > 0) {
    // Check if the indicator says "weak" / "low" for a "123" input
    const text = [...strengthEls].map(e => e.innerText).join(' ').toLowerCase();
    return {
      hasIndicator: true,
      indicatesWeak: /weak|low|poor|too short/.test(text)
    };
  }
  // 2. Look for visible error/warning near the password field
  const pwd = document.querySelector('input[type="password"]');
  if (pwd) {
    const container = pwd.closest('label, div, fieldset, .form-group, .field') || pwd.parentElement;
    const err = container && container.querySelector(
      '[role="alert"], .error, .invalid-feedback, [data-testid*="error"], .text-danger, .password-error'
    );
    if (err) return { hasIndicator: true, indicatesWeak: true };
  }
  return { hasIndicator: false, indicatesWeak: false };
}
```

```js
// probe.checkConfirmMismatchError
() => {
  const pwds = [...document.querySelectorAll('input[type="password"]')];
  if (pwds.length < 2) return { mismatchErrorVisible: false };
  const confirm = pwds[1];
  const container = confirm.closest('label, div, fieldset, .form-group, .field, form') || confirm.parentElement;
  if (!container) return { mismatchErrorVisible: false };
  const err = container.querySelector(
    '[role="alert"], .error, .invalid-feedback, [data-testid*="error"], .text-danger, .field-error'
  );
  const ariaInvalid = confirm.getAttribute('aria-invalid') === 'true';
  if (ariaInvalid || (err && /match|same|confirm|differ/i.test(err.innerText))) {
    return { mismatchErrorVisible: true };
  }
  return { mismatchErrorVisible: false };
}
```

```js
// probe.clearPasswordFields
() => {
  const pwds = document.querySelectorAll('input[type="password"]');
  for (const p of pwds) {
    try { p.value = ''; p.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| passwordNoStrengthFeedback | medium | "Password field accepts '123' without showing a strength indicator or weak-password error" |
| confirmPasswordNoMismatchError | high | "Mismatching password and confirm-password produced no visible error — users will create accounts with typo'd passwords" |
