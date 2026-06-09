---
name: qa-detect-web-vitals
section: performance
description: "Measures all 6 Core Web Vitals (LCP, CLS, INP, TBT, TTFB, FCP) via PerformanceObserver injected through Playwright MCP. Compares to Google's official thresholds — same metrics Lighthouse measures, same thresholds Chrome ranks pages on for SEO."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any Core Web Vital metric finding (LCP/CLS/INP/TBT/TTFB/FCP/long-tasks/DOM-size) belongs to this skill"
---

# qa-detect-web-vitals — Core Web Vitals Measurement

Measures all 6 Core Web Vitals using `PerformanceObserver` injected via `browser_evaluate`. No external dependency — uses native browser APIs available in every Chromium/WebKit instance. Same metrics Lighthouse measures and Google uses for Search ranking.

---

## What it checks (10 issue types)

### Core Web Vitals (6)

| Issue type | Severity threshold | Google's thresholds |
|---|---|---|
| `poorLCP` | high if > 4.0s, medium if > 2.5s | Good < 2.5s · Needs improvement 2.5-4.0s · Poor > 4.0s |
| `poorCLS` | high if > 0.25, medium if > 0.1 | Good < 0.1 · Needs improvement 0.1-0.25 · Poor > 0.25 |
| `poorINP` | high if > 500ms, medium if > 200ms | Good < 200ms · Needs improvement 200-500ms · Poor > 500ms |
| `highTBT` | high if > 600ms, medium if > 200ms | Lighthouse target: < 200ms |
| `slowTTFB` | high if > 1500ms, medium if > 600ms | Good < 600ms · Needs improvement 600-1500ms · Poor > 1500ms |
| `slowFCP` | high if > 3.0s, medium if > 1.8s | Good < 1.8s · Needs improvement 1.8-3.0s · Poor > 3.0s |

### Performance signals (4)

| Issue type | Severity | What it catches |
|---|---|---|
| `excessiveLongTasks` | medium | More than 5 long tasks (each > 50ms) during page lifetime |
| `domNodeCountExcessive` | medium if > 1500, high if > 3000 | Lighthouse warns at 1500, fails at 3000 |
| `mainThreadBlocked` | high | A single long task > 1000ms blocks the main thread (frozen UI) |
| `webVitalsNotMeasurable` | info | Page lifecycle prevents measurement (very short-lived) — not a bug |

---

## Self-skip conditions

- Skip if `customize.toml → [web_vitals].enabled = false`
- Skip if cell is the auth-flow cell (login navigation alters metrics)
- Skip if route returned 4xx/5xx (no point measuring vitals on error page)

---

## Orchestrator flow

The skill runs ONCE per cell. Web Vitals measurement requires:
1. Install observers BEFORE / DURING page load (use `buffered: true` for entries that already happened)
2. Wait for measurements to stabilize (~3s)
3. Trigger an interaction for INP measurement
4. Read all collected metrics
5. Compare to thresholds and emit findings

### Step 1 — Navigate, then install observers (Approach B — works without addInitScript)

```
1. browser_navigate({ url, waitUntil: 'domcontentloaded', timeout: 15000 })
2. browser_evaluate(probe.installWebVitalsObserver)
   → installs PerformanceObservers with buffered:true to catch already-fired entries
```

### Step 2 — Let metrics stabilize

```
3. browser_wait_for({ time: 3000 })   // 3s of accumulation
```

During this window, LCP/CLS/long-tasks continue to update.

### Step 3 — Trigger an interaction for INP

INP requires user interaction. Click a known visible interactive element.

```
4. interactiveTarget = browser_evaluate(probe.findInteractiveTarget)
   // Returns the safest visible interactive element (button, link — NOT submit/form-related)
5. If target found:
   browser_click({ selector: target.selector })
   browser_wait_for({ time: 500 })
```

If no safe target → INP stays 0 → skip `poorINP` check (cannot measure without interaction).

### Step 4 — Read final metrics

