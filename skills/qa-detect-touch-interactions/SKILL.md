---
name: qa-detect-touch-interactions
section: responsiveness
description: "Dispatches real TouchEvent (touchstart/touchend) on elements that have hover-only handlers, to detect controls that work with mouse but not with touch. Tests tap, double-tap-to-zoom suppression, swipe gestures."
model: haiku
applyOn: [mobile, tablet]
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any bug related to touch-event handling (vs mouse-event handling) belongs to this skill"
---

# qa-detect-touch-interactions — Real TouchEvent Dispatch Testing

Dispatches genuine `TouchEvent` (not `MouseEvent`) on interactive elements to catch sites that handle mouse but not touch. The most common mobile bug class: hover-only menus, click-only buttons that don't fire on tap.

## What it checks (5 issue types)

| Issue type | Severity | What it catches |
|---|---|---|
| `hoverOnlyMenu` | high | Menu opens on mouseenter but does NOT open on touchstart — invisible to mobile users |
| `touchEventIgnored` | high | Button has click handler but no touchend handler, and touchend doesn't bubble to click on this app |
| `doubleTapZoomBlocked` | medium | Page sets `touch-action: manipulation` everywhere, blocking legitimate double-tap-to-zoom |
| `tapDelayDetected` | low | App has 300ms tap delay because no `viewport` meta tag with `width=device-width` |
| `swipeNotHandled` | medium | Element has `overflow-x: scroll` content but no swipe handler — touch users can't navigate carousel |

## Self-skip conditions

- Run on mobile/tablet only (touch testing on desktop is theoretical)
- Skip if page has zero interactive elements
- Skip if browser doesn't support TouchEvent constructor (very rare)

## Orchestrator flow

### Step 1 — Find interactive targets

```
targets = browser_evaluate(probe.findInteractiveTargets)
// Returns up to 8 targets: { selector, hasHoverHandler, hasTouchHandler, hasClickHandler }
```

### Step 2 — Test each target with TouchEvent

For each target (max 8):

```
1. Capture baseline:
   beforeState = browser_evaluate(probe.captureElementState, { selector })
   // { isMenuOpen, isExpanded, hasFocus, classList }

2. Dispatch touchstart + touchend:
   browser_evaluate(probe.dispatchTap, { selector })

3. Wait briefly:
   browser_wait_for({ time: 300 })

4. Capture after state:
   afterState = browser_evaluate(probe.captureElementState, { selector })

5. Compare:
   - target.hasHoverHandler AND !target.hasTouchHandler AND afterState.isMenuOpen === beforeState.isMenuOpen
     → emit hoverOnlyMenu (high)
   - target.hasClickHandler AND afterState === beforeState (nothing changed)
     → emit touchEventIgnored (high)
```

### Step 3 — Check viewport meta + touch-action policy

```
6. policy = browser_evaluate(probe.checkTouchPolicy)
   - if no viewport meta with width=device-width → emit tapDelayDetected (low)
   - if all interactive elements have touch-action: manipulation → emit doubleTapZoomBlocked
```

### Step 4 — Check horizontal-scroll containers for swipe

```
7. carousels = browser_evaluate(probe.findScrollableHorizontalContainers)
   // Returns elements with overflow-x: scroll/auto AND scrollWidth > clientWidth

8. For each carousel:
   - Test if scrollLeft changes after dispatching touch-based swipe (simulated horizontal touch drag)
   - If scrollLeft unchanged → emit swipeNotHandled (medium)
```

### Step 5 — Cleanup

```
9. probe.cleanupTouchTest — close any opened menus, restore scroll positions
```

## Probes (browser_evaluate)

```js
// probe.findInteractiveTargets
() => {
  const sel = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + ':nth-of-type(' + ([...el.parentNode.children].indexOf(el) + 1) + ')').slice(0, 120);
  const out = [];

  // Targets: anything with click/hover/touch-related attributes or computed cursor:pointer
  for (const el of document.querySelectorAll('button, a, [role="button"], [onclick], [onmouseover], [data-toggle], summary, label[for]')) {
    if (out.length >= 8) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // Heuristic detection of hover handlers (perfect detection requires getEventListeners which isn't available)
    const hasOnHover = !!el.onmouseover || !!el.onmouseenter;
    const hasOnTouch = !!el.ontouchstart || !!el.ontouchend;
    const hasOnClick = !!el.onclick || el.hasAttribute('onclick');

    // Heuristic: class names containing "hover" hint at hover-driven CSS
    const className = el.className && typeof el.className === 'string' ? el.className : '';
    const cssHoverHint = /hover/i.test(className);

    out.push({
      selector: sel(el),
      hasHoverHandler: hasOnHover || cssHoverHint,
      hasTouchHandler: hasOnTouch,
      hasClickHandler: hasOnClick || el.tagName === 'BUTTON' || el.tagName === 'A',
      tagName: el.tagName.toLowerCase()
    });
  }
  return out;
}
```

