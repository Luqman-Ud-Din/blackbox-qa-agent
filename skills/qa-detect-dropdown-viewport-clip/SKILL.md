---
name: qa-detect-dropdown-viewport-clip
section: responsiveness
description: "Tests dropdown / tooltip / autocomplete menus: open each, verify the popup is not clipped at the right or bottom edge of the viewport"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

Dropdowns, popovers, autocomplete menus, and tooltips frequently render off-screen when their trigger sits near the right or bottom edge of the viewport. Common bugs:
- A dropdown opens but its right edge is past the viewport — options unreadable / unclickable
- A tooltip opens past the bottom — text cut off
- An autocomplete suggestion list overflows the page without scrollbar

This skill finds triggers near viewport edges, opens each, measures the popup's bbox, and reports any clipped beyond the viewport.

## Orchestrator flow

1. Run `probe.findEdgeNearTriggers` — returns `[{idx, selector, edgeKind}]` where `edgeKind` is `"right"` or `"bottom"`. Limit 3. If empty → **self-skip**.
2. For each trigger:
   a. `browser_click(selector=<trigger selector>)`
   b. `browser_wait_for(time=400)`
   c. Run `probe.measureOpenedPopup({idx})` — returns `{found, clippedRight, clippedBottom, popupBbox}`
   d. If `found` is true AND `clippedRight` is true → emit `dropdownClippedRight` (high)
   e. If `found` is true AND `clippedBottom` is true → emit `dropdownClippedBottom` (high)
   f. `browser_press_key('Escape')` — dismiss the popup before moving on
   g. `browser_wait_for(time=300)`
3. Run `probe.closeAllPopups` — best-effort dismiss anything still open.

## Probes (browser_evaluate)

```js
// probe.findEdgeNearTriggers
() => {
  const out = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Triggers: aria-haspopup, [aria-expanded="false"] dropdown buttons, common menu/select patterns
  const candidates = [
    ...document.querySelectorAll(
      '[aria-haspopup="menu"], [aria-haspopup="listbox"], [aria-haspopup="true"], ' +
      'button[aria-expanded="false"], ' +
      '[data-toggle="dropdown"], [data-toggle="tooltip"], ' +
      '[class*="dropdown-toggle"], [class*="menu-button"], ' +
      'button[data-tooltip], [data-popover]'
    )
  ]
    .filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      return true;
    });

  for (const el of candidates) {
    if (out.length >= 4) break;
    const r = el.getBoundingClientRect();
    // Near right edge — top 1/3 of viewport-right
    const nearRight = r.left > vw * 0.65;
    // Near bottom edge
    const nearBottom = r.top > vh * 0.65;
    if (!nearRight && !nearBottom) continue;
    el.setAttribute('data-argus-clip', String(out.length));
    out.push({
      idx: out.length,
      selector: el.id ? `#${el.id}` : `[data-argus-clip="${out.length}"]`,
      edgeKind: nearRight ? 'right' : 'bottom'
    });
  }
  return out;
}
```

```js
// probe.measureOpenedPopup  — args: { idx }
({idx}) => {
  const trigger = document.querySelector(`[data-argus-clip="${idx}"]`);
  if (!trigger) return { found: false };
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Find the popup. Strategy:
  // 1. trigger.aria-controls → element with that id
  const controls = trigger.getAttribute('aria-controls');
  let popup = controls ? document.getElementById(controls) : null;

  // 2. Look for newly visible role="menu" / role="listbox" / role="tooltip" / [class*=popover]
  // ALSO check Angular Material CDK overlay portal (attaches to document.body, not near trigger)
  if (!popup) {
    const candidates = document.querySelectorAll(
      '[role="menu"]:not([hidden]), [role="listbox"]:not([hidden]), ' +
      '[role="tooltip"]:not([aria-hidden="true"]), [class*="popover"]:not([aria-hidden="true"]), ' +
      '[class*="dropdown-menu"]:not([hidden]), [data-state="open"], ' +
      // Angular Material CDK overlays
      '.cdk-overlay-container .mat-select-panel, ' +
      '.cdk-overlay-container .mat-autocomplete-panel, ' +
      '.cdk-overlay-container mat-menu, ' +
      '.cdk-overlay-container [role="listbox"], ' +
      '.cdk-overlay-pane'
    );
    for (const c of candidates) {
      const r = c.getBoundingClientRect();
      const style = getComputedStyle(c);
      if (r.width > 30 && r.height > 20 && style.display !== 'none' && style.visibility !== 'hidden') {
        popup = c;
        break;
      }
    }
  }

  if (!popup) return { found: false };
  const r = popup.getBoundingClientRect();
  return {
    found: true,
    popupBbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    clippedRight: r.right > vw + 2,
    clippedBottom: r.bottom > vh + 2,
    overhangRight: Math.max(0, Math.round(r.right - vw)),
    overhangBottom: Math.max(0, Math.round(r.bottom - vh))
  };
}
```

```js
// probe.closeAllPopups
() => {
  // Dismiss everything via Escape
  try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
  // Click anywhere safe on document body
  try { document.body.click(); } catch (_) {}
  // Remove tracking attribute
  for (const el of document.querySelectorAll('[data-argus-clip]')) {
    try { el.removeAttribute('data-argus-clip'); } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| dropdownClippedRight | high | "Dropdown/popup opens past the right viewport edge by {overhangRight}px — options unreadable or unclickable" |
| dropdownClippedBottom | high | "Dropdown/popup opens past the bottom viewport edge by {overhangBottom}px — options unreadable or unclickable" |
