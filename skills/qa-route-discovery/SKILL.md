---
name: qa-route-discovery
description: "Discovers routes, classifies public vs auth-gated, and detects in-page tabs per route. Works for any SPA framework."
---

# QA Route Discovery

## Overview

Produces `{project-root}/.tmp/qa-<run-id>/routes.json` with every unique internal route classified
as public or auth-gated, plus a `tabs` array listing any in-page state tabs on each route.

Works for any SPA framework: Angular, React, Vue, Next.js, or plain HTML.

---

## ⛔ Absolute Prohibitions

- **NEVER** `cd` to any path outside `{project-root}`
- **NEVER** run `node lib/discover-routes.mjs`, `node lib/capture.mjs`, or any pre-existing Node script
- **NEVER** import or require anything from outside `{project-root}/node_modules`
- **WINDOWS:** use PowerShell only — bash heredoc converts `/login` to a Windows filesystem path

---

## Four-Strategy Route Discovery + Tab Detection

| # | Strategy | Covers |
|---|----------|--------|
| 1 | `<a href>` crawl | React Router, Vue Router, Next.js, plain HTML |
| 2 | Router attribute extraction | Angular `[routerLink]`, Vue `[to]`, `[data-route]` |
| 3 | `pushState` / `replaceState` interception | All programmatic navigation (any framework) |
| 4 | Click-based nav discovery | Angular click-routing, sidebars with no `<a>` tags |
| 5 | In-page tab detection | `[role=tab]` without href = view-state tabs, not routes |

**Key: `childElementCount <= 4`** — nav items have icon+text = 2 children. Do NOT use `cursor: pointer`
as a filter; Angular and Vue often use `cursor: auto` on nav items.

**Key: redirect check for tabs** — before recording tabs for a route, verify the browser actually
landed at that route URL. If it redirected (e.g. auth pages redirect to dashboard when logged in),
skip tab detection — those tabs belong to the destination, not the requested route.

**Two browser contexts:**
- Unauthenticated context: Strategy 1 only → classifies public routes
- Authenticated context: Strategies 1–4 + tab detection → classifies auth-gated routes and tabs

---

## Cross-Platform Execution

**Do NOT use a shell heredoc to write the Node.js script.** On Windows, bash heredocs mangle `/login` into a filesystem path. Instead, use the **Write tool** to write the script, then run it with `node`.

### Step 1 — Write the script to disk

Use the **Write tool** to write the Node.js block below to:
```
{project-root}/.tmp/discover-routes.cjs
```

### Step 2 — Run it

**Linux / macOS (bash):**
```bash
QA_BASE_URL="<baseUrl>"      \
QA_EMAIL="<email>"           \
QA_PASSWORD="<password>"     \
QA_LOGIN_PATH="<loginRoute>" \
QA_RUN_DIR="{project-root}/.tmp/<run-id>" \
QA_APP_NAME="<appName>"      \
QA_PROJECT_ROOT="{project-root}" \
node "{project-root}/.tmp/discover-routes.cjs"
```

