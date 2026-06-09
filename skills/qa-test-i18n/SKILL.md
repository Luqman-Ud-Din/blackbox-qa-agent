---
name: qa-test-i18n
section: interactive
description: "Tests language switcher effect and checks for untranslated key strings"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Skip if no visible: `[aria-label*="language" i], [data-testid*="lang"], select[name*="lang" i], .language-switcher, [class*="locale-switcher"], button:has-text(/EN|FR|DE|ES|ZH|JA|PT/)`

## Tests

**Language switch:**
- Baseline: `allInnerTexts()` of `h1, h2, nav, main p, button, label`
- Click switcher. Wait 300ms. Click first non-selected option: `option:not([selected]), .language-option:not(.active), [role="option"]:not([aria-selected="true"])` (first). Wait `domcontentloaded` (8s) then `browser_wait_for(time=800)` to allow Angular change detection to settle.
- If `baseline.join(' ').slice(0,500) === after.join(' ').slice(0,500) AND baseline.join(' ').length > 20` → languageSwitchNoEffect (medium)

**Untranslated keys (only if language switched):**
- Read `body.innerText`. Match `/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]{3,}\b/g` and `/\{\{[^}]+\}\}/g`
- Filter out URLs, `.px`, `.em`
- If `matches.length > 3` → untranslatedKeys (medium): list first 5

## Issues
| issueType | severity | description |
|---|---|---|
| languageSwitchNoEffect | medium | "Switching language did not change any visible UI text — language switcher has no effect" |
| untranslatedKeys | medium | "After language switch, {n} untranslated key strings visible: {examples}" |
