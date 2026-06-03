---
name: qa-test-states
description: "Tests empty state and error state (API 500 intercept)"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## Tests

**Empty state:**
- Search `input[type="search"], input[placeholder*="search" i]` (first, visible)
- If found: fill `'xxxxxxxxxx_no_match_empty_test'`, wait 800ms
- If `[data-testid*="empty"], .empty-state, [class*="no-results"], [class*="empty"]` not visible AND `tbody|[role="list"]|[data-testid*="list"]` text < 10 chars → missingEmptyState (low)
- Reset search, wait 400ms

**Error state:**
- `page.route('**/api/**', r => r.fulfill({ status: 500, body: JSON.stringify({ error: 'Server Error' }) }))`
- `page.reload({ waitUntil: 'domcontentloaded' })`, wait 1500ms
- If `[role="alert"], [data-testid*="error"], .error-state, [class*="error-state"], [class*="error-message"]` not visible AND page text does NOT contain `something went wrong|error loading|failed to load|try again` → missingErrorState (medium)
- `page.unroute('**/api/**')`, reload to restore

## Issues
| issueType | severity | description |
|---|---|---|
| missingEmptyState | low | "No empty state UI shown when search returns zero results" |
| missingErrorState | medium | "No error state shown when API returns 500 — page silently fails without user feedback" |
