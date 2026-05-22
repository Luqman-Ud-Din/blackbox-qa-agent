---
name: qa-test-idempotency
description: "Verify that clicking Submit twice does not submit the form twice and does not create duplicate records"
---

# QA Test — Form Idempotency

## What Claude tests

- Clicking the submit button a second time while the first submission is in flight is either prevented (button becomes disabled or shows a loading state) or results in only one record being created
- Saving a form twice in quick succession does not create two duplicate records in the data list

## Test steps

**Self-skip check:**
1. Check for a form with a submit button on the page:
   `page.locator('form button[type="submit"], form input[type="submit"]').isVisible()`.
   If not found → self-skip with message "no form with submit action found on this route".

**Double-click submit test:**
2. Locate the first visible form with a submit button.
3. Fill all required fields with minimal valid data:
   - For each `input[required]` or `input[aria-required="true"]` that is empty: fill with a test value (`"Test Value"` for text, `"test@example.com"` for email, `"12345"` for number/zip).
   - For each `select[required]` that has no selection: `page.selectOption(selector, { index: 1 })`.
   - For each `input[type="checkbox"][required]`: check it.
4. Set up a request counter by intercepting the submit API call:
   ```
   let submitCount = 0;
   page.on('request', req => {
     if (req.method() === 'POST' || req.method() === 'PUT') submitCount++;
   });
   ```
5. Double-click the submit button rapidly (two clicks within 200 ms):
   ```
   const btn = page.locator('button[type="submit"]').first();
   await btn.click();
   await btn.click();
   ```
6. Wait 3 s for any async operation: `page.waitForTimeout(3000)`.
7. Check button state: is the submit button disabled or does it have a loading class?
   `btn.isDisabled()` or `btn.getAttribute('class').includes('loading')`.
8. If `submitCount > 1` AND button was NOT disabled between clicks → log `doubleSubmitAllowed`.
9. If `submitCount === 1` or button disabled after first click → pass.

**Duplicate record test:**
10. Look for a "create new" or "add" action on a list page: `page.locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")').first()`.
11. If found:
    a. Note the current item count in the list: `page.locator('tbody tr, .list-item, li[data-id]').count()`.
    b. Click the "Add/New/Create" button, fill the form with test data, and submit.
    c. Wait for the list to update: `page.waitForLoadState('networkidle', { timeout: 6000 })`.
    d. Note the new count. Expected: `originalCount + 1`.
    e. Without refreshing or clearing the form, click the "Add/New/Create" button again and submit the same data.
    f. Wait for update.
    g. Note the count again. If `count > originalCount + 2` (i.e., two duplicates created) → log `duplicateCreated`.
    h. If the second submit was rejected with an error message about duplicates → pass (duplicate prevention is working).

## Pass / Fail criteria

Pass:
- Second click of the submit button while first request is in flight is ignored (button disabled or request count stays at 1).
- Submitting the same new-record form twice results in one record created, not two (either the second is rejected or the button is disabled).

Fail:
- Two network requests are sent because the submit button was not disabled between clicks → `doubleSubmitAllowed`.
- Two identical records appear in the list after two rapid submissions → `duplicateCreated`.

## Issue schema

- type: "doubleSubmitAllowed"
- severity: high
- selector: "form submit button"
- description: "Double-clicking the submit button sent {count} POST/PUT requests — the button was not disabled between clicks"

- type: "duplicateCreated"
- severity: high
- selector: "form or list container"
- description: "Submitting the same form twice created {count} duplicate records — no deduplication or submit guard in place"

## Scope

applyOn: ["desktop"]
Self-skip conditions: skip if no form with a submit button is visible on the route.
