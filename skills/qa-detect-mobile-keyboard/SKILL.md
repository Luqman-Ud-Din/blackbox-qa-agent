---
name: qa-detect-mobile-keyboard
description: "Detects layout that breaks when the on-screen keyboard appears AND inputs with wrong type/inputmode that show the wrong keyboard on mobile (QWERTY instead of numpad, etc.)"
model: haiku
applyOn: [mobile]
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

- **Wrong mobile keyboard** — input fields whose label/name/placeholder implies a specific data type (phone, email, postal code, card number, amount) but lack the correct `type` or `inputmode` attribute. Users get QWERTY when they need a numpad.
- **Input hidden by keyboard** — a fixed bottom bar covers the focused input when the on-screen keyboard appears
- **No scroll-into-view** — focused input in the lower 40% of viewport and page doesn't scroll it up
- **No visualViewport API** — page cannot dynamically respond to keyboard appearance

## Orchestrator flow

0. Run `probe.checkInputMobileKeyboards` (passive) — emit `wrongMobileKeyboard` for each mismatched input. Does not interact with the page.
1. Run `probe.findInputForKeyboardTest` — returns `{found, selector, initialPosition}`. If `found` is false → **self-skip**.
2. `browser_click(selector=<input selector>)` — focus it (does not summon a real keyboard in headless, but triggers focus handlers)
3. `browser_wait_for(time=400)` — allow any scroll-into-view JS to run
4. Run `probe.checkInputVisibilityAfterFocus({selector})` — measures position relative to simulated keyboard zone
5. Emit findings:
   - If `coveredByBottomFixed` is true → emit `inputHiddenByBottomBar` (high)
   - If `inKeyboardZone` is true AND `didScrollIntoView` is false → emit `inputInKeyboardZoneNoScroll` (medium)
   - If site has no visualViewport listener → emit `noVisualViewportHandling` (low)
6. Run `probe.blurInput({selector})` — blur it to leave page clean.

## Probes (browser_evaluate)

