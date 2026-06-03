---
name: qa-test-form-tag-input
description: "Tests tag / chip input widgets: pressing Enter adds a chip, clicking the X removes a chip, comma-separated paste creates multiple chips"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Tag / chip inputs (multi-value text inputs) are used for tags, recipients, skills, categories. Common bugs:
- Typing then pressing Enter does not create a chip
- The X / close icon on a chip doesn't remove it
- Pasting comma-separated values does not split into multiple chips
- Max-tag limit not enforced

## Orchestrator flow

1. Run `probe.detectTagInputs` — returns `[{idx, inputSelector, baselineChipCount}]`. If empty → **self-skip**.
2. For each tag input (max 2):
   a. **Test A — Enter adds chip:**
      - `browser_click(selector=<input selector>)`
      - `browser_type` text=`"argusTag1"`
      - `browser_press_key('Enter')`
      - `browser_wait_for(time=400)`
      - Run `probe.countChips({idx})` — if `chipCount` did not increase by 1 → emit `tagInputEnterNoAdd` (high)
   b. **Test B — Comma-separated paste splits:**
      - `browser_click(selector=<input selector>)`
      - Run `probe.simulatePasteTags({idx, value: "argusA, argusB, argusC"})`
      - `browser_wait_for(time=500)`
      - Run `probe.countChips({idx})` — if `chipCount` did not increase by 3 → emit `tagInputPasteNoSplit` (medium)
   c. **Test C — Remove chip:**
      - Run `probe.removeFirstAddedChip({idx})` — clicks the X on the last chip
      - `browser_wait_for(time=300)`
      - Run `probe.countChips({idx})` — if `chipCount` did not decrease → emit `tagInputRemoveBroken` (high)
3. Run `probe.cleanupTagInputs` — best-effort remove any test chips remaining.

## Probes (browser_evaluate)

```js
// probe.detectTagInputs
() => {
  const out = [];
  // Pattern A: input with role="combobox" aria-multiselectable
  // Pattern B: container with chips + child input
  const containers = [
    ...document.querySelectorAll(
      '[class*="tag"][class*="input"], [class*="chip"][class*="input"], ' +
      '[class*="multiselect"], [class*="MuiAutocomplete"], ' +
      '[role="combobox"][aria-multiselectable="true"], ' +
      '[data-testid*="tag-input"], [data-testid*="chip-input"]'
    )
  ]
    .filter(el => {
      const r = el.getBoundingClientRect();
      const input = el.querySelector('input[type="text"], input:not([type])');
      return r.width > 0 && r.height > 0 && input && !input.disabled;
    })
    .slice(0, 3);

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    container.setAttribute('data-argus-tag', String(i));
    const input = container.querySelector('input[type="text"], input:not([type])');
    const existingChips = container.querySelectorAll(
      '[class*="chip"], [class*="tag"], [role="button"][aria-label*="remove" i], [data-tag]'
    );
    out.push({
      idx: i,
      inputSelector: input.id ? `#${input.id}` : `[data-argus-tag="${i}"] input`,
      baselineChipCount: existingChips.length
    });
  }
  return out;
}
```

```js
// probe.countChips  — args: { idx }
({idx}) => {
  const container = document.querySelector(`[data-argus-tag="${idx}"]`);
  if (!container) return { chipCount: 0 };
  const chips = container.querySelectorAll(
    '[class*="chip"], [class*="tag"]:not(input), [role="button"][aria-label*="remove" i], [data-tag]'
  );
  // Filter to actual visible chip elements (not the input itself)
  const visible = [...chips].filter(c => {
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && c.tagName.toLowerCase() !== 'input';
  });
  return { chipCount: visible.length };
}
```

```js
// probe.simulatePasteTags  — args: { idx, value }
({idx, value}) => {
  const container = document.querySelector(`[data-argus-tag="${idx}"]`);
  if (!container) return { ok: false };
  const input = container.querySelector('input[type="text"], input:not([type])');
  if (!input) return { ok: false };
  input.focus();
  // Dispatch a paste event
  const dt = new DataTransfer();
  dt.setData('text/plain', value);
  const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  input.dispatchEvent(pasteEvent);
  // Fallback: if paste handler didn't fire, manually set value and trigger input + Enter
  if (!input.value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  }
  return { ok: true };
}
```

```js
// probe.removeFirstAddedChip  — args: { idx }
({idx}) => {
  const container = document.querySelector(`[data-argus-tag="${idx}"]`);
  if (!container) return { clicked: false };
  // Find any chip whose text starts with "argus" (one we added)
  const chips = [...container.querySelectorAll('[class*="chip"], [class*="tag"]:not(input), [data-tag]')];
  const ours = chips.find(c => /argus/i.test(c.innerText || ''));
  if (!ours) return { clicked: false };
  // Click the remove button inside the chip (X icon)
  const removeBtn = ours.querySelector('[aria-label*="remove" i], [class*="close"], [class*="remove"], button, svg');
  const target = removeBtn || ours;
  try { target.click(); } catch (_) { return { clicked: false }; }
  return { clicked: true };
}
```

```js
// probe.cleanupTagInputs
() => {
  const containers = document.querySelectorAll('[data-argus-tag]');
  for (const container of containers) {
    const chips = [...container.querySelectorAll('[class*="chip"], [class*="tag"]:not(input), [data-tag]')];
    for (const c of chips) {
      if (/argus/i.test(c.innerText || '')) {
        const removeBtn = c.querySelector('[aria-label*="remove" i], [class*="close"], [class*="remove"], button, svg');
        try { (removeBtn || c).click(); } catch (_) {}
      }
    }
    try { container.removeAttribute('data-argus-tag'); } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| tagInputEnterNoAdd | high | "Pressing Enter after typing in tag input did not create a chip" |
| tagInputPasteNoSplit | medium | "Pasting comma-separated values into tag input did not split into multiple chips" |
| tagInputRemoveBroken | high | "Clicking the remove icon on a chip did not remove it" |
