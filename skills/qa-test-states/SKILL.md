---
name: qa-test-states
section: interactive
description: "Tests empty state and error state. Empty state: types a no-match search term and checks for empty-state UI. Error state: injects a fetch interceptor via browser_evaluate to return 500 for API calls, reloads, checks for error UI feedback. Fully MCP — no page.route(), no page.reload()."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

# QA Test — Empty State & Error State (MCP-native rewrite)

## Tests

### Test 1 — Empty state

**Goal:** verify the app shows a proper "no results" UI when search/filter yields zero results.

```
1. searchState = browser_evaluate(probe.findSearchOrFilter)
   If !searchState.found → skip empty-state test

2. browser_click(selector=searchState.selector)
3. browser_type(selector=searchState.selector, text='xxxxxxxxxx_no_match_empty_test', delay=30)
4. browser_wait_for(time=1000)  ← wait for debounce + results to update

5. emptyCheck = browser_evaluate(probe.checkEmptyStateUI)
6. If !emptyCheck.hasEmptyState AND emptyCheck.hasDataContainer AND emptyCheck.rowCount < 2:
   → emit missingEmptyState (low)
     evidence: {note: 'searched for non-existent term, no empty-state UI shown'}

7. Clear search:
   browser_evaluate(probe.clearSearch, {selector: searchState.selector})
   browser_wait_for(time=500)
```

### Test 2 — Error state

**Goal:** verify the app shows a proper error message when the API returns a 500 error.

Uses a `fetch` + `XMLHttpRequest` interceptor injected via `browser_evaluate` — simulates API failure without `page.route()` (which is unavailable in MCP).

```
1. browser_evaluate(probe.installErrorInterceptor)
   // Wraps window.fetch and XMLHttpRequest to return 500 for all /api/ calls

2. browser_navigate({url: baseUrl + cell.route, waitUntil: 'domcontentloaded', timeout: 10000})
3. browser_wait_for(time=2000)  ← allow Angular error handlers to fire

4. errorCheck = browser_evaluate(probe.checkErrorStateUI)
5. If !errorCheck.hasErrorState AND !errorCheck.hasRetryOption:
   → emit missingErrorState (medium)
     evidence: {note: 'API intercepted to return 500, no error UI shown to user'}

6. Restore — remove interceptor and reload to clean state:
   browser_evaluate(probe.removeErrorInterceptor)
   browser_navigate({url: baseUrl + cell.route, waitUntil: 'domcontentloaded', timeout: 10000})
   browser_wait_for(time=800)
```

## Probes (browser_evaluate)

```js
// probe.findSearchOrFilter
() => {
  const searchInputs = [...document.querySelectorAll(
    'input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], ' +
    'input[formcontrolname*="search" i], input[aria-label*="search" i], ' +
    '[class*="search-input"] input, mat-form-field input[placeholder*="search" i]'
  )].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled;
  });
  if (searchInputs.length === 0) return { found: false };
  const inp = searchInputs[0];
  inp.setAttribute('data-argus-search-input', '1');
  return { found: true, selector: '[data-argus-search-input="1"]' };
}
```

```js
// probe.checkEmptyStateUI
() => {
  const emptySelectors = [
    '[data-testid*="empty"]', '.empty-state', '[class*="no-results"]',
    '[class*="empty"]', '[class*="zero-state"]', '[class*="empty-state"]',
    '[aria-label*="no results" i]', '[class*="not-found"]'
  ];
  const hasEmptyState = emptySelectors.some(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
  });

  // Check if there's a data container (table/list) that should show empty state
  const dataContainer = document.querySelector('table, mat-table, [role="grid"], [class*="list-container"]');
  const rows = dataContainer ? [...dataContainer.querySelectorAll('tr:not(:first-child), mat-row, [role="row"]:not([role="columnheader"])')].filter(r => r.getBoundingClientRect().height > 0) : [];

  return {
    hasEmptyState,
    hasDataContainer: !!dataContainer,
    rowCount: rows.length
  };
}
```

```js
// probe.clearSearch — args: { selector }
({selector}) => {
  const input = document.querySelector(selector);
  if (!input) return { cleared: false };
  input.focus();
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { cleared: true };
}
```

