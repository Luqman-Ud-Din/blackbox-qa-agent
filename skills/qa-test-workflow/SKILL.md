---
name: qa-test-workflow
section: interactive
description: "Tests status-transition workflows: finds records with actionable status buttons (Approve, Reject, Submit, Archive, Activate, Complete), clicks the action, verifies the status changed in the UI. Catches broken approval flows, stuck state machines, and missing confirmation feedback."
model: sonnet
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
---

# qa-test-workflow — Status Transition / Approval Flow Testing

Foundation management apps, HR systems, and any app with approval pipelines depend on status transitions. This skill tests that clicking Approve/Reject/Submit/Archive actually changes the record's status — not just that the button exists.

## What it checks (6 issue types)

| issueType | severity | what it catches |
|---|---|---|
| `workflowTransitionFailed` | high | Status action clicked + confirmed but record status did NOT change |
| `workflowNoStatusIndicator` | medium | Page has status action buttons but no visible status label/badge on records |
| `workflowNoConfirmFeedback` | medium | Status transition completed but no toast/snackbar/alert shown to user |
| `workflowConfirmDialogBroken` | high | Confirmation dialog appeared but confirm button click did not dismiss it |
| `workflowReverseNotBlocked` | medium | An irreversible status (Archived, Rejected) can be re-activated without restriction (no disabled button or error) |
| `workflowBulkActionMissing` | low | Page has a selectable list (checkboxes) but no bulk-action controls for status changes |

## Self-skip conditions

Skip if page has NONE of these status action patterns:
```
button:has-text(/approve|reject|submit|archive|activate|complete|publish|close|reopen|restore/i),
[aria-label*="approve" i], [aria-label*="reject" i], [aria-label*="submit" i],
[class*="approve-btn"], [class*="reject-btn"], [class*="status-action"],
mat-chip[color="warn"], mat-chip[color="accent"]
```

## Orchestrator flow

### Step 1 — Find actionable records

```
pageState = browser_evaluate(probe.discoverWorkflowPage)
```

Returns `{found, actions: [{selector, label, recordSelector, currentStatus}], hasBulkCheckboxes}`.

If `found` is false → self-skip.

### Step 2 — For each action (max 3, non-destructive first):

Priority order: `approve` > `submit` > `activate` > `complete` > `archive` > `reject` > `delete`.
Always attempt reversible actions (Approve, Activate) before irreversible ones (Archive, Delete).

```
For each action in actions (max 3):
  a. Capture the current status text of the record:
     statusBefore = browser_evaluate(probe.readRecordStatus, {recordSelector: action.recordSelector})

  b. browser_click(selector=<action.selector>)
  c. browser_wait_for(time=600)

  d. confirmState = browser_evaluate(probe.checkConfirmationDialog)
  e. If confirmState.dialogFound:
     - browser_click(selector=<confirmState.confirmSelector>)
     - browser_wait_for(time=800)
     - confirmDismissed = browser_evaluate(probe.checkConfirmationDialog)
     - If confirmDismissed.dialogFound → emit workflowConfirmDialogBroken (high); continue

  f. browser_wait_for(time=600)

  g. feedback = browser_evaluate(probe.checkActionFeedback)
  h. If !feedback.hasSuccess AND !feedback.hasError:
     → emit workflowNoConfirmFeedback (medium)

  i. statusAfter = browser_evaluate(probe.readRecordStatus, {recordSelector: action.recordSelector})
  j. If statusAfter.statusText === statusBefore.statusText:
     → emit workflowTransitionFailed (high)
       evidence: {action: action.label, statusBefore: statusBefore.statusText, statusAfter: statusAfter.statusText}
```

### Step 3 — Check status indicators

```
statusCheck = browser_evaluate(probe.checkStatusIndicators)
If statusCheck.hasActionButtons AND !statusCheck.hasStatusLabels:
  → emit workflowNoStatusIndicator (medium)
```

### Step 4 — Check reverse action on irreversible status (optional)

Only if an "Archive" or "Reject" action was tested and succeeded:
```
reverseCheck = browser_evaluate(probe.checkReverseBlocked, {lastAction: 'archive'})
If reverseCheck.reverseButtonEnabled:
  → emit workflowReverseNotBlocked (medium)
    evidence: {reverseButtonSelector: reverseCheck.selector}
```

### Step 5 — Check bulk action controls

```
If pageState.hasBulkCheckboxes:
  bulkCheck = browser_evaluate(probe.checkBulkActions)
  If !bulkCheck.hasBulkStatusControls:
    → emit workflowBulkActionMissing (low)
```

## Probes (browser_evaluate)

```js
// probe.discoverWorkflowPage
() => {
  const norm = t => (t || '').toLowerCase().trim();
  const actionLabels = /\b(approve|reject|submit|archive|activate|complete|publish|close|reopen|restore)\b/i;

  // Find all visible status action buttons
  const allBtns = [...document.querySelectorAll(
    'button, [role="button"], a[role="button"], mat-button, [mat-button], [mat-raised-button], [mat-stroked-button]'
  )].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled;
  });

  const actionBtns = allBtns.filter(btn => actionLabels.test(norm(btn.innerText) + ' ' + norm(btn.getAttribute('aria-label'))));

  if (actionBtns.length === 0) return { found: false };

  const actions = actionBtns.slice(0, 5).map((btn, i) => {
    btn.setAttribute('data-argus-wf-btn', String(i));
    // Find the containing record
    const row = btn.closest('tr, [role="row"], mat-row, [role="listitem"], [class*="card"], [class*="record"]');
    if (row) row.setAttribute('data-argus-wf-record', String(i));
    const label = norm(btn.innerText || btn.getAttribute('aria-label') || '');
    return {
      selector: `[data-argus-wf-btn="${i}"]`,
      label,
      recordSelector: row ? `[data-argus-wf-record="${i}"]` : null
    };
  });

  // Check for bulk checkboxes
  const checkboxes = document.querySelectorAll('input[type="checkbox"], mat-checkbox, [role="checkbox"]');
  const hasBulkCheckboxes = checkboxes.length >= 3;

  return { found: true, actions, hasBulkCheckboxes };
}
```

