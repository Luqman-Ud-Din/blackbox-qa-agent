---
name: qa-test-upload-e2e
section: interactive
description: "Tests the full file upload lifecycle: finds an upload control, uploads a test file via browser_file_upload, waits for the upload to complete, then verifies the uploaded file appears in the UI (name visible, preview shown, or list entry added). Catches silent upload failures, missing progress indicators, and files that upload but never appear in the list."
model: sonnet
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
---

# qa-test-upload-e2e — File Upload Lifecycle Testing

Upload controls are notoriously brittle. A file can "upload" but silently fail server-side, show a spinner that never resolves, or succeed but not appear in the list. This skill catches those three failure modes.

**Uses a tiny test file** — writes a small `.txt` file to `.tmp/argus-upload-test.txt` before testing. Never uploads real user data.

## What it checks (8 issue types)

| issueType | severity | what it catches |
|---|---|---|
| `uploadButtonNotFound` | low | Page has a form or media section but no file upload control is found |
| `uploadNoProgress` | medium | File selected, upload started, but no spinner/progress bar/status text appeared during upload |
| `uploadFailed` | high | Upload API call returned a non-2xx response OR error message appeared in UI after upload |
| `uploadNotPersisted` | high | Upload appeared to succeed (no error shown) but the uploaded filename does NOT appear anywhere in the page after waiting |
| `uploadMaxSizeUnclear` | low | Upload control has no max file size hint (no `accept` attribute, no label mentioning MB limit) |
| `uploadNoPreview` | low | Image upload completed but no thumbnail/preview appeared (image uploads should show previews) |
| `uploadMultipleNotSupported` | low | Upload control lacks `multiple` attribute on a page that likely handles multiple files (documents/gallery page) |
| `uploadSuccessNoFeedback` | medium | Upload completed but no success toast/snackbar/message appeared |

## Self-skip conditions

Skip if no upload control found:
```
input[type="file"], [class*="upload"], [class*="file-drop"], [class*="dropzone"],
[aria-label*="upload" i], button:has-text(/upload|attach|browse/i),
[class*="file-input"], mat-icon:has-text("upload"), [class*="file-picker"]
```

## Setup — create test file

Before Step 1, the orchestrator creates the test file. Use bash to write it:
```
Write test file: {project-root}/.tmp/argus-upload-test.txt
Content: "argus-upload-test 2026-06-08"
Absolute path stored as: testFilePath
```

Note: `browser_file_upload` requires an **absolute path** on the local filesystem.

## Orchestrator flow

### Step 1 — Scan for upload controls

```
uploadState = browser_evaluate(probe.scanUploadControls)
If !uploadState.found → emit uploadButtonNotFound (low) AND self-skip
```

Check `uploadState.hasMaxSizeHint`:
- If `!uploadState.hasMaxSizeHint` → emit uploadMaxSizeUnclear (low)
- If `!uploadState.multipleSupported AND uploadState.likelyMultiPage` → emit uploadMultipleNotSupported (low)

### Step 2 — Trigger upload

```
a. If uploadState.needsButtonClick (button-triggered upload):
     browser_click(selector=uploadState.triggerSelector)
     browser_wait_for(time=400)

b. browser_file_upload(
     selector=uploadState.inputSelector,
     files=[testFilePath]
   )
   browser_wait_for(time=500)
```

### Step 3 — Check for progress feedback

```
c. progressState = browser_evaluate(probe.checkUploadProgress)
   If !progressState.hasProgress → emit uploadNoProgress (medium)
     evidence: {selector: uploadState.inputSelector}
```

### Step 4 — Wait for completion

```
d. browser_wait_for(time=3000)
   finalState = browser_evaluate(probe.checkUploadFinalState, {testFileName: 'argus-upload-test.txt'})
```

### Step 5 — Evaluate result

```
e. If finalState.hasError:
     → emit uploadFailed (high)
       evidence: {errorText: finalState.errorText}
   Else:
     If !finalState.fileAppearedInUI:
       → emit uploadNotPersisted (high)
         evidence: {testFileName: 'argus-upload-test.txt'}
     If !finalState.hasSuccessFeedback:
       → emit uploadSuccessNoFeedback (medium)
     If uploadState.isImageUpload AND !finalState.hasPreview:
       → emit uploadNoPreview (low)
```

## Probes (browser_evaluate)