```js
// probe.installErrorInterceptor
() => {
  if (window.__argusErrorInterceptor) return { alreadyInstalled: true };

  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '');
    // Only intercept API calls, not static assets
    if (/\/api\/|\/graphql|\/rest\//.test(url)) {
      return new Response(JSON.stringify({ error: 'Internal Server Error', status: 500 }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return origFetch.apply(this, args);
  };

  // Intercept XMLHttpRequest
  const OrigXHR = window.XMLHttpRequest;
  class InterceptedXHR extends OrigXHR {
    open(method, url, ...args) {
      this._argusUrl = url;
      return super.open(method, url, ...args);
    }
    send(...args) {
      if (this._argusUrl && /\/api\/|\/graphql|\/rest\//.test(this._argusUrl)) {
        // Simulate 500 response
        setTimeout(() => {
          Object.defineProperty(this, 'status', { value: 500 });
          Object.defineProperty(this, 'readyState', { value: 4 });
          Object.defineProperty(this, 'responseText', { value: JSON.stringify({ error: 'Internal Server Error' }) });
          this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(new Event('load'));
        }, 100);
        return;
      }
      return super.send(...args);
    }
  }
  window.XMLHttpRequest = InterceptedXHR;

  window.__argusErrorInterceptor = { origFetch, OrigXHR };
  return { installed: true };
}
```

```js
// probe.checkErrorStateUI
() => {
  const errorSelectors = [
    '[role="alert"]', '[data-testid*="error"]', '.error-state',
    '[class*="error-state"]', '[class*="error-message"]', '[class*="api-error"]',
    'mat-error', '.alert-danger', 'snack-bar-container[class*="error"]',
    '[class*="http-error"]', '[class*="server-error"]'
  ];
  const hasErrorState = errorSelectors.some(sel => {
    const els = [...document.querySelectorAll(sel)];
    return els.some(el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width === 0 || s.display === 'none') return false;
      const txt = (el.innerText || '').toLowerCase();
      return txt.length > 3 && !/success|info/i.test(txt);
    });
  });

  // Also look for "try again" / "retry" button as an indicator
  const hasRetryOption = !!document.querySelector('button[class*="retry"], button[class*="try-again"], [aria-label*="retry" i], [aria-label*="try again" i]');

  // Check body text for error keywords
  const bodyText = (document.body.innerText || '').toLowerCase().slice(0, 800);
  const hasErrorText = /\b(something went wrong|error loading|failed to load|server error|unable to|please try again|oops)\b/.test(bodyText);

  return { hasErrorState: hasErrorState || hasErrorText, hasRetryOption };
}
```

```js
// probe.removeErrorInterceptor
() => {
  if (!window.__argusErrorInterceptor) return { wasInstalled: false };
  window.fetch = window.__argusErrorInterceptor.origFetch;
  window.XMLHttpRequest = window.__argusErrorInterceptor.OrigXHR;
  delete window.__argusErrorInterceptor;
  return { removed: true };
}
```

```js
// probe.cleanupStates
() => {
  const el = document.querySelector('[data-argus-search-input]');
  if (el) try { el.removeAttribute('data-argus-search-input'); } catch (_) {}
  // Ensure interceptor is removed
  if (window.__argusErrorInterceptor) {
    window.fetch = window.__argusErrorInterceptor.origFetch;
    window.XMLHttpRequest = window.__argusErrorInterceptor.OrigXHR;
    delete window.__argusErrorInterceptor;
  }
  return { ok: true };
}
```

Always call `probe.cleanupStates` at the end, even on error.

## Issues
| issueType | severity | description |
|---|---|---|
| missingEmptyState | low | "No empty state UI shown when search returns zero results" |
| missingErrorState | medium | "No error state shown when API returns 500 — page silently fails without user feedback" |

## Hard rules

1. **NEVER use `page.route()`** — raw Playwright API, unavailable in MCP. Use `probe.installErrorInterceptor` fetch wrapper instead.
2. **NEVER use `page.reload()`** — use `browser_navigate({url: sameUrl, waitUntil: 'domcontentloaded'})`.
3. **NEVER use `page.unroute()`** — use `probe.removeErrorInterceptor` to restore originals.
4. **Mandatory cleanup** — `probe.removeErrorInterceptor` MUST run before exit so subsequent skills get real API responses.
5. **Only intercept `/api/`, `/graphql/`, `/rest/`** — don't intercept static assets (CSS, JS, images).
