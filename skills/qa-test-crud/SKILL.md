---
name: qa-test-crud
section: interactive
description: "Tests full CRUD cycle on list pages: Add new record (fills form, submits, verifies it appeared), Edit (changes a field, saves, verifies persisted), Delete (deletes, confirms, verifies gone). Always cleans up its own test data. Runs as ONE in-page async probe (no AI hand-driving)."
model: sonnet
applyOn: [laptop]
needsSetup: false
viewportSensitive: true
interactive: true
executable: true
cacheVersion: "1.0.0"
requires: [hasAddButton, hasEditButton, hasDeleteButton]
---
## How the orchestrator runs this (ONE call — no hand-driving)

🚨 **This skill is an EXECUTABLE in-page probe, not a prose playbook.** Do NOT drive it click-by-click with separate `browser_click` / `browser_type` / `browser_wait_for` MCP calls. Instead make **ONE** call:

```
result = browser_evaluate(<the async function in "## Interactive Probe" below>)
```

The function discovers the list + Add button generically, opens the Add form, fills it by field type with a **unique marker** embedded in a text field, submits, verifies the record appeared, then Edits its own marked row, then Deletes (and confirms) its own marked row — cleaning up in a `try/finally` so it never leaves test data behind. All inside the page, in one round-trip, with its own `setTimeout` waits for dialog/API settle. It **self-skips** (returns `[]`) when there is no data list / Add button, or when the list is empty (to avoid orphaning data). Transcribe each returned finding verbatim into the cell JSONL; add only the envelope fields (runId, cellId, route, viewport, …).

**SAFETY:** The probe is destructive ONLY toward the record it creates itself. It finds, edits, and deletes solely by its own unique marker (`argus-crud-test…<timestamp>`); it never touches pre-existing rows. The `finally` block always attempts to delete any row containing the marker. Because it writes real data, only invoke this skill when the run config allows live mutation (dev/sandbox).

## Interactive Probe (browser_evaluate, async)

