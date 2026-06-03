---
name: qa-test-form-file-upload
description: "Tests file upload inputs: presence of accept attribute, presence of size constraints, and behaviour when a file is selected"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

File upload inputs (`<input type="file">`) frequently miss:
- An `accept=` attribute restricting types (any file accepted, including .exe / .bat)
- A documented size limit (users discover the limit by failing)
- Filename feedback after selection (user can't tell if file was attached)

This skill detects misconfigured upload inputs and, where safe, drives a small fixture file through the upload to verify the UI reflects the selection.

## Orchestrator flow

1. Run `probe.findFileInputs` — returns `[{inputIdx, selector, hasAccept, hasMultiple, sizeHint}]`. If empty → **self-skip**.
2. For each file input (max 2):
   a. Emit `fileAcceptMissing` (medium) if `hasAccept` is false.
   b. Emit `fileSizeHintMissing` (low) if `sizeHint` is false (no "max N MB" text nearby).
   c. **Upload test (best-effort, non-destructive — only triggers form `change` event, does NOT submit):**
      - Use `browser_file_upload(paths=["{project-root}/.tmp/qa-fixtures/tiny.txt"])` targeting the input.
        - The fixture file should be a 12-byte text file. If it does not exist, skip this upload test (no finding emitted).
      - `browser_wait_for(time=500)`
      - Run `probe.checkFilenameDisplayed({inputIdx, expectedName: "tiny.txt"})` — if no UI feedback shows the file name → emit `fileNoSelectionFeedback` (medium).
3. Run `probe.resetFileInputs` to clear any selection state.

## Probes (browser_evaluate)

```js
// probe.findFileInputs
() => {
  const out = [];
  const inputs = [...document.querySelectorAll('input[type="file"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      // file inputs are often hidden; the visible "Upload" button label is sibling
      // We still want to detect attribute issues on hidden file inputs
      return !el.disabled;
    })
    .slice(0, 2);
  for (let i = 0; i < inputs.length; i++) {
    const el = inputs[i];
    const container = el.closest('label, div, fieldset, .form-group, .upload, .file-input') || el.parentElement;
    const surroundingText = container ? container.innerText : '';
    const sizeHint = /max(imum)?\s*\d+\s*(kb|mb|bytes?)/i.test(surroundingText) ||
                      /up\s*to\s*\d+\s*(kb|mb)/i.test(surroundingText);
    out.push({
      inputIdx: i,
      selector: el.id ? `#${el.id}` : `input[type="file"]:nth-of-type(${i+1})`,
      hasAccept: el.hasAttribute('accept') && el.getAttribute('accept').trim().length > 0,
      hasMultiple: el.hasAttribute('multiple'),
      sizeHint
    });
  }
  return out;
}
```

```js
// probe.checkFilenameDisplayed  — args: { inputIdx, expectedName }
({inputIdx, expectedName}) => {
  const inputs = document.querySelectorAll('input[type="file"]');
  const input = inputs[inputIdx];
  if (!input) return { displayed: false };
  // Check 1: input.files reports the file
  const inputHasFile = input.files && input.files.length > 0 && input.files[0].name.includes(expectedName);
  // Check 2: nearby DOM contains the filename as text
  const container = input.closest('label, div, fieldset, .form-group, .upload, .file-input, form') || input.parentElement;
  const text = container ? container.innerText : '';
  const visibleFileName = text.includes(expectedName);
  return {
    displayed: inputHasFile && visibleFileName,
    inputHasFile,
    visibleFileName
  };
}
```

```js
// probe.resetFileInputs
() => {
  const inputs = document.querySelectorAll('input[type="file"]');
  for (const el of inputs) {
    try { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
  }
  return { ok: true };
}
```

## Fixture file requirement

This skill expects a small text file at `{project-root}/.tmp/qa-fixtures/tiny.txt` (any 1–100 byte file is fine). If the file is missing, the upload test is skipped and only the attribute checks run. The orchestrator may create the fixture once with content `"argus-qa upload test"`.

## Issues
| issueType | severity | description |
|---|---|---|
| fileAcceptMissing | medium | "File input {selector} has no accept attribute — any file type accepted including executables" |
| fileSizeHintMissing | low | "File input {selector} has no visible size-limit hint — users discover the limit by failing" |
| fileNoSelectionFeedback | medium | "After uploading a file, no UI feedback shows the selected file name" |
