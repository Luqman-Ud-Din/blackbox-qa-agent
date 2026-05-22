---
name: qa-detect-overflow
description: "Detects horizontal scroll and elements whose right edge exceeds the viewport width."
---

# Overflow Detection

## What Claude checks
- Whether `document.documentElement.scrollWidth` exceeds `window.innerWidth` at any tested viewport
- Individual elements whose bounding-box right edge (`getBoundingClientRect().right`) is greater than `window.innerWidth`
- Tables and CSS grid/flex containers whose content overflows their parent horizontally
- Elements with `overflow-x: scroll` or `overflow-x: auto` that are actually scrolling (content wider than container)

## How to detect

```js
// 1. Page-level horizontal overflow
const pageOverflow = await page.evaluate(() => {
  return document.documentElement.scrollWidth > window.innerWidth;
});

// 2. Elements clipping past the right viewport edge
const overflowingElements = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('*').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth + 2) {  // 2px tolerance
      results.push({
        tag: el.tagName.toLowerCase(),
        selector: el.id ? `#${el.id}` : el.className ? `.${el.className.trim().split(/\s+/)[0]}` : el.tagName.toLowerCase(),
        right: Math.round(rect.right),
        viewportWidth: window.innerWidth
      });
    }
  });
  return results;
});

// 3. Tables / grids overflowing
const tableOverflow = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('table, [class*="grid"], [class*="table"]').forEach(el => {
    if (el.scrollWidth > el.clientWidth) {
      results.push({
        tag: el.tagName.toLowerCase(),
        selector: el.id ? `#${el.id}` : el.className ? `.${el.className.trim().split(/\s+/)[0]}` : el.tagName.toLowerCase(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth
      });
    }
  });
  return results;
});
```

Use `page.locator('body')` to confirm visible overflow before filing.

## Issue schema
- type: `"horizontalOverflow"`
- severity: `high`
- selector: CSS selector of the overflowing element, or `null` if page-level overflow
- description: `"Element <selector> extends to <right>px but viewport is <viewportWidth>px wide"` — or `"Page has horizontal scroll: scrollWidth <N>px > innerWidth <M>px"` for page-level

## Viewport behaviour
- Check on **all viewports** (mobile, tablet, laptop, desktop)
- Overflow is most common on mobile; always include mobile results even if laptop looks fine
- Skip elements that are intentionally off-screen (e.g. drawer menus with `transform: translateX`)
