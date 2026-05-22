---
name: qa-test-auth-flow
description: "Verify login succeeds with valid credentials, wrong credentials show an error, logout clears the session, and protected routes redirect unauthenticated users"
---

# QA Test — Auth Flow

## What Claude tests

- Submitting valid credentials logs the user in and lands on an authenticated page
- Submitting wrong credentials shows a user-visible error message — not a crash, blank page, or silent failure
- Clicking logout/sign-out removes the session and prevents re-access without logging in again
- Visiting a protected route while unauthenticated redirects to the login page (not a blank page, not the protected content)

## Test steps

1. Read test credentials from `{project-root}/.claude/automation.config.json` — fields `apps[n].email`, `apps[n].password`, `apps[n].loginRoute`.
2. If no `loginRoute` is configured for this app → self-skip with note "no loginRoute configured".

**Valid login test:**
3. Navigate to `loginRoute` using `page.goto(loginRoute)`.
4. Locate the email/username field: `page.locator('input[type="email"], input[name*="user"], input[name*="email"], input[id*="email"], input[id*="user"]').first()`.
5. Locate the password field: `page.locator('input[type="password"]').first()`.
6. Fill both fields with the configured credentials using `page.fill(selector, value)`.
7. Submit the form: click `input[type="submit"], button[type="submit"]` or press `Enter`.
8. Wait for navigation: `page.waitForLoadState('networkidle', { timeout: 10000 })`.
9. Check the current URL — if still on the login route → log `loginFailed`.
10. Check for an authenticated landmark (user avatar, logout button, welcome message): `page.locator('[aria-label*="logout"], [href*="logout"], [href*="signout"], button:has-text("Log out"), button:has-text("Sign out")').isVisible()`. If none found and URL is still login → log `loginFailed`.

**Wrong credentials test:**
11. Navigate back to `loginRoute`.
12. Fill the form with deliberately wrong credentials (append `_WRONG` to the password).
13. Submit.
14. Wait 3 s: `page.waitForTimeout(3000)`.
15. Check that an error element is visible: `page.locator('[role="alert"], .error, .alert, [class*="error"], [class*="alert"], text=/invalid|incorrect|wrong|failed|unauthorized/i').isVisible()`.
16. If no error visible AND user appears logged in → log `authErrorNotShown`.
17. If page crashed or shows a stack trace → log `loginFailed` with severity high.

**Logout test:**
18. Re-login with valid credentials (steps 3–10).
19. Click the logout element found in step 10.
20. Wait for navigation: `page.waitForLoadState('networkidle', { timeout: 8000 })`.
21. Try to navigate directly to a known protected path (e.g. `/dashboard`, `/home`, or the first non-login route in the site map).
22. If the protected content is accessible without a login redirect → log `logoutBroken`.

**Protected route test:**
23. Clear all cookies and storage: `page.context().clearCookies()`, `page.evaluate(() => localStorage.clear())`.
24. Navigate directly to a protected route.
25. Wait for load: `page.waitForLoadState('networkidle', { timeout: 8000 })`.
26. If the final URL is NOT the login route and the page shows protected content → log `protectedRouteExposed`.

## Pass / Fail criteria

Pass:
- Valid credentials → URL changes away from loginRoute and an authenticated indicator is visible.
- Wrong credentials → a visible error message appears, no session is created.
- After logout → navigating to a protected route redirects to login.
- Unauthenticated direct access to a protected route → redirected to login.

Fail:
- Valid login does not redirect away from the login page → `loginFailed`.
- Wrong credentials produce no visible error → `authErrorNotShown`.
- After logout, protected content remains accessible → `logoutBroken`.
- Unauthenticated user can access a protected route → `protectedRouteExposed`.

## Issue schema

- type: "loginFailed"
- severity: high
- selector: "input[type='submit'], button[type='submit']"
- description: "Login with valid credentials did not succeed — user remains on login page or no authenticated state detected"

- type: "logoutBroken"
- severity: high
- selector: "logout button or link"
- description: "Logout did not clear the session — protected route '{route}' is still accessible after sign-out"

- type: "protectedRouteExposed"
- severity: high
- selector: null
- description: "Protected route '{route}' is accessible without authentication — no redirect to login"

- type: "authErrorNotShown"
- severity: high
- selector: "login form"
- description: "Login with wrong credentials produced no visible error message — silent failure"

## Scope

applyOn: ["desktop"]
Self-skip conditions: skip if `loginRoute` is not configured in `automation.config.json` for the current app.
