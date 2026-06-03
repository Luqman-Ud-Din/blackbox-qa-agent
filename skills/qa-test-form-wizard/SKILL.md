---
name: qa-test-form-wizard
description: "Tests multi-step form wizards: Next button navigation, Back preserves data, step indicator updates, per-step validation gating"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Multi-step forms (wizards) commonly break in three ways:
- Clicking Next without filling required fields proceeds anyway (no per-step validation)
- Clicking Back loses data entered in the previous step
- Step indicator does not visually update to reflect current step

## Orchestrator flow

1. Run `probe.detectWizard` — returns `{isWizard, stepCount, currentStep, nextSelector, backSelector, indicatorSelector}`. If `isWizard` is false → **self-skip**.
2. **Test A — Next without filling required fields:**
   a. Run `probe.captureStepFingerprint` — returns `{step, fingerprint}` (DOM hash of current step)
   b. `browser_click` the Next button
   c. `browser_wait_for(time=500)`
   d. Run `probe.captureStepFingerprint`
   e. If `step` advanced AND first step had unfilled required fields → emit `wizardNextNoValidation` (high)
3. **Test B — Back preserves data:**
   - If currently on step 1: skip to step 4 (no Back to test)
   - Run `probe.fillStepWithMarkers` — fills any empty text inputs with `argusM<idx>` markers
   - `browser_click` Next button → wait 500ms
   - On the next step, `browser_click` Back button → wait 500ms
   - Run `probe.checkMarkersStillPresent` — if any marker is gone → emit `wizardBackLosesData` (high)
4. **Test C — Step indicator:**
   - Run `probe.checkStepIndicator` — if no visible indicator OR indicator does not reflect current step → emit `wizardNoStepIndicator` (medium)
5. Run `probe.resetWizard` — best-effort restore to step 1.

## Probes (browser_evaluate)

```js
// probe.detectWizard
() => {
  // Wizard heuristics: presence of step indicators OR Next/Back buttons with step semantics
  const stepIndicators = document.querySelectorAll(
    '[role="tablist"] [role="tab"], .stepper [class*="step"], [class*="wizard"] [class*="step"], ' +
    '[aria-label*="step" i], ol[class*="step"] > li, [data-step]'
  );
  const nextBtn = [...document.querySelectorAll('button, input[type="submit"]')].find(b => {
    const t = (b.innerText || b.value || '').toLowerCase().trim();
    return /^(next|continue|proceed|step\s*\d)/i.test(t) && !b.disabled;
  });
  const backBtn = [...document.querySelectorAll('button, a[role="button"]')].find(b => {
    const t = (b.innerText || '').toLowerCase().trim();
    return /^(back|previous|prev|step\s*back)/i.test(t);
  });
  if (!nextBtn || stepIndicators.length < 2) return { isWizard: false };
  const sel = el => el.id ? `#${el.id}` : `button:has-text("${(el.innerText || el.value || '').trim().slice(0,20)}")`;
  return {
    isWizard: true,
    stepCount: stepIndicators.length,
    currentStep: [...stepIndicators].findIndex(s =>
      s.getAttribute('aria-selected') === 'true' ||
      s.getAttribute('aria-current') === 'step' ||
      /active|current|selected/i.test(s.className)
    ) + 1,
    nextSelector: sel(nextBtn),
    backSelector: backBtn ? sel(backBtn) : null
  };
}
```

```js
// probe.captureStepFingerprint
() => {
  const visibleStep = document.querySelector(
    '[role="tabpanel"]:not([hidden]), [aria-hidden="false"][role="tabpanel"], ' +
    '[class*="step-content"]:not([hidden]), [data-step][aria-current="step"]'
  ) || document.querySelector('form');
  if (!visibleStep) return { step: 0, fingerprint: '', hasUnfilledRequired: false };
  const requiredEmpty = [...visibleStep.querySelectorAll('[required], [aria-required="true"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return !el.value || el.value.trim() === '' || (el.type === 'checkbox' && !el.checked);
    });
  // Step number — find active indicator
  const indicators = document.querySelectorAll(
    '[role="tablist"] [role="tab"], .stepper [class*="step"], ol[class*="step"] > li'
  );
  const activeIdx = [...indicators].findIndex(s =>
    s.getAttribute('aria-selected') === 'true' ||
    s.getAttribute('aria-current') === 'step' ||
    /active|current|selected/i.test(s.className)
  );
  return {
    step: activeIdx + 1,
    fingerprint: visibleStep.innerHTML.length + ':' + visibleStep.querySelectorAll('input, select, textarea').length,
    hasUnfilledRequired: requiredEmpty.length > 0
  };
}
```

```js
// probe.fillStepWithMarkers
() => {
  const visibleStep = document.querySelector(
    '[role="tabpanel"]:not([hidden]), [class*="step-content"]:not([hidden])'
  ) || document.querySelector('form');
  if (!visibleStep) return { filled: 0 };
  const inputs = [...visibleStep.querySelectorAll('input[type="text"], input[type="email"], textarea')];
  let filled = 0;
  for (let i = 0; i < Math.min(inputs.length, 4); i++) {
    if (!inputs[i].value) {
      inputs[i].value = `argusM${i}`;
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
      filled++;
    }
  }
  return { filled };
}
```

```js
// probe.checkMarkersStillPresent
() => {
  const visibleStep = document.querySelector(
    '[role="tabpanel"]:not([hidden]), [class*="step-content"]:not([hidden])'
  ) || document.querySelector('form');
  if (!visibleStep) return { allPresent: false, lost: -1 };
  const inputs = [...visibleStep.querySelectorAll('input[type="text"], input[type="email"], textarea')];
  let lost = 0;
  for (let i = 0; i < Math.min(inputs.length, 4); i++) {
    if (!inputs[i].value.includes(`argusM${i}`)) lost++;
  }
  return { allPresent: lost === 0, lost };
}
```

```js
// probe.checkStepIndicator
() => {
  const indicators = document.querySelectorAll(
    '[role="tablist"] [role="tab"], .stepper [class*="step"], ol[class*="step"] > li'
  );
  if (indicators.length < 2) return { hasIndicator: false, reflectsCurrent: false };
  const hasActive = [...indicators].some(s =>
    s.getAttribute('aria-selected') === 'true' ||
    s.getAttribute('aria-current') === 'step' ||
    /active|current|selected/i.test(s.className)
  );
  return { hasIndicator: true, reflectsCurrent: hasActive };
}
```

```js
// probe.resetWizard
() => {
  // best-effort: click any "step 1" indicator or Back repeatedly (max 5 times)
  for (let i = 0; i < 5; i++) {
    const back = [...document.querySelectorAll('button')].find(b =>
      /^(back|previous|prev)/i.test((b.innerText || '').trim()) && !b.disabled
    );
    if (!back) break;
    try { back.click(); } catch (_) { break; }
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| wizardNextNoValidation | high | "Wizard advanced to next step without validating required fields on current step" |
| wizardBackLosesData | high | "Clicking Back lost data entered in the previous step — users will rage-quit on long forms" |
| wizardNoStepIndicator | medium | "Multi-step form has no visible step indicator or indicator does not reflect current step" |
