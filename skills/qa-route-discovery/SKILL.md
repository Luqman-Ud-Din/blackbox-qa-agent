---
name: qa-route-discovery
description: "Discovers routes, classifies public vs auth-gated, and detects in-page tabs per route. Works for any SPA framework."
model: sonnet
---

# QA Route Discovery

## Purpose
Produce `{project-root}/.tmp/qa-<run-id>/routes.json` with every unique internal route classified as public or auth-gated, plus a `tabs` array listing any in-page state tabs on each route.

Works for any SPA framework: Angular, React, Vue, Next.js, plain HTML — anything Playwright can navigate.

---

## Strategy (orchestrator follows these steps via Playwright MCP)

Run two passes — unauthenticated then authenticated.

### Pass 1 — Public routes (unauthenticated context)
1. `browser_navigate(url = baseUrl + '/')` — fresh session, no cookies
2. `browser_evaluate(probe.harvestAnchors)` — collect all visible `<a href>` pointing at the same origin
3. Normalise each href (strip query string, lowercase host, drop trailing slash)
4. Record each normalised path as `{ path, requiresAuth: false, tabs: [] }`

### Pass 2 — Auth-gated routes (authenticated context)
1. `browser_navigate(url = baseUrl + loginPath)`
2. `browser_type(input[type=email] / input[name=email], value = email)`
3. `browser_type(input[type=password], value = password)` — mask password in all output
4. `browser_click(button[type=submit])`
5. `browser_wait_for(time = 5000)` — SPA redirect chain
6. If post-login URL still matches loginPath → record `loginSucceeded: false` and SKIP pass 2
7. Inject route interceptor: `browser_evaluate(probe.injectInterceptor)`
8. Harvest with FOUR strategies (orchestrator calls each in sequence):
   - `probe.harvestAnchors` — `<a href>` (React Router, Vue Router, Next.js, plain HTML)
   - `probe.harvestRouterAttrs` — `[routerlink]`, `[data-route]`, `[data-href]` (Angular)
   - `probe.readIntercepted` — `pushState` / `replaceState` history events
   - `probe.scanNavItems` + `browser_click(item)` — sidebar/header click-based nav
9. For each discovered route, navigate to it, run `probe.classifyTabs` to detect view-state tabs

### Tab classification (per route)
For each route, after navigation:
1. `browser_evaluate(probe.collectTabLabels)` — find visible `[role=tab]` elements
2. For each tab:
   - If tab has `href` → treat as separate route, record under `routes[]`
   - Else: navigate fresh to expectedPath, `browser_click(tab.text)`, check if URL changed:
     - URL unchanged → genuine view-state tab → add to `route.tabs[]`
     - URL changed → it's actually a route, add to `routes[]`

---

## Probes (browser_evaluate)

```js
// probe.harvestAnchors
() => {
  return [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(Boolean);
}
```

```js
// probe.harvestRouterAttrs
() => {
  const attrs = ['routerlink','ng-reflect-router-link','data-route','data-href'];
  const out = new Set();
  document.querySelectorAll('*').forEach(el => {
    attrs.forEach(a => {
      const v = el.getAttribute(a);
      if (v && v.startsWith('/')) out.add(v.split('?')[0].replace(/\/$/, '') || '/');
    });
  });
  return [...out];
}
```

```js
// probe.injectInterceptor (call once before authenticated harvest)
() => {
  if (window.__rd) return;
  window.__rd = true;
  window.__rdRoutes = new Set([location.pathname]);
  const track = u => { try { window.__rdRoutes.add(new URL(String(u), location.href).pathname.replace(/\/$/, '') || '/'); } catch {} };
  const oP = history.pushState.bind(history), oR = history.replaceState.bind(history);
  history.pushState = (s, t, u) => { if (u) track(u); return oP(s, t, u); };
  history.replaceState = (s, t, u) => { if (u) track(u); return oR(s, t, u); };
  addEventListener('popstate', () => track(location.pathname));
}
```

```js
// probe.readIntercepted
() => [...(window.__rdRoutes || [])]
```

```js
// probe.scanNavItems  — returns up to 80 visible nav-item labels not yet clicked
(seen) => {
  const containers = 'nav,aside,[role=navigation],[role=menubar],[role=menu],' +
    '[class*=sidebar],[class*=Sidebar],[class*=sidenav],[class*=side-nav],[class*=drawer],' +
    '[class*=rightbar],[class*=right-panel],[class*=rightpanel],' +
    '[class*=header],[class*=Header],[class*=topbar],[class*=top-bar],' +
    '[class*=user-menu],[class*=profile-menu],[class*=account-menu],' +
    '[class*=settings-menu],[class*=dropdown-menu]';
  const out = [];
  const seenSet = new Set(seen || []);
  for (const el of document.querySelectorAll(containers + ' *')) {
    if (out.length >= 80) break;
    if (!el.offsetParent) continue;
    if (el.childElementCount > 8) continue;
    const t = (el.textContent || '').trim().replace(/\s+/g,' ');
    if (t.length < 2 || t.length > 60) continue;
    if (/logout|sign.?out/i.test(t)) continue;
    if (seenSet.has(t)) continue;
    seenSet.add(t);
    out.push(t);
  }
  return out;
}
```

