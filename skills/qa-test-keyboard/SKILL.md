---
name: qa-test-keyboard
description: "Tests tab order, focus ring visibility, and focus trap detection"
model: haiku
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## Tests

**Tab order / focus ring (10 tabs):**
- Press Tab 10 times. For each step:
  - `document.activeElement` — if null or === body → focusLost (high): "Tab caused focus to return to body"
  - Check focus ring: `parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none'`
  - If no ring → noFocusIndicator (high): "Focused element has no visible focus indicator"
  - Track `tag#id` — if same key appears > 1 time, increment traps; if traps > 1 → break (normal wrap)

## Issues
| issueType | severity | description |
|---|---|---|
| focusLost | high | "Tab key caused focus to return to \<body\> — focus trap or missing focusable elements" |
| noFocusIndicator | high | "Focused element {selector} has no visible focus indicator (outline or box-shadow)" |
