---
name: qa-test-widgets
description: "Verify modal/dialog open and close, dropdowns show and update, date pickers open and allow selection, and row action menus open and are clickable"
---

# QA Test — Widgets

## What Claude tests

- Modal / dialog open: a button that should open a modal actually opens it
- Modal / dialog close: the modal can be dismissed via the X button, the Escape key, and clicking the backdrop
- Dropdown: clicking a dropdown trigger shows the option list; selecting an option updates the displayed value
- Date picker: clicking a date input or calendar trigger opens a date picker; a date can be selected
- Row action menu (the ⋮ or "more actions" button): clicking it opens a context menu with visible, clickable options

## Test steps

**Self-skip check:**
1. Check for any widget on the page:
   `page.locator('[data-modal-trigger], [data-bs-toggle="modal"], button[aria-haspopup="dialog"], [aria-haspopup="listbox"], select, input[type="date"], [data-testid*="action-menu"], button[aria-label*="more" i], button:has-text("⋮"), button:has-text("…")').first().isVisible()`.
   If none found → self-skip.

**Modal / dialog test:**
2. Locate modal triggers: `page.locator('[data-modal-trigger], [data-bs-toggle="modal"], button[aria-haspopup="dialog"], button:has-text("Open"), button:has-text("Add"), button:has-text("New"), button:has-text("Create"), button:has-text("Edit")').all()`.
3. For each trigger (limit 3):
   a. Click it.
   b. Wait 500 ms.
   c. Check modal is visible: `page.locator('[role="dialog"], .modal.show, .modal[aria-hidden="false"], [aria-modal="true"]').isVisible()`.
   d. If not visible → log `modalWontOpen`.
   e. If visible, test close via X button: `page.locator('[role="dialog"] button[aria-label*="close" i], [role="dialog"] button[aria-label*="dismiss" i], [role="dialog"] .close, [role="dialog"] [data-dismiss]').click()`. Wait 300 ms. If modal still visible → log `modalWontClose` (X button).
   f. Re-open the modal (repeat step 3a).
   g. Test close via Escape: `page.keyboard.press('Escape')`. Wait 300 ms. If modal still visible → log `modalWontClose` (Escape key).
   h. Re-open the modal.
   i. Test close via backdrop: click at coordinates outside the modal dialog box (e.g. top-left corner of the page). Wait 300 ms. If modal still visible → note as informational (some modals intentionally block backdrop close).

**Dropdown test:**
4. Locate custom dropdowns (not native `<select>`): `page.locator('[aria-haspopup="listbox"], [role="combobox"], .dropdown-toggle, [data-testid*="dropdown"]').all()`.
5. For each (limit 3):
   a. Read the current displayed value.
   b. Click the trigger.
   c. Wait 300 ms.
   d. Check that an option list is visible: `page.locator('[role="listbox"], [role="option"], .dropdown-menu.show, .dropdown-menu[aria-hidden="false"]').isVisible()`.
   e. If not visible → log `dropdownBroken`.
   f. If visible, click the second option: `page.locator('[role="option"], .dropdown-item').nth(1).click()`. Wait 300 ms.
   g. Read the new displayed value. If unchanged → log `dropdownBroken`.
6. Also test native `<select>` elements:
   a. `page.locator('select').all()` — for each, `page.selectOption(selector, { index: 1 })`. If page.selectOption throws → log `dropdownBroken`.

**Date picker test:**
7. Locate date inputs: `page.locator('input[type="date"], [data-testid*="date-picker"], [aria-label*="date" i]').all()`.
8. For each (limit 2):
   a. Click it.
   b. Wait 400 ms.
   c. Check if a calendar popup appeared: `page.locator('[role="dialog"] table, .react-datepicker, .flatpickr-calendar, .datepicker').isVisible()`.
   d. If a calendar is visible, click the first enabled day: `page.locator('.react-datepicker__day:not(.react-datepicker__day--disabled), .flatpickr-day:not(.disabled), td[data-day]:not([aria-disabled])').first().click()`.
   e. Wait 300 ms. If the input value is still empty → log `datePickerBroken`.
   f. If calendar opened but no day could be clicked → log `datePickerBroken` (no selectable days).

**Row action menu test:**
9. Locate action menu buttons: `page.locator('button[aria-label*="more" i], button[aria-label*="actions" i], button:has-text("⋮"), button:has-text("…"), [data-testid*="action-menu"], [data-testid*="row-action"]').all()`.
10. For each (limit 3):
    a. Click it.
    b. Wait 300 ms.
    c. Check that a menu appeared: `page.locator('[role="menu"], [role="menuitem"], .dropdown-menu.show').isVisible()`.
    d. If not visible → log `actionMenuBroken`.
    e. If visible, verify at least one menu item is clickable (not disabled): `page.locator('[role="menuitem"]:not([aria-disabled="true"]), .dropdown-item:not(.disabled)').first().isVisible()`.
    f. Close the menu by pressing Escape.

## Pass / Fail criteria

Pass:
- Modal opens when trigger is clicked; closes via X, Escape, or backdrop.
- Dropdown shows option list when clicked; selecting an option updates the displayed value.
- Date picker opens a calendar; a date can be clicked and the input is populated.
- Row action menu opens with at least one enabled option visible.

Fail:
- Modal trigger clicked but no modal appears → `modalWontOpen`.
- Modal is open but X button or Escape does not close it → `modalWontClose`.
- Dropdown trigger clicked but no option list appears, OR selecting an option does not update the value → `dropdownBroken`.
- Date input clicked but no calendar appears, OR calendar appears but no day can be selected → `datePickerBroken`.
- Action menu button clicked but no menu appears → `actionMenuBroken`.

## Issue schema

- type: "modalWontOpen"
- severity: high
- selector: "modal trigger button"
- description: "Clicking '{triggerLabel}' did not open a modal or dialog"

- type: "modalWontClose"
- severity: high
- selector: "[role='dialog']"
- description: "Modal opened but could not be closed via '{method}' (X button / Escape / backdrop)"

- type: "dropdownBroken"
- severity: high
- selector: "dropdown trigger"
- description: "Dropdown '{label}' did not show options when clicked, or selecting an option did not update the displayed value"

- type: "datePickerBroken"
- severity: medium
- selector: "date input or calendar trigger"
- description: "Date picker '{label}' did not open a calendar, or no date could be selected"

- type: "actionMenuBroken"
- severity: high
- selector: "action menu button (⋮)"
- description: "Row action menu button did not open a menu with clickable options"

## Scope

applyOn: ["desktop"]
Self-skip conditions: skip if no modal triggers, custom dropdowns, date inputs, or action menu buttons are found on the route.