```js
// probe.readRecordStatus — args: { recordSelector }
({recordSelector}) => {
  if (!recordSelector) return { statusText: null };
  const record = document.querySelector(recordSelector);
  if (!record) return { statusText: null };

  // Look for status badges, chips, labels
  const statusEl = record.querySelector(
    'mat-chip, [class*="badge"], [class*="status"], [class*="chip"], ' +
    '[class*="label"][class*="state"], span[class*="tag"], .status-pill'
  );
  if (statusEl) {
    return { statusText: (statusEl.innerText || '').trim().toLowerCase() };
  }

  // Fallback: look for text matching status-like words
  const cellTexts = [...record.querySelectorAll('td, [role="cell"], mat-cell')].map(c => (c.innerText || '').trim());
  const statusWord = cellTexts.find(t => /\b(pending|approved|rejected|active|inactive|archived|submitted|completed|published|draft|open|closed)\b/i.test(t));
  return { statusText: statusWord ? statusWord.toLowerCase() : null };
}
```

```js
// probe.checkConfirmationDialog
() => {
  const dialog = document.querySelector(
    '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]), ' +
    'mat-dialog-container, .swal2-popup:not([aria-hidden="true"])'
  );
  if (!dialog) return { dialogFound: false };
  const r = dialog.getBoundingClientRect();
  if (r.width === 0) return { dialogFound: false };

  const confirmBtn = [...dialog.querySelectorAll('button')].find(b =>
    /\b(yes|confirm|ok|proceed|approve|continue)\b/i.test(b.innerText || '')
  );
  if (confirmBtn) confirmBtn.setAttribute('data-argus-confirm', '1');
  return {
    dialogFound: true,
    confirmSelector: confirmBtn ? '[data-argus-confirm="1"]' : null
  };
}
```

```js
// probe.checkActionFeedback — reuse the same pattern as qa-test-crud
() => {
  const successSel = 'mat-snack-bar-container, [class*="snackbar"], [class*="toast"], [role="alert"], .alert-success, [class*="success-message"], .swal2-success';
  const errorSel = '[role="alert"][class*="error"], .alert-danger, mat-error, [class*="error-message"], .swal2-error';
  const ok = [...document.querySelectorAll(successSel)].some(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none';
  });
  const err = [...document.querySelectorAll(errorSel)].some(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none';
  });
  return { hasSuccess: ok, hasError: err };
}
```

```js
// probe.checkStatusIndicators
() => {
  const hasActionButtons = !!document.querySelector(
    '[data-argus-wf-btn], button[aria-label*="approve" i], button[aria-label*="reject" i]'
  );
  const hasStatusLabels = !!document.querySelector(
    'mat-chip, [class*="status-badge"], [class*="status-chip"], [class*="status-label"], ' +
    '[class*="badge"][class*="state"], [class*="pill"]'
  );
  return { hasActionButtons, hasStatusLabels };
}
```

```js
// probe.checkReverseBlocked — args: { lastAction }
({lastAction}) => {
  // After archiving a record, check if there's an unblocked "Restore" or "Activate" button on it
  const record = document.querySelector('[data-argus-wf-record]');
  if (!record) return { reverseButtonEnabled: false };
  const reverseSel = lastAction === 'archive' ? /\b(restore|unarchive|activate)\b/i : /\b(approve|reopen)\b/i;
  const reverseBtn = [...record.querySelectorAll('button')].find(b =>
    reverseSel.test(b.innerText || b.getAttribute('aria-label') || '')
  );
  return {
    reverseButtonEnabled: !!(reverseBtn && !reverseBtn.disabled),
    selector: reverseBtn ? reverseBtn.id ? `#${reverseBtn.id}` : 'button[aria-label]' : null
  };
}
```

```js
// probe.checkBulkActions
() => {
  const bulkSel = [
    'button:has-text("Bulk")', 'button:has-text("bulk")',
    '[aria-label*="bulk" i]', '[class*="bulk-action"]',
    'button:has-text("Select all")', 'button:has-text("Actions")',
    '[class*="batch-action"]'
  ].join(', ');
  const hasBulkStatusControls = !!document.querySelector(bulkSel);
  return { hasBulkStatusControls };
}
```

```js
// probe.cleanupWorkflow — remove tracking attributes
() => {
  for (const el of document.querySelectorAll('[data-argus-wf-btn], [data-argus-wf-record], [data-argus-confirm]')) {
    try {
      el.removeAttribute('data-argus-wf-btn');
      el.removeAttribute('data-argus-wf-record');
      el.removeAttribute('data-argus-confirm');
    } catch (_) {}
  }
  return { ok: true };
}
```

Always call `probe.cleanupWorkflow` at the end, even on error.

## Hard rules

1. **Non-destructive first** — test Approve before Archive, Activate before Delete.
2. **Mandatory cleanup** — remove all `data-argus-wf-*` attributes on exit.
3. **Max 3 transitions** — bounded; don't churn through every record on the page.
4. **Sonnet model** — status text interpretation requires semantic judgment.
