---
name: qa-test-permissions
section: interactive
description: "Tests role-based access control at the UI level: tries accessing admin-only routes, checks if restricted actions are visually blocked (disabled buttons, hidden elements, redirect), verifies unauthorized API responses show proper UI feedback. Works with the current logged-in user's session."
model: sonnet
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
---

# qa-test-permissions — Role-Based Access Control Testing

Tests what the current logged-in user can and cannot do. Catches: admin routes accessible to non-admins, action buttons that should be disabled but aren't, missing authorization feedback when access is denied.

**Works with the CURRENT session** — does not switch users or log out. Tests from the perspective of whoever is logged in.

## What it checks (7 issue types)

| issueType | severity | what it catches |
|---|---|---|
| `adminRouteAccessible` | high | Route containing `/admin`, `/settings`, `/users`, `/config`, `/manage` returned content (not a redirect or 403) for the current user |
| `restrictedActionNotBlocked` | high | A button/action that looks like it should be role-restricted (Delete All, Manage Users, System Settings) is clickable and not disabled |
| `unauthorizedNoBoundary` | high | Navigating to a restricted route showed page content instead of a 401/403/redirect-to-login |
| `sensitiveDataExposed` | high | A route the current user should not access showed another user's PII or admin-only data |
| `missingRoleIndicator` | medium | User is logged in but no role/permission indicator (badge, menu item list, profile label) is visible anywhere |
| `actionWithoutConfirmation` | medium | A destructive role-restricted action (e.g., "Delete All Records", "Reset System") is accessible with single click and no confirmation |
| `permissionErrorNoFeedback` | medium | An action was blocked by the server (4xx response) but the UI showed no error message to the user |

## Self-skip conditions

Skip if the current page is a login/auth page (no session active).
Skip if `probe.detectAuthState` returns `{loggedIn: false}`.

## Orchestrator flow

### Step 1 — Confirm session is active

```
authState = browser_evaluate(probe.detectAuthState)
If !authState.loggedIn → self-skip
```

### Step 2 — Check for role indicator

```
roleIndicator = browser_evaluate(probe.findRoleIndicator)
If !roleIndicator.found → emit missingRoleIndicator (medium)
  evidence: {currentUser: authState.userHint}
```

### Step 3 — Probe admin-only routes

For each candidate admin route (derived from current baseUrl):
- `{baseUrl}/admin`, `{baseUrl}/users`, `{baseUrl}/settings`, `{baseUrl}/manage`, `{baseUrl}/system`, `{baseUrl}/config`

```
For each candidateRoute (max 4):
  a. browser_navigate({url: candidateRoute, waitUntil: 'domcontentloaded', timeout: 8000})
  b. browser_wait_for(time=600)
  c. result = browser_evaluate(probe.checkRouteAccessResult, {expectedRestricted: true})
  d. If result.status === 'accessible' AND result.hasContent:
     → emit adminRouteAccessible (high)
       evidence: {route: candidateRoute, pageTitle: result.pageTitle, contentPreview: result.contentPreview}
  e. browser_navigate({url: cell.route}) — return to original route
  f. browser_wait_for(time=500)
```

### Step 4 — Check dangerous actions on current page

```
browser_navigate({url: baseUrl + cell.route, waitUntil: 'domcontentloaded'})
browser_wait_for(time=600)

dangerousActions = browser_evaluate(probe.findDangerousActions)
For each action in dangerousActions (max 3):
  a. If action.isClickable AND !action.hasConfirm:
     → emit actionWithoutConfirmation (medium)
       evidence: {actionLabel: action.label, selector: action.selector}
  b. If action.isClickable AND roleIndicator.role === 'viewer' or 'user' (non-admin):
     → emit restrictedActionNotBlocked (high)
       evidence: {actionLabel: action.label, currentRole: roleIndicator.role}
```

### Step 5 — Monitor for silent permission failures

```
networkErrors = browser_evaluate(probe.checkNetworkErrors403)
For each error in networkErrors:
  → emit permissionErrorNoFeedback (medium)
    evidence: {url: error.url, status: error.status}
```

## Probes (browser_evaluate)

```js
// probe.detectAuthState
() => {
  // Heuristics to detect if user is logged in
  const loginIndicators = document.querySelector(
    '[class*="user-menu"], [class*="user-profile"], [class*="avatar"], ' +
    'mat-toolbar [aria-label*="user" i], [class*="logout"], [class*="sign-out"], ' +
    '[aria-label*="logout" i], [data-testid*="user"], [class*="user-name"]'
  );
  const loginPage = /\b(login|sign.?in|authenticate)\b/i.test(document.title + location.pathname);
  const hasSessionCookie = document.cookie.length > 0;
  const bodyText = (document.body.innerText || '').slice(0, 500).toLowerCase();
  const hasLogoutText = /\b(logout|sign\s*out|log\s*out)\b/.test(bodyText);

  // Try to read a displayed username
  const userEl = document.querySelector('[class*="user-name"], [class*="username"], [class*="display-name"]');
  const userHint = userEl ? (userEl.innerText || '').trim().slice(0, 60) : null;

  return {
    loggedIn: !loginPage && (!!loginIndicators || hasLogoutText),
    userHint,
    hasSessionCookie
  };
}
```

