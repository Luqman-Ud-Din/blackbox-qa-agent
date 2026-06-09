---
name: qa-detect-modal-viewport-fit
section: responsiveness
description: "Tests open modals / dialogs: verify they fit within the viewport height, action buttons (Submit/Cancel) are reachable, and content scrolls internally rather than the modal overflowing"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

Modals taller than the viewport leave action buttons (Submit, Save, Cancel) unreachable — users can't dismiss or complete the action. Common bugs:
- Modal height exceeds viewport, no internal scroll on the modal body
- Modal action footer scrolls offscreen
- Modal opens at scroll position that makes its content invisible

This skill detects already-open modals OR finds a modal trigger and opens one, then measures.

## Orchestrator flow

1. Run `probe.detectOpenModal` — returns `{found, selector, openedHere}`. If `found` is true, jump to step 3.
2. If no modal currently open:
   - Run `probe.findModalTrigger` — returns `{found, selector}`. If `found` is false → **self-skip**.
   - `browser_click(selector=<trigger selector>)`
   - `browser_wait_for(time=500)`
   - Run `probe.detectOpenModal` again — if `found` is false → orchestrator gave up on this cell, **self-skip**.
   - Set `openedHere = true` so step 5 dismisses it.
3. Run `probe.measureModalFit` — returns `{tooTall, hasInternalScroll, footerOffscreen, modalBbox}`
4. Emit findings:
   - If `tooTall` AND `!hasInternalScroll` → `modalTooTallNoScroll` (high)
   - If `footerOffscreen` → `modalFooterUnreachable` (high)
   - If `modalTooWideForViewport` → `modalTooWideForViewport` (medium)
   - If `contentOverflowsModal` → `modalContentOverflows` (medium)
5. If `openedHere` is true:
   - `browser_press_key('Escape')` — dismiss
   - `browser_wait_for(time=300)`

## Probes (browser_evaluate)

```js
// probe.detectOpenModal
() => {
  const candidates = document.querySelectorAll(
    '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]), ' +
    '[role="alertdialog"]:not([aria-hidden="true"]), ' +
    '.modal.show, .modal[class*="open"], ' +
    '[data-state="open"][role="dialog"], ' +
    // Angular Material CDK overlay — attaches to document.body portal, not near the trigger
    'mat-dialog-container, ' +
    '.cdk-overlay-container [role="dialog"]:not([aria-hidden="true"]), ' +
    '.cdk-overlay-pane mat-dialog-container'
  );
  for (const c of candidates) {
    const r = c.getBoundingClientRect();
    const style = getComputedStyle(c);
    if (r.width > 100 && r.height > 100 && style.display !== 'none' && style.visibility !== 'hidden') {
      const sel = c.id ? `#${c.id}` : `[role="dialog"]`;
      c.setAttribute('data-argus-modal', '1');
      return { found: true, selector: sel };
    }
  }
  return { found: false };
}
```

```js
// probe.findModalTrigger
() => {
  // Triggers: data-modal-trigger, buttons with text "Open" / "View" / "Add" / "Edit" / "Settings"
  const buttons = [...document.querySelectorAll('button, [role="button"], a[role="button"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled;
    });
  for (const b of buttons) {
    if (b.hasAttribute('data-modal-trigger') || b.hasAttribute('data-dialog-trigger')) {
      return { found: true, selector: b.id ? `#${b.id}` : `[data-modal-trigger]` };
    }
    const ac = b.getAttribute('aria-controls') || '';
    if (ac && /modal|dialog/i.test(ac)) {
      return { found: true, selector: b.id ? `#${b.id}` : `button[aria-controls="${ac}"]` };
    }
    const txt = (b.innerText || '').trim().toLowerCase();
    if (/^(open|view|details|edit|settings|preferences|new|add)$/i.test(txt) && b.offsetWidth > 0) {
      b.setAttribute('data-argus-modal-trigger', '1');
      return { found: true, selector: '[data-argus-modal-trigger]' };
    }
  }
  return { found: false };
}
```

```js
// probe.measureModalFit
() => {
  const modal = document.querySelector('[data-argus-modal="1"]') ||
                document.querySelector('[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])');
  if (!modal) return { tooTall: false, hasInternalScroll: false, footerOffscreen: false };
  const r = modal.getBoundingClientRect();
  const vh = window.innerHeight;

  // Find an internal scroll container inside the modal
  const innerScrollers = [...modal.querySelectorAll('*')].filter(el => {
    const s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
  });
  const hasInternalScroll = innerScrollers.length > 0;

  // Find footer — includes Angular Material mat-dialog-actions
  const footer = modal.querySelector(
    'mat-dialog-actions, ' +
    '.modal-footer, [class*="modal-footer"], [class*="dialog-footer"], ' +
    '[class*="actions"]:last-child, [class*="buttons"]:last-child, ' +
    '.cdk-overlay-pane mat-dialog-actions'
  );
  let footerOffscreen = false;
  if (footer) {
    const fr = footer.getBoundingClientRect();
    footerOffscreen = fr.bottom > vh + 2 || fr.top > vh;
  }

  // Narrow-width reflow check
  const modalStyle = getComputedStyle(modal);
  const minWidth = parseFloat(modalStyle.minWidth) || 0;
  const vwWidth = window.innerWidth;
  const modalTooWideForViewport = minWidth > vwWidth * 0.95 && vwWidth < 480;

  // Internal content overflow (fixed-width children inside modal)
  let contentOverflowsModal = false;
  const modalBody = modal.querySelector('[class*="modal-body"],[class*="dialog-body"],[class*="modal-content"] > div, [class*="dialog-content"] > div');
  if (modalBody && modalBody.scrollWidth > modalBody.clientWidth + 10) {
    contentOverflowsModal = true;
  }

  return {
    tooTall: r.height > vh + 4,
    hasInternalScroll,
    footerOffscreen,
    modalTooWideForViewport,
    contentOverflowsModal,
    modalBbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  };
}
```

```js
// probe.cleanupModalFit
() => {
  for (const el of document.querySelectorAll('[data-argus-modal], [data-argus-modal-trigger]')) {
    try {
      el.removeAttribute('data-argus-modal');
      el.removeAttribute('data-argus-modal-trigger');
    } catch (_) {}
  }
  return { ok: true };
}
```

After step 5 (if dismissed), call `probe.cleanupModalFit`.

## Issues
| issueType | severity | description |
|---|---|---|
| modalTooTallNoScroll | high | "Modal height {h}px exceeds viewport {vh}px and has no internal scroll — content below the fold is unreachable" |
| modalFooterUnreachable | high | "Modal action footer (Submit/Cancel buttons) is below the viewport — users cannot click them without scrolling outside the modal" |
| modalTooWideForViewport | medium | "Modal has min-width:{minWidth}px which exceeds viewport width {vw}px — content will overflow or be clipped on mobile" |
| modalContentOverflows | medium | "Modal body content overflows its container — internal content has fixed width wider than the modal itself" |
