---
name: qa-test-crud
section: interactive
description: "Tests full CRUD cycle on list pages: Add new record (fills form with valid data, submits, verifies record appeared in list), Edit record (changes a field, saves, verifies change persisted), Delete record (deletes, confirms dialog, verifies record gone). Always cleans up test data."
model: sonnet
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
---

# qa-test-crud — Full CRUD Cycle Testing

Tests whether Add / Edit / Delete operations actually work end-to-end. Not just "does the form open" — does saving the record persist it, does deleting actually remove it. Cleans up all test data it creates.

## What it checks (8 issue types)

| issueType | severity | what it catches |
|---|---|---|
| `crudAddNoButton` | medium | Page has a data list but no visible Add/New/Create button |
| `crudAddFormFailed` | high | Add form opened but submit produced a server error or validation error on valid data |
| `crudAddNotPersisted` | high | Add form submitted successfully but new record NOT visible in list after save |
| `crudEditNoButton` | medium | List has records but no Edit action available on any row |
| `crudEditNotPersisted` | high | Edit form saved but changed value NOT reflected in list |
| `crudDeleteNoButton` | medium | List has records but no Delete action available on any row |
| `crudDeleteNotRemoved` | high | Delete confirmed but record still visible in list |
| `crudNoSuccessFeedback` | medium | CRUD action completed but no toast/snackbar/alert success message shown to user |

## Self-skip conditions

Skip if page has NONE of:
- `table, [role="table"], [role="grid"], [class*="data-table"], [class*="mat-table"]`
- `[role="list"] > [role="listitem"]` (3+ items), `.card-list`, `[class*="record-list"]`

Self-skip with no findings if the page is a detail/form page (no list visible).

## Orchestrator flow

**CRITICAL:** The skill uses a unique marker `argus-crud-test` in all test data. This marker MUST be cleaned up before the skill exits — even on error. Use try/finally logic.

### Step 1 — Discover page type

```
pageInfo = browser_evaluate(probe.discoverCrudPage)
```

Returns `{hasList, rowCount, listSelector, hasAddButton, addButtonSelector, hasRowActions}`.

If `hasList` is false → self-skip.
If `rowCount === 0` → log "empty list, skip CRUD test to avoid creating orphaned data" → self-skip.

### Step 2 — ADD test

```
1. If !pageInfo.hasAddButton:
   → emit crudAddNoButton (medium), continue to EDIT check

2. browser_click(selector=<addButtonSelector>)
3. browser_wait_for(time=800)

4. formState = browser_evaluate(probe.scanOpenForm)
   // Returns {formFound, fields: [{selector, type, labelText, required}], submitSelector}

5. If formState.formFound:
   a. For each field in formState.fields (up to 8 required fields first):
      - fill with appropriate test value (see fillStrategy below)
   b. Capture rowsBefore = pageInfo.rowCount
   c. browser_click(selector=<submitSelector>)
   d. browser_wait_for(time=1200)
   e. feedback = browser_evaluate(probe.checkActionFeedback)
   f. If feedback.hasError → emit crudAddFormFailed (high)
      evidence: {errorText: feedback.errorText}
   g. Else:
      - If !feedback.hasSuccess → emit crudNoSuccessFeedback (medium)
      - browser_wait_for(time=600)
      - listState = browser_evaluate(probe.findTestRecord, {marker: 'argus-crud-test'})
      - If !listState.found → emit crudAddNotPersisted (high)
        evidence: {searchedFor: 'argus-crud-test', rowsAfter: listState.rowCount}
```

**fillStrategy** — fill each field based on type/label:
- `input[type="email"]` or label contains "email" → `argus-crud-test@example.com`
- `input[type="number"]` or label contains "amount/price/age/qty" → `99`
- `input[type="date"]` → today's date via `new Date().toISOString().slice(0,10)`
- `input[type="tel"]` or label contains "phone/mobile" → `+923001234567`
- `input[type="password"]` → `TestPass123!`
- `textarea` → `argus-crud-test automated test entry`
- `select`, `[role="combobox"]` → pick first non-empty option
- All other `input[type="text"]` or `input:not([type])`:
  - If label contains "name" → `argus crud test`
  - Else → `argus-crud-test`

### Step 3 — EDIT test (only if ADD succeeded and record was found)

