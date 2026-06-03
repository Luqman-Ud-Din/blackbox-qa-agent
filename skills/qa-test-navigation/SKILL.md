---
name: qa-test-navigation
description: "Verify internal nav links resolve, tabs switch content, and redirects land on real pages"
model: haiku
applyOn: [mobile, tablet, desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

# QA Test — Navigation

## What Claude tests

- Every visible internal link either changes the URL or transitions to a different view
- No link lands on a blank page, a 404, or an error page
- Tab components switch the visible panel content when clicked
- Redirect chains (e.g. `/` → `/dashboard`) land on a real, content-bearing page

## Test steps

1. Navigate to the target route using `page.goto(url)`.
2. Collect all visible internal anchor elements: `page.locator('a[href]:not([href^="http"]):not([href^="mailto"]):not([href^="tel"]):not([href="#"])').all()`. Limit to 20 to keep the test bounded.
3. For each link:
   a. Record the current URL with `page.url()`.
   b. Click the link with `page.click(locator)`.
   c. Wait for navigation or DOM settle: `page.waitForLoadState('networkidle', { timeout: 6000 })`.
   d. Record the new URL.
   e. Check for error indicators: `page.locator('text=/404|not found|error|something went wrong/i').isVisible()`.
   f. If URL did not change AND no visible content transition occurred → log `navLinkDead`.
   g. If an error indicator is visible → log `navLinkBroken`.
   h. Navigate back: `page.goBack()` and wait for load.
4. Collect all tab trigger elements: `page.locator('[role="tab"], .tab, [data-tab]').all()`.
5. For each tab (skip if < 2 tabs found):
   a. Note the current active panel's text via `page.locator('[role="tabpanel"]:visible').innerText()`.
   b. Click the tab.
   c. Wait 500 ms: `page.waitForTimeout(500)`.
   d. Re-read the panel text.
   e. If text is identical to what it was before → log `tabSwitchNoEffect`.
6. Identify redirect links (links whose `href` differs from the final URL after click by more than a trailing slash):
   a. If final page has no meaningful content (empty body text < 50 chars or visible error) → log `routeRedirectBroken`.

## Pass / Fail criteria

Pass:
- Every clicked link either changes the URL or produces a clearly different view.
- No error page text (`404`, `not found`, `error`, `something went wrong`) is visible after navigation.
- Each tab click changes the content of the associated panel.
- Every redirect ends on a page with visible content.

Fail (log as finding):
- A link click produces no URL change and no visible content change → `navItemDead`.
- A link click lands on a page showing an error message or blank body → `navLinkBroken`.
- Clicking a different tab shows no change in panel content → `tabSwitchNoEffect`.
- A redirect ends on an error or empty page → `routeRedirectBroken`.

## Issue schema

- type: "navLinkBroken"
- severity: high
- selector: the `<a>` element that was clicked
- description: "Navigation link leads to an error or blank page — href: {href}"

- type: "navItemDead"
- severity: medium
- selector: the `<a>` element that was clicked
- description: "Navigation link click produced no URL change and no visible content transition — href: {href}"

- type: "tabSwitchNoEffect"
- severity: high
- selector: the `[role="tab"]` element that was clicked
- description: "Clicking tab '{label}' did not change the visible panel content"

- type: "routeRedirectBroken"
- severity: high
- selector: null
- description: "Redirect from {sourceHref} ended on an error or content-less page — final URL: {finalUrl}"

## Scope

applyOn: ["desktop"]
Self-skip conditions: none — run on every route.
