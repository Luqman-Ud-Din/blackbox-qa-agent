---
name: qa-test-form-combobox
description: "Tests custom combobox / searchable dropdown / typeahead widgets: opens on click, filters on type, arrow keys navigate options, Enter selects, Escape closes"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Modern apps replace native `<select>` with searchable comboboxes (React-Select, Headless UI, Downshift, custom). Common bugs:
- Clicking the combobox does not open the listbox
- Typing does not filter the visible options
- Arrow Down/Up does not navigate the active option
- Enter on a highlighted option does not select it
- Escape does not close the listbox (keyboard trap)
- ARIA attributes missing (aria-expanded, aria-activedescendant, role="listbox")

## Orchestrator flow

1. Run `probe.detectComboboxes` — returns `[{idx, selector, hasAria, isOpenOnLoad}]`. If empty → **self-skip**.
2. For each combobox (max 2):
   a. **Test A — Click opens:**
      - If `isOpenOnLoad` is true → skip the open click
      - Else: `browser_click(selector=<combobox selector>)`
      - `browser_wait_for(time=400)`
      - Run `probe.checkListboxVisible` — if `visible` is false → emit `comboboxWontOpen` (high) and skip remaining tests on this combobox
   b. **Test B — Type filters:**
      - Run `probe.snapshotVisibleOptions` — `baselineCount`
      - `browser_type` text="a" into the combobox
      - `browser_wait_for(time=400)`
      - Run `probe.snapshotVisibleOptions` — `afterCount`
      - If `afterCount === baselineCount` AND `baselineCount > 3` → emit `comboboxNoTypeFilter` (medium)
   c. **Test C — Arrow Down + Enter selects:**
      - `browser_press_key('ArrowDown')`; wait 200ms
      - Run `probe.getActiveOptionText` — `optionA`
      - `browser_press_key('Enter')`; wait 300ms
      - Run `probe.getComboboxValue` — `selectedValue`
      - If `optionA.length > 0` AND `!selectedValue.includes(optionA)` → emit `comboboxEnterNoSelect` (high)
   d. **Test D — Escape closes:**
      - Re-open via click if needed
      - `browser_press_key('Escape')`; wait 300ms
      - Run `probe.checkListboxVisible` — if `visible` is still true → emit `comboboxEscapeNoClose` (medium)
   e. **Test E — ARIA attributes:**
      - If `hasAria` is false → emit `comboboxNoAria` (medium)
3. Run `probe.closeAllComboboxes` — best-effort dismiss all open listboxes.

## Probes (browser_evaluate)

```js
// probe.detectComboboxes
() => {
  const out = [];
  const candidates = [
    ...document.querySelectorAll(
      '[role="combobox"], ' +
      'input[role="combobox"], ' +
      '[class*="select"][class*="search"]:not(select), ' +
      '[class*="autocomplete"]:not(select), ' +
      '[class*="typeahead"]:not(select), ' +
      'div[class*="Select"]:not(select), ' +
      '[data-testid*="combobox"], ' +
      '[data-testid*="select"]:not(select)'
    )
  ]
    .filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (el.tagName.toLowerCase() === 'select') return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      return true;
    })
    .slice(0, 3);

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    el.setAttribute('data-argus-cb', String(i));
    out.push({
      idx: i,
      selector: el.id ? `#${el.id}` : `[data-argus-cb="${i}"]`,
      hasAria: el.getAttribute('role') === 'combobox' ||
               el.hasAttribute('aria-expanded') ||
               el.hasAttribute('aria-haspopup') ||
               !!el.querySelector('[role="combobox"]'),
      isOpenOnLoad: el.getAttribute('aria-expanded') === 'true'
    });
  }
  return out;
}
```

```js
// probe.checkListboxVisible
() => {
  const candidates = document.querySelectorAll(
    '[role="listbox"]:not([aria-hidden="true"]), ' +
    '[role="option"]:not([aria-hidden="true"])'
  );
  for (const c of candidates) {
    const r = c.getBoundingClientRect();
    const style = getComputedStyle(c);
    if (r.width > 50 && r.height > 20 && style.display !== 'none' && style.visibility !== 'hidden') {
      return { visible: true };
    }
  }
  // Fallback: any "open"/"expanded" container
  const opened = document.querySelector(
    '[class*="menu"][class*="open"], [class*="dropdown"][class*="open"], ' +
    '[class*="listbox"]:not([hidden]), [data-state="open"][role="listbox"]'
  );
  if (opened) {
    const r = opened.getBoundingClientRect();
    if (r.width > 50 && r.height > 20) return { visible: true };
  }
  return { visible: false };
}
```

```js
// probe.snapshotVisibleOptions
() => {
  const options = [...document.querySelectorAll('[role="option"]:not([aria-hidden="true"])')]
    .filter(o => {
      const r = o.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  return { visibleOptionCount: options.length };
}
```

```js
// probe.getActiveOptionText
() => {
  const active = document.querySelector(
    '[role="option"][aria-selected="true"], [role="option"][data-highlighted], ' +
    '[role="option"][class*="active"], [role="option"][class*="highlighted"], ' +
    '[role="option"][data-state="active"]'
  );
  if (!active) return { text: '' };
  return { text: (active.innerText || '').trim().slice(0, 60) };
}
```

```js
// probe.getComboboxValue
() => {
  const cb = document.querySelector('[data-argus-cb]');
  if (!cb) return { value: '' };
  // Read displayed value: input value, OR innerText of the combobox itself
  const input = cb.querySelector('input') || (cb.tagName.toLowerCase() === 'input' ? cb : null);
  if (input) return { value: input.value || '' };
  return { value: (cb.innerText || '').trim().slice(0, 80) };
}
```

```js
// probe.closeAllComboboxes
() => {
  const opens = document.querySelectorAll('[aria-expanded="true"]');
  for (const el of opens) {
    try { el.click(); } catch (_) {}
  }
  // Also press Escape via the document
  try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
  // Remove our tracking attribute
  for (const el of document.querySelectorAll('[data-argus-cb]')) {
    try { el.removeAttribute('data-argus-cb'); } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| comboboxWontOpen | high | "Clicking custom combobox did not open a visible listbox" |
| comboboxNoTypeFilter | medium | "Typing into combobox did not filter the visible options" |
| comboboxEnterNoSelect | high | "Pressing Enter on a highlighted combobox option did not select it" |
| comboboxEscapeNoClose | medium | "Escape key did not close the combobox listbox — possible keyboard trap" |
| comboboxNoAria | medium | "Custom combobox missing role=combobox / aria-expanded / aria-haspopup — screen readers can't operate it" |