```
1. rowHandle = browser_evaluate(probe.findTestRecord, {marker: 'argus-crud-test'})
   If !rowHandle.found → skip EDIT test

2. editButton = browser_evaluate(probe.findRowAction, {rowSelector: rowHandle.rowSelector, action: 'edit'})
   If !editButton.found → emit crudEditNoButton (medium)

3. Else:
   a. browser_click(selector=<editButton.selector>)
   b. browser_wait_for(time=800)
   c. editFormState = browser_evaluate(probe.scanOpenForm)
   d. If editFormState.formFound:
      - Find first editable text input
      - Clear it: browser_evaluate(probe.clearField, {selector: firstField.selector})
      - browser_type(selector=<firstField.selector>, text='argus-crud-edit-test')
      - browser_wait_for(time=300)
      - browser_click(selector=<editFormState.submitSelector>)
      - browser_wait_for(time=1200)
      - editFeedback = browser_evaluate(probe.checkActionFeedback)
      - If editFeedback.hasError → emit crudEditNotPersisted (high), evidence: {errorText}
      - Else:
        - browser_wait_for(time=500)
        - editCheck = browser_evaluate(probe.findTestRecord, {marker: 'argus-crud-edit-test'})
        - If !editCheck.found → emit crudEditNotPersisted (high)
          evidence: {searchedFor: 'argus-crud-edit-test'}
```

### Step 4 — DELETE test (always attempt to clean up)

```
1. currentMarker = (edit succeeded) ? 'argus-crud-edit-test' : 'argus-crud-test'
2. recordToDelete = browser_evaluate(probe.findTestRecord, {marker: currentMarker})
3. If !recordToDelete.found → skip DELETE test (record not found, may have been cleaned up)

4. deleteButton = browser_evaluate(probe.findRowAction, {rowSelector: recordToDelete.rowSelector, action: 'delete'})
5. If !deleteButton.found → emit crudDeleteNoButton (medium)

6. Else:
   a. browser_click(selector=<deleteButton.selector>)
   b. browser_wait_for(time=500)
   c. confirmResult = browser_evaluate(probe.confirmDeleteDialog)
   d. If confirmResult.dialogFound: browser_click(selector=<confirmResult.confirmSelector>)
   e. browser_wait_for(time=1200)
   f. deleteFeedback = browser_evaluate(probe.checkActionFeedback)
   g. If !deleteFeedback.hasSuccess AND !deleteFeedback.hasError:
      emit crudNoSuccessFeedback (medium) for delete
   h. browser_wait_for(time=500)
   i. deleteCheck = browser_evaluate(probe.findTestRecord, {marker: currentMarker})
   j. If deleteCheck.found → emit crudDeleteNotRemoved (high)
      evidence: {marker: currentMarker, rowCount: deleteCheck.rowCount}
```

### Step 5 — Emergency cleanup (MANDATORY)

Even if steps above errored, always attempt to remove any test records:
```
browser_evaluate(probe.emergencyCleanup)
// Tries to find and delete any row containing 'argus-crud' in its text
```

## Probes (browser_evaluate)

