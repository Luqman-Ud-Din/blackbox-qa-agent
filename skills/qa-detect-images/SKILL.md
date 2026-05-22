---
name: qa-detect-images
description: "Detects missing alt text, broken images, and images stretched more than 2x their natural size."
---

# Image Detection

## What Claude checks
- `<img>` elements where the `alt` attribute is **absent** (not empty — empty alt is valid for decorative images)
- Images whose `naturalWidth` is **0** after the page has loaded, indicating a broken or failed image resource
- Images rendered at a size **more than 2x their natural dimensions** in either width or height (upscaled beyond acceptable threshold)
- `<img>` used as icons or SVG replacements that lack any accessible name

## How to detect

```js
// 1. Missing alt attribute (absent, not empty string)
const missingAlt = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('img').forEach(img => {
    if (!img.hasAttribute('alt')) {
      results.push({
        selector: img.id ? `#${img.id}` : 'img',
        src: img.src.slice(0, 120),
        outerHTML: img.outerHTML.slice(0, 200)
      });
    }
  });
  return results;
});

// 2. Broken images (naturalWidth === 0 after load)
const brokenImages = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('img').forEach(img => {
    if (img.complete && img.naturalWidth === 0 && img.src) {
      results.push({
        selector: img.id ? `#${img.id}` : 'img',
        src: img.src.slice(0, 120),
        alt: img.alt || '(none)'
      });
    }
  });
  return results;
});

// Wait for all images to load before checking
await page.waitForLoadState('networkidle');

// 3. Stretched images (rendered > 2x natural size)
const stretchedImages = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('img').forEach(img => {
    if (img.naturalWidth === 0 || img.naturalHeight === 0) return;
    const rect = img.getBoundingClientRect();
    const widthRatio = rect.width / img.naturalWidth;
    const heightRatio = rect.height / img.naturalHeight;
    if (widthRatio > 2 || heightRatio > 2) {
      results.push({
        selector: img.id ? `#${img.id}` : 'img',
        src: img.src.slice(0, 120),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        renderedWidth: Math.round(rect.width),
        renderedHeight: Math.round(rect.height),
        widthRatio: widthRatio.toFixed(1),
        heightRatio: heightRatio.toFixed(1)
      });
    }
  });
  return results;
});
```

For broken images, also check the network tab responses via `page.on('response')` to confirm HTTP errors on image URLs.

## Issue schema
- type: `"imageMissingAlt"` | `"imageBroken"` | `"imageStretched"`
- severity: from config (`medium` for all)
- selector: CSS selector of the `<img>` element
- description:
  - imageMissingAlt: `"<img src='<src>'> is missing the alt attribute"`
  - imageBroken: `"Image at <src> failed to load (naturalWidth is 0)"`
  - imageStretched: `"Image <src> is rendered at <W>x<H>px but its natural size is <nW>x<nH>px (<ratio>x upscale)"`

## Viewport behaviour
- Check on **all viewports**
- Stretched images may appear only at certain breakpoints where CSS sets `width: 100%` on a large container — compare natural vs rendered at each size
- Missing alt and broken images are viewport-independent but verify at the viewport where the image is visible
