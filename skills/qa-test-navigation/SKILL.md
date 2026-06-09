---
name: qa-test-navigation
section: interactive
description: "Verify internal nav links resolve, tabs switch content, and deep links load. Fully MCP-native — uses browser_navigate, browser_click, browser_navigate_back, browser_evaluate. No raw Playwright page.locator/page.goBack/networkidle."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

# QA Test — Navigation (MCP-native rewrite)

## What it tests

- Every visible internal link either changes the URL or transitions to a different view
- No link lands on a blank page, a 404, or an error page
- Tab components switch the visible panel content when clicked
- Direct deep-link to the cell's route loads real content (not a 404)

## Orchestrator flow

### Step 1 — Collect internal links

```
links = browser_evaluate(probe.collectInternalLinks)
// Returns [{idx, selector, href, text}], max 10 items
If links.length === 0 → skip link testing
```

### Step 2 — Test each link (max 8)

```
startUrl = browser_evaluate(() => location.href)

For each link in links (max 8):
  a. browser_click(selector=link.selector)
  b. browser_wait_for(time=800)  ← Angular route change settle, NOT networkidle
  c. newUrl = browser_evaluate(() => location.href)
  d. errorState = browser_evaluate(probe.checkPageError)

  e. If newUrl === startUrl AND !errorState.hasContentChange:
     → emit navItemDead (medium)
       evidence: {href: link.href, text: link.text}

  f. If errorState.hasError:
     → emit navLinkBroken (high)
       evidence: {href: link.href, errorText: errorState.errorText}

  g. browser_navigate_back()
  h. browser_wait_for(time=600)
  i. restoredUrl = browser_evaluate(() => location.href)
  // If back didn't work, navigate explicitly to recover
  j. If restoredUrl !== startUrl:
       browser_navigate({url: startUrl, waitUntil: 'domcontentloaded'})
       browser_wait_for(time=500)
```

### Step 3 — Test tab components

```
tabs = browser_evaluate(probe.collectTabs)
// Returns [{idx, selector, label}], max 4 tabs

If tabs.length >= 2:
  For each tab in tabs (max 3, skip tab[0] which is usually already active):
    a. panelBefore = browser_evaluate(probe.getActivePanelText)
    b. browser_click(selector=tabs[i].selector)
    c. browser_wait_for(time=500)
    d. panelAfter = browser_evaluate(probe.getActivePanelText)

    e. If panelBefore.text === panelAfter.text AND panelBefore.text.length > 10:
       → emit tabSwitchNoEffect (high)
         evidence: {tabLabel: tabs[i].label}
```

### Step 4 — Deep-link test

```
browser_navigate({url: baseUrl + cell.route, waitUntil: 'domcontentloaded', timeout: 10000})
browser_wait_for(time=600)
deepLinkState = browser_evaluate(probe.checkPageError)
If deepLinkState.hasError:
  → emit routeDeepLinkFails (high)
    evidence: {route: cell.route, errorText: deepLinkState.errorText}
```

### Step 5 — Cleanup

```
browser_evaluate(probe.cleanupNavigation)
```

## Probes (browser_evaluate)

```js
// probe.collectInternalLinks
() => {
  const seen = new Set();
  const out = [];
  const currentPath = location.pathname;

  for (const a of document.querySelectorAll('a[href]')) {
    if (out.length >= 10) break;
    const r = a.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(a);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const href = a.getAttribute('href') || '';
    // Only internal links
    if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (href === '#' || href === '' || href === currentPath) continue;
    if (href.startsWith('javascript:')) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    const idx = out.length;
    a.setAttribute('data-argus-nav', String(idx));
    out.push({
      idx,
      selector: `[data-argus-nav="${idx}"]`,
      href,
      text: (a.innerText || a.getAttribute('aria-label') || href).trim().slice(0, 60)
    });
  }
  return out;
}
```

```js
// probe.checkPageError
() => {
  const title = (document.title || '').toLowerCase();
  const bodyText = (document.body.innerText || '').slice(0, 600).toLowerCase();
  const combined = title + ' ' + bodyText;
  const hasError = /\b(404|not found|page not found|something went wrong|error loading|access denied|forbidden)\b/.test(combined);
  const isEmpty = (document.body.innerText || '').trim().length < 80;

  // Angular Material: check if a real mat-card or mat-toolbar is present (content loaded)
  const hasAngularContent = !!(
    document.querySelector('mat-card, mat-toolbar, mat-sidenav-content, router-outlet + *') ||
    document.querySelectorAll('[class*="mat-"]').length > 3
  );

  // Content change heuristic (did the page content change from the startUrl page?)
  const headingText = (document.querySelector('h1, h2, mat-card-title, mat-toolbar') || {}).innerText || '';
  return {
    hasError: (hasError && !hasAngularContent) || isEmpty,
    hasContentChange: hasAngularContent || document.body.innerText.length > 200,
    errorText: hasError ? bodyText.slice(0, 100) : null,
    headingText: headingText.trim().slice(0, 80)
  };
}
```

```js
// probe.collectTabs
() => {
  const tabEls = [...document.querySelectorAll('[role="tab"], mat-tab, .tab, [data-tab]')].filter(el => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none';
  });
  return tabEls.slice(0, 5).map((el, i) => {
    el.setAttribute('data-argus-tab', String(i));
    return {
      idx: i,
      selector: `[data-argus-tab="${i}"]`,
      label: (el.innerText || el.getAttribute('aria-label') || `Tab ${i+1}`).trim().slice(0, 40)
    };
  });
}
```

```js
// probe.getActivePanelText
() => {
  // Angular Material mat-tab-body, standard [role="tabpanel"]
  const panel = document.querySelector(
    '[role="tabpanel"]:not([hidden]):not([aria-hidden="true"]), ' +
    'mat-tab-body.mat-tab-body-active, ' +
    '.tab-pane.active, [class*="tab-content"][class*="active"]'
  );
  if (!panel) return { text: '', found: false };
  const style = getComputedStyle(panel);
  if (style.display === 'none' || style.visibility === 'hidden') return { text: '', found: false };
  return { text: (panel.innerText || '').trim().slice(0, 200), found: true };
}
```

```js
// probe.cleanupNavigation
() => {
  for (const el of document.querySelectorAll('[data-argus-nav], [data-argus-tab]')) {
    try {
      el.removeAttribute('data-argus-nav');
      el.removeAttribute('data-argus-tab');
    } catch (_) {}
  }
  return { ok: true };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| navLinkBroken | high | "Navigation link leads to an error or blank page — href: {href}" |
| navItemDead | medium | "Clicking nav link '{text}' produced no URL change and no visible content transition — href: {href}" |
| tabSwitchNoEffect | high | "Clicking tab '{label}' did not change the visible panel content" |
| routeDeepLinkFails | high | "Direct navigation to '{route}' shows a 404 or empty page — deep linking is broken" |

## Hard rules

1. **NEVER use** `page.locator()`, `page.goto()`, `page.goBack()`, `networkidle` — all raw Playwright API, unavailable in MCP.
2. **Use `browser_navigate_back()`** for back navigation. If it fails to restore URL, navigate explicitly.
3. **Use `domcontentloaded` + `browser_wait_for(800)`** — never `networkidle` (Angular SPAs fire constant background requests).
4. **Mandatory cleanup** — remove all `data-argus-nav/tab` attributes before exit.
5. **Max 8 links, 3 tabs** — bounded; don't iterate the entire nav tree.