```js
// probe.findRoleIndicator
() => {
  // Look for role/permission labels in the UI
  const roleCandidates = document.querySelectorAll(
    '[class*="role"], [class*="permission"], [class*="user-type"], ' +
    'mat-chip[color="primary"], mat-chip[color="accent"], ' +
    '[data-testid*="role"], [aria-label*="role" i], [class*="badge"][class*="role"]'
  );
  for (const el of roleCandidates) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const txt = (el.innerText || el.getAttribute('aria-label') || '').trim();
    if (txt.length >= 2 && txt.length <= 50) {
      return { found: true, role: txt.toLowerCase(), selector: el.tagName.toLowerCase() };
    }
  }
  // Fallback: look for role text in the user menu or profile area
  const profileArea = document.querySelector('[class*="user-info"], [class*="profile"], mat-toolbar');
  if (profileArea) {
    const txt = profileArea.innerText || '';
    const roleMatch = txt.match(/\b(admin|administrator|super\s*admin|manager|viewer|editor|staff|operator|user|member)\b/i);
    if (roleMatch) return { found: true, role: roleMatch[0].toLowerCase(), selector: 'header/toolbar' };
  }
  return { found: false };
}
```

```js
// probe.checkRouteAccessResult — args: { expectedRestricted }
({expectedRestricted}) => {
  const status = (() => {
    // Check for 403/401/redirect indicators
    const bodyText = (document.body.innerText || '').slice(0, 500);
    if (/403|forbidden|unauthorized|access denied|not authorized/i.test(bodyText + document.title)) return 'blocked';
    if (location.pathname.includes('/login') || location.pathname.includes('/auth')) return 'redirected';
    if (document.body.innerText.length < 100) return 'empty';
    return 'accessible';
  })();
  return {
    status,
    hasContent: document.body.innerText.length > 200,
    pageTitle: document.title.slice(0, 100),
    contentPreview: (document.body.innerText || '').slice(0, 200)
  };
}
```

```js
// probe.findDangerousActions
() => {
  const dangerousLabels = /\b(delete all|remove all|reset|purge|clear all|destroy|wipe|manage users|grant|revoke|impersonate|system\s+settings|export all|bulk delete)\b/i;
  const out = [];
  for (const btn of document.querySelectorAll('button, [role="button"], a[role="button"]')) {
    const r = btn.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = (btn.innerText || btn.getAttribute('aria-label') || btn.title || '').trim();
    if (!dangerousLabels.test(label)) continue;
    const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || getComputedStyle(btn).pointerEvents === 'none';
    btn.setAttribute('data-argus-danger', String(out.length));
    out.push({
      selector: `[data-argus-danger="${out.length}"]`,
      label: label.slice(0, 80),
      isClickable: !isDisabled,
      hasConfirm: btn.getAttribute('data-confirm') != null || btn.getAttribute('onclick', '').includes('confirm')
    });
    if (out.length >= 5) break;
  }
  return out;
}
```

```js
// probe.checkNetworkErrors403
() => {
  // Read any network error state already captured in the DOM (Angular HttpErrorInterceptors often set data attributes)
  const errorEls = [...document.querySelectorAll('[data-status="403"], [data-status="401"], [data-http-error]')];
  const out = [];
  for (const el of errorEls.slice(0, 5)) {
    const status = el.getAttribute('data-status') || el.getAttribute('data-http-error');
    // Check if UI shows an error message for this
    const hasVisibleError = !!document.querySelector('[role="alert"], mat-error, [class*="error-state"]');
    if (!hasVisibleError) {
      out.push({ url: el.getAttribute('data-url') || location.href, status });
    }
  }
  return out;
}
```

```js
// probe.cleanupPermissions
() => {
  for (const el of document.querySelectorAll('[data-argus-danger]')) {
    try { el.removeAttribute('data-argus-danger'); } catch (_) {}
  }
  return { ok: true };
}
```

Always run `probe.cleanupPermissions` at the end.

## Hard rules

1. **Read-only probing** — never submit forms, never modify data during permission testing.
2. **Return to original route** after each admin route probe.
3. **Sonnet model** — role/access interpretation requires semantic judgment.
4. **Do NOT log out** — the skill operates within the current session only.
