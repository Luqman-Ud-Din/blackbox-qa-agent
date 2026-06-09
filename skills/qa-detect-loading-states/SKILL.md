---
name: qa-detect-loading-states
section: performance
description: "Tests loading-state behavior under simulated slow network. Detects stuck skeletons, loading spinners overlapping content, lazy-load that fails on slow connections, and below-fold content that never loads. Uses fetch interceptor for network throttling (works without CDP)."
model: haiku
applyOn: [mobile]
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any bug specific to slow-network loading-state behavior belongs to this skill"
---

# qa-detect-loading-states — Slow Network Loading-State Testing

Slows down the network via `fetch` interceptor injected into the page, then captures loading-state behavior. Catches skeletons that never disappear, spinners that overlap real content, lazy-load failures, and below-fold content that depends on network requests that timeout.

## What it checks (6 issue types)

| Issue type | Severity | What it catches |
|---|---|---|
| `skeletonStuckAfterLoad` | high | Skeleton placeholder still visible after page has loaded all content |
| `loadingSpinnerOverlapsContent` | medium | Spinner element rendered on top of real content (z-index issue) |
| `lazyLoadFailsOnSlow` | medium | Below-fold images don't load even after extended wait time |
| `loadingIndicatorMissing` | medium | Page is waiting for data with no visible loading indicator (users think it's broken) |
| `infiniteScrollStuckOnSlow` | low | Infinite scroll trigger never fires more content after scrolling to bottom on slow network |
| `criticalContentMissingAtSlow` | high | Critical above-fold content (hero, primary CTA) is missing or empty after 5s on slow network |

## Self-skip conditions

- Run on mobile only (mobile users hit slow networks; desktop usually fast)
- Skip if route is already audited with successful skeleton load (cached state)
- Skip if `customize.toml → [loading_states].enabled = false`

## Orchestrator flow

This skill installs a network throttle into the page, navigates to the route, captures loading states at intervals, then removes the throttle.

### Step 1 — Install network throttle (slow 3G)

```
browser_evaluate(probe.installNetworkThrottle, { delayMs: 1500 })
```

Wraps `window.fetch` and `XMLHttpRequest` with a 1.5s delay per request. Simulates real slow 3G behavior.

### Step 2 — Navigate to the route (re-trigger loading)

```
browser_navigate({
  url: baseUrl + cell.route,
  waitUntil: 'domcontentloaded',
  timeout: resilience.navigate_timeout_ms
})
browser_wait_for({ time: 500 })
```

Page now starts loading with all fetches throttled.

### Step 3 — Capture loading state at 3 intervals

```
t0 = now()
// Check 1: immediately after navigation (page just loaded HTML)
state0 = browser_evaluate(probe.snapshotLoadingState)

browser_wait_for({ time: 2000 })  // wait 2s (network still slow)
state2 = browser_evaluate(probe.snapshotLoadingState)

browser_wait_for({ time: 3000 })  // wait another 3s (5s total)
state5 = browser_evaluate(probe.snapshotLoadingState)
```

Each state captures: { skeletonCount, spinnerCount, criticalContentPresent, lazyImageLoadedCount, lazyImageTotalCount }

### Step 4 — Analyze loading-state evolution

```
1. If state5.skeletonCount > 0 AND state5.skeletonCount >= state0.skeletonCount
   → emit skeletonStuckAfterLoad (high) — skeleton hasn't disappeared after 5s

2. If state5.spinnerCount > 0 AND state5.criticalContentPresent
   → emit loadingSpinnerOverlapsContent (medium)

3. If state5.lazyImageLoadedCount === state0.lazyImageLoadedCount AND state5.lazyImageTotalCount > 0
   → emit lazyLoadFailsOnSlow (medium)

4. If state2 has empty critical sections AND state2.skeletonCount === 0 AND state2.spinnerCount === 0
   → emit loadingIndicatorMissing (medium) — users see blank screen

5. If !state5.criticalContentPresent
   → emit criticalContentMissingAtSlow (high)
```

### Step 5 — Test infinite scroll if present

```
6. hasInfinite = browser_evaluate(probe.detectInfiniteScroll)
   // Returns true if page has elements with sentinel pattern (intersection observer or scroll handler)

7. If hasInfinite:
   - Capture initial item count
   - Scroll to bottom
   - Wait 3s
   - Check if new items appeared
   - If not → emit infiniteScrollStuckOnSlow (low)
```

### Step 6 — Remove throttle, restore page

```
8. browser_evaluate(probe.removeNetworkThrottle)
9. browser_navigate to baseUrl + cell.route again WITHOUT throttle to leave page in normal state for next skill
10. browser_wait_for({ time: 800 })
```

## Probes (browser_evaluate)

```js
// probe.installNetworkThrottle — args: { delayMs }
({delayMs}) => {
  if (window.__argusThrottle) return { alreadyInstalled: true };

  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    await new Promise(r => setTimeout(r, delayMs));
    return origFetch.apply(this, args);
  };
  window.__argusThrottle = { origFetch, delayMs };

  // Also throttle XHR
  const OrigXHR = window.XMLHttpRequest;
  function ThrottledXHR() {
    const xhr = new OrigXHR();
    const origSend = xhr.send.bind(xhr);
    xhr.send = async function(...sendArgs) {
      await new Promise(r => setTimeout(r, delayMs));
      return origSend(...sendArgs);
    };
    return xhr;
  }
  window.XMLHttpRequest = ThrottledXHR;
  window.__argusThrottle.origXHR = OrigXHR;

  return { installed: true, delayMs };
}
```

```js
// probe.snapshotLoadingState
() => {
  // Count skeleton-like elements
  const skeletonSel = '.skeleton, [class*="skeleton"], [class*="shimmer"], [class*="loading-placeholder"], [aria-busy="true"]';
  const skeletons = [...document.querySelectorAll(skeletonSel)].filter(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  });

  // Count loading spinners
  const spinnerSel = '.spinner, .loader, [class*="spinner"], [role="progressbar"], svg.animate-spin, [data-loading="true"]';
  const spinners = [...document.querySelectorAll(spinnerSel)].filter(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  });

  // Critical content presence (above-fold heuristics — includes Angular Material selectors)
  const heroPresent = !!document.querySelector(
    'main h1, [class*="hero"] h1, main > section:first-child h1, ' +
    'mat-card-title, mat-toolbar-row h1, mat-toolbar h1, ' +
    '[class*="page-title"], [class*="page-header"] h1, [class*="mat-h1"], ' +
    '.mat-headline, mat-sidenav-content h1, mat-sidenav-content h2'
  );
  const ctaPresent = !!document.querySelector(
    'button[type="submit"], a.cta, .btn-primary, ' +
    'button[mat-raised-button], button[mat-flat-button], [class*="mat-primary"]'
  );
  const mainContentLength = (document.querySelector('main') || document.body).innerText.length;

  // Lazy image counts
  const lazyImages = [...document.querySelectorAll('img[loading="lazy"], img[data-src], img.lazy')];
  const lazyLoaded = lazyImages.filter(img => img.complete && img.naturalWidth > 0).length;

  return {
    skeletonCount: skeletons.length,
    spinnerCount: spinners.length,
    criticalContentPresent: heroPresent || (ctaPresent && mainContentLength > 200),
    lazyImageTotalCount: lazyImages.length,
    lazyImageLoadedCount: lazyLoaded,
    mainContentLength
  };
}
```

```js
// probe.detectInfiniteScroll
() => {
  // Heuristics: scroll-triggered loading
  const hasInfiniteClass = !!document.querySelector('[class*="infinite"], [data-infinite-scroll]');
  const hasSentinel = !!document.querySelector('[data-sentinel], .sentinel, [data-load-more]');
  // Check for IntersectionObserver in window (instantiated in JS for scroll triggers)
  const hasObserver = typeof window.IntersectionObserver !== 'undefined';
  return {
    detected: hasInfiniteClass || hasSentinel,
    initialItemCount: document.querySelectorAll('article, [data-item], .item, [class*="card"]').length
  };
}
```

```js
// probe.removeNetworkThrottle
() => {
  if (!window.__argusThrottle) return { wasInstalled: false };
  window.fetch = window.__argusThrottle.origFetch;
  if (window.__argusThrottle.origXHR) window.XMLHttpRequest = window.__argusThrottle.origXHR;
  delete window.__argusThrottle;
  return { removed: true };
}
```

## Configuration (customize.toml)

```toml
[loading_states]
enabled              = true
throttle_delay_ms    = 1500   # per-request delay (1500 = slow 3G; 500 = fast 3G)
sample_intervals_ms  = [500, 2000, 5000]  # when to sample loading state
critical_routes      = ["/", "/login", "/checkout", "/dashboard"]
test_infinite_scroll = true
```

## Hard rules

1. **Mandatory throttle removal** — `probe.removeNetworkThrottle` MUST run at the end. Subsequent skills can't be slow.
2. **Mandatory re-navigation after throttle removal** — leaves page in normal state for next skill in the cell.
3. **Run on mobile only** — desktop slow-network simulation is artificial.
4. **5-second total wait** — bounded; longer waits hurt cell budget.

## Cost analysis

| Phase | Cost |
|---|---|
| Install throttle (1 evaluate) | ~$0.0002 |
| Re-navigate (1 MCP call) | ~$0.0001 |
| 3× snapshot at intervals | ~$0.001 |
| Wait between samples | $0 (no LLM tokens) |
| Infinite scroll test (~3 evaluate) | ~$0.0008 |
| Remove throttle + re-nav | ~$0.0005 |
| **Total per cell** | **~$0.003** |

Wall-clock cost: ~6-8 seconds per cell on mobile (includes 5s waits). High value vs cost.

## Notes

- The fetch interceptor approach is a portable alternative to CDP `Network.emulateNetworkConditions`. Works in any MCP-supported browser.
- For genuinely WebSocket-heavy apps, throttle is incomplete (WS isn't intercepted). Sufficient for typical SPA fetch traffic.
- The skill REPLACES the existing `qa-detect-loading` skill's "stuck spinner" check only PARTIALLY. The existing skill checks 3s after networkidle; this one specifically forces a slow-network scenario and checks at multiple intervals.