```
6. metrics = browser_evaluate(probe.readWebVitals)
   Returns: {
     lcp: ms,           // 0 if not measured
     cls: float,        // 0 if no shifts
     inp: ms,           // 0 if no interaction recorded
     fcp: ms,
     ttfb: ms,
     longTasks: [{ start, dur }],
     domNodeCount: number,
     measurementAge: ms  // how long observers were collecting
   }
```

### Step 5 — Apply thresholds, emit findings

```
7. For each metric, apply Google's thresholds:

   if metrics.lcp > 4000:
     emit { issueType: 'poorLCP', severity: 'high',
            description: `LCP ${metrics.lcp}ms exceeds Google's "Poor" threshold (>4000ms). User sees largest element render too slowly.`,
            metricValue: metrics.lcp, threshold: 4000 }
   elif metrics.lcp > 2500:
     emit { issueType: 'poorLCP', severity: 'medium', ... }

   if metrics.cls > 0.25:
     emit { issueType: 'poorCLS', severity: 'high',
            description: `Cumulative layout shift ${metrics.cls.toFixed(3)} exceeds Google's "Poor" threshold (>0.25). Page content shifts unexpectedly during load.` }
   elif metrics.cls > 0.1:
     emit { issueType: 'poorCLS', severity: 'medium', ... }

   if metrics.inp > 500:
     emit { issueType: 'poorINP', severity: 'high',
            description: `INP ${metrics.inp}ms exceeds Google's "Poor" threshold (>500ms). Interactions feel laggy.` }
   elif metrics.inp > 200:
     emit { issueType: 'poorINP', severity: 'medium', ... }
   elif metrics.inp === 0:
     // No interaction occurred — emit info only, not a bug
     emit { issueType: 'webVitalsNotMeasurable', severity: 'info',
            description: 'INP not measured — no interactive element clicked during this cell.' }

   // TBT = sum of (longTaskDuration - 50ms) for each long task
   tbt = metrics.longTasks.reduce((sum, t) => sum + Math.max(0, t.dur - 50), 0)
   if tbt > 600:
     emit { issueType: 'highTBT', severity: 'high', ... }
   elif tbt > 200:
     emit { issueType: 'highTBT', severity: 'medium', ... }

   if metrics.ttfb > 1500:
     emit { issueType: 'slowTTFB', severity: 'high',
            description: `TTFB ${metrics.ttfb}ms exceeds Google's "Poor" threshold (>1500ms). Server response is slow.` }
   elif metrics.ttfb > 600:
     emit { issueType: 'slowTTFB', severity: 'medium', ... }

   if metrics.fcp > 3000:
     emit { issueType: 'slowFCP', severity: 'high', ... }
   elif metrics.fcp > 1800:
     emit { issueType: 'slowFCP', severity: 'medium', ... }

   // Long tasks count
   if metrics.longTasks.length > 5:
     emit { issueType: 'excessiveLongTasks', severity: 'medium',
            description: `${metrics.longTasks.length} long tasks during page lifetime. Combined blocking time: ${tbt}ms.` }

   // Main thread blocked
   const maxTask = metrics.longTasks.reduce((m, t) => Math.max(m, t.dur), 0);
   if maxTask > 1000:
     emit { issueType: 'mainThreadBlocked', severity: 'high',
            description: `Single long task of ${maxTask}ms blocked the main thread. UI frozen for ${(maxTask/1000).toFixed(1)}s.` }

   // DOM size
   if metrics.domNodeCount > 3000:
     emit { issueType: 'domNodeCountExcessive', severity: 'high',
            description: `${metrics.domNodeCount} DOM nodes exceeds Lighthouse fail threshold (3000). Page may be slow to render.` }
   elif metrics.domNodeCount > 1500:
     emit { issueType: 'domNodeCountExcessive', severity: 'medium',
            description: `${metrics.domNodeCount} DOM nodes exceeds Lighthouse warn threshold (1500).` }
```

### Step 6 — Cleanup (MANDATORY)

```
8. browser_evaluate(probe.cleanupWebVitals)
   // Removes the global window.__argusVitals object
   // Disconnects all PerformanceObservers
