---
name: qa-detect-network-errors
description: "Detects HTTP 4xx/5xx responses, request timeouts, and failed resource loads (images, scripts, fonts)."
---

# Network Error Detection

## What Claude checks
- HTTP **5xx responses** (server errors) on any request — API calls, page resources, or XHR/fetch
- HTTP **4xx responses** (client errors) excluding expected 401/403 on authenticated endpoints, and 404 on intentionally missing resources
- **Request failures** — network errors, connection refused, DNS failure (no response at all)
- **Failed resource loads** — images, JavaScript bundles, CSS files, and web fonts that fail to load
- Requests that take **longer than 10 seconds** (potential timeout scenario)

## How to detect

```js
// Set up listeners BEFORE navigating to the page
const networkErrors = [];
const failedRequests = [];
const slowRequests = [];

const requestStartTimes = new Map();

page.on('request', request => {
  requestStartTimes.set(request.url(), Date.now());
});

page.on('response', response => {
  const status = response.status();
  const url = response.url();
  const startTime = requestStartTimes.get(url);
  const duration = startTime ? Date.now() - startTime : null;

  // Ignore patterns
  const ignoredPatterns = [
    /\/cdn-cgi\/rum/,
    /\/favicon\.ico/,
    /\/__webpack_hmr/,
    /\/sockjs-node/,
    /analytics\.google\.com/,
    /googletagmanager\.com/,
    /hotjar\.com/
  ];
  if (ignoredPatterns.some(p => p.test(url))) return;

  if (status >= 500) {
    networkErrors.push({ type: 'httpError', status, url, severity: 'high' });
  } else if (status >= 400 && status !== 401 && status !== 403) {
    networkErrors.push({ type: 'httpError', status, url, severity: 'medium' });
  }

  if (duration && duration > 10000) {
    slowRequests.push({ url, duration });
  }
});

page.on('requestfailed', request => {
  const url = request.url();
  const failure = request.failure();
  const resourceType = request.resourceType();

  const ignoredPatterns = [/\/cdn-cgi\/rum/, /\/favicon\.ico/, /\/__webpack_hmr/];
  if (ignoredPatterns.some(p => p.test(url))) return;

  const isCriticalResource = ['script', 'stylesheet', 'image', 'font'].includes(resourceType);

  failedRequests.push({
    type: isCriticalResource ? 'resourceLoadFailed' : 'requestFailed',
    url: url.slice(0, 200),
    resourceType,
    errorText: failure ? failure.errorText : 'unknown',
    severity: isCriticalResource ? 'high' : 'medium'
  });
});

// Navigate to the page
await page.goto(url, { waitUntil: 'networkidle' });
```

Summarise findings after navigation completes. Filter out third-party analytics/tracking failures unless they break core functionality.

## Issue schema
- type: `"httpError"` | `"requestFailed"` | `"resourceLoadFailed"`
- severity: from config (`high` for 5xx and critical resources, `medium` for 4xx and non-critical)
- selector: `null` (network-level, not DOM-bound)
- description:
  - httpError: `"HTTP <status> response for <url>"`
  - requestFailed: `"Request failed for <url>: <errorText>"`
  - resourceLoadFailed: `"<resourceType> resource failed to load: <url> (<errorText>)"`

## Ignored patterns
- `/cdn-cgi/rum` — Cloudflare Real User Monitoring
- `/favicon.ico` — browser auto-request, often 404 by design
- `/__webpack_hmr` — Webpack hot module replacement
- `/sockjs-node` — webpack-dev-server websocket
- `analytics.google.com`, `googletagmanager.com`, `hotjar.com` — third-party tracking

## Viewport behaviour
- Run on **all viewports** — resource loading is not viewport-specific
- Set up listeners before each new page navigation
- On mobile viewports, watch for lazy-loaded resources that trigger on scroll — perform a page scroll before finalising the report
