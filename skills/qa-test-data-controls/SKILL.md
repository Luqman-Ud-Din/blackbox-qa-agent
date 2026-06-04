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

This is an **interactive** skill — the orchestrator MUST drive the click/type sequences below (it is NOT a passive probe; a passive-only run is a coverage gap, see qa-argus Step 5.4g). Run each block only if its control is present. **All asserts are deterministic** row/text/attribute comparisons → Haiku-tier. Where the result is genuinely ambiguous, emit `uncertain: true` so the orchestrator escalates THAT one check to Sonnet (`escalation_model`). Every finding carries an `evidence` object (before/after counts or text) so the coverage ledger can confirm the interaction actually happened.

Row counter = visible `tr, [role="row"], [data-testid*="row"]` excluding header rows.

**Filter / Search — negative AND happy:**
1. Locate the search/filter input (first visible). Record `rowsBefore`.
2. **Negative (no match):** fill `'zzzzz_no_match_test_argus'`, wait 800ms → `rowsAfter`.
   - `rowsAfter >= rowsBefore AND rowsBefore > 1` → `searchNoEffect` (high).
   - `rowsAfter === 0` AND no empty-state text matching `/no results|nothing found|no .* found|empty|0 results/i` visible → `noEmptyState` (medium).
3. **Clear:** reset to `''`, wait 500ms → `rowsCleared`.
   - `rowsCleared < rowsBefore` → `filterClearBroken` (medium) — clearing didn't restore the list.
4. **Happy (match):** take a token (first word ≥3 chars) from the FIRST data row's text. Fill it, wait 800ms → `rowsMatch`.
   - `rowsMatch === 0` → `searchMatchReturnsNothing` (high) — searching an on-screen value returns nothing.
   - `rowsMatch > rowsBefore` → `uncertain: true` (escalate: did it actually filter or reload everything?).
   - Reset to `''`, wait 500ms.

**Sort:**
1. Locate first sortable header (`th[aria-sort], th button, [role="columnheader"][aria-sort], [data-testid*="sort"]`).
2. Read first-row text. Click. Wait 500ms. Read again.
   - same AND rows > 2 → `sortNoEffect` (medium).
3. Click the SAME header again, wait 500ms.
   - order identical to the first-sort result AND rows > 2 → `uncertain: true` (escalate: 3-state sort vs broken toggle?).

**Pagination — happy AND negative:**
1. Locate Next (`[aria-label*="next" i], [data-testid*="next"], button:has-text("Next"), a:has-text("Next"), button:has-text("›")`), first visible.
2. **Happy (forward):** read first-row text → `page1FirstRow`. Click Next, wait 600ms, read again.
   - same → `paginationNoEffect` (high).
3. **Back:** locate Prev (`[aria-label*="prev" i], button:has-text("Previous"), button:has-text("‹")`). If present + enabled: click, wait 600ms.
   - first-row text !== `page1FirstRow` → `paginationPrevBroken` (medium) — Previous didn't return to the prior page.
4. **Last-page boundary:** click Next up to 20× (hard cap) until it becomes `disabled` / `aria-disabled="true"` / absent.
   - Next never disables even after row text stops changing → `paginationNextNotDisabledOnLastPage` (medium).
   - Still enabled AND rows keep changing at the cap → `uncertain: true` (escalate: uncapped/infinite pager?).
5. **Page size:** if a rows-per-page control exists (`select`, `[aria-label*="per page" i]`, `[data-testid*="page-size"]`): read row count, change to a larger value, wait 600ms.
   - row count unchanged → `pageSizeNoEffect` (medium).

## Issues
| issueType | severity | description |
|---|---|---|
| searchNoEffect | high | Filter/search did not narrow results on a no-match query |
| searchMatchReturnsNothing | high | Searching a value visible on the page returned zero rows |
| filterClearBroken | medium | Clearing the search/filter did not restore the full list |
| noEmptyState | medium | Zero-result filter shows no empty-state message |
| sortNoEffect | medium | Clicking a sortable column header did not change row order |
| paginationNoEffect | high | Clicking "Next" did not load the next page of results |
| paginationPrevBroken | medium | "Previous" did not return to the prior page |
| paginationNextNotDisabledOnLastPage | medium | "Next" stays enabled past the last page |
| pageSizeNoEffect | medium | Changing rows-per-page did not change the number of rows shown |
