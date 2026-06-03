---
name: qa-test-auth-flow
description: "Tests login, logout, and protected route redirect"
model: sonnet
applyOn: [mobile, tablet, desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Only run on routes containing `login`, `signin`, or `auth` in the path. Skip if no email/password in config.

## Tests

**Test 1 — Valid login:**
- Goto `baseUrl + loginPath`
- Fill `input[type="email"], input[name="email"], input[name="username"], input[id*="email" i]` (first)
- Fill `input[type="password"]` (first)
- Click `button[type="submit"], input[type="submit"], button:not([type])` (first)
- Wait `networkidle` (12s timeout)
- If URL still contains loginPath → loginFailed (critical)

**Test 2 — Logout:**
- Find `button:has-text(/log.?out|sign.?out/i), a:has-text(/log.?out|sign.?out/i), [data-testid*="logout"]` (first, visible)
- Click, wait networkidle (10s)
- If URL does NOT contain `login` or `signin` and is not `baseUrl + '/'` → logoutNotRedirected (medium)

**Test 3 — Protected route redirect:**
- `page.context().clearCookies()`
- Goto `baseUrl + (cell.route.includes('dashboard') ? cell.route : '/dashboard')`
- If URL does NOT contain `login` or `signin` → noProtectedRouteRedirect (high)

## Issues
| issueType | severity | description |
|---|---|---|
| loginFailed | critical | "Login with provided credentials failed — still on {url}" |
| loginError | critical | "Login flow threw an error: {msg}" |
| logoutNotRedirected | medium | "Logout did not redirect to login page — landed on {url}" |
| noProtectedRouteRedirect | high | "Accessing \"{path}\" while logged out did not redirect to login — landed on {url}" |
