---
name: qa-form-input-types
description: "Consolidated input-widget testing. Owns every input-type-specific bug: date/time pickers, file upload, OTP boxes, comboboxes, tag inputs, formatted (credit card / phone / CVV), masked inputs, inline-edit, password rules. Replaces 9 overlapping widget skills."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any bug specific to an input WIDGET (date, file, OTP, combobox, tag, mask, formatted, inline-edit, password) belongs to this skill"
replaces:
  - qa-test-form-datetime
  - qa-test-form-file-upload
  - qa-test-form-otp
  - qa-test-form-combobox
  - qa-test-form-tag-input
  - qa-test-form-formatted-inputs
  - qa-test-form-input-mask
  - qa-test-form-inline-edit
  - qa-test-form-password-rules
---

# qa-form-input-types — Consolidated Input-Widget Skill

Single skill owning every widget-specific bug type. By construction, no two skills can claim the same issueType for the same widget. Replaces 9 overlapping skills.

---

## What it checks (UNION of 32 issue types from 9 source skills)

### Date / time
| issueType | severity | catches |
|---|---|---|
| `dateInputNoMinMax` | low | Date input missing min/max attrs in future-only context |
| `dateAllowsPastForFutureField` | medium | Future-only field (expir/due/appointment) accepted 2020-01-01 |
| `dateRangeEndBeforeStart` | high | Date range pair accepted end < start |

### File upload
| issueType | severity | catches |
|---|---|---|
| `fileAcceptMissing` | medium | No `accept=` attribute — any file type accepted |
| `fileSizeHintMissing` | low | No visible "max N MB" hint near file input |
| `fileNoSelectionFeedback` | medium | After upload, no UI shows the file name |

### OTP / verification
| issueType | severity | catches |
|---|---|---|
| `otpNoAutoAdvance` | medium | Keystroke does not advance focus to next box |
| `otpBackspaceNoReturn` | low | Backspace on empty box doesn't return to previous |
| `otpPasteNotDistributed` | medium | Pasting full code doesn't fill all boxes |

### Combobox / searchable dropdown
| issueType | severity | catches |
|---|---|---|
| `comboboxWontOpen` | high | Click doesn't open listbox |
| `comboboxNoTypeFilter` | medium | Typing doesn't filter options |
| `comboboxEnterNoSelect` | high | Enter on highlighted option doesn't select |
| `comboboxEscapeNoClose` | medium | Escape doesn't close (keyboard trap) |
| `comboboxNoAria` | medium | Missing role=combobox / aria-expanded / aria-haspopup |

### Tag / chip input
| issueType | severity | catches |
|---|---|---|
| `tagInputEnterNoAdd` | high | Enter after typing doesn't create chip |
| `tagInputPasteNoSplit` | medium | Pasting "a, b, c" doesn't create 3 chips |
| `tagInputRemoveBroken` | high | Click X on chip doesn't remove it |

### Formatted inputs
| issueType | severity | catches |
|---|---|---|
| `cardAcceptsInvalidLuhn` | high | Card field accepted Luhn-fail "1234567890123456" |
| `expiryAcceptsPastDate` | high | Expiry field accepted past date "01/20" |
| `cvvAcceptsLetters` | medium | CVV field accepted letters instead of digits |
| `phoneAcceptsLetters` | medium | Phone field accepted "abc" |
| `numberAcceptsNegative` | medium | Number on positive-only context (price/age/qty) accepted -1 |
| `numberAcceptsDecimal` | medium | Number with step=1 accepted 1.5 |

### Masked inputs
| issueType | severity | catches |
|---|---|---|
| `patternNotEnforced` | medium | `pattern=` attr present but non-matching value accepted |
| `maskNotApplied` | medium | Phone/card mask didn't apply format separators on raw digits |
| `maskBackspaceStuck` | low | Backspace inside mask got stuck on separator char |

