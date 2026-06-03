---
name: qa-test-widgets
description: "Tests modal open/close, dropdown selection, and row action menus"
model: haiku
applyOn: [mobile, tablet, desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Skip if no visible: `[data-modal-trigger], [data-bs-toggle="modal"], button[aria-haspopup="dialog"], [aria-haspopup="listbox"], select, input[type="date"], [data-testid*="action-menu"], button[aria-label*="more" i], button:has-text("⋮")`

## Tests

**Modals (up to 3):** `[data-modal-trigger], [data-bs-toggle="modal"], button[aria-haspopup="dialog"], button:has-text("Open"), button:has-text("Add"), button:has-text("New"), button:has-text("Create"), button:has-text("Edit")`
- Click trigger, wait 500ms. If `[role="dialog"], .modal.show, [aria-modal="true"]` not visible → modalWontOpen (high)
- If visible: click `[role="dialog"] button[aria-label*="close" i], [role="dialog"] .close, [role="dialog"] [data-dismiss]`, wait 300ms. Still visible → modalWontClose (high)
- Re-open. Press Escape, wait 300ms. Still visible → modalWontClose (high)

**Dropdowns (up to 3):** `[aria-haspopup="listbox"], [role="combobox"], .dropdown-toggle, [data-testid*="dropdown"]`
- Read `before` text. Click, wait 300ms. If `[role="listbox"], [role="option"], .dropdown-menu.show` not visible → dropdownBroken (high)
- Click second option `[role="option"], .dropdown-item` nth(1). Wait 300ms. If text same as `before` → dropdownBroken (high)

**Action menus (up to 3):** `button[aria-label*="more" i], button[aria-label*="actions" i], button:has-text("⋮"), [data-testid*="action-menu"], [data-testid*="row-action"]`
- Click, wait 300ms. If `[role="menu"], [role="menuitem"], .dropdown-menu.show` not visible → actionMenuBroken (high)
- Else press Escape

## Issues
| issueType | severity | description |
|---|---|---|
| modalWontOpen | high | "Clicking \"{label}\" did not open a modal or dialog" |
| modalWontClose | high | "Modal opened but could not be closed via {method}" |
| dropdownBroken | high | "Dropdown trigger clicked but no option list appeared" |
| actionMenuBroken | high | "Row action menu button (⋮) clicked but no menu appeared" |
