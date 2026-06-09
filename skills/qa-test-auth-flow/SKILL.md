---
name: qa-test-auth-flow
section: interactive
description: "Tests login, logout, and protected route redirect"
model: sonnet
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Only run on routes containing `login`, `signin`, or `auth` in the path. Skip if no email/password in config.

## Tests

**Test 1 — Valid login:**
- browser_navigate({url: baseUrl + loginPath, waitUntil: 'domcontentloaded', timeout: 15000})
- browser_wait_for(time=500) — allow Angular change detection to settle
- Fill `input[type="email"], input[name="email"], input[name="username"], input[id*="email" i]` (first) via browser_type or browser_fill_form
- Fill `input[type="password"]` (first)
- Click `button[type="submit"], input[type="submit"], button:not([type])` (first) via browser_click
- browser_wait_for(time=2000) — Angular SPA route change instead of networkidle (never resolves)
- currentUrl = browser_evaluate(() => location.href)
- If currentUrl still contains loginPath → loginFailed (critical)

**Test 2 — Logout:**
- Find `button[aria-label*="logout" i], button[aria-label*="sign out" i], a[href*="logout"], [data-testid*="logout"], mat-icon:has-text("logout")` (first, visible) via browser_evaluate(probe.findLogoutButton)
- browser_click(logoutSelector)
- browser_wait_for(time=1500)
- currentUrl = browser_evaluate(() => location.href)
- If URL does NOT contain `login` or `signin` and is not `baseUrl + '/'` → logoutNotRedirected (medium)

**Test 3 — Protected route redirect (session-clearing via JS instead of page.context().clearCookies() which is unavailable in MCP):**
- browser_evaluate(probe.clearSessionStorage) — clears localStorage, sessionStorage, and all document.cookie entries accessible via JS
- browser_navigate({url: baseUrl + (cell.route.includes('dashboard') ? cell.route : '/dashboard'), waitUntil: 'domcontentloaded'})
- browser_wait_for(time=1000)
- currentUrl = browser_evaluate(() => location.href)
- If URL does NOT contain `login` or `signin` → noProtectedRouteRedirect (high)

**Probes for auth-flow:**

```js
// probe.findLogoutButton
() => {
  const logoutRe = /\b(log\s*out|sign\s*out|logout|signout)\b/i;
  const candidates = [...document.querySelectorAll(
    'button, a, [role="button"], mat-menu-item'
  )].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const match = candidates.find(el =>
    logoutRe.test(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '')
  );
  if (match) {
    match.setAttribute('data-argus-logout', '1');
    return { found: true, selector: '[data-argus-logout="1"]' };
  }
  // Check user profile menu for logout item
  const profileBtn = document.querySelector('[aria-label*="account" i], [aria-label*="profile" i], [class*="user-menu"] button');
  if (profileBtn) {
    profileBtn.setAttribute('data-argus-profile-btn', '1');
    return { found: true, selector: '[data-argus-profile-btn="1"]', needsMenuExpand: true };
  }
  return { found: false };
}
```

```js
// probe.clearSessionStorage — JS-only session clearing (replaces page.context().clearCookies() which is MCP-unavailable)
() => {
  try { localStorage.clear(); } catch (_) {}
  try { sessionStorage.clear(); } catch (_) {}
  // Clear accessible cookies (HttpOnly cookies cannot be cleared via JS — that is expected behavior)
  try {
    document.cookie.split(';').forEach(c => {
      const name = c.trim().split('=')[0];
      document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });
  } catch (_) {}
  return { cleared: true, note: 'HttpOnly cookies remain (server-controlled)' };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| loginFailed | critical | "Login with provided credentials failed — still on {url}" |
| loginError | critical | "Login flow threw an error: {msg}" |
| logoutNotRedirected | medium | "Logout did not redirect to login page — landed on {url}" |
| noProtectedRouteRedirect | high | "Accessing \"{path}\" while logged out did not redirect to login — landed on {url}" |