```js
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  const add = o => out.push(Object.assign({ skill: 'qa-test-crud' }, o));
  const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const setNative = (el, v) => { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const clickByText = (re, scope) => { const root = scope || document; const b = [...root.querySelectorAll('button, a[role="button"], [role="button"], input[type="submit"]')].filter(vis).find(el => re.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim())); if (b) { b.click(); return true; } return false; };

  const MARK = 'argus-crud-test' + Date.now();
  const EDIT_MARK = MARK + '-edited';
  let created = false;

  const dataRows = () => [...document.querySelectorAll('table tbody tr, [role="row"]:not([role="columnheader"]), mat-row, [role="listitem"], [class*="record-card"]')].filter(r => vis(r) && !r.closest('thead'));
  const rowWith = marker => dataRows().find(r => (r.innerText || r.textContent || '').toLowerCase().includes(marker.toLowerCase()));
  const findRecord = marker => !!rowWith(marker);

  const openForm = () => document.querySelector('[role="dialog"]:not([aria-hidden="true"]), mat-dialog-container, .modal:not([aria-hidden="true"]), [class*="modal"]:not([aria-hidden="true"])') || document.querySelector('form:not([role="search"])');

  const checkFeedback = () => {
    const toast = [...document.querySelectorAll('.toast, .toastr, [role="alert"], .snackbar, .mat-snack-bar-container, [class*="snackbar"], [class*="toast"], .notification, .alert, [class*="notification"], .swal2-popup, .p-toast, [data-testid*="success"]')].find(vis);
    const txt = toast ? (toast.innerText || '').trim() : '';
    const hasError = /error|failed|invalid|wrong|exception|required/i.test(txt) || !!document.querySelector('.mat-error:not(:empty), .invalid-feedback:not(:empty), [aria-invalid="true"]');
    const hasSuccess = !!toast && !hasError && /success|saved|created|added|updated|deleted|done/i.test(txt);
    return { hasSuccess, hasError, errorText: hasError ? txt.slice(0, 120) : '' };
  };

  // Fill the open form generically by field type; embeds MARK into a name/title (or any) text field.
  const fillForm = (mark) => {
    const scope = openForm() || document;
    const today = new Date().toISOString().slice(0, 10);
    const labelOf = el => {
      let t = '';
      if (el.id) { const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (l) t = l.innerText || ''; }
      if (!t && el.closest('mat-form-field')) { const ml = el.closest('mat-form-field').querySelector('mat-label'); if (ml) t = ml.innerText || ''; }
      return (t + ' ' + (el.placeholder || '') + ' ' + (el.name || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    };
    let count = 0, markerPlaced = false;
    const fields = [...scope.querySelectorAll('input, textarea, select')];
    for (const el of fields) {
      const tp = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'search', 'file', 'reset'].includes(tp)) continue;
      if (!vis(el) || el.disabled || el.readOnly) continue;
      const lab = labelOf(el);
      try {
        if (el.tagName === 'SELECT') { const o = [...el.options].find(o => o.value && !o.disabled); if (o) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); count++; } }
        else if (tp === 'checkbox' || tp === 'radio') { if (!el.checked) { el.click(); count++; } }
        else if (tp === 'email' || /email/.test(lab)) { setNative(el, mark + '@example.com'); markerPlaced = true; count++; }
        else if (tp === 'number' || /amount|price|age|qty|quantity|count/.test(lab)) { setNative(el, '99'); count++; }
        else if (tp === 'date' || /date/.test(lab)) { setNative(el, today); count++; }
        else if (tp === 'tel' || /phone|mobile/.test(lab)) { setNative(el, '+923001234567'); count++; }
        else if (tp === 'password') { setNative(el, 'TestPass123!'); count++; }
        else if (/name|title/.test(lab)) { setNative(el, mark); markerPlaced = true; count++; }
        else { setNative(el, mark); markerPlaced = true; count++; }
      } catch (e) {}
    }
    // Ensure the marker is in a visible field so we can find + clean up the row.
    if (!markerPlaced) { const t = fields.find(e => vis(e) && !e.disabled && !e.readOnly && (e.type === 'text' || e.tagName === 'TEXTAREA' || !e.type)); if (t) { setNative(t, mark); count++; } }
    return count;
  };

  const rowAction = (row, action) => {
    if (!row) return null;
    const re = action === 'edit' ? /\b(edit|update|modify|change)\b/i : /\b(delete|remove|destroy|trash)\b/i;
    const cls = action === 'edit' ? /edit/i : /delete|remove|trash/i;
    const btns = [...row.querySelectorAll('button, [role="button"], a[role="button"], [class*="icon-button"]')].filter(vis);
    return btns.find(b => re.test(b.innerText || b.getAttribute('aria-label') || b.title || '') || cls.test(b.className || '')) || null;
  };

  const confirmDialog = () => {
    const dlg = [...document.querySelectorAll('[role="dialog"], mat-dialog-container, .swal2-popup, [class*="confirm-dialog"], [class*="delete-dialog"], .modal')].find(vis);
    if (!dlg) return false;
    return clickByText(/\b(yes|confirm|delete|ok|proceed|sure)\b/i, dlg);
  };

  // ── DISCOVER (generic) ──
  const hasList = !!document.querySelector('table, [role="table"], [role="grid"], mat-table, [class*="mat-table"], [role="list"], [class*="record-list"], [class*="data-list"]');
  const addBtn = [...document.querySelectorAll('button, a[role="button"], [role="button"], a')].filter(vis).find(el => {
    const t = (el.innerText || '').trim().toLowerCase();
    const al = (el.getAttribute('aria-label') || el.title || '').toLowerCase();
    const cls = (el.className || '').toString().toLowerCase();
    return /\b(add|new|create|register|enroll|insert)\b/.test(t) || /\b(add|new|create|register)\b/.test(al) || /\b(add|create|new|fab)\b/.test(cls) || t === '+';
  });

  if (!hasList && !addBtn) return [];                 // self-skip — not a CRUD page
  if (hasList && dataRows().length === 0) return [];  // self-skip — empty list, don't orphan data
  if (!addBtn) { add({ issueType: 'crudAddNoButton', severity: 'medium', selector: 'page', bbox: null, description: 'Page has a data list but no visible Add/New/Create button.' }); return out; }

  try {
    // ── CREATE ──
    addBtn.click();
    await sleep(1000);
    const filledCount = fillForm(MARK);
    if (!filledCount) { return out; } // form had no fillable fields → inconclusive, skip
    await sleep(200);
    if (!clickByText(/\b(save|create|submit|add|confirm|done|register)\b/i, openForm() || document)) clickByText(/\b(save|create|submit|add|confirm)\b/i);
    await sleep(1200);

    const fb = checkFeedback();
    if (fb.hasError) {
      add({ issueType: 'crudAddFormFailed', severity: 'high', selector: 'create form', bbox: null, description: 'Add form opened but submit produced a server/validation error on valid data.', evidence: { errorText: fb.errorText } });
    } else {
      if (!fb.hasSuccess) add({ issueType: 'crudNoSuccessFeedback', severity: 'medium', selector: 'create flow', bbox: null, description: 'CRUD action completed but no toast/snackbar/alert success message shown to user.', evidence: fb });
      await sleep(500);
      created = findRecord(MARK);
      if (!created) add({ issueType: 'crudAddNotPersisted', severity: 'high', selector: 'list', bbox: null, description: 'Add form submitted successfully but the new record is NOT visible in the list.', evidence: { searchedFor: MARK } });
    }

    // ── EDIT (only if create persisted) ──
    if (created) {
      const row = rowWith(MARK);
      const editBtn = rowAction(row, 'edit');
      if (!editBtn) {
        add({ issueType: 'crudEditNoButton', severity: 'medium', selector: 'row actions', bbox: null, description: 'List has records but no Edit action available on the created row.' });
      } else {
        editBtn.click();
        await sleep(900);
        // change a visible text field to the edit marker
        const scope = openForm() || document;
        const field = [...scope.querySelectorAll('input[type="text"], input:not([type]), textarea')].find(e => vis(e) && !e.disabled && !e.readOnly);
        if (field) setNative(field, EDIT_MARK);
        await sleep(200);
        clickByText(/\b(save|update|submit|confirm)\b/i, openForm() || document) || clickByText(/\b(save|update|submit|confirm)\b/i);
        await sleep(1200);
        const efb = checkFeedback();
        const editOk = !efb.hasError && findRecord(EDIT_MARK);
        if (!editOk) add({ issueType: 'crudEditNotPersisted', severity: 'high', selector: 'edit form', bbox: null, description: 'Edit form saved but the changed value is NOT reflected in the list.', evidence: { searchedFor: EDIT_MARK, errorText: efb.errorText } });

        // ── NULLABLE-DROPDOWN CLEAR test (best-effort, on the same edit cycle) ──
        const curMark = findRecord(EDIT_MARK) ? EDIT_MARK : MARK;
        const row2 = rowWith(curMark);
        const editBtn2 = rowAction(row2, 'edit');
        if (editBtn2) {
          editBtn2.click();
          await sleep(900);
          const fscope = openForm() || document;
          const nullable = [...fscope.querySelectorAll('select')].find(s => {
            if (!vis(s) || s.disabled) return false;
            const co = s.options[s.selectedIndex];
            if (!co || !(co.text || '').trim()) return false;
            return [...s.options].some(o => !o.value || o.value === '' || /^select[\s.…]*$/i.test((o.text || '').trim()));
          });
          if (nullable) {
            const clearedValue = (nullable.options[nullable.selectedIndex].text || '').trim();
            const lab = nullable.getAttribute('aria-label') || nullable.name || 'dropdown';
            const emptyOpt = [...nullable.options].find(o => !o.value || o.value === '' || /^select[\s.…]*$/i.test((o.text || '').trim()));
            nullable.value = emptyOpt.value; nullable.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(300);
            clickByText(/\b(save|update|submit|confirm)\b/i, openForm() || document) || clickByText(/\b(save|update|submit|confirm)\b/i);
            await sleep(1200);
            const cfb = checkFeedback();
            if (!cfb.hasError) {
              await sleep(400);
              const r3 = rowWith(curMark);
              if (r3 && (r3.innerText || '').toLowerCase().includes(clearedValue.toLowerCase()))
                add({ issueType: 'crudEditNullableFieldNotPersisted', severity: 'high', selector: 'edit form', bbox: null, description: 'Nullable field "' + lab + '" was cleared (set to empty) and saved without error, but the list still shows "' + clearedValue + '". The PATCH likely omits null fields or the backend ignores them — send the field even when empty.', evidence: { fieldLabel: lab, clearedValue, rowTextAfter: (r3.innerText || '').trim().slice(0, 200) } });
            } else {
              // server rejected the clear → close the form, valid rejection, not our bug
              clickByText(/\b(cancel|close)\b/i, openForm() || document);
            }
          } else {
            clickByText(/\b(cancel|close)\b/i, openForm() || document);
          }
        }
      }
    }
  } catch (e) {
    add({ issueType: 'crudError', severity: 'medium', selector: null, bbox: null, description: 'CRUD flow error: ' + (e && e.message ? e.message : e) });
  } finally {
    // ── DELETE / CLEANUP (always — only the marker rows) ──
    if (created) {
      try {
        const marker = findRecord(EDIT_MARK) ? EDIT_MARK : MARK;
        const row = rowWith(marker);
        if (row) {
          const delBtn = rowAction(row, 'delete');
          if (!delBtn) {
            add({ issueType: 'crudDeleteNoButton', severity: 'medium', selector: 'row actions', bbox: null, description: 'List has records but no Delete action available on the created row — could not clean up test record (' + marker + '). Delete it manually.' });
          } else {
            delBtn.click();
            await sleep(600);
            confirmDialog();
            await sleep(1200);
            const dfb = checkFeedback();
            if (!dfb.hasSuccess && !dfb.hasError) add({ issueType: 'crudNoSuccessFeedback', severity: 'medium', selector: 'delete flow', bbox: null, description: 'Delete completed but no success toast/snackbar/alert shown to user.', evidence: dfb });
            await sleep(400);
            if (findRecord(marker)) add({ issueType: 'crudDeleteNotRemoved', severity: 'high', selector: 'delete action', bbox: null, description: 'Delete confirmed but the record is still visible in the list.', evidence: { marker } });
          }
        }
      } catch (e) {}
      // last-ditch: any remaining argus-crud row → click its delete + confirm
      try {
        const stray = dataRows().find(r => /argus-crud/i.test(r.innerText || ''));
        if (stray) { const db = rowAction(stray, 'delete'); if (db) { db.click(); await sleep(500); confirmDialog(); await sleep(800); } }
      } catch (e) {}
    }
  }

  return out;
}
```

