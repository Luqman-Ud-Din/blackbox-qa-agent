---
name: qa-test-theme
section: interactive
description: "Tests dark/light theme toggle effect and persistence after page reload"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Skip if no visible: `[aria-label*="dark" i], [aria-label*="light" i], [aria-label*="theme" i], [data-testid*="theme"], [data-testid*="dark-mode"], .theme-toggle, [class*="theme-toggle"]`

## Tests

**Baseline:** Read `body` computed style: `{ bg: style.backgroundColor, color: style.color }`. Read `html[data-theme]`, `html.className`.

**Toggle:**
- Click `[aria-label*="dark" i], [aria-label*="light" i], [aria-label*="theme" i], [data-testid*="theme"], .theme-toggle` (first). Wait 500ms.
- Read `{ bg, color, dataTheme, htmlClass }` again.
- If `bg === baseline.bg AND color === baseline.color AND dataTheme === baseline.dataTheme AND htmlClass === baseline.htmlClass` → themeToggleNoEffect (low)

**Persistence (only if toggle worked):**
- `page.reload({ waitUntil: 'networkidle' })`. Wait for load.
- Re-read `{ bg, color, dataTheme, htmlClass }`.
- If all reverted to baseline values → themeNotPersisted (low)

## Issues
| issueType | severity | description |
|---|---|---|
| themeToggleNoEffect | low | "Theme toggle clicked but no color or attribute change detected — bg stayed \"{bg}\", color stayed \"{color}\"" |
| themeNotPersisted | low | "Theme toggle worked but theme reverted to original after page reload — preference is not persisted in localStorage/cookie" |
