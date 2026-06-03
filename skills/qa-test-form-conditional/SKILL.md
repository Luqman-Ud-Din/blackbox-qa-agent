---
name: qa-test-form-conditional
description: "Tests conditional form fields — checkboxes/radios/selects that reveal or hide other fields when toggled"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Many forms have "If yes, please specify…" type interactions — toggling a checkbox or selecting a dropdown option should reveal new fields, and unselecting should hide them. Common bugs:
- New fields don't appear when trigger is activated
- New fields appear but stay visible when trigger is deactivated (stuck)
- Newly-revealed fields are read-only or disabled when they should be interactive

## Orchestrator flow

1. Run `probe.findToggleControls` — returns `[{controlIdx, type, selector}]`. Limit 4. If empty → **self-skip**.
2. Run `probe.snapshotFieldCount` — returns `{visibleFieldCount}`. Save as `baseline`.
3. For each control (max 4):
   a. **Activate the toggle:**
      - For checkbox/radio: `browser_click` the selector
      - For select: `browser_select_option` with the second option's value (`probe.findToggleControls` includes a `secondValue` field for selects)
   b. `browser_wait_for(time=400)` — allow conditional show/hide to run
   c. Run `probe.snapshotFieldCount` — `afterActivate.visibleFieldCount`
   d. If `afterActivate.visibleFieldCount === baseline` → no conditional behavior detected → skip remaining tests on this control
   e. Else if new fields appeared:
      - Run `probe.checkRevealedFieldsInteractive` — if any newly-visible field is disabled/readonly when it shouldn't be → emit `conditionalFieldReadOnly` (medium)
      - **Deactivate the toggle:** click again (or restore select to first option)
      - `browser_wait_for(time=400)`
      - Run `probe.snapshotFieldCount` — `afterDeactivate.visibleFieldCount`
      - If `afterDeactivate.visibleFieldCount !== baseline` → emit `conditionalFieldStuck` (medium) — fields didn't hide back
4. Run `probe.resetToggles` — best-effort restore.

## Probes (browser_evaluate)

```js
// probe.findToggleControls
() => {
  const out = [];
  const checks = [...document.querySelectorAll('input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled])')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .slice(0, 3);
  for (let i = 0; i < checks.length; i++) {
    out.push({
      controlIdx: out.length,
      type: checks[i].type,
      selector: checks[i].id ? `#${checks[i].id}` : `input[name="${checks[i].name}"][type="${checks[i].type}"]`
    });
  }
  const selects = [...document.querySelectorAll('select:not([disabled])')]
    .filter(s => s.options.length >= 2)
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .slice(0, 2);
  for (const sel of selects) {
    out.push({
      controlIdx: out.length,
      type: 'select',
      selector: sel.id ? `#${sel.id}` : `select[name="${sel.name}"]`,
      secondValue: sel.options[1].value
    });
  }
  return out.slice(0, 4);
}
```

```js
// probe.snapshotFieldCount
() => {
  const fields = [...document.querySelectorAll('input, select, textarea')]
    .filter(el => {
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
  const fields = [...document.querySelectorAll('input, select, textarea')]
    .filter(el => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  const stuck = fields.filter(f => (f.disabled || f.readOnly) && !f.hasAttribute('data-allow-readonly'));
  if (stuck.length > 0) {
    return {
      foundStuck: true,
      stuckCount: stuck.length,
      sample: stuck[0].name || stuck[0].id || 'unknown'
    };
  }
  return { foundStuck: false };
}
```

```js
// probe.resetToggles  — args: { controls }
({controls}) => {
  for (const c of controls) {
    try {
      const el = document.querySelector(c.selector);
      if (!el) continue;
      if (c.type === 'checkbox' || c.type === 'radio') {
        if (el.checked) { el.click(); }
      } else if (c.type === 'select') {
        if (el.options[0]) { el.value = el.options[0].value; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }
    } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| conditionalFieldReadOnly | medium | "Toggling control {selector} revealed new fields that are disabled or read-only" |
| conditionalFieldStuck | medium | "Deactivating control {selector} did not hide previously-revealed fields — stays in revealed state" |