```js
// probe.checkInputMobileKeyboards — passive scan, no interaction
() => {
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const heuristics = [
    { test: /phone|tel|mobile|cell|fax/i,              expectedType: 'tel',    expectedInputmode: 'tel',     label: 'phone number' },
    { test: /email|e-mail/i,                            expectedType: 'email',  expectedInputmode: 'email',   label: 'email address' },
    { test: /zip|postal|postcode/i,                     expectedType: 'text',   expectedInputmode: 'numeric', label: 'ZIP/postal code' },
    { test: /card.?num|credit.?card|debit.?card/i,      expectedType: 'text',   expectedInputmode: 'numeric', label: 'card number' },
    { test: /cvv|cvc|security.?code/i,                  expectedType: 'text',   expectedInputmode: 'numeric', label: 'CVV' },
    { test: /\bamount\b|\bprice\b|\bcost\b|\bqty\b|\bquantity\b|\bage\b|\bpin\b/i, expectedType: 'number', expectedInputmode: 'numeric', label: 'numeric value' },
    { test: /\bsearch\b/i,                              expectedType: 'search', expectedInputmode: 'search',  label: 'search field' },
  ];
  for (const input of document.querySelectorAll('input[type="text"], input:not([type])')) {
    if (out.length >= 10) break;
    const r = input.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || input.disabled || input.readOnly) continue;
    const labelEl = input.labels && input.labels[0];
    const labelText = (
      (labelEl && (labelEl.innerText || labelEl.textContent)) ||
      input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.name || ''
    ).toLowerCase();
    if (!labelText) continue;
    const currentType = (input.type || 'text').toLowerCase();
    const currentInputmode = (input.getAttribute('inputmode') || '').toLowerCase();
    const sel = input.id ? `#${input.id}` : (input.name ? `[name="${input.name}"]` : 'input');
    for (const h of heuristics) {
      if (!h.test.test(labelText)) continue;
      const typeOk = currentType === h.expectedType;
      const modeOk = currentInputmode === h.expectedInputmode;
      if (!typeOk && !modeOk) {
        out.push({ issueType: 'wrongMobileKeyboard', severity: 'medium', selector: sel,
          description: `"${labelText}" field uses type="${currentType}" without inputmode="${h.expectedInputmode}" — mobile users see QWERTY instead of the ${h.expectedInputmode} keyboard`,
          bbox: bb(input) });
      }
      break;
    }
  }
  return out;
}
```

```js
// probe.findInputForKeyboardTest
() => {
  // Pick the LAST visible text input on the page (most likely to be in the keyboard zone)
  const inputs = [...document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], input[type="search"], textarea')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
    });
  if (inputs.length === 0) return { found: false };
  // Choose the one furthest down — most likely to be hit by the keyboard
  inputs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const target = inputs[inputs.length - 1];
  const r = target.getBoundingClientRect();
  return {
    found: true,
    selector: target.id ? `#${target.id}` : `[name="${target.name || ''}"]`,
    initialPosition: { top: Math.round(r.top), bottom: Math.round(r.bottom) }
  };
}
```

```js
// probe.checkInputVisibilityAfterFocus  — args: { selector }
({selector}) => {
  let el;
  try { el = document.querySelector(selector); } catch (_) { return { coveredByBottomFixed: false }; }
  if (!el) return { coveredByBottomFixed: false };

  const vh = window.innerHeight;
  const r = el.getBoundingClientRect();
  // Simulated keyboard zone: lower 40% of the viewport on iOS, ~50% on Android
  const keyboardTop = vh * 0.6;
  const inKeyboardZone = r.bottom > keyboardTop;

  // Check for fixed/sticky bottom bars covering the input
  let coveredByBottomFixed = false;
  let coveringSelector = '';
  for (const c of document.querySelectorAll('[class*="bottom"], [class*="footer"], [class*="tab-bar"], [class*="sticky"], [class*="fixed"]')) {
    const cs = getComputedStyle(c);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const cr = c.getBoundingClientRect();
    if (cr.height === 0) continue;
    // Bar at the bottom of the viewport
    if (cr.bottom > vh - 4 && cr.top > vh - 200) {
      // Does it overlap the input vertically?
      if (cr.top < r.bottom && cr.bottom > r.top) {
        coveredByBottomFixed = true;
        coveringSelector = c.id ? `#${c.id}` : c.tagName.toLowerCase();
        break;
      }
    }
  }

  // visualViewport API usage check (heuristic): does any script attach an event listener?
  // This is impossible to read directly. Instead, we check whether window.visualViewport exists
  // (it does on modern browsers) AND whether there's a function on window that mentions it.
  const visualViewportAvailable = !!window.visualViewport;

  // Heuristic for scroll-into-view: was input.scrollIntoView() called?
  // We can't observe this directly. Approximation: did the input position change between baseline and now?
  // The orchestrator carries `initialPosition` from probe.findInputForKeyboardTest and compares.

  return {
    coveredByBottomFixed,
    coveringSelector,
    inKeyboardZone,
    currentTop: Math.round(r.top),
    visualViewportAvailable
  };
}
```

```js
// probe.blurInput  — args: { selector }
({selector}) => {
  try {
    const el = document.querySelector(selector);
    if (el) el.blur();
    document.body.focus();
  } catch (_) {}
  return { ok: true };
}
```

The orchestrator compares `currentTop` to the `initialPosition.top` it captured in step 1 to decide whether the page scrolled the input into view automatically. If they're identical AND `inKeyboardZone` is true, emit `inputInKeyboardZoneNoScroll`.

## Issues
| issueType | severity | description |
|---|---|---|
| wrongMobileKeyboard | medium | '"{label}" field uses type="{t}" without inputmode="{mode}" — mobile users see QWERTY instead of the correct keyboard' |
| inputHiddenByBottomBar | high | "Focused input is overlapped by a fixed bottom bar — keyboard would cover even more of the input on real device" |
| inputInKeyboardZoneNoScroll | medium | "Focused input sits in the lower 40% of the viewport and the page did not scroll it into view — on real device the keyboard hides it" |
| noVisualViewportHandling | low | "Site does not appear to use the visualViewport API — cannot dynamically respond to keyboard appearance" |
