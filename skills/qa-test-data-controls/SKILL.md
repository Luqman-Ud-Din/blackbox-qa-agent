---
name: qa-test-data-controls
description: "Tests search (live/Enter/button-triggered), filter dropdowns, filter modals/panels, sort (aria-sort or plain header click), and pagination — applies each control and verifies the list actually changes"
model: haiku
applyOn: [mobile, tablet, desktop]
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Skip ONLY if NONE of these is visible (a page with just a filter button or just a filter dropdown still has testable data controls and must NOT be skipped): `input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], [data-testid*="search"], [data-testid*="filter"], [aria-label*="search" i], [aria-label*="filter" i], select, [role="combobox"], [aria-haspopup="listbox"], button[aria-label*="filter" i], table, [role="table"], [role="grid"], [class*="paginat" i]`

## Tests

This is an **interactive** skill — the orchestrator MUST drive the click/type sequences below (it is NOT a passive probe; a passive-only run is a coverage gap, see qa-argus Step 5.4g). Run each block only if its control is present. **All asserts are deterministic** row/text/attribute comparisons → Haiku-tier. Where the result is genuinely ambiguous, emit `uncertain: true` so the orchestrator escalates THAT one check to Sonnet (`escalation_model`). Every finding carries an `evidence` object (before/after counts or text) so the coverage ledger can confirm the interaction actually happened.

Row counter = visible `tr, [role="row"], [data-testid*="row"]` excluding header rows.

**Search — apply it ROBUSTLY (typing alone is not always enough), negative AND happy:**

Define **applySearch(value)** — set the input, then make the app actually RUN the query, escalating through the three ways apps trigger a search until the row count changes (live-debounce, Enter-to-search, or a search button). This is mandatory: concluding "no effect" after only the type step is the false-positive that wrongly flags Enter-to-search / click-to-search apps as broken.
  a. `browser_type` the input with `value` (clear it first). Wait 800ms for a debounced/live filter.
  b. If the row count is unchanged vs. immediately before the fill → focus the input and `browser_press_key("Enter")`, wait 600ms.
  c. If STILL unchanged → click the adjacent search/submit control (a `button` / `[type=submit]` / icon button inside the input's container, or the input's immediately-following sibling button), wait 600ms.
  Record in `evidence` which step actually changed the rows (`live` / `enter` / `button`) — that proves the interaction fired.

1. Locate the search/filter input (first visible). Record `rowsBefore`.
2. **Negative (no match):** `applySearch('zzzzz_no_match_test_argus')` → `rowsAfter`.
   - `rowsAfter >= rowsBefore AND rowsBefore > 1` (only AFTER all three trigger steps were tried) → `searchNoEffect` (high).
   - `rowsAfter === 0` AND no empty-state text matching `/no results|nothing found|no .* found|empty|0 results/i` visible → `noEmptyState` (medium).
3. **Clear:** reset the input to `''`, re-trigger (Enter / button if the app needs it), wait 500ms → `rowsCleared`.
   - `rowsCleared < rowsBefore` → `filterClearBroken` (medium) — clearing didn't restore the list.
4. **Happy (match):** take a token (first word ≥3 chars) from the FIRST data row's text. `applySearch(token)` → `rowsMatch`.
   - `rowsMatch === 0` → `searchMatchReturnsNothing` (high) — searching an on-screen value returns nothing.
   - `rowsMatch > rowsBefore` → `uncertain: true` (escalate: did it actually filter or reload everything?).
   - Reset to `''`, re-trigger, wait 500ms.

**Filter dropdowns / comboboxes — change EACH and verify the list reacts:**
Targets every filter `select`, `[role="combobox"]`, `[role="listbox"]` trigger, or `[aria-haspopup="listbox"]` button that is **NOT** the pagination "items per page" control and **NOT** a sortable-column menu. Cap 4 filters per page.
1. For each filter: record `rowsBefore`, `firstRowText`, and the current/default option label.
2. Open it and choose a DIFFERENT option (the first option whose label ≠ current). Native `select` → set value + dispatch `change`; ARIA combobox → click trigger, then click the option.
3. Wait 800ms → `rowsAfter` + `firstRowTextAfter`.
   - `rowsAfter === rowsBefore AND firstRowTextAfter === firstRowText AND rowsBefore > 1` → `filterDropdownNoEffect` (high) — changing the filter changed nothing (evidence: `{ filterLabel, from, to, rowsBefore, rowsAfter }`).
   - list became empty AND no empty-state text visible → `noEmptyState` (medium).
