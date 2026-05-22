---
name: qa-detect-console-errors
description: "Captures console.error messages, uncaught JS exceptions, and failed dynamic imports during page load and interaction."
---

# Console Error Detection

## What Claude checks
- **`console.error`** and **`console.warn`** messages emitted during page load and after initial interactions
- **Uncaught JavaScript exceptions** (window errors, unhandled promise rejections)
- **Failed dynamic imports** — `import()` calls that reject, often surfacing as uncaught promise rejections
- Error messages that indicate broken functionality: `undefined is not a function`, `Cannot read properties of null`, `ChunkLoadError`, etc.

## How to detect

```js
// Set up listeners BEFORE navigating to the page
const consoleErrors = [];
const pageErrors = [];

page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleErrors.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location()  // { url, lineNumber, columnNumber }
    });
  }
});

page.on('pageerror', err => {
  pageErrors.push({
    message: err.message,
    stack: err.stack ? err.stack.slice(0, 500) : null,
    name: err.name
  });
});

// Navigate to the page
await page.goto(url, { waitUntil: 'networkidle' });

// Wait a moment for deferred scripts
await page.waitForTimeout(2000);

// Filter out known/acceptable noise
const ignoredPatterns = [
  /favicon\.ico/i,
  /chrome-extension/i,
  /ResizeObserver loop/i,  // benign browser warning
  /\[HMR\]/i,              // hot-module-replacement dev noise
  /\[vite\]/i
];

const filteredErrors = consoleErrors.filter(e =>
  !ignoredPatterns.some(p => p.test(e.text))
);

const filteredPageErrors = pageErrors.filter(e =>
  !ignoredPatterns.some(p => p.test(e.message))
);
```

Also check for failed dynamic imports specifically:

```js
// Check for ChunkLoadError (common in webpack/vite apps)
const chunkErrors = filteredPageErrors.filter(e =>
  /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module/i.test(e.message)
);
```

## Issue schema
- type: `"consoleError"` | `"uncaughtException"`
- severity: from config (`high` for uncaughtException, `medium` for consoleError)
- selector: `null` (page-level — errors are not tied to a DOM element)
- description:
  - consoleError: `"Console error on <url>: <text>" (location: <file>:<line>)`
  - uncaughtException: `"Uncaught <name>: <message>" (stack: <first line of stack>)`

## Viewport behaviour
- Run on **all viewports** — JS errors can vary by viewport if responsive code paths differ (e.g. mobile-only component failing to mount)
- Set up listeners before each viewport navigation/resize to capture errors specific to that breakpoint
- Deduplicate errors across viewports — report once but note all viewports affected
