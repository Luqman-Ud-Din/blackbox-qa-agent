---
name: qa-form-flow
description: "Consolidated form-flow skill. Owns multi-step wizards (Next validation, Back data preservation, step indicator) AND conditional fields (toggle reveals/hides fields, no stuck states, revealed fields interactive). Replaces 2 overlapping skills."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any bug about wizard navigation, multi-step forms, or conditional field show/hide belongs to this skill"
replaces:
  - qa-test-form-wizard
  - qa-test-form-conditional
---

# qa-form-flow — Consolidated Form Flow Skill

Single skill owning wizard navigation and conditional-field behavior.

## What it checks (5 issue types)

### Wizard
| issueType | severity | catches |
|---|---|---|
| `wizardNextNoValidation` | high | Wizard advances to next step without validating current step's required fields |
| `wizardBackLosesData` | high | Clicking Back loses data entered in previous step |
| `wizardNoStepIndicator` | medium | Multi-step form has no visible step indicator (or indicator doesn't reflect current step) |

### Conditional fields
| issueType | severity | catches |
|---|---|---|
| `conditionalFieldReadOnly` | medium | Toggling control reveals fields that are disabled or read-only |
| `conditionalFieldStuck` | medium | Deactivating control didn't hide previously-revealed fields |

## Self-skip
Single discovery probe detects wizard AND toggles in one call. If both empty → self-skip.

## Orchestrator flow

### Step 1 — Discovery
Run `probe.discoverFlowControls`. Returns:
```js
{ wizard: { isWizard, stepCount, currentStep, nextSelector, backSelector }, toggles: [...] }
```

### Step 2 — Wizard tests (if `isWizard` true)
a. Capture step fingerprint
b. Click Next → wait 500ms → re-capture
c. If step advanced AND prior step had unfilled required → emit `wizardNextNoValidation`
d. Fill step with markers → Next → Back → check markers preserved → emit `wizardBackLosesData` if lost
e. Run `probe.checkStepIndicator` → emit `wizardNoStepIndicator` if no/wrong indicator
f. Run `probe.resetWizard`

### Step 3 — Conditional toggle tests (if `toggles[]` non-empty, max 4)
For each toggle:
a. Snapshot baseline visible-field count
b. Activate toggle (click checkbox/radio, change select to secondValue)
c. Wait 400ms → re-snapshot
d. If field count unchanged → no conditional behavior → skip remaining tests
e. Else if new fields appeared:
   - Run `probe.checkRevealedFieldsInteractive` → emit `conditionalFieldReadOnly`
   - Deactivate toggle → wait 400ms → re-snapshot
   - If field count != baseline → emit `conditionalFieldStuck`

### Step 4 — Cleanup
Run `probe.resetToggles({controls})`.

## Probes (browser_evaluate)

```js
// probe.discoverFlowControls — single discovery for both wizard + toggles
() => {
  const out = { wizard: { isWizard: false }, toggles: [] };

  // WIZARD
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
  if (nextBtn && stepIndicators.length >= 2) {
    const sel = el => el.id ? `#${el.id}` : `button:has-text("${(el.innerText || el.value || '').trim().slice(0,20)}")`;
    out.wizard = {
      isWizard: true,
      stepCount: stepIndicators.length,
      currentStep: [...stepIndicators].findIndex(s =>
        s.getAttribute('aria-selected') === 'true' || s.getAttribute('aria-current') === 'step' ||
        /active|current|selected/i.test(s.className)
      ) + 1,
      nextSelector: sel(nextBtn),
      backSelector: backBtn ? sel(backBtn) : null
    };
  }

  // TOGGLES (checkbox + radio + selects with >= 2 options)
  const checks = [...document.querySelectorAll('input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled])')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, 3);
  for (const c of checks) {
    out.toggles.push({
      controlIdx: out.toggles.length, type: c.type,
      selector: c.id ? `#${c.id}` : `input[name="${c.name}"][type="${c.type}"]`
    });
  }
  const selects = [...document.querySelectorAll('select:not([disabled])')]
    .filter(s => s.options.length >= 2)
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, 2);
  for (const s of selects) {
    out.toggles.push({
      controlIdx: out.toggles.length, type: 'select',
      selector: s.id ? `#${s.id}` : `select[name="${s.name}"]`,
      secondValue: s.options[1].value
    });
  }
  out.toggles = out.toggles.slice(0, 4);
  return out;
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
  const requiredEmpty = [...visibleStep.querySelectorAll('[required], [aria-required="true"]')].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return !el.value || el.value.trim() === '' || (el.type === 'checkbox' && !el.checked);
  });
  const indicators = document.querySelectorAll('[role="tablist"] [role="tab"], .stepper [class*="step"], ol[class*="step"] > li');
  const activeIdx = [...indicators].findIndex(s =>
    s.getAttribute('aria-selected') === 'true' || s.getAttribute('aria-current') === 'step' ||
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
  const visibleStep = document.querySelector('[role="tabpanel"]:not([hidden]), [class*="step-content"]:not([hidden])') || document.querySelector('form');
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
  const visibleStep = document.querySelector('[role="tabpanel"]:not([hidden]), [class*="step-content"]:not([hidden])') || document.querySelector('form');
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
  const indicators = document.querySelectorAll('[role="tablist"] [role="tab"], .stepper [class*="step"], ol[class*="step"] > li');
  if (indicators.length < 2) return { hasIndicator: false, reflectsCurrent: false };
  const hasActive = [...indicators].some(s =>
    s.getAttribute('aria-selected') === 'true' || s.getAttribute('aria-current') === 'step' ||
    /active|current|selected/i.test(s.className)
  );
  return { hasIndicator: true, reflectsCurrent: hasActive };
}
```

```js
// probe.snapshotFieldCount
() => {
  const fields = [...document.querySelectorAll('input, select, textarea')].filter(el => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  return { visibleFieldCount: fields.length };
}
```

```js
// probe.checkRevealedFieldsInteractive
() => {
  const fields = [...document.querySelectorAll('input, select, textarea')].filter(el => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const stuck = fields.filter(f => (f.disabled || f.readOnly) && !f.hasAttribute('data-allow-readonly'));
  if (stuck.length > 0) return { foundStuck: true, stuckCount: stuck.length, sample: stuck[0].name || stuck[0].id || 'unknown' };
  return { foundStuck: false };
}
```

```js
// probe.resetWizard — best-effort restore to step 1
() => {
  for (let i = 0; i < 5; i++) {
    const back = [...document.querySelectorAll('button')].find(b =>
      /^(back|previous|prev)/i.test((b.innerText || '').trim()) && !b.disabled);
    if (!back) break;
    try { back.click(); } catch (_) { break; }
  }
  return { ok: true };
}
```

```js
// probe.resetToggles — args: { controls }
({controls}) => {
  for (const c of controls) {
    try {
      const el = document.querySelector(c.selector);
      if (!el) continue;
      if (c.type === 'checkbox' || c.type === 'radio') {
        if (el.checked) el.click();
      } else if (c.type === 'select') {
        if (el.options[0]) { el.value = el.options[0].value; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }
    } catch (_) {}
  }
  return { ok: true };
}
```

## Migration
```toml
[detectors]
qa-form-flow              = true
qa-test-form-wizard       = false
qa-test-form-conditional  = false
```
