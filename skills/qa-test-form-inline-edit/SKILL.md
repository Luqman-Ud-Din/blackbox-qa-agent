---
name: qa-test-form-inline-edit
description: "Tests click-to-edit cells: clicking enters edit mode, Escape cancels with no save, Enter triggers save, blur saves or cancels predictably"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Inline-edit fields (click cell → input appears → edit → save/cancel) are common in tables, dashboards, and settings pages. Common bugs:
- Clicking the cell does not turn it into an editable input
- Escape does not cancel — changes persist
- Enter or blur does not commit the change
- The newly-shown input is not auto-focused

## Orchestrator flow

1. Run `probe.detectInlineEditables` — returns `[{idx, selector, originalText}]`. If empty → **self-skip**.
2. For each editable (max 2):
   a. **Test A — Click enters edit mode:**
      - `browser_click(selector=<cell selector>)`
      - `browser_wait_for(time=350)`
      - Run `probe.checkEditModeActive({idx})` — if `editing` is false → emit `inlineEditClickFails` (high) and skip remaining tests on this cell
      - If `inputFocused` is false → emit `inlineEditNoAutoFocus` (low)
   b. **Test B — Escape cancels:**
      - `browser_evaluate` to set the active input's value to "argusEditTest"
      - `browser_press_key('Escape')`
      - `browser_wait_for(time=350)`
      - Run `probe.checkCellText({idx})` — if `text` includes "argusEditTest" → emit `inlineEditEscapeCommits` (high) — Escape should cancel, not save
   c. **Test C — Enter commits:**
      - `browser_click(selector=<cell selector>)` (re-enter edit mode)
      - `browser_wait_for(time=300)`
      - `browser_evaluate` to set value to `<originalText>` (keep identity, just verify save path)
      - `browser_press_key('Enter')`
      - `browser_wait_for(time=350)`
      - Run `probe.checkEditModeActive({idx})` — if `editing` is still true → emit `inlineEditEnterNoCommit` (medium)
3. Run `probe.restoreInlineCells` — best-effort restore original text into each cell.

## Probes (browser_evaluate)

```js
// probe.detectInlineEditables
() => {
  const out = [];
  // Common patterns: contenteditable, data-editable, role="gridcell", click handlers w/ "edit" class
  const candidates = [
    ...document.querySelectorAll(
      '[contenteditable="true"], [contenteditable=""], ' +
      '[data-editable], [data-inline-edit], ' +
      '[role="gridcell"][tabindex], ' +
      '[class*="editable"]:not(input):not(textarea), ' +
      '[class*="inline-edit"]:not(input):not(textarea)'
    )
  ]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .slice(0, 3);

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    el.setAttribute('data-argus-ie', String(i));
    out.push({
      idx: i,
      selector: el.id ? `#${el.id}` : `[data-argus-ie="${i}"]`,
      originalText: (el.innerText || el.textContent || '').trim().slice(0, 200)
    });
  }
  return out;
}
```

```js
// probe.checkEditModeActive  — args: { idx }
({idx}) => {
  const cell = document.querySelector(`[data-argus-ie="${idx}"]`);
  if (!cell) return { editing: false, inputFocused: false };
  // Detection 1: cell itself became contenteditable + focused
  if (cell.getAttribute('contenteditable') === 'true' && document.activeElement === cell) {
    return { editing: true, inputFocused: true };
  }
  // Detection 2: an input or textarea appeared inside the cell
  const input = cell.querySelector('input:not([type="hidden"]), textarea');
  if (input) {
    return {
      editing: true,
      inputFocused: document.activeElement === input
    };
  }
  // Detection 3: cell has class indicating edit mode
  if (/editing|active|focused/i.test(cell.className) || cell.getAttribute('data-state') === 'editing') {
    return {
      editing: true,
      inputFocused: !!cell.querySelector(':focus')
    };
  }
  return { editing: false, inputFocused: false };
}
```

```js
// probe.checkCellText  — args: { idx }
({idx}) => {
  const cell = document.querySelector(`[data-argus-ie="${idx}"]`);
  if (!cell) return { text: '' };
  return { text: (cell.innerText || cell.textContent || '').trim().slice(0, 200) };
}
```

```js
// probe.restoreInlineCells
() => {
  const cells = document.querySelectorAll('[data-argus-ie]');
  for (const c of cells) {
    try { c.removeAttribute('data-argus-ie'); } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| inlineEditClickFails | high | "Clicking inline-edit cell did not enter edit mode (no input appeared, no contenteditable)" |
| inlineEditNoAutoFocus | low | "Inline-edit input is not auto-focused after entering edit mode" |
| inlineEditEscapeCommits | high | "Escape key did not cancel the edit — modified value persists" |
| inlineEditEnterNoCommit | medium | "Enter key did not commit the edit — cell remains in editing state" |
