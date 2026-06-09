---
name: qa-test-history
section: interactive
description: "Tests browser back/forward navigation and direct deep-link loading using MCP browser_navigate_back. Clicks a visible internal link, goes back, verifies URL restored, goes forward, verifies URL restored."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## Tests

**Back/forward (fully MCP — no raw Playwright API):**

1. Record startUrl via `browser_evaluate(() => location.href)`.
2. Find a clickable internal link via `probe.findInternalLink` — returns `{found, selector, href}`.
   - Criteria: visible, `href` starts with `/`, not `#`, not `mailto:`, not the same as cell.route.
3. If not found → skip back/forward test (no internal nav available).
4. `browser_click(selector)` + `browser_wait_for(time=800)` — wait for Angular route change (NOT networkidle).
5. afterNavUrl = `browser_evaluate(() => location.href)`.
6. If afterNavUrl === startUrl → navLinkDead (medium) — link click did nothing.
7. **Back:** `browser_navigate_back()` + `browser_wait_for(time=800)`.
8. afterBackUrl = `browser_evaluate(() => location.href)`.
9. If afterBackUrl !== startUrl → backButtonBroken (medium).
10. **Forward:** `browser_navigate({url: afterNavUrl, waitUntil: 'domcontentloaded'})` + `browser_wait_for(time=600)`.
    - Note: MCP does not expose a direct `browser_navigate_forward`. Simulate by re-navigating to the forward URL.
11. afterFwdUrl = `browser_evaluate(() => location.href)`.
12. If afterFwdUrl !== afterNavUrl → forwardButtonBroken (low).
13. Navigate back to startUrl to restore state: `browser_navigate({url: startUrl, waitUntil: 'domcontentloaded'})` + `browser_wait_for(time=600)`.

**Deep link:**
1. `browser_navigate({url: baseUrl + cell.route, waitUntil: 'domcontentloaded', timeout: 10000})`.
2. `browser_wait_for(time=600)`.
3. errorCheck = `browser_evaluate(probe.checkDeepLinkError)`.
4. If `errorCheck.hasError` → deepLinkFails (high).

## Probes (browser_evaluate)

```js
// probe.findInternalLink
() => {
  const links = [...document.querySelectorAll('a[href]')].filter(a => {
    const r = a.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('/') && !href.startsWith('./')) return false;
    if (href === '#' || href === '/' || href === location.pathname) return false;
    if (/mailto:|tel:|javascript:/.test(href)) return false;
    const style = getComputedStyle(a);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
  const link = links[0];
  if (!link) return { found: false };
  if (!link.id) link.setAttribute('data-argus-nav-link', '1');
  return {
    found: true,
    selector: link.id ? `#${link.id}` : '[data-argus-nav-link="1"]',
    href: link.getAttribute('href')
  };
}
```

```js
// probe.checkDeepLinkError
() => {
  const title = (document.title || '').toLowerCase();
  const body = (document.body.innerText || '').slice(0, 500).toLowerCase();
  const hasError = /\b(404|not found|page not found|error|something went wrong|oops)\b/.test(title + ' ' + body);
  const isEmpty = (document.body.innerText || '').trim().length < 50;
  return { hasError: hasError || isEmpty, title: document.title.slice(0, 100) };
}
```

```js
// probe.cleanupHistory
() => {
  const el = document.querySelector('[data-argus-nav-link]');
  if (el) try { el.removeAttribute('data-argus-nav-link'); } catch (_) {}
  return { ok: true };
}
```

Always call `probe.cleanupHistory` at the end.

## Issues
| issueType | severity | description |
|---|---|---|
| backButtonBroken | medium | "Browser back navigation did not return to \"{startUrl}\" — ended up at \"{afterBackUrl}\"" |
| forwardButtonBroken | low | "Forward navigation did not reach \"{afterNavUrl}\" — ended up at \"{afterFwdUrl}\"" |
| deepLinkFails | high | "Direct navigation to \"{cell.route}\" shows a 404/error page — deep linking is broken" |
| navLinkDead | medium | "Clicking internal link \"{href}\" produced no URL change" |

## Hard rules
1. NEVER use `page.goBack()` or `page.goForward()` — both are raw Playwright API, not in MCP.
2. Use `browser_navigate_back()` for back, and re-navigate to the saved URL for forward.
3. Always restore to startUrl before exiting so the next skill starts from the correct route.
4. Use `domcontentloaded` + `browser_wait_for(800)` — never `networkidle` (hangs on Angular SPA).
