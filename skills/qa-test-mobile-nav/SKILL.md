---
name: qa-test-mobile-nav
description: "Tests hamburger menu / mobile nav drawer: opens, contains visible links, closes on link-click or Escape"
model: haiku
applyOn: [mobile, tablet]
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

On mobile/tablet, navigation usually lives behind a hamburger button. This skill verifies:
- The hamburger toggle exists and is clickable
- Clicking it reveals a drawer/menu with visible internal links
- Closing the drawer (Escape or close button) hides the navigation
- Drawer does not trap focus permanently

## Orchestrator flow

1. Run `probe.findHamburgerToggle` — returns `{found, selector, alreadyOpen}`. If `found` is false → **self-skip** (no findings).
2. If `alreadyOpen` is true → skip the open click. Otherwise:
   - `browser_click(selector=<toggle selector from probe>)`
   - `browser_wait_for(time=500)`
3. Run `probe.checkDrawerVisible` — if `visible` is false → emit `mobileNavDoesNotOpen` (high) and stop.
4. Run `probe.countDrawerLinks` — if `linkCount` < 1 → emit `mobileNavEmpty` (high).
5. `browser_press_key('Escape')`
6. `browser_wait_for(time=400)`
7. Run `probe.checkDrawerVisible` again — if `visible` is still true → emit `mobileNavWontClose` (medium).

## Probes (browser_evaluate)

```js
// probe.findHamburgerToggle
() => {
  const candidates = [
    'button[aria-label*="menu" i]', 'button[aria-label*="navigation" i]',
    '.hamburger', '[data-testid*="menu-toggle"]', '[data-testid*="nav-toggle"]',
    'button[aria-controls*="menu" i]', 'button[aria-controls*="nav" i]',
    'button[aria-expanded][class*="menu"]', 'button[aria-expanded][class*="nav"]',
    'button > svg + span:has-text("Menu")'
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
    '[data-state="open"][class*="nav"]'
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
| mobileNavDoesNotOpen | high | "Clicking hamburger toggle did not open a visible navigation drawer" |
| mobileNavEmpty | high | "Mobile nav drawer opened but contains no visible navigation links" |
| mobileNavWontClose | medium | "Mobile nav drawer did not close on Escape key — focus trap risk" |
