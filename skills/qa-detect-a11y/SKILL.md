---
name: qa-detect-a11y
description: "Detects missing H1, unnamed buttons, missing lang attribute, and absent skip-to-content link."
---

# Accessibility Detection

## What Claude checks
- Page has **no `<h1>`** element — every page should have exactly one H1 as the primary heading
- `<button>` elements and elements with `role="button"` that have **no accessible name** (no inner text, no `aria-label`, no `title`, no `aria-labelledby`)
- `<html>` element **missing the `lang` attribute** — required for screen readers to use correct language/pronunciation
- **No skip-to-content link** present — a visible-on-focus `<a href="#main">` or equivalent that lets keyboard users bypass navigation
- Icon-only images (`<img>` used as icons) that lack any alt text — overlaps with qa-detect-images but focuses on icon context

## How to detect

```js
// 1. No H1 on page
const h1Check = await page.evaluate(() => {
  const h1s = document.querySelectorAll('h1');
  return { count: h1s.length, texts: Array.from(h1s).map(h => h.innerText.trim().slice(0, 80)) };
});

// 2. Buttons with no accessible name
const unnamedButtons = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('button, [role="button"]').forEach(el => {
    const text = el.innerText ? el.innerText.trim() : '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    const title = el.getAttribute('title') || '';
    const labelledByText = ariaLabelledBy
      ? (document.getElementById(ariaLabelledBy) || {}).innerText || ''
      : '';
    if (!text && !ariaLabel && !title && !labelledByText) {
      results.push({
        selector: el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''),
        outerHTML: el.outerHTML.slice(0, 200)
      });
    }
  });
  return results;
});

// 3. Missing lang attribute on <html>
const langCheck = await page.evaluate(() => {
  const html = document.documentElement;
  return {
    hasLang: html.hasAttribute('lang'),
    lang: html.getAttribute('lang')
  };
});

// 4. No skip-to-content link
const skipLinkCheck = await page.evaluate(() => {
  const candidates = document.querySelectorAll('a[href^="#"]');
  const skipLink = Array.from(candidates).find(a => {
    const text = a.innerText.toLowerCase();
    return /skip|jump|main.?content|content/i.test(text);
  });
  return {
    found: !!skipLink,
    text: skipLink ? skipLink.innerText.trim() : null,
    href: skipLink ? skipLink.getAttribute('href') : null
  };
});

// 5. Icon images without alt
const iconImagesNoAlt = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('img').forEach(img => {
    const src = img.src || '';
    const isIcon = /icon|ico|sprite|glyph/i.test(src) || (img.width < 48 && img.height < 48);
    if (isIcon && !img.hasAttribute('alt') && !img.getAttribute('aria-hidden')) {
      results.push({
        selector: img.id ? `#${img.id}` : 'img',
        src: src.slice(0, 120)
      });
    }
  });
  return results;
});

// Also run accessibility snapshot for cross-reference
const snapshot = await page.accessibility.snapshot();
```

## Issue schema
- type: `"noH1"` | `"buttonNoName"` | `"missingLang"` | `"noSkipLink"`
- severity: from config
- selector: CSS selector, or `null` for page-level issues
- description:
  - noH1: `"Page has no <h1> heading — add a single H1 as the primary page title"`
  - buttonNoName: `"Button <selector> has no accessible name — add text content, aria-label, or title"`
  - missingLang: `"<html> element is missing the lang attribute — add lang='en' (or appropriate language code)"`
  - noSkipLink: `"Page has no skip-to-content link — add <a href='#main' class='sr-only focus:not-sr-only'>Skip to content</a> as the first focusable element"`

## Viewport behaviour
- All issues are **viewport-independent** — check once per page load (not per viewport)
- Still run at each tested viewport as the DOM may differ across responsive breakpoints (e.g. separate mobile nav with different button structure)
- Skip-to-content link: test on **laptop/desktop** where keyboard navigation is most common
