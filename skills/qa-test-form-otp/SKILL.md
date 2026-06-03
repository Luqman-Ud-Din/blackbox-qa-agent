---
name: qa-test-form-otp
description: "Tests OTP / verification-code multi-input fields: auto-advance to next box on keystroke, backspace returns to previous box, paste fills all boxes"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

For OTP / 2FA / verification code inputs split across multiple boxes (common pattern: 4–6 separate one-character inputs):
- Typing a digit auto-advances focus to the next input
- Pressing Backspace on an empty input returns focus to the previous input
- Pasting a full code distributes characters across all boxes

## Orchestrator flow

1. Run `probe.findOtpInputs` — returns `{found, boxCount, firstSelector}`. If `found` is false → **self-skip**.
2. **Test A — Auto-advance:**
   a. `browser_click` the first OTP input (focus it)
   b. `browser_type` text=`"1"` (single digit)
   c. `browser_wait_for(time=200)`
   d. Run `probe.checkFocusedBox` — returns `{focusedIdx}`. If `focusedIdx !== 1` → emit `otpNoAutoAdvance` (medium)
3. **Test B — Backspace return:**
   - From the now-focused input (idx 1), `browser_press_key` 'Backspace'
   - `browser_wait_for(time=200)`
   - Run `probe.checkFocusedBox` — if `focusedIdx !== 0` → emit `otpBackspaceNoReturn` (low)
4. **Test C — Paste fills all boxes:**
   - `browser_click` the first OTP input
   - Run `probe.simulatePaste` with value `"123456".slice(0, boxCount)`
   - `browser_wait_for(time=300)`
   - Run `probe.checkAllBoxesFilled` — if not all boxes filled → emit `otpPasteNotDistributed` (medium)
5. Run `probe.clearOtpInputs` to leave the page clean.

## Probes (browser_evaluate)

```js
// probe.findOtpInputs
() => {
  // OTP pattern: 4-6 single-character inputs in a tight horizontal cluster, often type=text with maxlength=1 or inputMode=numeric
  const candidates = [...document.querySelectorAll('input[maxlength="1"], input[inputmode="numeric"][maxlength="1"], input[type="tel"][maxlength="1"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled;
    });
  if (candidates.length < 4) return { found: false };
  // Verify they're in a cluster (same parent or near each other)
  const grouped = candidates.slice(0, 6);
  const first = grouped[0];
  const second = grouped[1];
  const dx = Math.abs(second.getBoundingClientRect().left - first.getBoundingClientRect().left);
  if (dx > 200) return { found: false };  // too far apart to be an OTP group
  // Mark each one so probes can find by index
  for (let i = 0; i < grouped.length; i++) {
    grouped[i].setAttribute('data-argus-otp', String(i));
  }
  return {
    found: true,
    boxCount: grouped.length,
    firstSelector: first.id ? `#${first.id}` : 'input[data-argus-otp="0"]'
  };
}
```

```js
// probe.checkFocusedBox
() => {
  const active = document.activeElement;
  if (!active) return { focusedIdx: -1 };
  const idx = active.getAttribute('data-argus-otp');
  return { focusedIdx: idx !== null ? parseInt(idx, 10) : -1 };
}
```

```js
// probe.simulatePaste  — args: { value }
({value}) => {
  const first = document.querySelector('input[data-argus-otp="0"]');
  if (!first) return { ok: false };
  first.focus();
  // Simulate clipboard paste
  const dt = new DataTransfer();
  dt.setData('text/plain', value);
  const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  first.dispatchEvent(pasteEvent);
  // Fallback: if no handler reacted, set the first box value to simulate manual paste
  if (!first.value) {
    first.value = value[0] || '';
    first.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return { ok: true };
}
```

```js
// probe.checkAllBoxesFilled
() => {
  const boxes = document.querySelectorAll('input[data-argus-otp]');
  let filled = 0;
  for (const b of boxes) if (b.value && b.value.length === 1) filled++;
  return { filled, total: boxes.length };
}
```

```js
// probe.clearOtpInputs
() => {
  const boxes = document.querySelectorAll('input[data-argus-otp]');
  for (const b of boxes) {
    try {
      b.value = '';
      b.dispatchEvent(new Event('input', { bubbles: true }));
      b.removeAttribute('data-argus-otp');
    } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| otpNoAutoAdvance | medium | "OTP input does not auto-advance focus to the next box on keystroke" |
| otpBackspaceNoReturn | low | "Backspace on an empty OTP box does not return focus to the previous box" |
| otpPasteNotDistributed | medium | "Pasting a full code into the first OTP box does not distribute characters across the remaining boxes" |
