---
name: qa-test-history
description: "Verify browser Back and Forward navigation work correctly, and deep-link URLs load the right content without redirecting to home"
---

# QA Test — Browser History

## What Claude tests

- The browser Back button returns to the previous page with the correct content intact
- The browser Forward button works after navigating back (does not land on a blank page or throw an error)
- A deep-link URL (a route that is not the root `/`) loads the expected content when opened directly — it does not redirect to the home page or a 404

## Test steps

**Back button test:**
1. Navigate to the app's root URL: `page.goto(appUrl)`.
2. Wait for load: `page.waitForLoadState('networkidle', { timeout: 8000 })`.
3. Record the starting URL and a fingerprint of the current content: read the text of `page.locator('h1, [data-testid*="title"], main').first()`.
4. Navigate to a second route — click any internal nav link or use `page.goto(appUrl + knownSubPath)`.
5. Wait for load. Record the second URL and its content fingerprint.
6. Click back: `page.goBack()`. Wait for load: `page.waitForLoadState('networkidle', { timeout: 8000 })`.
7. Verify the current URL matches the starting URL.
8. Read content fingerprint again.
9. If URL does not match OR the page shows an error → log `backBroken`.
10. If URL matches but the content fingerprint is substantially different (e.g. the page re-rendered to a different view) → log `backBroken` with note "content did not restore correctly".

**Forward button test:**
11. After confirming Back worked, click forward: `page.goForward()`. Wait for load: `page.waitForLoadState('networkidle', { timeout: 8000 })`.
12. Verify the URL matches the second route from step 5.
13. Check for error indicators: `page.locator('text=/404|not found|error|something went wrong/i').isVisible()`.
14. If URL does not match or an error is visible → log `forwardBroken`.

**Deep-link test:**
15. Collect the set of routes discovered during the navigation audit (or use a known sub-path like `/dashboard`, `/settings`, `/users`, `/admin`).
16. For each candidate route (limit 3):
    a. Open a fresh context (clear cookies and storage):
       `const context = await browser.newContext(); const deepPage = await context.newPage()`.
    b. Navigate directly: `deepPage.goto(appUrl + route)`.
    c. Wait: `deepPage.waitForLoadState('networkidle', { timeout: 8000 })`.
    d. Read the final URL.
    e. If the final URL is the root URL (`/` or `/login`) AND the route was not a protected route requiring login → log `deepLinkBroken`.
    f. Check for error page indicators: `deepPage.locator('text=/404|not found|error/i').isVisible()`. If visible → log `deepLinkBroken`.
    g. Close the context.

## Pass / Fail criteria

Pass:
- Back navigates to the previous URL and restores the expected page content.
- Forward navigates back to the subsequent URL without error.
- Deep-linking to a sub-route loads the correct content without redirecting to home (unless authentication is required).

Fail:
- Back navigation lands on a wrong URL or shows an error/blank page → `backBroken`.
- Forward navigation lands on a wrong URL or shows an error/blank page → `forwardBroken`.
- Direct access to a known sub-route redirects to home (when the route is public) or shows a 404 → `deepLinkBroken`.

## Issue schema

- type: "backBroken"
- severity: high
- selector: null
- description: "Browser Back from '{secondRoute}' did not restore '{firstRoute}' — final URL: {finalUrl}"

- type: "forwardBroken"
- severity: high
- selector: null
- description: "Browser Forward did not navigate to '{expectedRoute}' — final URL: {finalUrl}"

- type: "deepLinkBroken"
- severity: high
- selector: null
- description: "Direct navigation to '{route}' redirected to '{finalUrl}' instead of loading the expected content"

## Scope

applyOn: ["desktop"]
Self-skip conditions: none — run on every route.
