---
name: qa-test-i18n
description: "If a language switcher is present, verify switching language changes visible text and no untranslated i18n keys are rendered"
---

# QA Test — Internationalisation (i18n)

## What Claude tests

- Switching to a different language changes the visible UI text to the new language
- After switching, no raw i18n key strings are visible in the UI (strings matching patterns like `key.label.name`, `common.button.save`, `section.subsection.title`)
- The language switch applies to the full page — not just one section

## Test steps

**Self-skip check:**
1. Look for a language switcher on the page:
   `page.locator('[aria-label*="language" i], [data-testid*="lang"], select[name*="lang" i], select[name*="locale" i], button:has-text(/EN|FR|DE|ES|ZH|JA|PT|AR|language/i), .language-switcher, [class*="locale-switcher"]').first().isVisible()`.
2. If none found → self-skip with message "no language switcher found — i18n test not applicable".

**Baseline snapshot:**
3. Read the visible text of major content sections as a baseline:
   `const baseline = await page.locator('h1, h2, nav, main p, button, label').allInnerTexts()`.
4. Note the first detected language (likely English).

**Switch language test:**
5. Click the language switcher.
6. Wait 300 ms for any dropdown to open.
7. Select a non-default language option (the first one in the list that is NOT the current language):
   `page.locator('[aria-label*="language" i] option:not([selected]), .language-option:not(.active), [role="option"]:not([aria-selected="true"])').first().click()`.
8. Wait for the page to reflect the change: `page.waitForLoadState('networkidle', { timeout: 6000 })`.
9. Read the new visible text of the same content areas:
   `const afterSwitch = await page.locator('h1, h2, nav, main p, button, label').allInnerTexts()`.
10. Compare `baseline` and `afterSwitch`. If they are identical (same strings) → log `languageSwitchNoEffect`.

**Untranslated keys check:**
11. After the language switch, read all visible text nodes on the page:
    `const allText = await page.locator('body').innerText()`.
12. Search for patterns matching common i18n key formats using a regex:
    - Dot-separated lowercase segments: `/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]{3,}\b/g`
    - Curly brace placeholders left unresolved: `/\{\{[^}]+\}\}/g`
    - All-caps underscore-separated keys: `/\b[A-Z][A-Z0-9_]{3,}\b/g`
13. Filter out obvious non-keys: URLs, CSS class names, code snippets. Focus on keys that appear as standalone label text or button text.
14. If more than 3 suspected untranslated keys are found visible in the UI → log `untranslatedKeys` with a list of the first 5 examples.

## Pass / Fail criteria

Pass:
- Switching language visibly changes the UI text to the new language.
- After switching, no i18n key patterns are visible as labels, button text, or headings.

Fail:
- Switching language does not change any visible text on the page → `languageSwitchNoEffect`.
- After switching, visible text contains strings that match i18n key patterns → `untranslatedKeys`.

## Issue schema

- type: "languageSwitchNoEffect"
- severity: medium
- selector: "language switcher"
- description: "Switching to language '{targetLanguage}' did not change any visible UI text — the language switcher has no effect"

- type: "untranslatedKeys"
- severity: medium
- selector: null
- description: "After switching to '{targetLanguage}', untranslated key strings are visible in the UI: {exampleKeys}"

## Scope

applyOn: ["desktop"]
Self-skip conditions: skip if no language switcher control is found on the page. This is not a failure — it means i18n is not applicable for this route.
