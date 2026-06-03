---
name: qa-test-data-controls
description: "Tests search, sort, and pagination controls"
model: haiku
applyOn: [mobile, tablet, desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Skip if no visible: `input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], [data-testid*="search"], [data-testid*="filter"], [aria-label*="search" i], select, table`

## Tests

**Search:**
- Find `input[type="search"], input[placeholder*="search" i], [data-testid*="search"], [aria-label*="search" i]` (first, visible)
- Count `tr, [role="row"], [data-testid*="row"]` before
- Fill `'zzzzz_no_match_test_argus'`, wait 800ms
- Count after. If `rowsAfter >= rowsBefore AND rowsBefore > 1` → searchNoEffect (high)
- Reset to `''`, wait 500ms

**Sort:**
- Find `th[aria-sort], th button, [role="columnheader"][aria-sort], [data-testid*="sort"]` (first, visible)
- Read first row text before. Click. Wait 500ms. Read first row text after.
- If same AND row count > 2 → sortNoEffect (medium)

**Pagination:**
- Find `[aria-label*="next" i], [data-testid*="next"], button:has-text("Next"), a:has-text("Next"), button:has-text("›")` (first, visible, not disabled)
- Read first row text before. Click. Wait 600ms. Read after.
- If same → paginationNoEffect (high)

## Issues
| issueType | severity | description |
|---|---|---|
| searchNoEffect | high | "Search input did not filter results — rows stayed at {n} after searching \"zzzzz_no_match_test_argus\"" |
| sortNoEffect | medium | "Clicking sortable column header did not change the order of rows" |
| paginationNoEffect | high | "Clicking \"Next\" pagination button did not load the next page of results" |