```

---

## Probes (browser_evaluate)

```js
// probe.installWebVitalsObserver — runs RIGHT AFTER navigation
// Uses buffered: true to retrieve entries that already fired
() => {
  if (window.__argusVitals) return { alreadyInstalled: true };
  window.__argusVitals = {
    lcp: 0, cls: 0, inp: 0, fcp: 0, ttfb: 0,
    longTasks: [],
    domNodeCount: 0,
    installedAt: performance.now(),
    observers: []
  };

  try {
    // LCP — buffered catches the one that already happened during page load
    const lcpObs = new PerformanceObserver(list => {
      const entries = list.getEntries();
      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        window.__argusVitals.lcp = Math.round(last.renderTime || last.loadTime || last.startTime);
      }
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    window.__argusVitals.observers.push(lcpObs);
  } catch (_) {}

  try {
    // CLS — accumulate, but exclude user-input-driven shifts
    const clsObs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__argusVitals.cls += e.value;
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
    window.__argusVitals.observers.push(clsObs);
  } catch (_) {}

  try {
    // Long tasks (for TBT)
    const ltObs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        window.__argusVitals.longTasks.push({
          start: Math.round(e.startTime),
          dur: Math.round(e.duration)
        });
      }
    });
    ltObs.observe({ type: 'longtask', buffered: true });
    window.__argusVitals.observers.push(ltObs);
  } catch (_) {}

  try {
    // Event Timing API (for INP)
    const evtObs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        // INP = MAX of interaction durations across the page lifetime
        if (e.interactionId) {
          window.__argusVitals.inp = Math.max(window.__argusVitals.inp, Math.round(e.duration));
        }
      }
    });
    evtObs.observe({ type: 'event', buffered: true, durationThreshold: 16 });
    window.__argusVitals.observers.push(evtObs);
  } catch (_) {}

  // FCP — read from paint entries that already happened
  for (const e of performance.getEntriesByType('paint')) {
    if (e.name === 'first-contentful-paint') {
      window.__argusVitals.fcp = Math.round(e.startTime);
      break;
    }
  }

  // TTFB — from navigation timing
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) {
    window.__argusVitals.ttfb = Math.round(nav.responseStart - nav.requestStart);
  }

  return { installed: true, observerCount: window.__argusVitals.observers.length };
}
```

```js
// probe.findInteractiveTarget — find a safe element to click for INP measurement
() => {
  // Prefer: visible buttons/links that are NOT submit, NOT form actions, NOT navigation
  const candidates = [
    ...document.querySelectorAll(
      'button:not([type="submit"]):not([disabled]), ' +
      'a[href]:not([href^="javascript:"]):not([href*="logout"]):not([href*="signout"]), ' +
      '[role="button"]:not([disabled]), ' +
      '[role="tab"]:not([aria-selected="true"])'
    )
  ].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.top < 0 || r.bottom > innerHeight) return false;  // viewport-only
    // Exclude dangerous elements
    const txt = (el.innerText || '').toLowerCase();
    if (/delete|remove|destroy|cancel|logout|sign\s*out/i.test(txt)) return false;
    return true;
  });
  if (candidates.length === 0) return { found: false };
  // Prefer hamburger menu / nav / tab clicks (state-only changes)
  const safest = candidates.find(c => /menu|toggle|tab|expand|collapse|nav/i.test(c.className || '')) || candidates[0];
  return {
    found: true,
    selector: safest.id ? `#${safest.id}` : safest.tagName.toLowerCase() + (safest.className ? `.${safest.className.split(' ')[0]}` : ''),
    text: (safest.innerText || '').trim().slice(0, 40)
  };
}
```

```js
// probe.readWebVitals — read all metrics
() => {
  if (!window.__argusVitals) return { error: 'not-installed' };
  const v = window.__argusVitals;
  return {
    lcp: v.lcp,
    cls: Math.round(v.cls * 1000) / 1000,  // 3 decimal places
    inp: v.inp,
    fcp: v.fcp,
    ttfb: v.ttfb,
    longTasks: v.longTasks.slice(0, 50),  // cap to keep payload bounded
    longTaskCount: v.longTasks.length,
    domNodeCount: document.querySelectorAll('*').length,
    measurementAge: Math.round(performance.now() - v.installedAt)
  };
}
```

```js
// probe.cleanupWebVitals — disconnect observers, remove window global
() => {
  if (!window.__argusVitals) return { wasInstalled: false };
  for (const obs of window.__argusVitals.observers) {
    try { obs.disconnect(); } catch (_) {}
  }
  delete window.__argusVitals;
  return { cleaned: true };
}
```

---

## Configuration (customize.toml)

```toml
[web_vitals]
enabled                = true
interaction_for_inp    = true       # if false, skip INP measurement
inp_target_priority    = "nav-tab-button"  # which element types to prefer for triggering INP
wait_for_stabilization_ms = 3000    # how long to let observers collect after navigation
critical_routes        = []         # if non-empty, only run on these routes (cost control)

