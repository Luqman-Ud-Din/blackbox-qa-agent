---
name: qa-detect-images
description: "Detects missing alt text, broken images, oversized images, and aspect-ratio distortion (stretched)"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it checks
- Missing alt attribute (absent, not empty)
- Failed loads (broken image)
- Images rendered at <1/3 natural size (oversized download for tiny render)
- **Images stretched: rendered aspect ratio differs from natural aspect ratio by >20%**

## Probe (browser_evaluate)
```js
() => {
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  for (const img of document.querySelectorAll('img')) {
    if (out.length >= 20) break;
    const src = (img.src || '').slice(0,100);
    const selector = `img[src="${src.slice(0,60)}"]`;

    // 1. Missing alt
    if (!img.hasAttribute('alt')) {
      out.push({ issueType:'missingAlt', severity:'medium', selector,
        description:`img element is missing the alt attribute entirely`, bbox: bb(img) });
    }

    // 2. Broken image
    if (img.complete && img.naturalWidth === 0) {
      out.push({ issueType:'brokenImage', severity:'critical', selector,
        description:`Image failed to load: ${src}`, bbox: bb(img) });
      continue; // can't compute ratios without natural dimensions
    }

    const r = img.getBoundingClientRect();
    if (img.naturalWidth === 0 || img.naturalHeight === 0) continue;
    if (r.width === 0 || r.height === 0) continue;

    // 3. Oversized (downloaded much larger than rendered)
    if (img.naturalWidth/r.width > 3) {
      const ratio = (img.naturalWidth/r.width).toFixed(1);
      out.push({ issueType:'oversizedImage', severity:'low', selector,
        description:`Natural size ${img.naturalWidth}×${img.naturalHeight}px rendered at ${Math.round(r.width)}×${Math.round(r.height)}px (${ratio}x oversized)`, bbox: bb(img) });
    }

    // 4. Stretched (aspect ratio distortion)
    const naturalRatio  = img.naturalWidth / img.naturalHeight;
    const renderedRatio = r.width / r.height;
    const ratioDiff = Math.abs(naturalRatio - renderedRatio) / naturalRatio;
    if (ratioDiff > 0.20) {
      const pctOff = Math.round(ratioDiff * 100);
      out.push({ issueType:'imageStretched', severity:'medium', selector,
        description:`Aspect ratio distorted: natural ${img.naturalWidth}×${img.naturalHeight} (${naturalRatio.toFixed(2)}:1) rendered at ${Math.round(r.width)}×${Math.round(r.height)} (${renderedRatio.toFixed(2)}:1) — ${pctOff}% off`, bbox: bb(img) });
    }
  }
  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| missingAlt | medium | "img element is missing the alt attribute entirely" |
| brokenImage | critical | "Image failed to load: {src}" |
| oversizedImage | low | "Natural size {nw}×{nh}px rendered at {rw}×{rh}px ({ratio}x oversized)" |
| imageStretched | medium | "Aspect ratio distorted: natural {nw}×{nh} ({nr}:1) rendered at {rw}×{rh} ({rr}:1) — {pct}% off" |

## Threshold note
The 20% threshold balances catching genuine distortion (logos squashed, photos stretched) against allowing minor variations from `object-fit: cover` cropping. Increase to 30% if false positives appear on photos with intentional cropping; decrease to 10% for strict design QA.
