---
name: qa-detect-loading
description: "Detects spinners/loaders still visible after 3 seconds post-networkidle, and skeleton screens that never resolve."
---

# Loading State Detection

## What Claude checks
- **Spinners and loaders** still visible more than **3 seconds after network idle** — indicates a hung request or infinite loading state
- **Skeleton screens** (placeholder shimmer/pulse animations) that remain in the DOM after content should have loaded
- **Progress bars** that are stuck at a partial fill (e.g. `width: 40%` with no change after 3s)
- Loading indicators that are present but hidden via `opacity: 0` or `visibility: hidden` while still consuming layout space

## How to detect

```js
// Step 1: Wait for network idle
await page.waitForLoadState('networkidle');

// Step 2: Wait an additional 3 seconds
await page.waitForTimeout(3000);

// Step 3: Check for visible loading spinners
const stuckSpinners = await page.evaluate(() => {
  const spinnerSelectors = [
    '[class*="spinner"]', '[class*="loader"]', '[class*="loading"]',
    '[class*="spin"]', '[aria-label*="loading" i]', '[aria-busy="true"]',
    '[role="progressbar"]', '[class*="progress"]', '[class*="skeleton"]',
    '[class*="shimmer"]', '[class*="placeholder"]', '[class*="pulse"]'
  ];
  const results = [];
  spinnerSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const isVisible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        parseFloat(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0;
      if (isVisible) {
        results.push({
          selector: el.id ? `#${el.id}` : sel,
          className: el.className,
          rect: { width: Math.round(rect.width), height: Math.round(rect.height) }
        });
      }
    });
  });
  return results;
});

// Step 4: Check skeleton screens specifically
const stuckSkeletons = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('[class*="skeleton"], [class*="shimmer"], [class*="placeholder"]').forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      // Check if it still has animation (shimmer animations indicate not-yet-resolved)
      const hasAnimation = style.animationName && style.animationName !== 'none';
      if (hasAnimation) {
        results.push({
          selector: el.id ? `#${el.id}` : el.tagName.toLowerCase() + '.' + (el.className || '').trim().split(/\s+/)[0],
          animationName: style.animationName
        });
      }
    }
  });
  return results;
});

// Step 5: Check for stuck progress bars
const stuckProgressBars = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('[role="progressbar"], [class*="progress-bar"], progress').forEach(el => {
    const value = el.getAttribute('aria-valuenow') || el.getAttribute('value');
    const max = el.getAttribute('aria-valuemax') || el.getAttribute('max') || '100';
    const style = window.getComputedStyle(el);
    const width = style.width;
    // Flag progress bars that aren't at 0% or 100%
    if (value !== null && value !== max && value !== '0') {
      results.push({
        selector: el.id ? `#${el.id}` : '[role="progressbar"]',
        valuenow: value,
        valuemax: max
      });
    } else if (width && width.includes('%')) {
      const pct = parseFloat(width);
      if (pct > 5 && pct < 95) {
        results.push({
          selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
          width
        });
      }
    }
  });
  return results;
});
```

Take a screenshot after the 3s wait to visually confirm loading indicators are still visible.

## Issue schema
- type: `"loadingStuck"` | `"skeletonNotResolved"`
- severity: from config (`medium` for both)
- selector: CSS selector of the stuck element
- description:
  - loadingStuck: `"Loading indicator <selector> is still visible 3 seconds after networkidle — possible hung request"`
  - skeletonNotResolved: `"Skeleton screen <selector> still has shimmer animation 3s after networkidle — content has not loaded"`

## Viewport behaviour
- Check on **all viewports** — loading issues are not viewport-specific
- Network conditions may affect timing; if testing on slow throttled connection increase the wait from 3s to 8s
- Always capture a screenshot to document the stuck state as evidence
