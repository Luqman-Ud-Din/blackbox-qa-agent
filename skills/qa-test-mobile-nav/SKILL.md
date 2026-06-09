---
name: qa-test-mobile-nav
section: interactive
description: "Tests hamburger menu / mobile nav drawer: ARIA label, opens, contains visible links, closes on Escape, focus does not leak to background content"
model: haiku
applyOn: [mobile, tablet]
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

On mobile/tablet, navigation usually lives behind a hamburger button. This skill verifies:
- The hamburger toggle exists and is clickable
- Hamburger button has `aria-label` and `aria-expanded` (screen reader accessible)
- Clicking it reveals a drawer/menu with visible internal links
- When drawer is open, background content is inert or aria-hidden (focus stays in drawer)
- Closing the drawer (Escape or close button) hides the navigation

## Orchestrator flow

1. Run `probe.findHamburgerToggle` — returns `{found, selector, alreadyOpen}`. If `found` is false → **self-skip** (no findings).
2. Run `probe.checkHamburgerA11y` — if hamburger button is missing `aria-label`/visible text → emit `hamburgerNoAriaLabel` (medium). If missing `aria-expanded` → emit `hamburgerNoAriaExpanded` (medium).
3. If `alreadyOpen` is true → skip the open click. Otherwise:
   - `browser_click(selector=<toggle selector from probe>)`
   - `browser_wait_for(time=500)`
4. Run `probe.checkDrawerVisible` — if `visible` is false → emit `mobileNavDoesNotOpen` (high) and stop.
5. Run `probe.countDrawerLinks` — if `linkCount` < 1 → emit `mobileNavEmpty` (high).
6. Run `probe.checkFocusTrap` — if background `<main>` has no `inert` or `aria-hidden="true"` while drawer is open → emit `drawerNoFocusTrap` (high).
7. Run `probe.swipeToCloseDrawer` — dispatches a synthetic TouchEvent swipe sequence on the drawer.
8. `browser_wait_for(time=500)`
9. Run `probe.checkDrawerVisible` — if `visible` is still true after swipe → emit `mobileNavNoSwipeClose` (low). Then continue to Escape test regardless.
10. `browser_press_key('Escape')`
11. `browser_wait_for(time=400)`
12. Run `probe.checkDrawerVisible` again — if `visible` is still true → emit `mobileNavWontClose` (medium).

## Probes (browser_evaluate)

