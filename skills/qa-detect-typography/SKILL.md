---
name: qa-detect-typography
description: "Detects font sizes below 12px, tight line-heights, low-contrast grey text, and text clipped in fixed-height containers."
---

# Typography Detection

## What Claude checks
- Body/paragraph text rendered at a computed `font-size` below **12px**
- Elements whose computed `line-height` divided by `font-size` is below **1.2** (unitless ratio)
- Text that appears light-grey on white or near-white backgrounds (contrast ratio below approximately 3:1 for large text or 4.5:1 for normal text)
- Text nodes inside containers that have a fixed `height` or `max-height` with `overflow: hidden`, where the text is visually clipped

## How to detect

```js
// 1. Font size too small
const smallFontEls = await page.evaluate(() => {
  const results = [];
  const textEls = document.querySelectorAll('p, span, li, td, th, label, a, div');
  textEls.forEach(el => {
    const style = window.getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize);
    if (fontSize < 12 && el.innerText && el.innerText.trim().length > 0) {
      results.push({
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''),
        fontSize
      });
    }
  });
  return results;
});

// 2. Line-height too tight
const tightLineHeightEls = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('p, li, td, th, div').forEach(el => {
    const style = window.getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize);
    const lineHeight = parseFloat(style.lineHeight);
    if (fontSize > 0 && lineHeight / fontSize < 1.2 && el.innerText && el.innerText.trim().length > 3) {
      results.push({
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
        lineHeight,
        fontSize,
        ratio: (lineHeight / fontSize).toFixed(2)
      });
    }
  });
  return results;
});

// 3. Text clipped in fixed-height containers
const clippedTextEls = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('*').forEach(el => {
    const style = window.getComputedStyle(el);
    if (
      (style.overflow === 'hidden' || style.overflowY === 'hidden') &&
      (style.height !== 'auto' || style.maxHeight !== 'none') &&
      el.scrollHeight > el.clientHeight + 2 &&
      el.innerText && el.innerText.trim().length > 0
    ) {
      results.push({
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight
      });
    }
  });
  return results;
});

// 4. Low contrast: check via accessibility snapshot or manual color comparison
const snapshot = await page.accessibility.snapshot();
// Look for text nodes where color is near-white and background is white
const lowContrastEls = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('p, span, li, label, a').forEach(el => {
    const style = window.getComputedStyle(el);
    const color = style.color; // e.g. "rgb(200, 200, 200)"
    const bg = style.backgroundColor;
    // Flag anything where color RGB channels are all > 180 and background is near-white
    const colorMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (colorMatch) {
      const [, r, g, b] = colorMatch.map(Number);
      if (r > 180 && g > 180 && b > 180 && el.innerText && el.innerText.trim().length > 0) {
        results.push({
          selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
          color,
          bg
        });
      }
    }
  });
  return results;
});
```

## Issue schema
- type: `"fontTooSmall"` | `"lineHeightTooTight"` | `"textClipped"`
- severity: from config (`medium` for all)
- selector: CSS selector of the offending element
- description:
  - fontTooSmall: `"Text at <selector> has font-size <N>px (minimum is 12px)"`
  - lineHeightTooTight: `"Element <selector> has line-height/font-size ratio <N> (minimum is 1.2)"`
  - textClipped: `"Text in <selector> is clipped: scrollHeight <N>px > clientHeight <M>px with overflow:hidden"`

## Viewport behaviour
- Check on **all viewports**
- Font-size issues are most visible on mobile where OS scaling may differ
- Line-height and clipping issues are viewport-independent but re-verify at each breakpoint as responsive CSS may change values
