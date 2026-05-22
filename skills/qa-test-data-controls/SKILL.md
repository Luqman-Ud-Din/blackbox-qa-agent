---
name: qa-test-data-controls
description: "Verify search, filter, sort, pagination, and items-per-page controls actually change the displayed data"
---

# QA Test — Data Controls

## What Claude tests

- A search input narrows the visible rows/cards/items to those matching the query
- Filter controls (dropdowns, checkboxes, radio buttons labelled as filters) change which items are displayed
- Sort controls change the order of rows (ascending vs descending, or different column)
- Pagination "Next" and "Previous" buttons load a different page of results
- The "items per page" selector changes how many rows are visible in the table/list

## Test steps

**Self-skip check:**
1. Check for any data control element on the page:
   `page.locator('input[type="search"], input[placeholder*="search" i], [aria-label*="search" i], select[name*="filter" i], [data-testid*="filter"], [data-testid*="sort"], [aria-label*="sort" i], [aria-label*="pagination" i], nav[aria-label*="pagination" i], button:has-text("Next"), button:has-text("Previous")').first().isVisible()`.
   If none found → self-skip with message "no search/filter/sort/pagination controls detected on this route".

**Search test:**
2. Locate search input: `page.locator('input[type="search"], input[placeholder*="search" i], [aria-label*="search" i]').first()`.
3. If found and visible:
   a. Read the current row/item count: count elements matching `tr:not(:first-child), [data-row], .item-row, li[data-id]`.
   b. Type a specific query: `page.fill(searchSelector, 'a')` (single character ensures some results on most datasets).
   c. Wait 1 s for debounce: `page.waitForTimeout(1000)`.
   d. Re-count rows.
   e. If count is identical AND no "no results" indicator is visible → log `searchNoEffect`.

**Filter test:**
4. Locate a filter control: `page.locator('select[name*="filter" i], [data-testid*="filter"], [aria-label*="filter" i]').first()`.
5. If found and visible:
   a. Read current row count.
   b. Select the second option (index 1) using `page.selectOption(selector, { index: 1 })` — or click the filter element and then click the second visible option.
   c. Wait 1 s.
   d. Re-count rows.
   e. If count is identical → log `filterNoEffect`.

**Sort test:**
6. Locate sort triggers: `page.locator('th[aria-sort], [data-sort], button[aria-label*="sort" i], th button').first()`.
7. If found and visible:
   a. Read the text of the first visible data row's first cell.
   b. Click the sort trigger.
   c. Wait 500 ms.
   d. Read the text of the first data row's first cell again.
   e. If text is identical AND no visual sort indicator change is detected → log `sortNoEffect`.

**Pagination test:**
8. Locate Next button: `page.locator('button:has-text("Next"), [aria-label*="next page" i], [data-testid*="next"]').first()`.
9. If found and visible and not disabled:
   a. Read the text of the first visible data row.
   b. Click Next.
   c. Wait for load: `page.waitForLoadState('networkidle', { timeout: 6000 })`.
   d. Read the first row again.
   e. If text is identical → log `paginationBroken` (next page did not load new data).
   f. Click Previous button: `page.locator('button:has-text("Previous"), button:has-text("Prev"), [aria-label*="previous page" i]').first()`.
   g. Wait for load.
   h. If first row text does not match original → log `paginationBroken` (back navigation broken).

**Items per page test:**
10. Locate items-per-page selector: `page.locator('select[name*="pageSize" i], select[name*="perPage" i], select[aria-label*="rows per page" i], select[aria-label*="items per page" i]').first()`.
11. If found and visible:
    a. Read current row count.
    b. Select a different option (if current is 10, select 25; if current is 25, select 10).
    c. Wait 1 s.
    d. Re-count rows.
    e. If count is identical → log `paginationBroken` (items-per-page change had no effect).

## Pass / Fail criteria

Pass:
- Search reduces the visible item count (or shows a "no results" state).
- Filter changes which items are displayed.
- Sort reorders rows so the first row is different.
- Next page loads different row content; Previous returns to prior content.
- Changing items-per-page changes the row count.

Fail:
- Search input typed into but row count and content unchanged → `searchNoEffect`.
- Filter option selected but row count and content unchanged → `filterNoEffect`.
- Sort clicked but row order unchanged → `sortNoEffect`.
- Next/Previous clicked but data unchanged → `paginationBroken`.
- Items-per-page changed but row count unchanged → `paginationBroken`.

## Issue schema

- type: "searchNoEffect"
- severity: high
- selector: "search input"
- description: "Typing '{query}' into the search input did not change the displayed rows or items"

- type: "filterNoEffect"
- severity: high
- selector: "filter control"
- description: "Selecting filter option '{option}' did not change the displayed data"

- type: "sortNoEffect"
- severity: high
- selector: "sort trigger"
- description: "Clicking the sort control on column '{column}' did not reorder the rows"

- type: "paginationBroken"
- severity: high
- selector: "pagination control"
- description: "Pagination control '{action}' did not load a different page of results"

## Scope

applyOn: ["desktop"]
Self-skip conditions: skip if no search input, filter control, sort trigger, or pagination control is visible on the route.
