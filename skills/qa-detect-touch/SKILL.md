---
name: qa-detect-touch
description: "Detects interactive elements smaller than 44px and tap targets that are too close together."
---

# Touch Target Detection

## What Claude checks
- Buttons, links, inputs, selects, checkboxes, radio buttons, and toggle switches whose rendered **height or width is below 44px** (Apple HIG minimum / WCAG 2.5.5 AAA)
- Pairs of interactive elements whose bounding boxes are **less than 8px apart** (edge-to-edge), making them hard to tap without hitting the wrong target
- Elements that rely on CSS `padding` to meet the 44px threshold — verify the actual hit area, not just the visual size

## How to detect

```js
// 1. Tap targets too small
const smallTargets = await page.evaluate(() => {
  const interactive = document.querySelectorAll(
    'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [tabindex]'
  );
  const results = [];
  interactive.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // hidden
    if (rect.width < 44 || rect.height < 44) {
      results.push({
        selector: el.id
          ? `#${el.id}`
          : el.tagName.toLowerCase() + (el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 60)
      });
    }
  });
  return results;
});

// 2. Tap targets too close together (< 8px gap between neighbouring elements)
const tooClose = await page.evaluate(() => {
  const interactive = Array.from(document.querySelectorAll(
    'button, a[href], input, select, [role="button"], [role="link"]'
  )).filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const results = [];
  for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i].getBoundingClientRect();
      const b = interactive[j].getBoundingClientRect();
      const horizontalGap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const verticalGap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      const gap = Math.max(horizontalGap, verticalGap);
      if (gap < 8 && gap >= 0) {
        results.push({
          elementA: interactive[i].id ? `#${interactive[i].id}` : interactive[i].tagName.toLowerCase(),
          elementB: interactive[j].id ? `#${interactive[j].id}` : interactive[j].tagName.toLowerCase(),
          gap: Math.round(gap)
        });
      }
    }
  }
  return results.slice(0, 20); // cap results
});
```

Visually confirm findings with a screenshot — some elements are decorative despite having interactive semantics.

## Issue schema
- type: `"tapTargetTooSmall"` | `"tapTargetsTooClose"`
- severity: from config (`high` on mobile/tablet, `medium` on desktop)
- selector: CSS selector of the offending element(s)
- description:
  - tapTargetTooSmall: `"Interactive element <selector> ('<text>') is <W>x<H>px — minimum tap target is 44x44px"`
  - tapTargetsTooClose: `"<elementA> and <elementB> are only <gap>px apart — minimum spacing between tap targets is 8px"`

## Viewport behaviour
- Priority viewports: **mobile** and **tablet** — these are the primary touch contexts
- Still check **laptop** and **desktop** for tapTargetTooSmall (WCAG 2.5.5 applies universally)
- tapTargetsTooClose is most critical on mobile; report it on all viewports but note mobile severity is higher
