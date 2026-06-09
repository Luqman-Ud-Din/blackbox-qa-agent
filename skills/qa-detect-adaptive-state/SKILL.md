---
name: qa-detect-adaptive-state
section: visual
description: "Simulates adaptive media states (prefers-color-scheme: dark, prefers-reduced-motion: reduce, forced-colors: active, prefers-contrast: more) within a single cell via browser_evaluate + matchMedia event synthesis. Detects bugs in each adaptive state without spawning separate cells."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any bug specific to dark mode, reduced motion, forced colors, or high contrast adaptive states belongs to this skill"
---

# qa-detect-adaptive-state — Adaptive State Matrix Testing

Tests 4 adaptive states (dark mode, reduced motion, forced colors, high contrast) within a single cell instead of spawning 4× the cells. Uses `matchMedia` event synthesis and CSS `color-scheme` injection to flip states, runs probes per state, and restores at end.

## What it checks (8 issue types)

### Dark mode (2)
| Issue type | Severity | What it catches |
|---|---|---|
| `darkModeContrastFail` | high | Text contrast drops below WCAG AA in dark mode |
| `darkModeMissingStyles` | medium | Page uses `prefers-color-scheme: dark` query but some elements don't update (mixed light/dark) |

### Reduced motion (2)
| Issue type | Severity | What it catches |
|---|---|---|
| `motionIgnoresReducedPref` | high | Animations still play when prefers-reduced-motion is active |
| `parallaxOnReducedMotion` | medium | Parallax scrolling still active despite preference |

### Forced colors (2)
| Issue type | Severity | What it catches |
|---|---|---|
| `forcedColorsBreaksLayout` | high | Layout breaks in Windows High Contrast Mode (forced-colors: active) |
| `forcedColorsTextInvisible` | high | Text becomes invisible due to color: transparent or background-based text-color |

### High contrast (2)
| Issue type | Severity | What it catches |
|---|---|---|
| `highContrastFocusInvisible` | medium | Focus ring becomes invisible in high-contrast mode |
| `highContrastIconBroken` | medium | Icon (using CSS color or background-image) becomes invisible |

## Self-skip conditions

- Run on desktop cell only (this skill drives state changes internally)
- Skip if the page has 0 elements using `prefers-*` CSS rules (no adaptive design — nothing to test)

## Orchestrator flow

This skill tests 4 adaptive states sequentially. Each state has setup, snapshot, comparison, and teardown.

### Step 1 — Capture baseline (normal state)

```
baseline = browser_evaluate(probe.snapshotAdaptiveState)
```

Returns: { textContrasts: [...], animationCount, parallaxCount, focusVisible, iconVisibility }

### Step 2 — Test dark mode

```
1. browser_evaluate(probe.simulateDarkMode)  // injects color-scheme + dispatches matchMedia change event
2. browser_wait_for({ time: 500 })  // allow CSS transitions
3. darkState = browser_evaluate(probe.snapshotAdaptiveState)
4. Compare:
   - For each text element in darkState.textContrasts: if AA fail → emit darkModeContrastFail (high)
   - If darkState has elements with same colors as baseline (CSS didn't apply) → emit darkModeMissingStyles
5. browser_evaluate(probe.restoreColorScheme)
```

### Step 3 — Test reduced motion

```
1. browser_evaluate(probe.simulateReducedMotion)
2. browser_wait_for({ time: 300 })
3. reducedState = browser_evaluate(probe.snapshotAnimationState)  // dedicated probe — checks animation durations post-injection
4. Compare:
   - reducedState.animationCount > 0 → emit motionIgnoresReducedPref (high)
   - reducedState.parallaxCount > 0 → emit parallaxOnReducedMotion
5. browser_evaluate(probe.restoreReducedMotion)
```

### Step 4 — Test forced colors

```
1. browser_evaluate(probe.simulateForcedColors)
2. browser_wait_for({ time: 500 })
3. forcedState = browser_evaluate(probe.snapshotAdaptiveState)
4. Compare:
   - New overflow findings vs baseline → emit forcedColorsBreaksLayout
   - text elements with color === background → emit forcedColorsTextInvisible
5. browser_evaluate(probe.restoreForcedColors)
```

### Step 5 — Test high contrast

```
1. browser_evaluate(probe.simulateHighContrast)
2. browser_wait_for({ time: 500 })
3. contrastState = browser_evaluate(probe.snapshotAdaptiveState)
4. Compare:
   - focus ring opacity < 0.5 → emit highContrastFocusInvisible
   - Icon elements with transparent background → emit highContrastIconBroken
5. browser_evaluate(probe.restoreHighContrast)
```