## Issues
| issueType | severity | what it catches |
|---|---|---|
| `crudAddNoButton` | medium | Page has a data list but no visible Add/New/Create button |
| `crudAddFormFailed` | high | Add form opened but submit produced a server/validation error on valid data |
| `crudAddNotPersisted` | high | Add form submitted successfully but new record NOT visible in list after save |
| `crudEditNoButton` | medium | List has records but no Edit action available on any row |
| `crudEditNotPersisted` | high | Edit form saved but changed value NOT reflected in list |
| `crudEditNullableFieldNotPersisted` | high | Nullable dropdown cleared and saved without error, but the list still shows the old value |
| `crudDeleteNoButton` | medium | List has records but no Delete action available on any row |
| `crudDeleteNotRemoved` | high | Delete confirmed but record still visible in list |
| `crudNoSuccessFeedback` | medium | CRUD action completed but no toast/snackbar/alert success message shown to user |

(`crudError` is emitted only as an internal catch-all when the flow throws mid-cycle; it is not a primary check.)

## Hard rules

1. **ALWAYS run the `finally` cleanup** — even on error. The probe deletes only rows whose text contains its own marker. Test data left in the app is worse than a missed finding.
2. **NEVER touch existing records** — the probe finds/edits/deletes solely by its unique `argus-crud-test…` marker.
3. **NEVER test on empty lists** — self-skips when `dataRows().length === 0`. We only test against pages that already have real data.
4. **Sonnet model** — form filling and feedback interpretation benefit from judgment in the surrounding orchestration; the probe itself is deterministic.
5. **One Add/Edit/Delete cycle per cell** — the probe does not loop.

## Notes on this conversion
- Replaces the ~14-step prose playbook (a dozen separate `browser_evaluate`/`browser_click`/`browser_wait_for` round-trips per phase) with ONE in-page async probe that runs the whole Create→verify→Edit→(nullable-clear)→Delete(cleanup) cycle. Ported from the engine's generic `interactive-crud.js`.
- All 9 documented issueTypes are preserved with identical names; `crudEditNullableFieldNotPersisted` (Step 3b) is folded into the same edit cycle.
- **Cleanup hardened:** the `finally` block deletes the marker row and also sweeps for any stray `argus-crud` row, so the probe never leaves test data — the same safety guarantee as the prose "emergency cleanup" step, now in one call.
- Marker-based find/edit/delete makes the destructive operations self-scoped: the probe can only ever modify the single record it created.
