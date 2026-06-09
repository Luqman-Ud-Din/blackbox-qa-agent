---
name: qa-test-dragdrop
section: interactive
description: "Tests drag-and-drop reordering using MCP browser_drag tool (primary) and HTML5 drag event fallback via browser_evaluate. No raw Playwright mouse API. Uses browser_console_messages to detect JS errors during drag."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

# QA Test — Drag and Drop (MCP-native rewrite)

## Self-skip
Skip if no visible draggable elements: `[draggable="true"], [data-draggable], [class*="sortable"] > *, .drag-handle, [cdkDrag], [class*="cdk-drag"]`

## Orchestrator flow

### Step 1 — Find draggable items

```
dragState = browser_evaluate(probe.findDraggableItems)
// Returns {found, items: [{idx, selector, text, cx, cy}]}
If !dragState.found OR dragState.items.length < 2 → self-skip
```

Record:
- `item0 = items[0]` (source — will be dragged)
- `item2 = items[min(2, items.length-1)]` (target — drag destination)
- `text0 = item0.text` (to verify order changed after drag)

### Step 2 — Take baseline screenshot

```
browser_take_screenshot()
```

### Step 3 — Attempt MCP drag (primary method)

```
browser_drag(
  startX = item0.cx,
  startY = item0.cy,
  endX   = item2.cx,
  endY   = item2.cy
)
browser_wait_for(time=700)
```

### Step 4 — Check if reorder occurred

```
reorderCheck = browser_evaluate(probe.checkReorderOccurred, {
  expectedFirstText: text0,
  item0Selector: item0.selector
})

If reorderCheck.reordered → drag succeeded, continue to Step 6
If !reorderCheck.reordered → Step 5 (HTML5 fallback)
```

### Step 5 — HTML5 drag event fallback

```
fallbackResult = browser_evaluate(probe.triggerHtml5Drag, {
  sourceIdx: item0.idx,
  targetIdx: item2.idx
})
browser_wait_for(time=700)

reorderCheck2 = browser_evaluate(probe.checkReorderOccurred, {
  expectedFirstText: text0,
  item0Selector: item0.selector
})

If !reorderCheck2.reordered:
  → emit dragDropBroken (high)
    evidence: {
      text0: text0,
      targetText: item2.text,
      fallbackAttempted: true,
      mcpDragAttempted: true
    }
```

### Step 6 — Check for JS errors during drag

```
consoleMsgs = browser_console_messages()
jsErrors = consoleMsgs.filter(m => m.type === 'error')
If jsErrors.length > 0:
  → emit dragDropJsError (high)
    evidence: {firstError: jsErrors[0].text.slice(0, 200)}
```

### Step 7 — Cleanup

```
browser_evaluate(probe.cleanupDragDrop)
```

## Probes (browser_evaluate)

```js
// probe.findDraggableItems
() => {
  const selectors = [
    '[draggable="true"]',
    '[class*="sortable"] > li',
    '[class*="sortable"] > [class*="item"]',
    '.drag-handle',
    '[cdkDrag]',
    '[class*="cdk-drag"]',
    '[data-draggable]',
    '[class*="drag-item"]'
  ];

  let items = [];
  for (const sel of selectors) {
    const found = [...document.querySelectorAll(sel)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 10 && r.height > 10;
    });
    if (found.length >= 2) { items = found; break; }
  }

  if (items.length < 2) return { found: false };

  const result = items.slice(0, 5).map((el, i) => {
    const r = el.getBoundingClientRect();
    el.setAttribute('data-argus-drag', String(i));
    return {
      idx: i,
      selector: `[data-argus-drag="${i}"]`,
      text: (el.innerText || el.getAttribute('aria-label') || `Item ${i+1}`).trim().slice(0, 60),
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2)
    };
  });

  return { found: true, items: result };
}
```

```js
// probe.checkReorderOccurred — args: { expectedFirstText, item0Selector }
({expectedFirstText, item0Selector}) => {
  // Find the first visible item in the list
  const container = document.querySelector(
    '[class*="sortable"], [cdkDropList], [class*="drag-list"], [class*="drop-zone"]'
  );
  if (!container) {
    // Fallback: check if item with data-argus-drag="0" is still in the first position
    const item0 = document.querySelector(item0Selector);
    if (!item0) return { reordered: true }; // item moved DOM position
    const parent = item0.parentElement;
    if (!parent) return { reordered: false };
    const firstChild = [...parent.children].find(c => c.getBoundingClientRect().width > 0);
    return { reordered: firstChild !== item0 };
  }

  const firstItem = [...container.children].find(el => el.getBoundingClientRect().height > 0);
  if (!firstItem) return { reordered: false };

  const firstText = (firstItem.innerText || '').trim().slice(0, 60);
  return { reordered: firstText !== expectedFirstText, firstText };
}
```

```js
// probe.triggerHtml5Drag — args: { sourceIdx, targetIdx }
({sourceIdx, targetIdx}) => {
  const source = document.querySelector(`[data-argus-drag="${sourceIdx}"]`);
  const target = document.querySelector(`[data-argus-drag="${targetIdx}"]`);
  if (!source || !target) return { dispatched: false, reason: 'elements not found' };

  const dt = new DataTransfer();
  dt.setData('text/plain', sourceIdx.toString());

  try {
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }));
    source.dispatchEvent(new DragEvent('dragend',   { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { dispatched: true };
  } catch (e) {
    return { dispatched: false, error: e.message };
  }
}
```

```js
// probe.cleanupDragDrop
() => {
  for (const el of document.querySelectorAll('[data-argus-drag]')) {
    try { el.removeAttribute('data-argus-drag'); } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| dragDropBroken | high | "Dragging '{text0}' to position 3 did not reorder the list (tried both MCP browser_drag and HTML5 DragEvent fallback)" |
| dragDropJsError | high | "Drag-and-drop produced a JavaScript console error: {firstError}" |

## Hard rules

1. **NEVER use** raw Playwright mouse API (`page.mouse.down()`, `page.mouse.move()`, `page.on()`) — unavailable in MCP.
2. **Primary method:** `browser_drag(startX, startY, endX, endY)` — the MCP `browser_drag` tool handles mouse press/move/release.
3. **Fallback method:** HTML5 `DragEvent` dispatch via `browser_evaluate` — covers CDK drag or HTML5-only implementations.
4. **JS error detection:** use `browser_console_messages()` — not `page.on('pageerror', ...)`.
5. **Mandatory cleanup** — remove all `data-argus-drag` attributes.
