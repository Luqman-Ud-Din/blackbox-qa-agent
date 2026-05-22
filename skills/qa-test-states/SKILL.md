---
name: qa-test-states
description: "Verify empty, error, loading, and success feedback states are shown at the appropriate times"
---

# QA Test — UI States

## What Claude tests

- Empty state: when a list or table has no items, a meaningful empty state UI is rendered (not a blank space)
- Error state: when an API request returns an error (500), a user-visible error message is shown — not a crash, blank page, or silent failure
- Loading state: during a slow response, a spinner, skeleton, or "Loading…" indicator is visible
- Success feedback: after a form is submitted successfully, a confirmation message or visual indicator is shown

## Test steps

**Empty state test:**
1. Look for list or table components: `page.locator('table, [role="grid"], ul[data-list], .data-table, .list-container').all()`.
2. For each (limit 2), check if the element is empty (no data rows):
   `page.locator('tbody tr, [role="row"]:not([role="columnheader"]), .list-item, li[data-id]').count()` === 0.
3. If empty and no "empty state" indicator is visible → log `emptyStateAbsent`.
   Empty state indicators: `page.locator('text=/no results/i, text=/no items/i, text=/nothing here/i, text=/no data/i, [data-testid*="empty"], .empty-state, [class*="empty-state"]').isVisible()`.
4. If the list has data, optionally search for a term that is unlikely to match (e.g. `"zzznomatch_xqz"`), wait 1 s, and re-check for an empty state indicator.

**Error state test:**
5. Use Playwright's route interception to simulate a server error on the most likely API endpoint:
   `page.route('**/api/**', route => route.fulfill({ status: 500, body: 'Internal Server Error' }))`.
6. Reload the page: `page.reload()`. Wait for load: `page.waitForLoadState('networkidle', { timeout: 8000 })`.
7. Check for a visible error message:
   `page.locator('[role="alert"], .error-message, [class*="error"], text=/something went wrong/i, text=/error/i, text=/failed to load/i, text=/unable to/i').isVisible()`.
8. If no error indicator visible → log `errorStateAbsent`.
9. Remove the route intercept: `page.unroute('**/api/**')`.
10. Reload to restore normal state.

**Loading state test:**
11. Intercept API requests to introduce a delay:
    `page.route('**/api/**', async route => { await new Promise(r => setTimeout(r, 2000)); route.continue(); })`.
12. Reload the page without waiting for networkidle — wait only for `domcontentloaded`:
    `page.reload(); page.waitForLoadState('domcontentloaded', { timeout: 5000 })`.
13. Immediately check for loading indicators:
    `page.locator('[data-testid*="loading"], [class*="spinner"], [class*="skeleton"], [aria-label*="loading" i], [role="progressbar"], text=/loading/i').isVisible()`.
14. If no loading indicator found within the 2 s delay window → log `loadingStateAbsent`.
15. Remove the route intercept: `page.unroute('**/api/**')`.
16. Wait for full load to restore state.

**Success feedback test:**
17. Locate a form with a submit button on the page:
    `page.locator('form').filter({ has: page.locator('button[type="submit"], input[type="submit"]') }).first()`.
18. If found:
    a. Fill required fields with minimal valid data (any non-empty string for text inputs, select first option for selects, check first checkbox).
    b. Click the submit button.
    c. Wait 3 s.
    d. Check for a success indicator:
       `page.locator('[role="alert"]:has-text(/success/i), .toast, [class*="toast"], [class*="success"], text=/saved/i, text=/submitted/i, text=/created/i, text=/updated/i, [data-testid*="success"]').isVisible()`.
    e. If no success indicator visible and no navigation to a different route occurred → log `successFeedbackAbsent`.

## Pass / Fail criteria

Pass:
- Empty list shows a clear empty state message or illustration.
- A 500 API error results in a visible, user-friendly error message.
- During a delayed response, a spinner or skeleton screen is shown.
- After form submission, a success toast, message, or redirect is visible.

Fail:
- Empty list renders nothing at all (blank white space) → `emptyStateAbsent`.
- API 500 error produces a blank page or silent failure with no user-visible message → `errorStateAbsent`.
- During API delay, no loading indicator is shown → `loadingStateAbsent`.
- Form submitted successfully but no confirmation feedback displayed → `successFeedbackAbsent`.

## Issue schema

- type: "emptyStateAbsent"
- severity: medium
- selector: "list or table container"
- description: "Empty list/table has no empty state indicator — users see a blank space with no explanation"

- type: "errorStateAbsent"
- severity: medium
- selector: null
- description: "API error (500) occurred but no error message was shown to the user — silent failure"

- type: "loadingStateAbsent"
- severity: medium
- selector: null
- description: "Data is loading from the API but no loading indicator (spinner, skeleton) is visible"

- type: "successFeedbackAbsent"
- severity: medium
- selector: "form submit button"
- description: "Form was submitted successfully but no confirmation feedback (toast, message, or redirect) was shown"

## Scope

applyOn: ["desktop"]
Self-skip conditions: none — applicable to every route (each sub-test self-skips if the relevant element type is absent).