# Override Google's thresholds if your team has different SLAs
[web_vitals.thresholds]
lcp_poor_ms     = 4000
lcp_ni_ms       = 2500
cls_poor        = 0.25
cls_ni          = 0.10
inp_poor_ms     = 500
inp_ni_ms       = 200
tbt_poor_ms     = 600
tbt_ni_ms       = 200
ttfb_poor_ms    = 1500
ttfb_ni_ms      = 600
fcp_poor_ms     = 3000
fcp_ni_ms       = 1800
long_tasks_max  = 5
dom_warn        = 1500
dom_fail        = 3000
max_single_task_ms = 1000
```

---

## Hard rules

1. **Install observers IMMEDIATELY after navigate**, not before — `buffered: true` retrieves backfill entries.
2. **3-second stabilization wait is non-negotiable** — shorter misses late LCP candidates.
3. **NEVER click form submit / delete / logout buttons** for INP — could destroy page state.
4. **Mandatory cleanup** — observers and `window.__argusVitals` removed before exit.
5. **Skip the cell if it's the login-flow cell** — login navigation invalidates metrics.
6. **TBT computed CLIENT-SIDE** in orchestrator from long-tasks array — not from PerformanceObserver directly.
7. **Cap long-tasks payload at 50** — bounded transport size.

---

## Cost analysis

| Phase | Round-trips | Cost |
|---|---|---|
| Install observer | 1 evaluate | ~$0.0003 |
| 3s stabilization wait | 0 (free) | $0 |
| Find interactive target | 1 evaluate | ~$0.0002 |
| Trigger click for INP | 1 MCP click | ~$0.0001 |
| Wait 500ms | 0 | $0 |
| Read metrics | 1 evaluate | ~$0.0005 |
| Threshold check + emit findings | orchestrator-side | $0 |
| Cleanup | 1 evaluate | ~$0.0001 |
| **Total per cell** | **~5 MCP calls** | **~$0.002** |

For 10 issue types covering THE metrics Google uses for Search ranking, that's **exceptional ROI**.

---

## Why these specific thresholds?

| Source | What they're based on |
|---|---|
| Google's Core Web Vitals thresholds (LCP/CLS/INP) | Real user data from Chrome UX Report (CrUX); 75th-percentile users see at least this performance |
| Lighthouse thresholds (TBT, TTFB, FCP) | Synthetic measurement standards; what Lighthouse score 90+ requires |
| DOM node count (1500/3000) | Lighthouse audit thresholds |
| 1000ms single-task threshold | Above this users report frozen UI complaints |

These aren't arbitrary — they're the published industry standards every web performance tool uses.

---

## Notes

- This skill REPLACES nothing. It adds a Performance dimension current skills don't measure.
- INP requires real interaction; if your route has no safe clickable element, INP is just not reported (info-level note, not a bug).
- For routes where you want STRICTER thresholds (checkout, signup), override per-route via a future enhancement.
- The web-vitals values measured here ARE the same values Lighthouse reports for these metrics. Same algorithms, same buffered observers.
- For real-user (RUM) data, you'd need analytics integration outside this skill. This skill provides synthetic data — same as Lighthouse, same as PSI.
