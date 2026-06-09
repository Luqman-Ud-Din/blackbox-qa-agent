---
name: qa-detect-rtl-layout
section: responsiveness
description: "Switches the document to RTL (dir='rtl') and detects layout breakage — overflow, mirrored asymmetry, and non-logical CSS properties that don't flip"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
interactive: true
---

## What it checks

Many sites that ship to Arabic, Hebrew, Persian, or Urdu users break in subtle ways when `dir="rtl"`. Common bugs:
- Horizontal overflow that didn't exist in LTR
- Icons not mirrored (back arrow still points left, looking like "forward")
- Padding/margin asymmetry — content drifts off-screen
- Fixed positioning anchored to wrong side

This skill temporarily sets `dir="rtl"` on the document, scans for new overflow, then restores LTR.

## Orchestrator flow

**Step 5 (restore LTR) is mandatory.**

1. Run `probe.captureDirAndCount` — returns `{originalDir, baselineOverflowCount}`. Save.
2. Run `probe.applyRtl` — sets `document.documentElement.dir = 'rtl'`
3. `browser_wait_for(time=500)` — let CSS recompute, transforms apply
4. Run `probe.scanRtlBreaks`
5. Run `probe.restoreDir({originalDir})` — RESTORE original direction
6. `browser_wait_for(time=300)`

## Probes (browser_evaluate)

```js
// probe.captureDirAndCount
() => {
  const html = document.documentElement;
  const original = html.getAttribute('dir') || 'ltr';
  // Count existing horizontal-overflow elements as baseline
  let baseline = 0;
  for (const el of document.querySelectorAll('*')) {
    if (baseline >= 30) break;
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'hidden') baseline++;
  }
  return { originalDir: original, baselineOverflowCount: baseline };
}
```

```js
// probe.applyRtl
() => {
  document.documentElement.setAttribute('dir', 'rtl');
  return { ok: true };
}
```

```js
// probe.scanRtlBreaks
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    return (el.tagName.toLowerCase() + id).slice(0, 120);
  };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];

  // 1. Page-level horizontal overflow in RTL
  if (document.documentElement.scrollWidth > window.innerWidth + 2) {
    out.push({
      issueType: 'rtlPageOverflow',
      severity: 'high',
      selector: 'html',
      description: `Page has horizontal overflow when dir="rtl" — scrollWidth ${document.documentElement.scrollWidth}px vs viewport ${window.innerWidth}px. Likely hardcoded margin-left/padding-right or left:0 instead of inset-inline-*`,
      bbox: { x: 0, y: 0, w: 200, h: 60 }
    });
  }

  // 2. Element-level overflow that appeared because of RTL
  let perElementOverflow = 0;
  for (const el of document.querySelectorAll('header, nav, aside, main, section, [class*="container"]')) {
    if (perElementOverflow >= 6) break;
    const style = getComputedStyle(el);
    if (style.overflowX === 'hidden') continue;
    if (el.scrollWidth > el.clientWidth + 4) {
      perElementOverflow++;
      out.push({
        issueType: 'rtlElementOverflow',
        severity: 'medium',
        selector: sel(el),
        description: `Element ${sel(el)} overflows horizontally in RTL — scrollWidth ${el.scrollWidth}px > clientWidth ${el.clientWidth}px. Likely hardcoded directional CSS.`,
        bbox: bb(el)
      });
    }
  }

  // 3. Fixed-position elements anchored to "left" but expected to be on the start side
  for (const el of document.querySelectorAll('[class*="sidebar"], [class*="drawer"], [class*="sticky"], [class*="fixed"]')) {
    if (out.length >= 15) break;
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    // In RTL, "start" is right. If left:0 is set, the element is now on the "end" side — usually wrong.
    if (style.left === '0px' && style.right !== '0px') {
      const r = el.getBoundingClientRect();
      out.push({
        issueType: 'rtlFixedSidewrong',
        severity: 'medium',
        selector: sel(el),
        description: `Fixed/sticky ${sel(el)} is anchored to left:0 in RTL — should use inset-inline-start:0 so it flips to the right side in RTL.`,
        bbox: bb(el)
      });
    }
  }

  return out;
}
```

```js
// probe.restoreDir  — args: { originalDir }
({originalDir}) => {
  if (originalDir && originalDir.toLowerCase() === 'rtl') {
    document.documentElement.setAttribute('dir', 'rtl');
  } else if (originalDir && originalDir.toLowerCase() === 'ltr') {
    document.documentElement.setAttribute('dir', 'ltr');
  } else {
    document.documentElement.removeAttribute('dir');
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| rtlPageOverflow | high | "Page has horizontal overflow in RTL — hardcoded directional CSS" |
| rtlElementOverflow | medium | "Element overflows in RTL — needs logical properties (inset-inline-*, margin-inline-*)" |
| rtlFixedSidewrong | medium | "Fixed element anchored to left in RTL — should use inset-inline-start" |