4. **Reset** the filter to its original option before the next filter/block (restore prior state).

**Filter modal / panel — open, set a criterion, Apply, verify:**
1. Locate a filter trigger: a button/element whose text or `aria-label` matches `/^\s*filter|filters|funnel|refine|advanced search/i`, or an icon button with a filter/funnel glyph adjacent to the list. If none is present → skip THIS block only (not the whole skill).
2. Record `rowsBefore` + `firstRowText`. Click the trigger, wait 600ms.
   - No panel became visible (no newly-shown `[role=dialog]`, `[role=menu]`, `.modal`, `[class*=panel]`, `[class*=filter]`, `[class*=drawer]`) → `filterButtonOpensNothing` (medium); stop this block.
3. Inside the opened panel set the FIRST actionable control: choose a non-default `select`/radio/checkbox option, OR fill the first text input with a token taken from the first data row.
4. Click the panel's apply control (text/`aria-label` matching `/apply|search|done|show results|^\s*filter\s*$|update/i`). If there is no apply control, treat the filter as live and continue.
5. Wait 800ms → `rowsAfter` + `firstRowTextAfter`.
   - `rowsAfter === rowsBefore AND firstRowTextAfter === firstRowText AND rowsBefore > 1` → `filterModalNoEffect` (high) — criteria set + applied changed nothing (evidence: `{ control, value, rowsBefore, rowsAfter }`).
6. **Reset:** reopen if needed and click a clear/reset control (`/clear|reset|remove all/i`); if none exists, `browser_navigate` back to the route to restore the unfiltered list.

**Sort — via aria-sort/button AND plain header click:**
1. Locate a sortable header. Prefer `th[aria-sort], th button, [role="columnheader"][aria-sort], [data-testid*="sort"]`. **If none match, fall back to the first plain header cell** (`thead th, [role="columnheader"]`) — many tables (e.g. apps whose columns have no `aria-sort` attribute) sort on a bare header click.
2. Read first-row text. Click the header. Wait 500ms. Read again.
   - changed → record `evidence: { mechanism: 'aria-sort'|'plain-header', firstRowBefore, firstRowAfter }` (proves sort fired; no finding).
   - same AND rows > 2 AND the header had `aria-sort`/sort affordance → `sortNoEffect` (medium) — an advertised-sortable column didn't reorder.
   - same AND rows > 2 AND it was a PLAIN header with no sort affordance → `uncertain: true` (escalate: is this column sortable at all, or correctly non-sortable?).
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
| searchNoEffect | high | Filter/search did not narrow results on a no-match query (after live + Enter + button triggers all tried) |
| searchMatchReturnsNothing | high | Searching a value visible on the page returned zero rows |
| filterClearBroken | medium | Clearing the search/filter did not restore the full list |
| filterDropdownNoEffect | high | Changing a filter dropdown/combobox to a different option did not change the list |
| filterModalNoEffect | high | Setting a criterion in a filter modal/panel and applying it did not change the list |
| filterButtonOpensNothing | medium | A filter button opened no panel/dropdown when clicked |
| noEmptyState | medium | Zero-result filter shows no empty-state message |
| sortNoEffect | medium | Clicking a sortable column header did not change row order |
| paginationNoEffect | high | Clicking "Next" did not load the next page of results |
| paginationPrevBroken | medium | "Previous" did not return to the prior page |
| paginationNextNotDisabledOnLastPage | medium | "Next" stays enabled past the last page |
| pageSizeNoEffect | medium | Changing rows-per-page did not change the number of rows shown |