### Inline edit
| issueType | severity | catches |
|---|---|---|
| `inlineEditClickFails` | high | Click cell doesn't enter edit mode |
| `inlineEditNoAutoFocus` | low | Edit input not auto-focused |
| `inlineEditEscapeCommits` | high | Escape doesn't cancel — modified value persists |
| `inlineEditEnterNoCommit` | medium | Enter doesn't commit — cell stuck in editing |

### Password
| issueType | severity | catches |
|---|---|---|
| `passwordNoStrengthFeedback` | medium | "123" accepted without strength indicator |
| `confirmPasswordNoMismatchError` | high | Mismatching primary + confirm shows no error |

---

## Self-skip conditions

Skip silently if `probe.discoverAllWidgets` returns zero widgets of every type.

---

## Orchestrator flow

The skill runs ONE discovery probe to find every widget type on the page, then runs the per-type test suites only for widgets that actually exist. Each test suite is bounded (max 1-3 widgets per type, max 3 payloads per widget).

### Step 1 — Unified discovery

Run `probe.discoverAllWidgets`. Returns:
```js
{
  date: [...], file: [...], otp: {found,boxCount,firstSelector}, combobox: [...],
  tag: [...], cards: {...}, masked: [...], inlineEdit: [...], password: {...}
}
```

If every value is empty/false → self-skip with no findings.

### Step 2-10 — Per-widget test suites

For each widget type with detected instances, run its dedicated test sequence. Tests are independent of each other; a crash in one widget type does NOT abort the others.

#### Date inputs (max 4 inputs)
- For each input: emit `dateInputNoMinMax` if context is future-only AND no min/max
- Past-date test on future-only fields → `dateAllowsPastForFutureField`
- Run `probe.findDateRangePair` → if pair: test end-before-start → `dateRangeEndBeforeStart`
- Cleanup via `probe.clearDateInputs`

#### File inputs (max 2 inputs)
- Attribute checks: emit `fileAcceptMissing`, `fileSizeHintMissing`
- If fixture file exists at `{project-root}/.tmp/qa-fixtures/tiny.txt`: upload, check feedback → `fileNoSelectionFeedback`
- Cleanup via `probe.resetFileInputs`

#### OTP boxes (max 1 cluster)
- Click first box, type "1", check focus moved → `otpNoAutoAdvance`
- Backspace, check focus returned → `otpBackspaceNoReturn`
- Simulate paste of full code, check all boxes filled → `otpPasteNotDistributed`
- Cleanup via `probe.clearOtpInputs`

#### Comboboxes (max 2)
- Click to open, check listbox visible → `comboboxWontOpen`
- Type "a", check option count changed → `comboboxNoTypeFilter`
- Arrow Down, Enter, check value → `comboboxEnterNoSelect`
- Escape, check closed → `comboboxEscapeNoClose`
- If no aria → `comboboxNoAria`
- Cleanup via `probe.closeAllComboboxes`

#### Tag inputs (max 2)
- Type "argusTag1", Enter, check chip added → `tagInputEnterNoAdd`
- Simulate paste "argusA, argusB, argusC", check 3 chips → `tagInputPasteNoSplit`
- Click X on argus chip, check removed → `tagInputRemoveBroken`
- Cleanup via `probe.cleanupTagInputs`

#### Formatted inputs (max 1 of each: card / expiry / cvv / phone / number)
- Card: type "1234567890123456" → `cardAcceptsInvalidLuhn`
- Expiry: type "01/20" → `expiryAcceptsPastDate`
- CVV: type "ab" → `cvvAcceptsLetters`
- Phone: type "abc" → `phoneAcceptsLetters`
- Number (positive-only): type "-1" → `numberAcceptsNegative`
- Number (integer-only): type "1.5" → `numberAcceptsDecimal`
- Cleanup via `probe.clearFormattedFields`

