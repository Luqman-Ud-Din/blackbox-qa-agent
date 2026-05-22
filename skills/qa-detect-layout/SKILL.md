---
name: qa-detect-layout
description: "Detects fixed/sticky elements cut off at viewport edges, content areas narrower than 280px, and action buttons below the fold on mobile."
---

# Layout Detection

## What Claude checks
- Elements with `position: fixed` or `position: sticky` whose bounding box extends **outside the viewport** (left < 0, right > innerWidth, top < 0, bottom > innerHeight)
- The **main content area** (`<main>`, `[role="main"]`, or the widest block-level container) rendered narrower than **280px** — the minimum width per CSS spec
- Primary action buttons (CTAs: "Submit", "Buy", "Sign up", "Continue", etc.) that are **below the fold** (top > window.innerHeight) on mobile with no visible scroll affordance

## How to detect

```js
// 1. Fixed/sticky elements cut off at viewport edges
const cutOffElements = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('*').forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const cutOff =
      rect.left < -2 ||
      rect.right > window.innerWidth + 2 ||
      rect.top < -2 ||
      rect.bottom > window.innerHeight + 2;
    if (cutOff) {
      results.push({
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''),
        position: style.position,
        rect: { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
        viewport: { width: window.innerWidth, height: window.innerHeight }
      });
    }
  });
  return results;
});

// 2. Main content area too narrow (< 280px)
const tooNarrow = await page.evaluate(() => {
  const candidates = [
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
    document.querySelector('#content'),
    document.querySelector('.content'),
    document.querySelector('article')
  ].filter(Boolean);
  const results = [];
  candidates.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 280) {
      results.push({
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''),
        width: Math.round(rect.width)
      });
    }
  });
  return results;
});

// 3. Primary CTA buttons below fold on mobile
const belowFoldActions = await page.evaluate(() => {
  const actionKeywords = /submit|sign.?up|get.?start|buy|order|checkout|continue|next|confirm|register|join|subscribe/i;
  const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"], [role="button"]'));
  const results = [];
  buttons.forEach(el => {
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    if (!actionKeywords.test(text)) return;
    const rect = el.getBoundingClientRect();
    if (rect.top > window.innerHeight) {
      results.push({
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
        text: text.slice(0, 60),
        top: Math.round(rect.top),
        viewportHeight: window.innerHeight
      });
    }
  });
  return results;
});
```

Take a full-page screenshot to visually confirm cut-off and below-fold findings.

## Issue schema
- type: `"elementCutOff"` | `"contentTooNarrow"` | `"actionBelowFold"`
- severity: from config (`medium` for all)
- selector: CSS selector of the offending element
- description:
  - elementCutOff: `"Fixed/sticky element <selector> is cut off: right edge at <right>px exceeds viewport width <viewportWidth>px"`
  - contentTooNarrow: `"Main content area <selector> is only <width>px wide — minimum is 280px"`
  - actionBelowFold: `"CTA button '<text>' (<selector>) starts at <top>px, below the <viewportHeight>px viewport fold"`

## Viewport behaviour
- `elementCutOff`: check all viewports — most common on mobile
- `contentTooNarrow`: primarily a **mobile** concern; skip on desktop unless width < 280px
- `actionBelowFold`: **mobile only** — desktop users expect to scroll; mobile first-impressions require above-fold CTAs