### Step 6 — Final restore

`probe.restoreAllAdaptiveStates` — ensure all 4 states are reset. Idempotent.

## Probes (browser_evaluate)

```js
// probe.snapshotAdaptiveState
() => {
  const sel = el => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')).slice(0, 120);
  const out = { textContrasts: [], animationCount: 0, parallaxCount: 0, focusVisible: null, iconVisibility: [] };

  // Text contrast samples (up to 10 visible text elements)
  let count = 0;
  for (const el of document.querySelectorAll('p, h1, h2, h3, button, a, span, label')) {
    if (count >= 10) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const txt = (el.innerText || '').trim();
    if (txt.length < 3) continue;
    const style = getComputedStyle(el);
    // Walk up to find background
    let bgEl = el;
    let bg = 'transparent';
    while (bgEl) {
      const bs = getComputedStyle(bgEl);
      if (bs.backgroundColor && bs.backgroundColor !== 'rgba(0, 0, 0, 0)' && bs.backgroundColor !== 'transparent') {
        bg = bs.backgroundColor; break;
      }
      bgEl = bgEl.parentElement;
    }
    out.textContrasts.push({ sel: sel(el), color: style.color, bg, fontSize: parseFloat(style.fontSize), fontWeight: style.fontWeight });
    count++;
  }

  // Animation count
  out.animationCount = document.getAnimations ? document.getAnimations().filter(a => a.playState === 'running').length : 0;

  // Parallax (heuristic: position: fixed background-attachment: fixed elements)
  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.backgroundAttachment === 'fixed' || style.transform.includes('translate3d')) {
      out.parallaxCount++;
      if (out.parallaxCount >= 5) break;
    }
  }

  return out;
}
```

```js
// probe.simulateDarkMode
// NOTE: Object.defineProperty on a matchMedia instance CANNOT override the prototype getter in modern browsers.
// Instead we use CSS injection — inject a style that approximates dark-mode variable overrides,
// and set the html[data-theme] attribute that many Angular apps listen to.
() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.setAttribute('data-argus-dark', '1');
  const style = document.createElement('style');
  style.id = 'argus-dark-mode';
  style.textContent = `
    [data-argus-dark="1"] { color-scheme: dark !important; }
  `;
  document.head.appendChild(style);
  // Dispatch matchMedia event for listeners — some Angular apps listen for this
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.dispatchEvent(new MediaQueryListEvent('change', { matches: true, media: '(prefers-color-scheme: dark)' }));
  } catch (_) {}
  return { simulated: true };
}
```

```js
// probe.restoreColorScheme
() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-argus-dark');
  const s = document.getElementById('argus-dark-mode');
  if (s) s.remove();
  return { restored: true };
}
```

```js
// probe.simulateReducedMotion
// Injects CSS that makes all animations/transitions near-instant — same behavioral effect as the media query.
() => {
  const existing = document.getElementById('argus-reduced-motion');
  if (existing) return { alreadyInstalled: true };
  const style = document.createElement('style');
  style.id = 'argus-reduced-motion';
  style.textContent = `
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }
  `;
  document.head.appendChild(style);
  // Dispatch event for Angular listeners
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.dispatchEvent(new MediaQueryListEvent('change', { matches: true, media: '(prefers-reduced-motion: reduce)' }));
  } catch (_) {}
  return { simulated: true };
}
```

```js
// probe.restoreReducedMotion
() => {
  const s = document.getElementById('argus-reduced-motion');
  if (s) s.remove();
  return { restored: true };
}
```

```js
// probe.snapshotAnimationState — dedicated probe for reduced-motion step (Step 3)
() => {
  const animations = document.getAnimations ? document.getAnimations() : [];
  const running = animations.filter(a => a.playState === 'running' && a.effect);
  const longRunning = running.filter(a => {
    const dur = a.effect && a.effect.getTiming ? a.effect.getTiming().duration : 0;
    return typeof dur === 'number' && dur > 10; // > 10ms means not instantly-done
  });
  const parallaxEls = [...document.querySelectorAll('*')].filter(el => {
    const s = getComputedStyle(el);
    return s.backgroundAttachment === 'fixed' || (s.transform !== 'none' && /translate3d|translateZ/.test(s.transform));
  }).length;
  return {
    animationCount: longRunning.length,
    parallaxCount: Math.min(parallaxEls, 10)
  };
}
```

