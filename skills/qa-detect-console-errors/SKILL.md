---
name: qa-detect-console-errors
section: performance
description: "Captures console errors and uncaught JS exceptions during page load"
model: haiku
applyOn: all
needsSetup: true
viewportSensitive: false
---

## What it checks
Captures `console.error()` and uncaught page exceptions during navigation.

## Orchestrator flow (uses Playwright MCP listener APIs)
1. BEFORE navigate, call `browser_console_messages(onlyErrors=true)` to start capturing.
2. Navigate to cell route.
3. AFTER navigation, call `browser_console_messages()` to read collected messages.
4. Filter + dedupe per rules below.

## Rules
- Merge console.error messages with uncaught pageerror exceptions.
- Deduplicate by `msg.slice(0,100)`.
- Skip messages containing: `favicon`, `ResizeObserver loop`, `Non-passive event listener`, `Permissions policy`.
- Each remaining message → `consoleError` (high).
- Cap at 20.

## Issue format
```json
{ "issueType":"consoleError", "severity":"high", "selector":null,
  "description":"JavaScript error: {msg.slice(0,300)}" }
```

## Issues
| issueType | severity | description |
|---|---|---|
| consoleError | high | "JavaScript error: {msg.slice(0,300)}" |