**Windows (PowerShell):**
```powershell
$env:QA_BASE_URL      = "<baseUrl>"
$env:QA_EMAIL         = "<email>"
$env:QA_PASSWORD      = "<password>"
$env:QA_LOGIN_PATH    = "<loginRoute>"
$env:QA_RUN_DIR       = "{project-root}/.tmp/<run-id>"
$env:QA_APP_NAME      = "<appName>"
$env:QA_PROJECT_ROOT  = "{project-root} — strip \skills\qa-route-discovery from this skill's base directory"

```js
const { chromium } = require(process.env.QA_PROJECT_ROOT + '/node_modules/@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL   = process.env.QA_BASE_URL   || '';
const EMAIL      = process.env.QA_EMAIL      || '';
const PASSWORD   = process.env.QA_PASSWORD   || '';
const LOGIN_PATH = process.env.QA_LOGIN_PATH || '/login';
const RUN_DIR    = process.env.QA_RUN_DIR    || '.tmp/qa-unknown';
const APP_NAME   = process.env.QA_APP_NAME   || 'app';
const MAX_ROUTES = 80;
const sleep      = ms => new Promise(r => setTimeout(r, ms));

const normalise = (href) => {
  try {
    const p = new URL(href, BASE_URL);
    if (p.origin !== new URL(BASE_URL).origin) return null;
    if (/\.(png|jpg|svg|ico|css|js|pdf|zip|woff|ttf)$/i.test(p.pathname)) return null;
    if (p.pathname.startsWith('/api/')) return null;
    if (/^\/loading(\/|$)/.test(p.pathname)) return null;
    return p.pathname.replace(/\/$/, '') || '/';
  } catch { return null; }
};

const injectInterceptor = async (page) => {
  await page.evaluate(() => {
    if (window.__routeInterceptorActive) return;
    window.__routeInterceptorActive = true;
    window.__capturedRoutes = new Set([window.location.pathname]);
    const track = (url) => { try { window.__capturedRoutes.add(new URL(String(url), location.href).pathname.replace(/\/$/, '') || '/'); } catch (_) {} };
    const oP = history.pushState.bind(history); const oR = history.replaceState.bind(history);
    history.pushState    = (s, t, u) => { if (u) track(u); return oP(s, t, u); };
    history.replaceState = (s, t, u) => { if (u) track(u); return oR(s, t, u); };
    window.addEventListener('popstate', () => track(location.pathname));
  });
};
const readIntercepted    = async (page) => page.evaluate(() => [...(window.__capturedRoutes || [])]).catch(() => []);
const harvestAnchors     = async (page) => { const h = await page.$$eval('a[href]', els => els.map(a => a.getAttribute('href'))).catch(() => []); return h.map(normalise).filter(Boolean); };
const harvestRouterAttrs = async (page) => page.evaluate(() => {
  const attrs = ['routerlink', 'ng-reflect-router-link', 'data-route', 'data-href'];
  const routes = new Set();
  document.querySelectorAll('*').forEach(el => { attrs.forEach(a => { const v = el.getAttribute(a); if (v && v.startsWith('/')) routes.add(v.split('?')[0].replace(/\/$/, '') || '/'); }); });
  return [...routes];
}).catch(() => []);

const NAV_CONTAINERS = [
  // Standard nav elements
  'nav','aside','[role=navigation]','[role=menubar]','[role=menu]',
  // Left sidebar variants
  '[class*=sidebar]','[class*=Sidebar]','[class*=sidenav]','[class*=side-nav]',
  '[class*=side-menu]','[class*=drawer]','[class*=Drawer]',
  // Right sidebar variants
  '[class*=rightbar]','[class*=Rightbar]','[class*=right-bar]','[class*=RightBar]',
  '[class*=right-sidebar]','[class*=RightSidebar]','[class*=right-panel]','[class*=RightPanel]',
  '[class*=rightpanel]','[class*=right-nav]','[class*=rightnav]',
  // Settings / user menu (gear icon, avatar dropdown, profile menu)
  '[class*=header]','[class*=Header]','[class*=topbar]','[class*=TopBar]','[class*=top-bar]',
  '[class*=user-menu]','[class*=UserMenu]','[class*=usermenu]',
  '[class*=profile-menu]','[class*=ProfileMenu]','[class*=account-menu]',
  '[class*=settings-menu]','[class*=SettingsMenu]',
  '[class*=dropdown-menu]','[class*=DropdownMenu]',
].join(',');

// Scan visible nav items — returns only items whose text hasn't been seen before
// seenTexts prevents re-queueing the same label after DOM re-renders
const scanNavItems = async (page, seenTexts) => {
  const els = await page.$$(NAV_CONTAINERS + ' *');
  const result = [];
  for (const el of els) {
    const info = await el.evaluate(e => {
      if (!e.offsetParent) return null;
      // Allow up to 8 children — settings items often have icon+text+badge+arrow+tooltip
      if (e.childElementCount > 8) return null;
      const text = e.textContent.trim().replace(/\s+/g, ' ');
      if (text.length < 2 || text.length > 60) return null;
      if (/logout|sign.?out/i.test(text)) return null;
      return text;
    }).catch(() => null);
    if (info && !seenTexts.has(info)) {
      seenTexts.add(info);
      result.push({ el, text: info });
    }
  }
  return result;
};

const clickNavItems = async (page, seen) => {
  const found      = [];
  const seenTexts  = new Set(); // tracks item labels already queued — never re-queued
  const queue      = await scanNavItems(page, seenTexts); // initial scan
  let   attempts   = 0;

  while (queue.length > 0 && attempts < 80) {
    const { el, text } = queue.shift();
    attempts++;
    try {
      const visible = await el.evaluate(e => !!e.offsetParent).catch(() => false);
      if (!visible) continue;

      const urlBefore = normalise(page.url());
      await el.click().catch(() => {});
      await sleep(1500);

      const urlAfter = normalise(page.url());

      if (urlAfter && !seen.has(urlAfter)) {
        seen.add(urlAfter);
        found.push(urlAfter);
        console.log('[route-discovery] [click] ' + text.slice(0,25).padEnd(25) + ' -> ' + urlAfter);
      }

      // URL did NOT change → this item expanded a sub-menu (e.g. "Settings >")
      // Re-scan immediately so newly visible sub-items join the queue
      if (urlAfter === urlBefore) {
        const newItems = await scanNavItems(page, seenTexts); // seenTexts filters duplicates
        if (newItems.length > 0) {
          console.log('[route-discovery] [expand] ' + text.slice(0,25).trim() + ' revealed ' + newItems.length + ' sub-item(s)');
          queue.unshift(...newItems); // prepend so sub-items are clicked before moving on
        }
      }

      for (const r of await readIntercepted(page)) { const n = normalise(r); if (n && !seen.has(n)) { seen.add(n); found.push(n); } }
    } catch (_) {}
  }
  return found;
};

// Classify [role=tab] elements by clicking each one and observing the URL.
// Returns { viewStateTabs: string[], newRoutes: string[] }
//   viewStateTabs → URL stayed the same → content swap only → stored in tabs[]
//   newRoutes     → URL changed         → these are real routes → added to routes[]
const classifyTabs = async (page, expectedPath, seen, routes, publicSet) => {
  if (normalise(page.url()) !== expectedPath) return { viewStateTabs: [], newRoutes: [] };

  // Collect tab labels without clicking anything yet
  const tabLabels = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('[role=tab]').forEach(el => {
      if (!el.offsetParent) return;
      const href = el.getAttribute('href');
      const text = el.textContent.trim().replace(/\s+/g, ' ').replace(/\s*\d+\s*$/, '').trim();
      if (text.length < 2 || text.length > 60) return;
      result.push({ text, href: href || null });
    });
    return [...new Map(result.map(t => [t.text, t])).values()];
  }).catch(() => []);

  const viewStateTabs = [];
  const newRoutes     = [];

  for (const { text, href } of tabLabels) {
    // Tab has an href — treat it directly as a route without clicking
    if (href) {
      const n = normalise(href);
      if (n && !seen.has(n)) {
        seen.add(n);
        newRoutes.push(n);
        routes.push({ path: n, title: '', requiresAuth: !publicSet.has(n), tabs: [] });
        console.log('[route-discovery] [tab-href] ' + text.slice(0,25).padEnd(25) + ' -> ' + n);
      }
      continue;
    }

    // No href — navigate fresh to expectedPath, then click this tab and observe URL
    await page.goto(BASE_URL + expectedPath, { waitUntil: 'networkidle', timeout: 12000 }).catch(() => {});
    await sleep(500);

    const tabEl = page.locator('[role=tab]').filter({ hasText: new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    if (await tabEl.count() === 0) continue;

    await tabEl.first().click().catch(() => {});
    await sleep(800);

    const urlAfter = normalise(page.url());

    if (urlAfter && urlAfter !== expectedPath) {
      // URL changed → this tab is a real route
      if (!seen.has(urlAfter)) {
        seen.add(urlAfter);
        newRoutes.push(urlAfter);
        routes.push({ path: urlAfter, title: '', requiresAuth: !publicSet.has(urlAfter), tabs: [] });
        console.log('[route-discovery] [tab-route] ' + text.slice(0,25).padEnd(25) + ' -> ' + urlAfter);
      }
    } else {
      // URL unchanged → genuine view-state tab (content swap, no navigation)
      viewStateTabs.push(text);
      console.log('[route-discovery] [tab-state] ' + text.slice(0,25).padEnd(25) + ' (view state on ' + expectedPath + ')');
    }
  }

  return { viewStateTabs: [...new Set(viewStateTabs)], newRoutes };
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const seen = new Set(); const routes = []; const publicSet = new Set();

  // Phase 1 — unauthenticated crawl
  {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 20000 }); await sleep(500);
    for (const r of await harvestAnchors(page)) { if (!seen.has(r)) { seen.add(r); publicSet.add(r); routes.push({ path: r, title: '', requiresAuth: false, tabs: [] }); } }
    try { const c = normalise(page.url()); if (c && !seen.has(c)) { seen.add(c); publicSet.add(c); routes.push({ path: c, title: '', requiresAuth: false, tabs: [] }); } } catch(_){}
    await ctx.close();
    console.log('[route-discovery] Public routes:', publicSet.size);
  }

  // Phase 2 — authenticated crawl (all 4 strategies) + tab detection
  let loginSucceeded = false;
  if (EMAIL && PASSWORD) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL + LOGIN_PATH, { waitUntil: 'networkidle', timeout: 20000 }); await sleep(1500);
      const emailSel = 'input[type=email], input[name=email], input[name=username], input[id*=email i]';
      if (await page.locator(emailSel).count() > 0) {
        await page.locator(emailSel).first().fill(EMAIL);
        await page.locator('input[type=password]').first().fill(PASSWORD);
        await injectInterceptor(page);
        await page.locator('button[type=submit], input[type=submit]').first().click();
        await sleep(5000);
        loginSucceeded = !page.url().includes(LOGIN_PATH);
      }
      console.log('[route-discovery] Login:', loginSucceeded ? 'succeeded' : 'failed');

      if (loginSucceeded) {
        await injectInterceptor(page);
        for (const r of await harvestAnchors(page))     { if (!seen.has(r)) { seen.add(r); routes.push({ path: r, title: '', requiresAuth: !publicSet.has(r), tabs: [] }); } }
        for (const r of await harvestRouterAttrs(page)) { const n = normalise(r); if (n && !seen.has(n)) { seen.add(n); routes.push({ path: n, title: '', requiresAuth: true, tabs: [] }); } }
        for (const r of await clickNavItems(page, seen)) { routes.push({ path: r, title: '', requiresAuth: !publicSet.has(r), tabs: [] }); }
        for (const r of await readIntercepted(page))    { const n = normalise(r); if (n && !seen.has(n)) { seen.add(n); routes.push({ path: n, title: '', requiresAuth: !publicSet.has(n), tabs: [] }); } }

        console.log('[route-discovery] Scanning routes for tabs...');
        // Use a live queue so tab-routes discovered mid-scan are also scanned
        const tabScanQueue = [...routes];
        const tabScanned   = new Set();
        let   tabScanCount = 0;

        while (tabScanQueue.length > 0 && tabScanCount < MAX_ROUTES) {
          const r = tabScanQueue.shift();
          if (tabScanned.has(r.path)) continue;
          tabScanned.add(r.path);
          tabScanCount++;
          try {
            await page.goto(BASE_URL + r.path, { waitUntil: 'networkidle', timeout: 12000 });
            await sleep(600);
            r.title = await page.title().catch(() => r.path);
            const { viewStateTabs, newRoutes } = await classifyTabs(page, r.path, seen, routes, publicSet);
            r.tabs = viewStateTabs;
            if (r.tabs.length > 0)   console.log('[route-discovery] [view-state-tabs] ' + r.path + ' -> ' + r.tabs.join(' | '));
            if (newRoutes.length > 0) console.log('[route-discovery] [tab-routes] ' + r.path + ' -> ' + newRoutes.join(' | '));
            // Enqueue newly discovered tab-routes so their own tabs get scanned too
            for (const np of newRoutes) {
              const nr = routes.find(x => x.path === np);
              if (nr) tabScanQueue.push(nr);
            }
          } catch(_) {}
        }
      }
    } catch(e) { console.warn('[route-discovery] error:', e.message); }
    await ctx.close();
  }

  await browser.close();
  if (!seen.has('/')) routes.unshift({ path: '/', title: 'Home', requiresAuth: false, tabs: [] });

  const output = { runId: path.basename(RUN_DIR), discoveredAt: new Date().toISOString(), app: APP_NAME, baseUrl: BASE_URL, loginSucceeded, routes };
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, 'routes.json'), JSON.stringify(output, null, 2));

  const pub      = routes.filter(r => !r.requiresAuth).length;
  const auth     = routes.filter(r =>  r.requiresAuth).length;
  const withTabs = routes.filter(r => r.tabs && r.tabs.length > 0).length;
  console.log('[route-discovery] runDir: ' + RUN_DIR);
  console.log('[route-discovery] Found ' + routes.length + ' routes (' + pub + ' public, ' + auth + ' auth-gated, ' + withTabs + ' with in-page tabs)');
  routes.forEach(r => {
    const tabStr = r.tabs && r.tabs.length ? '\n      tabs: ' + r.tabs.join(' | ') : '';
    console.log('  ' + (r.requiresAuth ? 'AUTH' : 'PUB ') + ' ' + r.path + tabStr);
  });
})();
```

node "{project-root}/.tmp/discover-routes.cjs"

### Step 3 — Clean up

After the script exits, delete `{project-root}/.tmp/discover-routes.cjs`.

---

### Node.js Script (write this via the Write tool)

---

## Output Schema

```json
{
  "runId": "qa-20260520-abc1",
  "app": "myapp",
  "loginSucceeded": true,
  "routes": [
    { "path": "/login",      "title": "My App",      "requiresAuth": false, "tabs": [] },
    { "path": "/dashboard",  "title": "My App",      "requiresAuth": true,
      "tabs": ["Overview", "Details", "History"]
    },
    { "path": "/settings",   "title": "My App",      "requiresAuth": true,  "tabs": [] }
  ]
}
```

The `tabs` array is consumed by the QA spec generator to produce one test cell per tab on routes
that have in-page tabbed content.

---

## Hard Limits

| Rule | Value |
|------|-------|
| Max routes | 80 |
| Per-page timeout | 20 s |
| Post-login wait | 5 s (SPA redirect chain) |
| Nav click wait | 1.5 s per item |
| Tab scan wait | 0.6 s per route |
| Skip | `/api/*`, `/loading/*`, static assets, external origins, logout items |
| Tab redirect check | Tabs only recorded when `normalise(page.url()) === r.path` |

---

## Framework Coverage

| Framework | Strategy 1 | Strategy 2 | Strategy 3 | Strategy 4 |
|-----------|-----------|-----------|-----------|-----------|
| React Router | ✅ | – | ✅ | – |
| Vue Router | ✅ | `[to]` ✅ | ✅ | – |
| Angular Router | ❌ | `[routerLink]` ✅ | ✅ | ✅ |
| Next.js | ✅ | – | ✅ | – |
| Plain HTML | ✅ | – | – | – |