```js
// probe.findHamburgerToggle
() => {
  const candidates = [
    'button[aria-label*="menu" i]', 'button[aria-label*="navigation" i]',
    '.hamburger', '[data-testid*="menu-toggle"]', '[data-testid*="nav-toggle"]',
    'button[aria-controls*="menu" i]', 'button[aria-controls*="nav" i]',
    'button[aria-expanded][class*="menu"]', 'button[aria-expanded][class*="nav"]',
    // Angular Material mat-sidenav triggers
    'button[aria-label*="toggle" i]', 'button[aria-label*="sidenav" i]',
    '[class*="sidenav-toggle"]', '[class*="menu-toggle"]',
    'mat-icon[aria-label*="menu" i]', 'button mat-icon'
  ];
  for (const sel of candidates) {
    let el;
    try { el = document.querySelector(sel); } catch (_) { continue; }
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const expanded = el.getAttribute('aria-expanded');
    return {
      found: true,
      selector: el.id ? `#${el.id}` : sel,
      alreadyOpen: expanded === 'true'
    };
  }
  return { found: false };
}
```

```js
// probe.checkDrawerVisible
() => {
  const candidates = [
    '[role="dialog"][aria-modal="true"]',
    'nav[aria-hidden="false"]',
    '[class*="drawer"]:not([aria-hidden="true"])',
    '[class*="mobile-nav"]:not([aria-hidden="true"])',
    '[class*="nav-menu"][class*="open"]',
    '[data-state="open"][class*="nav"]',
    // Angular Material mat-sidenav (opened state)
    'mat-sidenav[opened]',
    'mat-sidenav.mat-drawer-opened',
    'mat-sidenav:not([style*="visibility: hidden"])',
    '.mat-drawer-opened mat-sidenav'
  ];
  for (const sel of candidates) {
    let el;
    try { el = document.querySelector(sel); } catch (_) { continue; }
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width > 50 && r.height > 50 && style.display !== 'none' && style.visibility !== 'hidden') {
      return { visible: true, selector: sel };
    }
  }
  return { visible: false };
}
```

```js
// probe.checkHamburgerA11y
() => {
  const candidates = [
    'button[aria-label*="menu" i]', 'button[aria-label*="navigation" i]',
    '.hamburger', '[data-testid*="menu-toggle"]', '[data-testid*="nav-toggle"]',
    'button[aria-controls*="menu" i]', 'button[aria-controls*="nav" i]',
    'button[aria-expanded][class*="menu"]', 'button[aria-expanded][class*="nav"]'
  ];
  for (const sel of candidates) {
    let el;
    try { el = document.querySelector(sel); } catch (_) { continue; }
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const hasAriaLabel = el.hasAttribute('aria-label') && el.getAttribute('aria-label').trim().length > 0;
    const hasAriaExpanded = el.hasAttribute('aria-expanded');
    const visibleText = (el.innerText || el.textContent || '').trim();
    return {
      found: true,
      hasLabel: hasAriaLabel || visibleText.length > 0,
      hasExpanded: hasAriaExpanded
    };
  }
  return { found: false, hasLabel: false, hasExpanded: false };
}
```

```js
// probe.checkFocusTrap — drawer open: is background main content still tabbable?
() => {
  const drawer = document.querySelector(
    '[role="dialog"][aria-modal="true"], nav[aria-hidden="false"], [class*="drawer"]:not([aria-hidden="true"]), [class*="mobile-nav"]:not([aria-hidden="true"]), [data-state="open"][class*="nav"]'
  );
  if (!drawer) return { drawerFound: false };
  const main = document.querySelector('main, [role="main"], #main, #content, .main-content');
  if (!main) return { drawerFound: true, trapped: true };
  const hasInert = main.hasAttribute('inert');
  const hasAriaHidden = main.getAttribute('aria-hidden') === 'true';
  if (hasInert || hasAriaHidden) return { drawerFound: true, trapped: true };
  const tabbable = [...main.querySelectorAll(
    'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => !drawer.contains(el));
  return { drawerFound: true, trapped: false, tabbableCount: tabbable.length };
}
```

```js
// probe.swipeToCloseDrawer — dispatch synthetic left swipe on the open drawer
() => {
  const drawer = document.querySelector(
    '[role="dialog"][aria-modal="true"], nav[aria-hidden="false"], [class*="drawer"]:not([aria-hidden="true"]), [class*="mobile-nav"]:not([aria-hidden="true"]), [data-state="open"][class*="nav"]'
  );
  if (!drawer) return { dispatched: false };
  const r = drawer.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { dispatched: false };
  // Swipe left across the drawer (typical gesture for closing a left-side drawer)
  const startX = r.left + r.width * 0.7;
  const startY = r.top + r.height * 0.5;
  const endX = r.left - 30;
  try {
    const mkTouch = (x, y) => new Touch({ identifier: Date.now(), target: drawer, clientX: x, clientY: y, radiusX: 10, radiusY: 10, force: 1 });
    drawer.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [mkTouch(startX, startY)] }));
    drawer.dispatchEvent(new TouchEvent('touchmove',  { bubbles: true, cancelable: true, touches: [mkTouch((startX+endX)/2, startY)] }));
    drawer.dispatchEvent(new TouchEvent('touchmove',  { bubbles: true, cancelable: true, touches: [mkTouch(endX, startY)] }));
    drawer.dispatchEvent(new TouchEvent('touchend',   { bubbles: true, cancelable: true, touches: [], changedTouches: [mkTouch(endX, startY)] }));
    return { dispatched: true };
  } catch (_) { return { dispatched: false, error: _.message }; }
}
```

```js
// probe.countDrawerLinks
() => {
  const drawer = document.querySelector(
    '[role="dialog"][aria-modal="true"], nav[aria-hidden="false"], [class*="drawer"]:not([aria-hidden="true"]), [class*="mobile-nav"]:not([aria-hidden="true"])'
  );
  if (!drawer) return { linkCount: 0 };
  const links = [...drawer.querySelectorAll('a[href], button[role="link"]')].filter(a => {
    const r = a.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  return { linkCount: links.length };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| hamburgerNoAriaLabel | medium | "Hamburger button has no aria-label and no visible text — screen readers can't identify it" |
| hamburgerNoAriaExpanded | medium | "Hamburger button is missing aria-expanded — screen readers won't announce open/closed state" |
| mobileNavDoesNotOpen | high | "Clicking hamburger toggle did not open a visible navigation drawer" |
| mobileNavEmpty | high | "Mobile nav drawer opened but contains no visible navigation links" |
| drawerNoFocusTrap | high | "Mobile nav drawer is open but background <main> has no inert/aria-hidden — {N} tabbable elements leak outside drawer" |
| mobileNavNoSwipeClose | low | "Mobile nav drawer did not close on left-swipe gesture — swipe-to-dismiss not implemented" |
| mobileNavWontClose | medium | "Mobile nav drawer did not close on Escape key — focus trap risk" |