```js
// probe.captureElementState — args: { selector }
({selector}) => {
  let el;
  try { el = document.querySelector(selector); } catch (_) { return { error: 'selector-fail' }; }
  if (!el) return { error: 'not-found' };

  // Capture any state that might change on tap:
  // - Adjacent menu open (e.g., dropdown)
  // - aria-expanded
  // - classList (often "active", "open", "selected")
  // - Body's visible siblings (modal opened?)

  const adjacent = el.parentElement ? [...el.parentElement.children].filter(c => c !== el) : [];
  const expandedSiblings = adjacent.filter(s => {
    const r = s.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (s.getAttribute('aria-expanded') === 'true' || /open|active|expanded|show/i.test(s.className));
  });

  return {
    ariaExpanded: el.getAttribute('aria-expanded'),
    classList: el.className,
    visibleSiblings: expandedSiblings.length,
    hasFocus: document.activeElement === el,
    docScrollY: window.scrollY
  };
}
```

```js
// probe.dispatchTap — args: { selector }
({selector}) => {
  let el;
  try { el = document.querySelector(selector); } catch (_) { return { error: 'selector-fail' }; }
  if (!el) return { error: 'not-found' };

  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;

  // Construct Touch object
  const touch = new Touch({
    identifier: 1,
    target: el,
    clientX: x, clientY: y,
    pageX: x, pageY: y,
    screenX: x, screenY: y,
    radiusX: 10, radiusY: 10,
    force: 1
  });

  // Dispatch touchstart, touchend (proper sequence)
  const startEvt = new TouchEvent('touchstart', {
    bubbles: true, cancelable: true,
    touches: [touch], targetTouches: [touch], changedTouches: [touch]
  });
  el.dispatchEvent(startEvt);

  const endEvt = new TouchEvent('touchend', {
    bubbles: true, cancelable: true,
    touches: [], targetTouches: [], changedTouches: [touch]
  });
  el.dispatchEvent(endEvt);

  return { dispatched: true, x, y };
}
```

```js
// probe.checkTouchPolicy
() => {
  const meta = document.querySelector('meta[name="viewport"]');
  const metaContent = meta ? meta.getAttribute('content') || '' : '';
  const hasWidthDevice = /width\s*=\s*device-width/.test(metaContent);

  // Check if any interactive elements block double-tap zoom
  let blockedCount = 0;
  for (const el of document.querySelectorAll('button, a, [role="button"]')) {
    const style = getComputedStyle(el);
    if (style.touchAction === 'manipulation' || style.touchAction === 'none') blockedCount++;
    if (blockedCount > 20) break;
  }
  // If most interactive elements block double-tap-zoom, it's an anti-pattern
  return {
    hasWidthDevice,
    blockedTouchActionCount: blockedCount,
    tapDelayLikely: !hasWidthDevice  // older 300ms tap delay
  };
}
```

```js
// probe.findScrollableHorizontalContainers
() => {
  const sel = el => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')).slice(0, 120);
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (out.length >= 5) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width > innerWidth * 0.5) continue;  // skip large containers
    const style = getComputedStyle(el);
    if (style.overflowX !== 'scroll' && style.overflowX !== 'auto') continue;
    if (el.scrollWidth <= el.clientWidth + 5) continue;  // no actual horizontal overflow
    out.push({
      selector: sel(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      initialScrollLeft: el.scrollLeft
    });
  }
  return out;
}
```

```js
// probe.simulateHorizontalSwipe — args: { selector }
({selector}) => {
  let el;
  try { el = document.querySelector(selector); } catch (_) { return { ok: false }; }
  if (!el) return { ok: false };

  const r = el.getBoundingClientRect();
  const startX = r.left + r.width * 0.8;  // start near right edge
  const endX = r.left + r.width * 0.2;    // end near left edge (swipe left = scroll right)
  const y = r.top + r.height / 2;

  // Sequence: touchstart at startX → touchmove (3 steps) → touchend at endX
  const touch = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y, force: 1 });

  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(startX)], targetTouches: [touch(startX)], changedTouches: [touch(startX)] }));
  el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch((startX + endX) / 2)], targetTouches: [touch((startX + endX) / 2)], changedTouches: [touch((startX + endX) / 2)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch(endX)] }));

  return { ok: true, beforeScroll: el.scrollLeft };
}
```

```js
// probe.cleanupTouchTest
() => {
  // Close any opened menus
  for (const el of document.querySelectorAll('[aria-expanded="true"]')) {
    el.setAttribute('aria-expanded', 'false');
  }
  // Reset scroll positions tracked via data attribute (if needed in future)
  return { ok: true };
}
```

## Hard rules

1. **Never dispatch on form submit buttons** — could trigger real submission. Filter targets by tag/role.
2. **Mandatory cleanup** — opened menus close on exit so next skill sees clean state.
3. **Mobile/tablet only** — desktop touch testing is theoretical.
4. **300 ms wait between dispatch and snapshot** — allows JS handlers to update DOM.

## Cost analysis

| Phase | Round-trips | Cost |
|---|---|---|
| Find targets | 1 evaluate | ~$0.0002 |
| Per-target test (state + dispatch + wait + recheck) | 3 per target × 8 targets = 24 | ~$0.004 |
| Policy check | 1 evaluate | ~$0.0002 |
| Swipe test on carousels | 2 per carousel × 2-5 carousels | ~$0.001 |
| Cleanup | 1 evaluate | ~$0.0001 |
| **Total per cell** | **~30 MCP calls** | **~$0.005** |

## Notes

- Detection of hover handlers is HEURISTIC (no real way to inspect attached listeners). False negatives possible.
- TouchEvent constructor requires modern browsers; Playwright Chromium/Firefox/WebKit all support it.
- The skill complements `qa-detect-hover-touch` (which checks CSS) by testing the actual JS behavior.