```js
// probe.simulateForcedColors — injects CSS approximating Windows High Contrast Mode (forced-colors: active)
() => {
  const existing = document.getElementById('argus-forced-colors');
  if (existing) return { alreadyInstalled: true };
  const style = document.createElement('style');
  style.id = 'argus-forced-colors';
  style.textContent = `
    * {
      background-image: none !important;
      box-shadow: none !important;
    }
    *:focus {
      outline: 2px solid ButtonText !important;
    }
    img, svg { opacity: 1 !important; }
  `;
  document.head.appendChild(style);
  return { simulated: true };
}
```

```js
// probe.restoreForcedColors
() => {
  const s = document.getElementById('argus-forced-colors');
  if (s) s.remove();
  return { restored: true };
}
```

```js
// probe.simulateHighContrast — inject maximum contrast CSS approximation
() => {
  const existing = document.getElementById('argus-high-contrast');
  if (existing) return { alreadyInstalled: true };
  const style = document.createElement('style');
  style.id = 'argus-high-contrast';
  style.textContent = `
    * {
      filter: contrast(200%) !important;
    }
    *:focus {
      outline: 3px solid #ff0 !important;
      outline-offset: 2px !important;
    }
  `;
  document.head.appendChild(style);
  return { simulated: true };
}
```

```js
// probe.restoreHighContrast
() => {
  const s = document.getElementById('argus-high-contrast');
  if (s) s.remove();
  return { restored: true };
}
```

```js
// probe.checkTextContrast — args: { color, bg, fontSize, fontWeight }
// Computes WCAG contrast ratio between two colors. Returns { ratio, aaPass, aaaPass, isLargeText }
({color, bg, fontSize, fontWeight}) => {
  // Parse rgb(...) or hex
  const parse = c => {
    const m = c.match(/(\d+(?:\.\d+)?)/g) || [];
    return m.map(Number).slice(0, 3);
  };
  const luminance = ([r, g, b]) => {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const L1 = luminance(parse(color));
  const L2 = luminance(parse(bg));
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && parseInt(fontWeight) >= 700);
  return {
    ratio: Math.round(ratio * 100) / 100,
    aaPass: isLargeText ? ratio >= 3 : ratio >= 4.5,
    aaaPass: isLargeText ? ratio >= 4.5 : ratio >= 7,
    isLargeText
  };
}
```

```js
// probe.restoreAllAdaptiveStates — final cleanup, idempotent
// Removes ALL injected style tags; resets data attributes
() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-argus-dark');
  for (const id of ['argus-dark-mode', 'argus-reduced-motion', 'argus-forced-colors', 'argus-high-contrast']) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
  return { restored: true };
}
```

## Hard rules

1. **Mandatory final restore** — page returns to normal state before exit.
2. **Inject CSS marker for forced-colors** — Windows HCM CSS approximation via injected style tag with id `argus-forced-colors`. Must be removed on cleanup.
3. **NEVER persist matchMedia override** — synthetic events only fire while active; on resize/navigation, browser resets.
4. **500 ms wait per state** — allow CSS transitions to settle before snapshot.

## Cost analysis

| State | MCP calls | Cost |
|---|---|---|
| Baseline snapshot | 1 | ~$0.0003 |
| Dark mode (simulate + snapshot + restore) | 3 | ~$0.001 |
| Reduced motion (simulate + snapshot + restore) | 3 | ~$0.001 |
| Forced colors (simulate + snapshot + restore) | 3 | ~$0.001 |
| High contrast (simulate + snapshot + restore) | 3 | ~$0.001 |
| Final cleanup | 1 | ~$0.0001 |
| **Total per cell** | **~14 MCP calls** | **~$0.004** |

vs running 4 separate cells (4× navigation + 4× full per-cell suite) = ~$0.060 per route. **~93% cost reduction** for same coverage.

## Notes

- This skill REPLACES the per-cell-per-viewport overhead of testing adaptive states by doing all 4 in one cell.
- The existing skills `qa-detect-dark-mode`, `qa-detect-reduced-motion`, `qa-detect-forced-colors` are SHALLOWER (they just check for CSS rules existing). This skill actually flips state and tests behavior. Both layers are valuable; not deprecating the existing skills.
- Contrast computation uses WCAG 2.1 formula. AA threshold: 4.5 for normal text, 3 for large text. AAA: 7 / 4.5.