```js
// probe.discoverCrudPage
() => {
  const norm = s => (s || '').trim().toLowerCase();
  // Detect list: table, mat-table, grid, card list
  const tableEl = document.querySelector('table, [role="table"], [role="grid"], mat-table, [class*="mat-table"]');
  const listEl = document.querySelector('[role="list"], [class*="record-list"], [class*="data-list"]');
  const hasList = !!(tableEl || listEl);
  if (!hasList) return { hasList: false };

  const rows = [...document.querySelectorAll('tr:not(thead tr), [role="row"]:not([role="columnheader"]), mat-row')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  // Find Add/New/Create button
  const addCandidates = [...document.querySelectorAll('button, a[role="button"], [role="button"]')].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const txt = norm(el.innerText || el.getAttribute('aria-label') || '');
    return /\b(add|new|create|register|enroll|insert)\b/.test(txt);
  });

  // Check for row action buttons (edit/delete)
  const firstRow = rows[0];
  let hasRowActions = false;
  if (firstRow) {
    const rowBtns = firstRow.querySelectorAll('button, [role="button"], mat-icon-button, [mat-icon-button]');
    hasRowActions = rowBtns.length > 0;
  }

  const addBtn = addCandidates[0];
  return {
    hasList: true,
    rowCount: rows.length,
    listSelector: tableEl ? 'table' : '[role="list"]',
    hasAddButton: !!addBtn,
    addButtonSelector: addBtn ? (addBtn.id ? `#${addBtn.id}` : null) : null,
    hasRowActions
  };
}
```

```js
// probe.scanOpenForm
() => {
  // Find the most recently opened form: dialog, mat-dialog, modal, or page form
  const dialogEl = document.querySelector(
    '[role="dialog"]:not([aria-hidden="true"]), mat-dialog-container, .cdk-overlay-pane [formGroup], ' +
    '[class*="modal"]:not([aria-hidden="true"])'
  );
  const formContainer = dialogEl || document.querySelector('form:not([role="search"])');
  if (!formContainer) return { formFound: false };

  const fields = [];
  for (const el of formContainer.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), ' +
    'textarea, select, [role="combobox"]'
  )) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.disabled || el.readOnly) continue;
    // Find label
    const labelEl = el.labels && el.labels[0];
    const labelText = (
      (labelEl && (labelEl.innerText || '')) ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.name || ''
    ).trim().toLowerCase();
    fields.push({
      selector: el.id ? `#${el.id}` : (el.name ? `[name="${el.name}"]` : el.tagName.toLowerCase()),
      type: el.type || el.tagName.toLowerCase(),
      labelText,
      required: el.required || el.getAttribute('aria-required') === 'true'
    });
    if (fields.length >= 12) break;
  }

  // Find submit button
  const submitBtn = formContainer.querySelector(
    'button[type="submit"], input[type="submit"], ' +
    'button:not([type="button"]):not([type="reset"]), ' +
    '[class*="submit"], [class*="save"], [class*="confirm"]'
  );
  const submitBtns = [...formContainer.querySelectorAll('button')].filter(b => {
    const txt = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
    return /\b(save|submit|add|create|confirm|ok|done|register)\b/.test(txt);
  });

  const finalSubmit = submitBtns[0] || submitBtn;
  return {
    formFound: true,
    fields,
    submitSelector: finalSubmit ? (finalSubmit.id ? `#${finalSubmit.id}` : 'button[type="submit"]') : 'button[type="submit"]',
    fieldCount: fields.length
  };
}
```

```js
// probe.checkActionFeedback
() => {
  // Check for success toast/snackbar/alert
  const successSel = [
    'mat-snack-bar-container', '.mat-snack-bar-container',
    '[class*="snackbar"]', '[class*="toast"]',
    '[role="alert"]', '.alert-success', '[class*="success-message"]',
    '[class*="notification"]', '[class*="alert"][class*="success"]',
    '.swal2-success', '[data-testid*="success"]'
  ].join(', ');
  const successEls = [...document.querySelectorAll(successSel)].filter(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  });

  // Check for error state
  const errorSel = [
    '[role="alert"][class*="error"]', '.alert-danger', '.alert-error',
    '[class*="error-message"]', 'mat-error', '.mat-error',
    '[class*="snackbar"][class*="error"]', '[class*="toast"][class*="error"]',
    '.swal2-error'
  ].join(', ');
  const errorEls = [...document.querySelectorAll(errorSel)].filter(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  });

  const errorText = errorEls.map(e => (e.innerText || '').trim().slice(0, 100)).join(' | ');
  const successText = successEls.map(e => (e.innerText || '').trim().slice(0, 100)).join(' | ');

  return {
    hasSuccess: successEls.length > 0,
    hasError: errorEls.length > 0,
    successText,
    errorText
  };
}
```

```js
// probe.findTestRecord — args: { marker }
({marker}) => {
  const rows = [
    ...document.querySelectorAll(
      'tr:not(thead tr), [role="row"]:not([role="columnheader"]), mat-row, ' +
      '[role="listitem"], [class*="record-card"], [class*="data-card"]'
    )
  ].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  for (const row of rows) {
    const text = (row.innerText || row.textContent || '').toLowerCase();
    if (text.includes(marker.toLowerCase())) {
      // Tag it for the next probe
      row.setAttribute('data-argus-crud-row', '1');
      return {
        found: true,
        rowSelector: '[data-argus-crud-row="1"]',
        rowText: text.slice(0, 200),
        rowCount: rows.length
      };
    }
  }
  return { found: false, rowCount: rows.length };
}
```

```js
// probe.findRowAction — args: { rowSelector, action }
({rowSelector, action}) => {
  const row = document.querySelector(rowSelector);
  if (!row) return { found: false };

  const btnText = action === 'edit'
    ? /\b(edit|update|modify|change)\b/i
    : /\b(delete|remove|destroy)\b/i;

  // Direct buttons inside the row
  const rowBtns = [...row.querySelectorAll('button, [role="button"], a[role="button"], mat-icon-button')];
  for (const btn of rowBtns) {
    const txt = btn.innerText || btn.getAttribute('aria-label') || btn.title || '';
    if (btnText.test(txt)) {
      btn.setAttribute('data-argus-action-btn', action);
      return { found: true, selector: `[data-argus-action-btn="${action}"]`, direct: true };
    }
  }

  // May be in an action menu (⋮) — check for menu trigger
  const menuTrigger = row.querySelector(
    '[aria-label*="more" i], [aria-label*="actions" i], button:has-text("⋮"), ' +
    '[data-testid*="action"], [class*="action-menu-trigger"]'
  );
  if (menuTrigger) {
    menuTrigger.setAttribute('data-argus-menu-trigger', action);
    return { found: true, selector: `[data-argus-menu-trigger="${action}"]`, inMenu: true, action };
  }

  return { found: false };
}
```

```js
// probe.confirmDeleteDialog
() => {
  // Look for a confirmation dialog
  const dialog = document.querySelector(
    '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]), ' +
    'mat-dialog-container, .swal2-popup:not([aria-hidden="true"]), ' +
    '[class*="confirm-dialog"], [class*="delete-dialog"]'
  );
  if (!dialog) return { dialogFound: false };
  const r = dialog.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { dialogFound: false };

  // Find confirm button
  const confirmBtns = [...dialog.querySelectorAll('button')].filter(b => {
    const txt = (b.innerText || '').toLowerCase();
    return /\b(yes|confirm|delete|ok|proceed|sure)\b/.test(txt);
  });
  const confirmBtn = confirmBtns[0];
  if (confirmBtn) {
    confirmBtn.setAttribute('data-argus-confirm', '1');
  }
  return {
    dialogFound: true,
    confirmSelector: confirmBtn ? '[data-argus-confirm="1"]' : null,
    dialogText: (dialog.innerText || '').trim().slice(0, 200)
  };
}
```

```js
// probe.clearField — args: { selector }
({selector}) => {
  try {
    const el = document.querySelector(selector);
    if (!el) return { ok: false };
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  } catch (_) { return { ok: false }; }
}
```

```js
// probe.emergencyCleanup — best-effort: find and delete any argus test rows
() => {
  const marker = 'argus-crud';
  const rows = [...document.querySelectorAll(
    'tr:not(thead tr), [role="row"]:not([role="columnheader"]), mat-row'
  )].filter(el => {
    const txt = (el.innerText || el.textContent || '').toLowerCase();
    return txt.includes(marker);
  });
  let cleaned = 0;
  for (const row of rows.slice(0, 5)) {
    const delBtn = [...row.querySelectorAll('button')].find(b =>
      /delete|remove/i.test(b.innerText || b.getAttribute('aria-label') || '')
    );
    if (delBtn) { try { delBtn.click(); cleaned++; } catch (_) {} }
  }
  // Remove tracking attributes
  for (const el of document.querySelectorAll('[data-argus-crud-row], [data-argus-action-btn], [data-argus-menu-trigger], [data-argus-confirm]')) {
    try { ['data-argus-crud-row','data-argus-action-btn','data-argus-menu-trigger','data-argus-confirm'].forEach(a => el.removeAttribute(a)); } catch (_) {}
  }
  return { attempted: rows.length, cleaned };
}
```

## Hard rules

1. **ALWAYS run Step 5 (emergency cleanup)** — even on error. Test data left in the app is worse than a missed finding.
2. **NEVER delete existing records** — only delete records containing `'argus-crud'` in their text.
3. **NEVER test on empty lists** — skip if rowCount === 0. We only test against pages that already have real data to confirm the list works.
4. **Sonnet model** — form filling and feedback interpretation require judgment.
5. **One Add/Edit/Delete cycle per cell** — do not loop. If the first cycle fails, emit and stop.