```js
// probe.scanUploadControls
() => {
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  const buttonTriggers = [...document.querySelectorAll(
    '[class*="upload-btn"], [class*="file-btn"], [aria-label*="upload" i], ' +
    'button[onclick*="upload"], [class*="dropzone"] button, [class*="file-drop"] button'
  )].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  const visibleInputs = inputs.filter(el => {
    const s = getComputedStyle(el);
    // File inputs are often hidden; still usable via browser_file_upload
    return el.offsetParent !== null || s.position === 'absolute';
  });

  if (inputs.length === 0 && buttonTriggers.length === 0) return { found: false };

  // Tag the first usable input
  const primaryInput = inputs[0] || null;
  if (primaryInput) primaryInput.setAttribute('data-argus-upload-input', '1');

  const triggerBtn = buttonTriggers[0];
  if (triggerBtn) triggerBtn.setAttribute('data-argus-upload-trigger', '1');

  // Check for size hints
  const accept = primaryInput?.getAttribute('accept') || '';
  const surroundingText = (primaryInput?.closest('form,mat-form-field,[class*="upload"]')?.innerText || '').toLowerCase();
  const hasMaxSizeHint = /\b\d+\s*(mb|kb|gb|byte|limit|max)\b/i.test(surroundingText) || accept.length > 0;

  // Multiple support
  const multipleSupported = !!(primaryInput?.getAttribute('multiple') != null);
  const likelyMultiPage = /\b(document|attachment|media|gallery|files|images)\b/i.test(document.title + location.pathname);

  // Is this an image upload?
  const isImageUpload = /image|photo|picture|avatar|thumbnail/i.test(accept + surroundingText);

  return {
    found: true,
    inputSelector: primaryInput ? '[data-argus-upload-input="1"]' : null,
    triggerSelector: triggerBtn ? '[data-argus-upload-trigger="1"]' : null,
    needsButtonClick: !primaryInput && !!triggerBtn,
    hasMaxSizeHint,
    multipleSupported,
    likelyMultiPage,
    isImageUpload
  };
}
```

```js
// probe.checkUploadProgress
() => {
  const progressSel = [
    'mat-progress-bar', 'mat-progress-spinner', '[role="progressbar"]',
    '[class*="upload-progress"]', '[class*="progress-bar"]', '[class*="spinner"]',
    '[class*="uploading"]', '[class*="loading"]'
  ].join(', ');
  const hasProgress = [...document.querySelectorAll(progressSel)].some(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && getComputedStyle(e).display !== 'none';
  });
  return { hasProgress };
}
```

```js
// probe.checkUploadFinalState — args: { testFileName }
({testFileName}) => {
  const bodyText = document.body.innerText || '';
  const lowerBody = bodyText.toLowerCase();

  // Check for error state
  const errorEls = [...document.querySelectorAll('[role="alert"], mat-error, [class*="upload-error"], [class*="error-message"], .alert-danger')];
  const hasError = errorEls.some(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none';
  });
  const errorEl = errorEls.find(e => e.getBoundingClientRect().width > 0);
  const errorText = errorEl ? (errorEl.innerText || '').trim().slice(0, 200) : null;

  // Check if file name appeared in UI
  const baseName = testFileName.replace('.txt', '');
  const fileAppearedInUI = bodyText.includes(testFileName) || bodyText.includes(baseName) ||
    !!document.querySelector('[class*="file-name"], [class*="filename"], [class*="attachment-name"]');

  // Check for success feedback
  const successSel = 'mat-snack-bar-container, [class*="snackbar"], [class*="toast"], [role="alert"][class*="success"], .alert-success, [class*="success-message"]';
  const hasSuccessFeedback = [...document.querySelectorAll(successSel)].some(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none';
  });

  // Check for image preview
  const hasPreview = !!document.querySelector('[class*="preview"] img, [class*="thumbnail"] img, [class*="upload-preview"]');

  return { hasError, errorText, fileAppearedInUI, hasSuccessFeedback, hasPreview };
}
```

```js
// probe.cleanupUpload
() => {
  for (const el of document.querySelectorAll('[data-argus-upload-input], [data-argus-upload-trigger]')) {
    try {
      el.removeAttribute('data-argus-upload-input');
      el.removeAttribute('data-argus-upload-trigger');
    } catch (_) {}
  }
  return { ok: true };
}
```

Always run `probe.cleanupUpload` at the end.

## Test file setup (write before Step 1)

The orchestrator must write the test file to disk before calling `browser_file_upload`:

```
testFilePath = "{project-root}/.tmp/argus-upload-test.txt"
Content: "argus-upload-test"
```

Use the Write tool or a Bash `echo` to create it. The file must exist on the local filesystem before `browser_file_upload` is called.

## Hard rules

1. **Only upload the test `.txt` file** — never upload real user files or large binaries.
2. **Mandatory cleanup** — remove all `data-argus-upload-*` attributes.
3. **Wait max 5 s** for upload completion — `browser_wait_for(time=3000)` ceiling.
4. **Sonnet model** — upload result interpretation (did it really persist?) requires judgment.
5. **Do NOT delete the uploaded test file from the server** — the skill leaves cleanup to `qa-test-crud`'s emergency cleanup or manual review. The `.txt` content makes it clearly a test artifact.
