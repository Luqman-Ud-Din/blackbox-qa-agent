---
name: qa-detect-sticky-scroll
section: responsiveness
description: "Tests sticky elements during scroll: they remain pinned, do not overlap content, and do not detach. Scrolls the page, captures state, restores."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

Sticky / fixed headers and sidebars commonly break in subtle ways:
- The sticky header detaches and scrolls away (`position: sticky` broken by an ancestor with `overflow: hidden`)
- The sticky element overlaps content that has no offset/padding compensation
- Two sticky elements collide

This skill scrolls the page down, measures sticky behavior, then scrolls back to top.

## Orchestrator flow

**Step 5 (scroll back to top) is mandatory.**

1. Run `probe.captureScrollAndSticky` — returns `{scrollTop: 0, stickyCount, stickyAtTop: [...]}`. Save baseline. If `stickyCount === 0` → **self-skip**.
2. `browser_evaluate`: `window.scrollTo({ top: 800, behavior: 'instant' })` (or use `window.scrollBy(0, 800)`)
3. `browser_wait_for(time=400)`
4. Run `probe.checkStickyAfterScroll` — measures each baseline sticky element's new position
5. `browser_evaluate`: `window.scrollTo({ top: 0, behavior: 'instant' })` — RESTORE
6. `browser_wait_for(time=200)`

## Probes (browser_evaluate)

```js
// probe.captureScrollAndSticky
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    return (el.tagName.toLowerCase() + id).slice(0, 120);
  };
  const out = [];
  // Find all sticky and fixed elements visible in viewport
  const all = document.querySelectorAll('header, nav, aside, [class*="sticky"], [class*="fixed"], [class*="navbar"]');
  let stickyCount = 0;
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.position !== 'sticky' && style.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    stickyCount++;
    el.setAttribute('data-argus-sticky', String(out.length));
    out.push({
      idx: out.length,
      selector: sel(el),
      initialTop: Math.round(r.top),
      initialBottom: Math.round(r.bottom),
      position: style.position
    });
    if (out.length >= 6) break;
  }
  return {
    scrollTop: window.scrollY,
    stickyCount,
    stickyAtTop: out
  };
}
```

```js
// probe.checkStickyAfterScroll
() => {
  const out = [];
  const items = document.querySelectorAll('[data-argus-sticky]');
  const newScrollTop = window.scrollY;
  for (const el of items) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const idx = el.getAttribute('data-argus-sticky');
    out.push({
      idx,
      selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
      newTop: Math.round(r.top),
      stillVisible: r.bottom > 0 && r.top < window.innerHeight,
      position: style.position,
      // A working sticky element should still be at top OR within the viewport (top ≈ 0 for header)
      detachedFromTop: style.position === 'sticky' && r.top < -2 && !el.closest('[style*="overflow:hidden"]')
    });
  }
  return { newScrollTop, stickies: out };
}
```

The orchestrator post-processes the `stickies` array:

For each sticky:
- If `detachedFromTop` is true → emit `stickyDetachedOnScroll` (high) — `position:sticky` element scrolled off when it should have pinned
- If `position === "fixed"` and `stillVisible` is false → emit `fixedDetachedOnScroll` (high) — fixed element disappeared (likely transformed ancestor breaking it)

```js
// probe.cleanupSticky
() => {
  for (const el of document.querySelectorAll('[data-argus-sticky]')) {
    try { el.removeAttribute('data-argus-sticky'); } catch (_) {}
  }
  return { ok: true };
}
```

After step 6, call `probe.cleanupSticky`.

## Issues
| issueType | severity | description |
|---|---|---|
| stickyDetachedOnScroll | high | "position:sticky element {selector} scrolled off-screen instead of pinning — ancestor probably has overflow:hidden or transform" |
| fixedDetachedOnScroll | high | "position:fixed element {selector} is no longer visible after scroll — likely a transformed ancestor breaking the fixed-positioning context" |
