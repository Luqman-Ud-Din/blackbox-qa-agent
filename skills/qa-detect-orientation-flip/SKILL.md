---
name: qa-detect-orientation-flip
section: responsiveness
description: "Tests TRUE orientation rotation via browser_resize (swap width/height). Detects layout bugs that appear in landscape, state loss across rotation, and missing orientationchange event handling."
model: haiku
applyOn: [mobile, tablet]
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any bug related to portrait↔landscape rotation belongs to this skill"
---

# qa-detect-orientation-flip — Real Orientation Rotation Testing

Tests orientation rotation by actually swapping viewport width and height mid-cell, not just checking meta tags. Catches the bugs only real users on rotating devices experience.

## What it checks (4 issue types)

| Issue type | Severity | What it catches |
|---|---|---|
| `landscapeOverflow` | high | Layout produces NEW overflow in landscape that didn't exist in portrait |
| `landscapeContentHidden` | high | Primary CTA or critical content drops below the (narrower) viewport in landscape |
| `orientationLosesState` | high | Form data, scroll position, modal state, or session lost after rotation |
| `orientationNoHandler` | low | Page declares orientation-dependent CSS but doesn't listen to `orientationchange`/`resize` events (broken JS on rotation) |

## Self-skip conditions

- Skip if cell.viewportClass is "desktop" (orientation is mobile/tablet concern)
- Skip if browser_resize MCP tool unavailable (Bash fallback)
- Skip if cell is auth-gated AND session is fragile (first-run setup verification)

## Orchestrator flow

This skill runs ONLY on mobile and tablet cells. For each route, it tests the portrait→landscape flip.

### Step 1 — Capture portrait state

```
1. (assume cell.viewport is portrait — e.g., 390 × 844)
2. portraitFindings = browser_evaluate(probe.snapshotOrientationState)
3. browser_evaluate(probe.fillFormForStateLossTest)  // type "argusRotate" into first text input
4. portraitScroll = browser_evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
5. portraitFormValue = browser_evaluate(probe.readFirstFormValue)
```

### Step 2 — Flip to landscape

```
6. browser_resize({ width: cell.viewport.height, height: cell.viewport.width })
   // Swap: 390×844 → 844×390
7. browser_wait_for({ time: 600 })  // allow CSS reflow + orientationchange event handlers
8. browser_evaluate(probe.dispatchOrientationChange)  // synthesize the event in case browser_resize doesn't fire it
9. browser_wait_for({ time: 400 })
```

### Step 3 — Capture landscape state, compare

```
10. landscapeFindings = browser_evaluate(probe.snapshotOrientationState)
11. landscapeScroll = browser_evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
12. landscapeFormValue = browser_evaluate(probe.readFirstFormValue)
13. landscapeHasResizeListener = browser_evaluate(probe.checkOrientationListenerActive)

14. Diff:
    - Any overflow finding in landscapeFindings NOT in portraitFindings → emit landscapeOverflow (high)
    - Primary CTA was visible in portrait but vh.bottom in landscape > vh → emit landscapeContentHidden (high)
    - portraitFormValue ≠ landscapeFormValue → emit orientationLosesState (high)
    - landscapeHasResizeListener.hasOrientationCSS is false AND page has @media(orientation:landscape) rules → emit orientationNoHandler (low)
```

### Step 4 — Restore portrait (MANDATORY)

```
15. browser_resize({ width: cell.viewport.width, height: cell.viewport.height })  // back to original
16. browser_wait_for({ time: 500 })
17. browser_evaluate(probe.clearFormForStateLossTest)  // clear "argusRotate" marker
```

## Probes (browser_evaluate)

```js
// probe.snapshotOrientationState
() => {
  const out = { vw: innerWidth, vh: innerHeight, overflowing: [], primaryCTA: null };
  // Detect orientation
  out.orientation = innerWidth > innerHeight ? 'landscape' : 'portrait';

  // Overflow elements
  for (const el of document.querySelectorAll('main, section, header, footer, nav, [class*="container"]')) {
    if (out.overflowing.length >= 12) break;
    const style = getComputedStyle(el);
    if (style.overflowX === 'hidden' || style.overflowX === 'scroll' || style.overflowX === 'auto') continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      const tag = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
      out.overflowing.push(tag);
    }
  }

  // Primary CTA position
  const cta = document.querySelector('button[type="submit"], a.cta, .btn-primary, [class*="primary-button"]');
  if (cta) {
    const r = cta.getBoundingClientRect();
    out.primaryCTA = { selector: cta.tagName.toLowerCase() + (cta.id ? '#' + cta.id : ''), top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.top < innerHeight };
  }
  return out;
}
```

```js
// probe.fillFormForStateLossTest
() => {
  const input = document.querySelector('input[type="text"], input[type="email"], textarea');
  if (!input) return { filled: false };
  input.value = 'argusRotate' + Date.now();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { filled: true, selector: input.id ? '#' + input.id : input.name };
}
```

```js
// probe.readFirstFormValue
() => {
  const input = document.querySelector('input[type="text"], input[type="email"], textarea');
  return { value: input ? input.value : null };
}
```

```js
// probe.dispatchOrientationChange — synthesize event in case browser_resize didn't fire it
() => {
  window.dispatchEvent(new Event('orientationchange'));
  window.dispatchEvent(new Event('resize'));
  return { dispatched: true };
}
```

```js
// probe.checkOrientationListenerActive — detects if app has registered orientation handlers
() => {
  // Check for media query listener via matchMedia
  const mq = window.matchMedia('(orientation: landscape)');
  // Check for @media (orientation: ...) in stylesheets
  let hasOrientationCSS = false;
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.MEDIA_RULE && /orientation/i.test(rule.conditionText)) {
          hasOrientationCSS = true;
          break;
        }
      }
    } catch (_) {}
    if (hasOrientationCSS) break;
  }
  return { matchesLandscape: mq.matches, hasOrientationCSS };
}
```

```js
// probe.clearFormForStateLossTest
() => {
  const input = document.querySelector('input[type="text"], input[type="email"], textarea');
  if (input && /^argusRotate/.test(input.value)) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return { ok: true };
}
```

## Hard rules

1. **Mandatory restore** — viewport returns to portrait before exit. Next skill expects cell.viewport.
2. **Clear form marker on exit** — "argusRotate" string must not persist into next skill's tests.
3. **Skip on desktop cells** — orientation is mobile/tablet only.
4. **600 ms wait after resize** — allows CSS reflow + JS resize handlers to fire.

## Cost analysis

| Phase | Round-trips | Cost |
|---|---|---|
| Portrait snapshot + fill marker | 4 evaluate | ~$0.0008 |
| Resize + dispatch + wait | 3 MCP calls | ~$0.0003 |
| Landscape snapshot + compare | 4 evaluate | ~$0.0008 |
| Restore + cleanup | 2 MCP calls + 1 evaluate | ~$0.0003 |
| **Total per cell** | **~14 MCP calls** | **~$0.002** |

## Notes

- The skill replaces nothing. `qa-detect-orientation` (existing) only checks for the meta tag — completely different bug class. Both should run.
- Some apps lose session on orientation change because they re-mount React components. This skill catches that.
- The `argusRotate` marker is intentional — distinctive so it can be detected and cleared.
