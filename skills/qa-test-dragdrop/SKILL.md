---
name: qa-test-dragdrop
description: "Verify draggable items can be reordered and drag-and-drop produces no JS errors"
---

# QA Test — Drag and Drop

## What Claude tests

- Items in a sortable list or kanban board can be dragged from one position to another and the order changes
- The drag-and-drop interaction does not produce an unhandled JavaScript error

## Test steps

**Self-skip check:**
1. Check for draggable elements on the page:
   `page.locator('[draggable="true"], [data-draggable], [class*="sortable"] li, [class*="kanban"] [class*="card"], .drag-handle').first().isVisible()`.
   If none found → self-skip with message "no draggable elements detected on this route".

**JS error monitoring:**
2. Set up a console error listener before performing drag:
   ```
   const jsErrors = [];
   page.on('pageerror', err => jsErrors.push(err.message));
   page.on('console', msg => {
     if (msg.type() === 'error') jsErrors.push(msg.text());
   });
   ```

**Drag to reorder test:**
3. Collect the list of draggable items:
   `const items = await page.locator('[draggable="true"], [class*="sortable"] li, .drag-handle').all()`.
4. If fewer than 2 items → self-skip (nothing to reorder).
5. Read the label/text of item at position 0 (first item) and position 2 (third item, or last if < 3):
   ```
   const item0Text = await items[0].innerText();
   const item2Text = await items[Math.min(2, items.length - 1)].innerText();
   ```
6. Get the bounding boxes of item[0] and item[2]:
   ```
   const box0 = await items[0].boundingBox();
   const box2 = await items[Math.min(2, items.length - 1)].boundingBox();
   ```
7. Perform the drag using mouse events (simulates real drag):
   ```
   // Start drag
   await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
   await page.mouse.down();
   // Move slowly to the target
   await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 10 });
   await page.waitForTimeout(200);
   await page.mouse.up();
   await page.waitForTimeout(500);
   ```
8. Re-read the text of the first item in the list after the drag:
   `const newFirstText = await page.locator('[draggable="true"], [class*="sortable"] li').first().innerText()`.
9. If the first item text is still `item0Text` (unchanged) AND `item2Text` is still in its original position → log `dragDropBroken`.
10. If any JS error was captured in step 2 → log `dragDropJsError`.

**Alternative: HTML5 drag events (for elements that use ondragstart/ondrop):**
11. If the mouse-based approach in steps 6–9 did not produce a reorder, try firing native drag events:
    ```
    await page.evaluate(([sourceSelector, targetSelector]) => {
      const source = document.querySelector(sourceSelector);
      const target = document.querySelector(targetSelector);
      if (!source || !target) return;
      const dt = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, [draggableSelector0, draggableSelector2]);
    ```
12. Re-check the order as in step 8–9.

## Pass / Fail criteria

Pass:
- After dragging item from position 0 to position 2 (or 3), the list order has changed — item0Text is no longer in the first position.
- No JavaScript console errors were produced during the drag interaction.

Fail:
- Drag interaction completed but item order did not change → `dragDropBroken`.
- Drag interaction produced a JavaScript error → `dragDropJsError`.

## Issue schema

- type: "dragDropBroken"
- severity: high
- selector: "draggable list or sortable container"
- description: "Dragging item '{item0Text}' to position 3 did not reorder the list — the item order is unchanged"

- type: "dragDropJsError"
- severity: high
- selector: "draggable element"
- description: "Drag-and-drop interaction produced a JavaScript error: '{errorMessage}'"

## Scope

applyOn: ["desktop"]
Self-skip conditions: skip if no elements with `draggable="true"`, `data-draggable`, sortable list classes, or kanban board cards are found on the route.