```js
// probe.collectTabLabels
() => {
  const out = [];
  document.querySelectorAll('[role=tab]').forEach(el => {
    if (!el.offsetParent) return;
    const href = el.getAttribute('href');
    const text = (el.textContent || '').trim().replace(/\s+/g,' ').replace(/\s*\d+\s*$/,'').trim();
    if (text.length < 2 || text.length > 60) return;
    out.push({ text, href: href || null });
  });
  return [...new Map(out.map(t => [t.text, t])).values()];
}
```

---

## Normalisation rules (orchestrator applies after every harvest)

```js
// Pseudocode — apply to every href the orchestrator collects
function normalise(href, baseUrl) {
  const u = new URL(href, baseUrl);
  if (u.origin !== new URL(baseUrl).origin) return null;
  if (/\.(png|jpg|svg|ico|css|js|pdf|zip|woff|ttf)$/i.test(u.pathname)) return null;
  if (u.pathname.startsWith('/api/')) return null;
  if (/^\/loading(\/|$)/.test(u.pathname)) return null;
  return u.pathname.replace(/\/$/, '') || '/';
}
```

Deduplicate by the normalised path. Skip routes already in `qa-state.json → routes.skipped`. Cap total routes at 80.

---

## Output schema

Write to `{project-root}/.tmp/qa-<run-id>/routes.json`:

```json
{
  "runId": "qa-20260520-abc1",
  "discoveredAt": "ISO-8601",
  "app": "myapp",
  "baseUrl": "https://...",
  "loginSucceeded": true,
  "routes": [
    { "path": "/login",      "title": "Sign in",  "requiresAuth": false, "tabs": [] },
    { "path": "/dashboard",  "title": "Home",     "requiresAuth": true,
      "tabs": ["Overview", "Details", "History"] },
    { "path": "/settings",   "title": "Settings", "requiresAuth": true,  "tabs": [] }
  ]
}
```

The `tabs` array is consumed by `qa-phase-strategy` (propagates into cells) and the orchestrator (per-tab detection in Step 5.6).

---

## Hard limits

| Rule | Value |
|------|-------|
| Max routes | 80 |
| Per-page navigate timeout | 20 s |
| Post-login wait | 5 s (SPA redirect chain) |
| Nav click wait | 1.5 s per item |
| Tab scan wait | 0.6 s per route |
| Skip | `/api/*`, `/loading/*`, static assets, external origins, logout items |
| Tab redirect check | Tabs only recorded when current URL matches the expected route after navigation |

---

## Fallback when Playwright MCP is unavailable

When MCP is not detected, the orchestrator MUST use the Write+Run pattern (NOT heredoc — see qa-argus Hard Stop Rule #5).

### Required two-step pattern

**Step A — Write the discovery script via the Write tool** to `{project-root}/.tmp/{runId}/discover.cjs`. The script must:

- `require` Playwright from `{project-root}/node_modules/@playwright/test`
- Read `process.env.QA_BASE_URL`, `QA_EMAIL`, `QA_PASSWORD`, `QA_LOGIN_PATH`, `QA_RUN_DIR`
- Implement every probe from the **Probes** section above inline as JavaScript functions
- Run the two-pass strategy (unauthenticated → authenticated → tab classification)
- Write `{QA_RUN_DIR}/routes.json` directly to disk
- Exit with code 0

**Step B — Run it via the Bash tool** with environment variables set inline:

```bash
QA_BASE_URL="..." QA_EMAIL="..." QA_PASSWORD="..." QA_LOGIN_PATH="/login" QA_RUN_DIR="{abs}/.tmp/{runId}" \
  node "{abs-project-root}/.tmp/{runId}/discover.cjs"
```

Or PowerShell:
```powershell
$env:QA_BASE_URL = "..."
$env:QA_EMAIL = "..."
$env:QA_PASSWORD = "..."
$env:QA_LOGIN_PATH = "/login"
$env:QA_RUN_DIR = "{abs}/.tmp/{runId}"
node "{abs-project-root}/.tmp/{runId}/discover.cjs"
```

### FORBIDDEN patterns

These DO NOT work cross-platform (especially Windows) and MUST NEVER be used:

```bash
# ❌ FORBIDDEN — heredoc with embedded JS breaks on Windows
node - <<'EOF'
  const x = `${something}`;
EOF

# ❌ FORBIDDEN — node -e with JS containing backticks or quotes
node -e "const x = `foo`;"

# ❌ FORBIDDEN — bash -c with JS embedded
bash -c "node -e 'const x = \`foo\`;'"
```

The Write tool sends file content as raw bytes — no shell escaping needed. Always use it for scripts longer than 3 lines or containing JS template literals, regex, or special characters.
