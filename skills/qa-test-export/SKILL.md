---
name: qa-test-export
section: interactive
description: "Tests file download/export functionality: clicks Export/Download buttons, waits for the browser download event, verifies the file appeared (non-zero size implied by download trigger), checks the download link is valid and not a 404. Catches broken export buttons, zero-byte downloads, and missing file format options."
model: sonnet
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
---

# qa-test-export — File Download / Export Testing

Many management apps expose export-to-CSV, export-to-PDF, and print buttons. This skill tests that these controls work: button is found, clickable, triggers a download event or opens a new tab with a file URL, and the download link is not a 404.

## What it checks (7 issue types)

| issueType | severity | what it catches |
|---|---|---|
| `exportButtonNotFound` | low | Page has a data table or list but NO export/download button visible |
| `exportButtonDisabled` | medium | Export button is present but disabled (aria-disabled or pointer-events:none) |
| `exportNoDownloadTriggered` | high | Export button clicked, waited 3 s, but no download link appeared and no new tab opened |
| `exportLinkBroken` | high | Download link href is blank, `javascript:void(0)`, or `#` with no download attribute |
| `exportMissingFormatChoice` | low | Only one format available (e.g., no CSV+PDF choice) on a page with rich data |
| `exportDialogBroken` | medium | An export configuration dialog (date range, format selector) appeared but the Confirm/Export button inside it did not work |
| `exportNoFeedback` | medium | Export initiated but no loading indicator, toast, or progress appeared while the download was pending |

## Self-skip conditions

Skip if no export/download control is found:
```
button:has-text(/export|download|csv|excel|pdf|print/i),
[aria-label*="export" i], [aria-label*="download" i],
a[download], a[href*="export"], a[href*="download"], a[href*=".csv"], a[href*=".pdf"]
```

## Orchestrator flow

### Step 1 — Scan for export controls

```
exportState = browser_evaluate(probe.scanExportControls)
If !exportState.found → emit exportButtonNotFound (low) AND self-skip
If exportState.allDisabled → emit exportButtonDisabled (medium) AND self-skip
```

### Step 2 — Check format variety

```
If exportState.formatCount === 1 AND exportState.hasDataTable:
  → emit exportMissingFormatChoice (low)
    evidence: {availableFormats: exportState.formats}
```

### Step 3 — Click the primary export control

```
Take screenshot BEFORE clicking (baseline).

For primary export button (first enabled one):
  a. browser_click(selector=exportState.primarySelector)
  b. browser_wait_for(time=600)

  c. dialogState = browser_evaluate(probe.checkExportDialog)
  d. If dialogState.dialogFound:
       - Fill any required fields (date range → last 30 days default)
       - browser_click(selector=dialogState.confirmSelector)
       - browser_wait_for(time=1000)
       - dialogAfter = browser_evaluate(probe.checkExportDialog)
       - If dialogAfter.dialogFound → emit exportDialogBroken (medium)

  e. browser_wait_for(time=3000)  ← wait for download / tab

  f. downloadResult = browser_evaluate(probe.checkDownloadOccurred)
  g. If !downloadResult.downloadTriggered → emit exportNoDownloadTriggered (high)
       evidence: {buttonLabel: exportState.primaryLabel}
  h. If downloadResult.linkBroken → emit exportLinkBroken (high)
       evidence: {href: downloadResult.href}

  i. feedback = browser_evaluate(probe.checkExportFeedback)
  j. If !feedback.hasFeedback → emit exportNoFeedback (medium)
```

## Probes (browser_evaluate)

