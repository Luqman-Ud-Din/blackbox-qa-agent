---
name: qa-test-theme
description: "If a dark/light mode toggle is present, verify toggling changes colors and the preference persists after reload"
---

# QA Test — Theme Toggle

## What Claude tests

- Clicking the dark/light mode toggle changes the background color and text color of the page
- After a page reload, the chosen theme is still active (preference is persisted via localStorage or a cookie)

## Test steps

**Self-skip check:**
1. Look for a theme toggle on the page:
   `page.locator('[aria-label*="dark" i], [aria-label*="light" i], [aria-label*="theme" i], [data-testid*="theme"], [data-testid*="dark-mode"], button:has-text(/dark|light|theme/i), .theme-toggle, [class*="theme-toggle"], input[type="checkbox"][aria-label*="dark" i]').first().isVisible()`.
2. If none found → self-skip with message "no theme toggle found — theme test not applicable".

**Baseline color snapshot:**
3. Read the current background color and text color of the `<body>`:
   ```
   const baseline = await page.evaluate(() => {
     const style = window.getComputedStyle(document.body);
     return {
       bg: style.backgroundColor,
       color: style.color
     };
   });
   ```
4. Read the current `data-theme` or `class` on `<html>` or `<body>`:
   ```
   const baseTheme = await page.evaluate(() => ({
     htmlClass: document.documentElement.className,
     bodyClass: document.body.className,
     dataTheme: document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme')
   }));
   ```

**Toggle theme test:**
5. Click the theme toggle:
   `page.locator('[aria-label*="dark" i], [aria-label*="light" i], [aria-label*="theme" i], [data-testid*="theme"], .theme-toggle, button:has-text(/dark|light/i)').first().click()`.
6. Wait 500 ms for CSS transition: `page.waitForTimeout(500)`.
7. Read colors again:
   ```
   const afterToggle = await page.evaluate(() => {
     const style = window.getComputedStyle(document.body);
     return { bg: style.backgroundColor, color: style.color };
   });
   ```
8. If `afterToggle.bg === baseline.bg` AND `afterToggle.color === baseline.color` → log `themeToggleNoEffect`.
9. Also verify the `data-theme` attribute or class changed (e.g. `dark` was added/removed). If no attribute change detected either → log `themeToggleNoEffect`.

**Persistence test:**
10. If the toggle worked (step 8 passed):
    a. Note which theme is now active.
    b. Reload the page: `page.reload()`. Wait: `page.waitForLoadState('networkidle', { timeout: 8000 })`.
    c. Read colors and theme attributes again (same as steps 3–4).
    d. If the colors and attributes reverted to the `baseline` values → log `themeNotPersisted`.
    e. If the theme is still the toggled state → pass.

## Pass / Fail criteria

Pass:
- Clicking the theme toggle changes the `background-color` and `color` of the body (and/or a `data-theme` attribute changes).
- After reloading the page, the toggled theme is still active.

Fail:
- Theme toggle clicked but no color or attribute change detected → `themeToggleNoEffect`.
- Theme changed correctly but reverts to the original theme after page reload → `themeNotPersisted`.

## Issue schema

- type: "themeToggleNoEffect"
- severity: low
- selector: "theme toggle button"
- description: "Clicking the theme toggle did not change the page background or text colors — background stayed '{bg}', color stayed '{color}'"

- type: "themeNotPersisted"
- severity: low
- selector: null
- description: "Theme toggle changed to '{theme}' but reverted to '{originalTheme}' after page reload — preference is not persisted"

## Scope

applyOn: ["desktop"]
Self-skip conditions: skip if no theme toggle control is found on the page. This is not a failure — it means dark/light mode theming is not applicable for this route.
