---
name: qa-test-dragdrop
description: "Tests drag-and-drop reordering using mouse events with HTML5 drag event fallback"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Skip if no visible: `[draggable="true"], [data-draggable], [class*="sortable"] li, .drag-handle`

## Test
- Capture JS errors: `page.on('pageerror', err => jsErrors.push(err.message))`
- Collect `[draggable="true"], [class*="sortable"] li, .drag-handle` — need ≥ 2 items
- Record `text0 = items[0].innerText`, `box0 = items[0].boundingBox()`, `box2 = items[min(2,len-1)].boundingBox()`
- **Mouse drag:** move to center of box0, mousedown, move to center of box2 (steps:10), wait 200ms, mouseup, wait 500ms
- Check first item text. If still `text0` → try **HTML5 fallback:**
  ```js
  // dispatch dragstart on source, dragover+drop on target, dragend on source (DataTransfer)
  ```
  Wait 500ms, re-check. If still `text0` → dragDropBroken (high)
- If `jsErrors.length > 0` → dragDropJsError (high)

## Issues
| issueType | severity | description |
|---|---|---|
| dragDropBroken | high | "Dragging \"{text0}\" to position 3 did not reorder the list (tried both mouse and HTML5 drag events)" |
| dragDropJsError | high | "Drag-and-drop produced a JavaScript error: {jsErrors[0]}" |