#### Masked inputs (max 2)
- If `pattern` attr present: set non-matching value → `patternNotEnforced`
- Type unformatted digits, check separators present → `maskNotApplied`
- Backspace 3 times, check length shrunk by 3 → `maskBackspaceStuck`
- Cleanup via `probe.clearMaskedInputs`

#### Inline-edit cells (max 2)
- Click cell, check edit mode → `inlineEditClickFails`, `inlineEditNoAutoFocus`
- Type "argusEditTest", Escape, check original text → `inlineEditEscapeCommits`
- Re-enter, Enter, check editing exited → `inlineEditEnterNoCommit`
- Cleanup via `probe.restoreInlineCells`

#### Password fields (1 or 2)
- Type "123" in primary, check strength indicator → `passwordNoStrengthFeedback`
- If confirm exists: mismatch test → `confirmPasswordNoMismatchError`
- Cleanup via `probe.clearPasswordFields`

### Step 11 — Final mandatory cleanup

Run ALL cleanup probes (idempotent — safe to run even if widget wasn't tested):
- `probe.clearDateInputs`, `probe.resetFileInputs`, `probe.clearOtpInputs`,
  `probe.closeAllComboboxes`, `probe.cleanupTagInputs`, `probe.clearFormattedFields`,
  `probe.clearMaskedInputs`, `probe.restoreInlineCells`, `probe.clearPasswordFields`

---

## Probes (browser_evaluate)

```js
// probe.discoverAllWidgets — single shared discovery, returns everything at once
() => {
  const sel = el => el.id ? `#${el.id}` : '';
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
  };

  // DATE
  const dateInputs = [...document.querySelectorAll(
    'input[type="date"], input[type="time"], input[type="datetime-local"]'
  )].filter(visible).slice(0, 4).map((el, i) => {
    const name = (el.name || el.id || '').toLowerCase();
    const labelText = (el.labels && el.labels[0] ? el.labels[0].innerText : '').toLowerCase();
    const context = name + ' ' + labelText;
    return {
      idx: i, type: el.type, name: el.name || el.id || `field${i}`,
      selector: sel(el) || `input[type="${el.type}"]:nth-of-type(${i+1})`,
      contextHint: /expir|due|appointment|schedule|reservation|booking|deliver|deadline/.test(context) ? 'future-only' :
                   /birth|dob|started|joined|registered|founded/.test(context) ? 'past-only' : 'neutral',
      hasMin: el.hasAttribute('min'), hasMax: el.hasAttribute('max')
    };
  });

  // FILE
  const fileInputs = [...document.querySelectorAll('input[type="file"]')]
    .filter(el => !el.disabled).slice(0, 2).map((el, i) => {
      const container = el.closest('label, div, fieldset, .form-group, .upload, .file-input') || el.parentElement;
      const txt = container ? container.innerText : '';
      return {
        inputIdx: i,
        selector: sel(el) || `input[type="file"]:nth-of-type(${i+1})`,
        hasAccept: el.hasAttribute('accept') && el.getAttribute('accept').trim().length > 0,
        sizeHint: /max(imum)?\s*\d+\s*(kb|mb|bytes?)/i.test(txt) || /up\s*to\s*\d+\s*(kb|mb)/i.test(txt)
      };
    });

  // OTP
  const otpCands = [...document.querySelectorAll('input[maxlength="1"], input[inputmode="numeric"][maxlength="1"], input[type="tel"][maxlength="1"]')].filter(visible);
  let otp = { found: false };
  if (otpCands.length >= 4) {
    const grouped = otpCands.slice(0, 6);
    const dx = Math.abs(grouped[1].getBoundingClientRect().left - grouped[0].getBoundingClientRect().left);
    if (dx <= 200) {
      for (let i = 0; i < grouped.length; i++) grouped[i].setAttribute('data-argus-otp', String(i));
      otp = { found: true, boxCount: grouped.length, firstSelector: sel(grouped[0]) || 'input[data-argus-otp="0"]' };
    }
  }

  // COMBOBOX
  const cbCands = [...document.querySelectorAll(
    '[role="combobox"], input[role="combobox"], [class*="select"][class*="search"]:not(select), ' +
    '[class*="autocomplete"]:not(select), [class*="typeahead"]:not(select), div[class*="Select"]:not(select), ' +
    '[data-testid*="combobox"], [data-testid*="select"]:not(select)'
  )].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.tagName.toLowerCase() !== 'select' &&
           !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  }).slice(0, 3);
  const comboboxes = cbCands.map((el, i) => {
    el.setAttribute('data-argus-cb', String(i));
    return {
      idx: i, selector: sel(el) || `[data-argus-cb="${i}"]`,
      hasAria: el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-expanded') ||
               el.hasAttribute('aria-haspopup') || !!el.querySelector('[role="combobox"]'),
      isOpenOnLoad: el.getAttribute('aria-expanded') === 'true'
    };
  });

  // TAG INPUT
  const tagCands = [...document.querySelectorAll(
    '[class*="tag"][class*="input"], [class*="chip"][class*="input"], [class*="multiselect"], ' +
    '[class*="MuiAutocomplete"], [role="combobox"][aria-multiselectable="true"], ' +
    '[data-testid*="tag-input"], [data-testid*="chip-input"]'
  )].filter(el => {
    const r = el.getBoundingClientRect();
    const inp = el.querySelector('input[type="text"], input:not([type])');
    return r.width > 0 && r.height > 0 && inp && !inp.disabled;
  }).slice(0, 3);
  const tagInputs = tagCands.map((el, i) => {
    el.setAttribute('data-argus-tag', String(i));
    const inp = el.querySelector('input[type="text"], input:not([type])');
    const chips = el.querySelectorAll('[class*="chip"], [class*="tag"], [role="button"][aria-label*="remove" i], [data-tag]');
    return {
      idx: i,
      inputSelector: inp.id ? `#${inp.id}` : `[data-argus-tag="${i}"] input`,
      baselineChipCount: chips.length
    };
  });

  // FORMATTED INPUTS
  const fieldsBy = predicate => [...document.querySelectorAll('input, textarea')]
    .filter(visible).filter(predicate).slice(0, 1)
    .map(el => ({ selector: sel(el) || `input[name="${el.name}"]`, name: el.name || el.id }));
  const cardFields = fieldsBy(el => {
    const ac = el.getAttribute('autocomplete') || '';
    const n = (el.name + el.id).toLowerCase();
    return ac.includes('cc-number') || /card.?number|cardnumber|cc.?num/.test(n);
  });
  const expiryFields = fieldsBy(el => {
    const ac = el.getAttribute('autocomplete') || '';
    const n = (el.name + el.id).toLowerCase();
    return ac.includes('cc-exp') || /expir|cc.?exp/.test(n);
  });
  const cvvFields = fieldsBy(el => {
    const ac = el.getAttribute('autocomplete') || '';
    const n = (el.name + el.id).toLowerCase();
    return ac.includes('cc-csc') || /cvv|cvc|csc|security.?code/.test(n);
  });
  const phoneFields = fieldsBy(el => el.type === 'tel' || /phone|mobile|tel|whatsapp/.test((el.name + el.id).toLowerCase()));
  const numberFields = [...document.querySelectorAll('input[type="number"]')].filter(visible).slice(0, 1).map(el => {
    const context = (el.name + el.id + (el.labels && el.labels[0] ? el.labels[0].innerText : '')).toLowerCase();
    return {
      selector: sel(el) || `input[name="${el.name}"]`, name: el.name || el.id,
      positiveOnly: /price|amount|cost|age|quantity|qty|count|total/.test(context),
      integerOnly: !el.step || el.step === '1' || el.step === ''
    };
  });

  // MASKED INPUTS
  const maskCands = [...document.querySelectorAll('input[type="text"], input[type="tel"], input[type="search"]')].filter(visible);
  const masked = [];
  for (let i = 0; i < maskCands.length && masked.length < 3; i++) {
    const el = maskCands[i];
    const ph = el.placeholder || '';
    const n = (el.name + el.id).toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const hasFormatPh = /[_(){}-]\s*[_({}\-)]|\(?___?\)?|####|####\s*####|XX\s*\/\s*XX|\d{2}\s*\/\s*\d{2}/.test(ph);
    const isPhoneish = /phone|mobile|tel/.test(n) || el.type === 'tel' || ac.includes('tel');
    const isCardish = /card|cc.?num/.test(n) || ac.includes('cc-number');
    const isIban = /iban|account.?number/.test(n);
    const isPostal = /postal|zip/.test(n);
    if (!hasFormatPh && !isPhoneish && !isCardish && !isIban && !isPostal) continue;
    el.setAttribute('data-argus-mask', String(masked.length));
    masked.push({
      idx: masked.length,
      selector: sel(el) || `[data-argus-mask="${masked.length}"]`,
      maskHint: isPhoneish ? 'phone' : isCardish ? 'card' : isIban ? 'iban' : isPostal ? 'postal' : 'generic',
      pattern: el.pattern || null, placeholder: ph
    });
  }

  // INLINE EDIT
  const ieCands = [...document.querySelectorAll(
    '[contenteditable="true"], [contenteditable=""], [data-editable], [data-inline-edit], ' +
    '[role="gridcell"][tabindex], [class*="editable"]:not(input):not(textarea), ' +
    '[class*="inline-edit"]:not(input):not(textarea)'
  )].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).slice(0, 3);
  const inlineEdit = ieCands.map((el, i) => {
    el.setAttribute('data-argus-ie', String(i));
    return {
      idx: i, selector: sel(el) || `[data-argus-ie="${i}"]`,
      originalText: (el.innerText || el.textContent || '').trim().slice(0, 200)
    };
  });

  // PASSWORD
  const pwds = [...document.querySelectorAll('input[type="password"]')].filter(visible);
  let password = { passwordCount: 0 };
  if (pwds.length > 0) {
    password = {
      passwordCount: pwds.length,
      primary: { selector: sel(pwds[0]) || `input[name="${pwds[0].name}"]`, name: pwds[0].name || pwds[0].id || 'password' },
      confirm: pwds.length >= 2 ? { selector: sel(pwds[1]) || `input[name="${pwds[1].name}"]`, name: pwds[1].name || pwds[1].id || 'confirm-password' } : null
    };
  }

  return {
    date: dateInputs, file: fileInputs, otp, combobox: comboboxes, tag: tagInputs,
    cards: { card: cardFields, expiry: expiryFields, cvv: cvvFields, phone: phoneFields, number: numberFields },
    masked, inlineEdit, password
  };
}
```

```js
// probe.checkDateError — args: { idx }
({idx}) => {
  const inputs = document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"]');
  const el = inputs[idx];
  if (!el) return { errorVisible: false };
  const ariaInvalid = el.getAttribute('aria-invalid') === 'true';
  let cssInvalid = false;
  try { cssInvalid = el.matches(':invalid'); } catch (_) {}
  const container = el.closest('label, div, fieldset, .form-group, .field') || el.parentElement;
  const nearbyError = container && container.querySelector('[role="alert"], .error, .invalid-feedback, [data-testid*="error"]');
  return { errorVisible: ariaInvalid || cssInvalid || !!nearbyError };
}
```

```js
// probe.findDateRangePair
() => {
  const dates = [...document.querySelectorAll('input[type="date"], input[type="datetime-local"]')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled;
  });
  if (dates.length < 2) return { found: false };
  for (let i = 0; i < dates.length - 1; i++) {
    if (dates[i].form && dates[i].form === dates[i + 1].form) {
      return {
        found: true,
        startSelector: dates[i].id ? `#${dates[i].id}` : `input[name="${dates[i].name}"]`,
        endSelector: dates[i + 1].id ? `#${dates[i + 1].id}` : `input[name="${dates[i + 1].name}"]`,
        startIdx: i, endIdx: i + 1
      };
    }
  }
  return { found: false };
}
```

```js
// probe.checkRangeError — args: { endIdx }
({endIdx}) => {
  const dates = document.querySelectorAll('input[type="date"], input[type="datetime-local"]');
  const end = dates[endIdx];
  if (!end) return { errorVisible: false };
  const ariaInvalid = end.getAttribute('aria-invalid') === 'true';
  const container = end.closest('form') || end.closest('div, fieldset') || end.parentElement;
  const anyError = container && container.querySelector('[role="alert"], .error, .invalid-feedback, [data-testid*="error"]');
  const errorText = anyError ? anyError.innerText : '';
  return { errorVisible: ariaInvalid || (!!anyError && /(end|after|before|range|date)/i.test(errorText)) };
}
```

```js
// probe.checkFilenameDisplayed — args: { inputIdx, expectedName }
({inputIdx, expectedName}) => {
  const inputs = document.querySelectorAll('input[type="file"]');
  const input = inputs[inputIdx];
  if (!input) return { displayed: false };
  const inputHasFile = input.files && input.files.length > 0 && input.files[0].name.includes(expectedName);
  const container = input.closest('label, div, fieldset, .form-group, .upload, .file-input, form') || input.parentElement;
  const text = container ? container.innerText : '';
  return { displayed: inputHasFile && text.includes(expectedName), inputHasFile, visibleFileName: text.includes(expectedName) };
}
```

```js
// probe.checkOtpFocused
() => {
  const active = document.activeElement;
  if (!active) return { focusedIdx: -1 };
  const idx = active.getAttribute('data-argus-otp');
  return { focusedIdx: idx !== null ? parseInt(idx, 10) : -1 };
}
```

```js
// probe.simulateOtpPaste — args: { value }
({value}) => {
  const first = document.querySelector('input[data-argus-otp="0"]');
  if (!first) return { ok: false };
  first.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', value);
  first.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  if (!first.value) {
    first.value = value[0] || '';
    first.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return { ok: true };
}
```

```js
// probe.checkOtpAllFilled
() => {
  const boxes = document.querySelectorAll('input[data-argus-otp]');
  let filled = 0;
  for (const b of boxes) if (b.value && b.value.length === 1) filled++;
  return { filled, total: boxes.length };
}
```

```js
// probe.checkListboxVisible (combobox)
() => {
  const cands = document.querySelectorAll('[role="listbox"]:not([aria-hidden="true"]), [role="option"]:not([aria-hidden="true"])');
  for (const c of cands) {
    const r = c.getBoundingClientRect();
    const s = getComputedStyle(c);
    if (r.width > 50 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden') return { visible: true };
  }
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
// probe.snapshotComboboxOptions
() => {
  const options = [...document.querySelectorAll('[role="option"]:not([aria-hidden="true"])')]
    .filter(o => { const r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
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
  const input = cb.querySelector('input') || (cb.tagName.toLowerCase() === 'input' ? cb : null);
  if (input) return { value: input.value || '' };
  return { value: (cb.innerText || '').trim().slice(0, 80) };
}
```

```js
// probe.countTagChips — args: { idx }
({idx}) => {
  const container = document.querySelector(`[data-argus-tag="${idx}"]`);
  if (!container) return { chipCount: 0 };
  const chips = container.querySelectorAll('[class*="chip"], [class*="tag"]:not(input), [role="button"][aria-label*="remove" i], [data-tag]');
  const visible = [...chips].filter(c => {
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && c.tagName.toLowerCase() !== 'input';
  });
  return { chipCount: visible.length };
}
```

```js
// probe.simulateTagPaste — args: { idx, value }
({idx, value}) => {
  const container = document.querySelector(`[data-argus-tag="${idx}"]`);
  if (!container) return { ok: false };
  const input = container.querySelector('input[type="text"], input:not([type])');
  if (!input) return { ok: false };
  input.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', value);
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
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
// probe.removeArgusTagChip — args: { idx }
({idx}) => {
  const container = document.querySelector(`[data-argus-tag="${idx}"]`);
  if (!container) return { clicked: false };
  const chips = [...container.querySelectorAll('[class*="chip"], [class*="tag"]:not(input), [data-tag]')];
  const ours = chips.find(c => /argus/i.test(c.innerText || ''));
  if (!ours) return { clicked: false };
  const removeBtn = ours.querySelector('[aria-label*="remove" i], [class*="close"], [class*="remove"], button, svg');
  try { (removeBtn || ours).click(); } catch (_) { return { clicked: false }; }
  return { clicked: true };
}
```

```js
// probe.checkInputError — args: { selector }
({selector}) => {
  let el;
  try { el = document.querySelector(selector); } catch (_) { return { errorVisible: false }; }
  if (!el) return { errorVisible: false };
  const ariaInvalid = el.getAttribute('aria-invalid') === 'true';
  let cssInvalid = false;
  try { cssInvalid = el.matches(':invalid'); } catch (_) {}
  const container = el.closest('label, div, fieldset, .form-group, .field') || el.parentElement;
  const nearbyError = container && container.querySelector(
    '[role="alert"], .error, .invalid-feedback, [data-testid*="error"], .text-red-500, .text-danger'
  );
  return { errorVisible: ariaInvalid || cssInvalid || !!nearbyError };
}
```

```js
// probe.checkPatternRejection — args: { idx }
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
// probe.getMaskedValue — args: { idx }
({idx}) => {
  const el = document.querySelector(`[data-argus-mask="${idx}"]`);
  if (!el) return { value: '' };
  return { value: el.value };
}
```

```js
// probe.checkInlineEditMode — args: { idx }
({idx}) => {
  const cell = document.querySelector(`[data-argus-ie="${idx}"]`);
  if (!cell) return { editing: false, inputFocused: false };
  if (cell.getAttribute('contenteditable') === 'true' && document.activeElement === cell) return { editing: true, inputFocused: true };
  const input = cell.querySelector('input:not([type="hidden"]), textarea');
  if (input) return { editing: true, inputFocused: document.activeElement === input };
  if (/editing|active|focused/i.test(cell.className) || cell.getAttribute('data-state') === 'editing') {
    return { editing: true, inputFocused: !!cell.querySelector(':focus') };
  }
  return { editing: false, inputFocused: false };
}
```

```js
// probe.checkInlineCellText — args: { idx }
({idx}) => {
  const cell = document.querySelector(`[data-argus-ie="${idx}"]`);
  if (!cell) return { text: '' };
  return { text: (cell.innerText || cell.textContent || '').trim().slice(0, 200) };
}
```

```js
// probe.checkPasswordStrengthIndicator
() => {
  const strengthEls = document.querySelectorAll(
    '[class*="strength"], [data-testid*="strength"], [aria-label*="strength" i], ' +
    '[class*="password-meter"], [role="progressbar"][aria-label*="password" i]'
  );
  if (strengthEls.length > 0) {
    const text = [...strengthEls].map(e => e.innerText).join(' ').toLowerCase();
    return { hasIndicator: true, indicatesWeak: /weak|low|poor|too short/.test(text) };
  }
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
// probe.checkConfirmPasswordMismatchError
() => {
  const pwds = [...document.querySelectorAll('input[type="password"]')];
  if (pwds.length < 2) return { mismatchErrorVisible: false };
  const confirm = pwds[1];
  const container = confirm.closest('label, div, fieldset, .form-group, .field, form') || confirm.parentElement;
  if (!container) return { mismatchErrorVisible: false };
  const err = container.querySelector('[role="alert"], .error, .invalid-feedback, [data-testid*="error"], .text-danger, .field-error');
  const ariaInvalid = confirm.getAttribute('aria-invalid') === 'true';
  if (ariaInvalid || (err && /match|same|confirm|differ/i.test(err.innerText))) return { mismatchErrorVisible: true };
  return { mismatchErrorVisible: false };
}
```

### Cleanup probes (idempotent, safe to call always)

```js
// probe.clearDateInputs
() => { for (const el of document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"]')) { try { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {} } return { ok: true }; }
```

```js
// probe.resetFileInputs
() => { for (const el of document.querySelectorAll('input[type="file"]')) { try { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {} } return { ok: true }; }
```

```js
// probe.clearOtpInputs
() => { for (const b of document.querySelectorAll('input[data-argus-otp]')) { try { b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })); b.removeAttribute('data-argus-otp'); } catch (_) {} } return { ok: true }; }
```

```js
// probe.closeAllComboboxes
() => {
  for (const el of document.querySelectorAll('[aria-expanded="true"]')) { try { el.click(); } catch (_) {} }
  try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
  for (const el of document.querySelectorAll('[data-argus-cb]')) { try { el.removeAttribute('data-argus-cb'); } catch (_) {} }
  return { ok: true };
}
```

```js
// probe.cleanupTagInputs
() => {
  for (const container of document.querySelectorAll('[data-argus-tag]')) {
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

```js
// probe.clearFormattedFields
() => {
  for (const el of document.querySelectorAll('input, textarea')) {
    if (el.type === 'submit' || el.type === 'button' || el.type === 'hidden' || el.type === 'password') continue;
    try { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
  }
  return { ok: true };
}
```

```js
// probe.clearMaskedInputs
() => {
  for (const el of document.querySelectorAll('[data-argus-mask]')) {
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

```js
// probe.restoreInlineCells
() => { for (const c of document.querySelectorAll('[data-argus-ie]')) { try { c.removeAttribute('data-argus-ie'); } catch (_) {} } return { ok: true }; }
```

```js
// probe.clearPasswordFields
() => { for (const p of document.querySelectorAll('input[type="password"]')) { try { p.value = ''; p.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {} } return { ok: true }; }
```

---

## Cost analysis

| Phase | Per cell |
|---|---|
| Phase 1 unified discovery | ~$0.0005 |
| Phase 2-10 per-widget tests (typical page = 2-3 widget types found) | ~$0.005 |
| Step 11 cleanup | ~$0.0003 |
| **Total per cell** | **~$0.006** |

Vs running 9 source skills separately (~$0.015 combined): **~60% cost reduction.**

---

## Migration

```toml
[detectors]
qa-form-input-types        = true   # NEW
qa-test-form-datetime      = false  # REPLACED
qa-test-form-file-upload   = false
qa-test-form-otp           = false
qa-test-form-combobox      = false
qa-test-form-tag-input     = false
qa-test-form-formatted-inputs = false
qa-test-form-input-mask    = false
qa-test-form-inline-edit   = false
qa-test-form-password-rules = false
```

## Hard rules

1. **NEVER navigate or submit.** Widgets are tested in-place; cleanup restores state.
2. **ALWAYS run Step 11 cleanup** even if individual tests fail. Idempotent — safe.
3. **NEVER exceed declared per-type caps** (max 4 date / 2 file / 1 OTP / 2 combobox / 2 tag / 1 each formatted / 2 mask / 2 inline / 1 password pair).
4. **`cacheVersion: "1.0.0"`** — bump on any detection-logic change for selective cache invalidation.
5. **Track via `data-argus-*` attrs** for the widgets that need stateful tracking (OTP, combobox, tag, mask, inline-edit). Cleanup removes them.

## Notes

- Discovery probe is ONE round-trip vs 9 separate discoveries in source skills.
- Each widget type's test suite is independent — a crash in one doesn't block others.
- Issue type vocabulary preserved exactly: every issueType emitted by the 9 source skills is preserved here.