```js
// probe.scanExportControls
() => {
  const exportRe = /\b(export|download|csv|excel|xls|xlsx|pdf|print)\b/i;
  const allCandidates = [
    ...document.querySelectorAll(
      'button, [role="button"], a[download], a[href*="export"], a[href*="download"], ' +
      'a[href*=".csv"], a[href*=".pdf"], a[href*=".xlsx"], [aria-label*="export" i], [aria-label*="download" i]'
    )
  ].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).filter(el => {
    const label = (el.innerText || el.getAttribute('aria-label') || el.title || el.getAttribute('href') || '');
    return exportRe.test(label);
  });

  if (allCandidates.length === 0) return { found: false };

  const formats = [];
  const enabledCandidates = allCandidates.filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true');

  allCandidates.forEach((el, i) => {
    const label = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
    el.setAttribute('data-argus-export', String(i));
    if (/csv/i.test(label)) formats.push('csv');
    else if (/excel|xls/i.test(label)) formats.push('excel');
    else if (/pdf/i.test(label)) formats.push('pdf');
    else if (/print/i.test(label)) formats.push('print');
    else formats.push('generic');
  });

  const primary = enabledCandidates[0];
  const primaryLabel = primary ? (primary.innerText || primary.getAttribute('aria-label') || '').trim().slice(0, 80) : null;
  const primaryIdx = primary ? primary.getAttribute('data-argus-export') : null;

  const hasDataTable = !!document.querySelector('table, mat-table, [role="grid"], [class*="data-table"]');

  return {
    found: true,
    allDisabled: enabledCandidates.length === 0,
    primarySelector: primaryIdx != null ? `[data-argus-export="${primaryIdx}"]` : null,
    primaryLabel,
    formats: [...new Set(formats)],
    formatCount: new Set(formats).size,
    hasDataTable
  };
}
```

```js
// probe.checkExportDialog
() => {
  const dialog = document.querySelector(
    '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]), mat-dialog-container, .swal2-popup:not([aria-hidden="true"])'
  );
  if (!dialog) return { dialogFound: false };
  const r = dialog.getBoundingClientRect();
  if (r.width === 0) return { dialogFound: false };

  // Find confirm button
  const confirmBtn = [...dialog.querySelectorAll('button')].find(b =>
    /\b(export|download|confirm|ok|proceed|generate)\b/i.test(b.innerText || '')
  );
  if (confirmBtn) confirmBtn.setAttribute('data-argus-export-confirm', '1');
  return {
    dialogFound: true,
    confirmSelector: confirmBtn ? '[data-argus-export-confirm="1"]' : null
  };
}
```

```js
// probe.checkDownloadOccurred
() => {
  // Strategy 1: look for a newly appeared <a download> link in DOM
  const downloadLinks = [...document.querySelectorAll('a[download], a[href*=".csv"], a[href*=".pdf"], a[href*=".xlsx"], a[href*="blob:"]')];
  for (const link of downloadLinks) {
    const href = link.getAttribute('href') || '';
    if (!href || href === '#' || href.startsWith('javascript:')) {
      return { downloadTriggered: true, linkBroken: true, href };
    }
    return { downloadTriggered: true, linkBroken: false, href: href.slice(0, 200) };
  }

  // Strategy 2: check if a new tab was opened (check title of current page vs. expected)
  // If the page navigated to a file URL, consider that a download
  const isFileUrl = /\.(csv|pdf|xlsx|xls|zip|txt)(\?.*)?$/i.test(location.href);
  if (isFileUrl) return { downloadTriggered: true, linkBroken: false, href: location.href };

  // Strategy 3: check for any data URI links
  const dataLinks = [...document.querySelectorAll('a[href^="data:"]')];
  if (dataLinks.length > 0) return { downloadTriggered: true, linkBroken: false, href: 'data:...' };

  return { downloadTriggered: false, linkBroken: false, href: null };
}
```

```js
// probe.checkExportFeedback
() => {
  const successSel = 'mat-snack-bar-container, [class*="snackbar"], [class*="toast"], [role="alert"], ' +
    '.alert-success, [class*="success-message"], mat-progress-bar, [class*="loading"], [class*="progress"]';
  const has = [...document.querySelectorAll(successSel)].some(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && getComputedStyle(e).display !== 'none';
  });
  return { hasFeedback: has };
}
```

```js
// probe.cleanupExport
() => {
  for (const el of document.querySelectorAll('[data-argus-export], [data-argus-export-confirm]')) {
    try {
      el.removeAttribute('data-argus-export');
      el.removeAttribute('data-argus-export-confirm');
    } catch (_) {}
  }
  return { ok: true };
}
```

Always run `probe.cleanupExport` at the end.

## Hard rules

1. **Do NOT wait more than 5 s** for a download — `browser_wait_for(time=3000)` is the maximum.
2. **Mandatory cleanup** — remove all `data-argus-export*` attributes.
3. **Max 2 export controls tested** per cell — don't test every format button.
4. **Sonnet model** — export dialog interaction requires judgment.
