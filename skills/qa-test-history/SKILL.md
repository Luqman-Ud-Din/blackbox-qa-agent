---
name: qa-test-history
description: "Tests browser back/forward navigation and direct deep-link loading"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## Tests

**Back/forward:**
- Collect `a[href^="/"], a[href^="./"]` links (up to 5). Click first visible one with `href !== cell.route && href !== '#'`. Wait `domcontentloaded` (8s).
- If navigated: record `afterNavUrl`. `goBack(domcontentloaded, 8s)`. If back URL ≠ startUrl → backButtonBroken (medium)
- `goForward(domcontentloaded, 8s)`. If fwd URL ≠ afterNavUrl AND fwd URL === afterBack → forwardButtonBroken (low)

**Deep link:**
- `page.goto(startUrl, { waitUntil: 'domcontentloaded' })` — check if `document.title.toLowerCase()` contains `404|not found|error` → deepLinkFails (high)

## Issues
| issueType | severity | description |
|---|---|---|
| backButtonBroken | medium | "Browser back button did not return to \"{startUrl}\" — ended up at \"{afterBack}\"" |
| forwardButtonBroken | low | "Browser forward button did not return to \"{afterNavUrl}\" — ended up at \"{afterFwd}\"" |
| deepLinkFails | high | "Direct navigation to \"{cell.route}\" shows a 404/error page — deep linking is broken" |
