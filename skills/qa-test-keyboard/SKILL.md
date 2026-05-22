---
name: qa-test-keyboard
description: "Verify all interactive elements are reachable by Tab, Enter activates focused buttons/links, Escape closes modals/dropdowns, and focus indicators are visible"
---

# QA Test — Keyboard Accessibility

## What Claude tests

- Tab key cycles through all interactive elements without getting stuck in a "keyboard trap" (except intentionally within an open modal)
- Pressing Enter on a focused button or link activates it (same effect as clicking)
- Pressing Escape closes any open modal or dropdown
- Every focused interactive element has a visible focus indicator — the browser default outline is not suppressed without a replacement style

## Test steps

**Tab navigation / keyboard trap test:**
1. Navigate to the route: `page.goto(url)`.
2. Click on the `<body>` to ensure focus is in the page: `page.click('body')`.
3. Press Tab up to 50 times, recording each focused element:
   ```
   const visited = [];
   for (let i = 0; i < 50; i++) {
     await page.keyboard.press('Tab');
     const focused = await page.evaluate(() => {
       const el = document.activeElement;
       return el ? { tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label') || el.innerText?.slice(0, 30) } : null;
     });
     if (!focused || focused.tag === 'BODY') break; // wrapped around — done
     if (visited.some(v => v.tag === focused.tag && v.label === focused.label) && visited.length > 5) break; // cycle detected
     visited.push(focused);
   }
   ```
4. If Tab never moves focus away from `<body>` and there are visible interactive elements → log `keyboardTrap`.
5. If focus cycles back to the same single element repeatedly (e.g. stuck on one button) → log `keyboardTrap`.

**Focus indicator test:**
6. Tab through the first 10 focusable elements.
7. For each, evaluate whether a focus ring is visible:
   ```
   const hasFocusRing = await page.evaluate(() => {
     const el = document.activeElement;
     if (!el) return false;
     const style = window.getComputedStyle(el, ':focus');
     const outline = style.outline;
     const boxShadow = style.boxShadow;
     const outlineHidden = outline === 'none' || outline === '0px' || outline.includes('0px none');
     const noBoxShadow = boxShadow === 'none';
     return !(outlineHidden && noBoxShadow);
   });
   ```
8. If `hasFocusRing` is false for more than 3 elements → log `focusNotVisible` once (report the first 3 selectors).

**Enter key activation test:**
9. Tab to the first focusable button: `page.locator('button:visible, [role="button"]:visible').first()`.
10. Focus it: `element.focus()`.
11. Record the current URL and any visible dialog state.
12. Press Enter: `page.keyboard.press('Enter')`.
13. Wait 500 ms.
14. If the URL did not change AND no dialog appeared AND no visible state change occurred (e.g. form submitted, panel toggled) → log `enterKeyNoEffect`.
15. Press Escape or go back to restore state if navigation occurred.

**Escape key test:**
16. Open a modal or dropdown if one exists (use steps from qa-test-widgets to open).
17. If a modal or dropdown is open:
    a. Press Escape: `page.keyboard.press('Escape')`.
    b. Wait 300 ms.
    c. Check if the modal/dropdown is still visible.
    d. If still visible → log `escapeKeyNoEffect`.

## Pass / Fail criteria

Pass:
- Tab cycles through all interactive elements without getting permanently stuck.
- Each focused element shows a visible outline or box-shadow focus indicator.
- Pressing Enter on a focused button/link triggers the expected action.
- Escape closes open modals and dropdowns.

Fail:
- Tab gets stuck on one element (cycling to the same element without progressing) or never moves at all → `keyboardTrap`.
- More than 3 interactive elements suppress the focus outline with no visible replacement → `focusNotVisible`.
- Enter on a focused button produces no action → `enterKeyNoEffect`.
- Escape on an open modal or dropdown does not close it → `escapeKeyNoEffect`.

## Issue schema

- type: "keyboardTrap"
- severity: high
- selector: "body or trapped element"
- description: "Keyboard trap detected — Tab key cannot move focus past '{element}'; users relying on keyboard cannot navigate the page"

- type: "focusNotVisible"
- severity: medium
- selector: "interactive element"
- description: "Focus indicator is not visible on '{selectors}' — outline:none is applied with no replacement style"

- type: "enterKeyNoEffect"
- severity: medium
- selector: "focused button or link"
- description: "Pressing Enter on focused element '{label}' produced no action — keyboard activation is broken"

- type: "escapeKeyNoEffect"
- severity: medium
- selector: "open modal or dropdown"
- description: "Pressing Escape did not close the open '{widgetType}' — keyboard dismissal is broken"

## Scope

applyOn: ["desktop"]
Self-skip conditions: none — run on every route.
