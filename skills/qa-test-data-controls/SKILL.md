---
name: qa-test-data-controls
section: interactive
description: "Tests search (live/Enter/button-triggered), filter dropdowns, filter modals/panels, sort (aria-sort or plain header click), and pagination — applies each control and verifies the list actually changes"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Skip ONLY if NONE of these is visible (a page with just a filter button or just a filter dropdown still has testable data controls and must NOT be skipped): `input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], [data-testid*="search"], [data-testid*="filter"], [aria-label*="search" i], [aria-label*="filter" i], select, [role="combobox"], [aria-haspopup="listbox"], button[aria-label*="filter" i], table, [role="table"], [role="grid"], [class*="paginat" i], [role="tab"], [role="tablist"], .mat-tab-label, .nav-tabs, .tab-button, [aria-selected], button[aria-label*="refresh" i], button[aria-label*="reload" i], input[type="date"]`

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
4. **Happy (match) — verify search ACTUALLY filters by picked values:**

   Run this verification TWICE — once with a token from the FIRST data row, once with a token from a MIDDLE row (rowIdx = floor(rowsBefore/2)).
   This catches the bug class where the search input accepts input but does nothing to the data (your "rrtwtewrwrerewerrrfewrfwefr" still showing 2 rows screenshot).

   For each iteration:
   a. Pick a token: take the longest word (≥3 chars, no punctuation) from the chosen data row's text. If the row has a distinctive column like an ID code or supplier name, prefer that.
      Record `pickedToken`, `pickedFromRowIdx`, and `originalRowsBefore`.

   b. `applySearch(pickedToken)` → `rowsMatch` (the new row count after search).

   c. Check 1 — search effect on matching value:
      - `rowsMatch === 0` → `searchMatchReturnsNothing` (high). The picked value IS on the page but search returns zero — broken matching logic. Evidence: `{ pickedToken, pickedFromRowIdx }`.
      - `rowsMatch === originalRowsBefore AND rowsBefore > 1` → `searchNoEffect` (high). Search is a no-op even for a valid value — same bug as the gibberish-search no-op.

   d. Check 2 — verify remaining rows ACTUALLY contain the picked token:
      Read the text of all visible rows after the search. Each should contain the picked token (case-insensitive substring) OR a closely related value.
      - If `rowsMatch >= 1` AND zero of the visible rows contain `pickedToken` (case-insensitive) → `searchResultsContainNonMatchingRows` (high). The search "filtered" but to the wrong rows.
        Evidence: `{ pickedToken, visibleRowTexts: [...sampled rows...] }`.

   e. Check 3 — total-count footer should reflect the filter:
      Read any visible "X total" / "showing X" / "X results" text near the table (typically in the footer).
      - If a total was previously `originalRowsBefore` and `rowsMatch < originalRowsBefore` but the footer total still shows the original number → `searchTotalCountStale` (medium). Evidence: `{ totalTextBefore, totalTextAfter, rowsMatch }`.

   f. Check 4 — picked-value-not-in-results:
      If the user-visible value the search WAS picked from is no longer in the result, AND rowsMatch > 0 → `searchPickedValueNotInResults` (high). Catches the search ROUTED to the wrong column.

   g. Reset to `''`, re-trigger, wait 500ms before next iteration.

   After both iterations: if both produced identical "searchNoEffect" results → high confidence the search is broken globally; if they differ → log evidence per iteration.

4.5. **Per-column scope discovery — find out which columns the search actually filters by:**

This catches the bug class where the placeholder reads "Search budgets..." but the actual implementation only searches one or two columns (e.g. only Title, not Description). Without knowing, users type into the search and get confused when matches they expect don't appear.

   a. Read the table's column headers (text from `thead th`). Skip non-content columns (Actions, Status, Date, Sr#, ID).
   b. For the FIRST row, extract the value displayed in each remaining column.
   c. For each (columnName, columnValue) pair (max 4 columns to bound cost):
      - applySearch(columnValue) → `rowsAfter`, `firstRowText`.
      - Record whether the original row is still visible (search matched this column) → `columnSearchable[columnName] = true`.
      - If `rowsAfter === 0` AND the original value exactly matched the cell text → `columnSearchable[columnName] = false`.
      - Reset search before next column.
   d. Compute:
      - `searchableColumns` = columns where `columnSearchable === true`
      - `unsearchableColumns` = columns where `columnSearchable === false`
   e. Read the search input placeholder/aria-label.
      - If `unsearchableColumns.length >= 1` AND placeholder/aria-label does NOT name any of the unsearchable columns explicitly → emit:
        ```json
        {
          "issueType": "searchScopeColumnRestricted",
          "severity": "medium",
          "evidence": {
            "placeholder": "<the actual placeholder text>",
            "searchableColumns": [...],
            "unsearchableColumns": [...]
          },
          "description": "Search filters only <searchableColumns> but placeholder says '<text>' giving users no hint that <unsearchableColumns> are NOT searched. Update placeholder: 'Search by <searchableColumns join ', '>...'"
        }
        ```
   f. Reset search to `''` at the end so subsequent tests see the full list.

This complements the passive check `qa-detect-ux-feedback.searchPlaceholderTooGeneric` which flags ANY generic placeholder; this Phase 2 check confirms WHICH columns are actually searchable so the placeholder can be made specific.

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

**Stale-results-after-empty-response check — runs once per applied filter:**

This catches the "system says no records but old data still showing" bug class (your Students filter screenshot where `Record Not Found` toast appeared but the previous RIDA NASIR card stayed visible).

After applying ANY filter step above (filter dropdown change, filter modal Apply, or search input), within 1500ms:

1. Capture `resultsBefore` = list of currently-visible result-item text fingerprints (first 60 chars of each `tbody tr`, `[class*="card"]`, `[class*="list-item"]`, `[role="row"]` in the main content area, max 10).
2. Wait 1200ms after the filter action.
3. Look for an **empty-state signal** — any of:
   - A visible toast/alert containing `record not found`, `no record`, `no data`, `no results`, `not found`, `0 results`, `nothing found` (case-insensitive)
   - An inline message in the result area matching the same phrases
   - Console log of HTTP 200 with `[]` body OR HTTP 404 to a data endpoint
4. If empty-state signal present, capture `resultsAfter` = same fingerprint list.
5. **Compare:**
   - `resultsBefore.length >= 1 AND resultsAfter.length >= 1 AND resultsAfter ⊇ resultsBefore (any pre-filter row still visible)` → `staleResultsAfterEmptyResponse` (high). Evidence: `{ emptyStateText, resultsBefore: resultsBefore.slice(0, 3), resultsAfter: resultsAfter.slice(0, 3), filterApplied }`.
6. Also flag duplicate toasts in the SAME observation:
   - 2+ visible toasts sharing identical text within 1.5s window → `duplicateToastSimultaneous` (medium). Evidence: `{ toastText, count }`.

This check is cheap (just an observation after each filter) — run it after the existing filterDropdownNoEffect / filterModalNoEffect / search checks, NOT as a separate iteration.

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

**Tab groups / segmented controls — click EACH option and verify displayed values change:**

This catches the "static dashboard" bug class: tabs like `Month | Quarter | Year` (or Day/Week/Month, or All/Active/Archived) where clicking different tabs leaves the page content unchanged.

Define **valueFingerprint()** — a deterministic snapshot of the page's data region:
- concatenate all visible numeric text (e.g. "45", "12,450", "387", "62%")
- + first 10 visible `tr`/`[role=row]` text contents
- + any visible `[data-value]`, `[data-count]` attribute values
- + the first 200 chars of the main `[role="main"]` / `main` element's `innerText`
- return as a single string

Targets:
- ARIA tab groups: `[role="tablist"] > [role="tab"]`
- Bootstrap/Material tabs: `.mat-tab-label, .nav-tabs > li, .tab-button`
- Segmented control buttons inside the same parent that share a "selected/active" class pattern (typically 2-5 sibling buttons, one with `.active`/`.selected`/`aria-selected=true`)
- Chip-style filters: `.chip[aria-pressed], .filter-chip, [role="radio"]` groups of 2-5 siblings

Cap: 3 tab groups per page. Within each group, test up to 4 options.

1. Locate the first tab group. Read the currently-active option label. Compute `baseline = valueFingerprint()`.
2. For each non-active option in the group (max 3):
   - Click the option, wait 800ms (use `[resilience].post_navigate_settle_ms` if longer).
   - Verify the option visually became active (aria-selected=true or .active class) → if not, record `uncertain: true` and skip the next steps for this option.
   - Compute `fingerprintAfter = valueFingerprint()`.
   - If `fingerprintAfter === baseline` → `tabHasNoEffect` (high), evidence: `{ groupSelector, from, to, baseline: baseline.slice(0,200), after: fingerprintAfter.slice(0,200) }`. The bug: clicking a different tab shows identical content — backend filter not wired or stale cache.
   - Update `baseline = fingerprintAfter` for the next comparison (so we catch "Quarter and Year are identical even though Month differs").
3. Reset by clicking back to the original active option. If the group is a segmented control instead of `[role="tab"]` → emit findings with `issueType: 'segmentedControlNoEffect'` instead (same shape).

**Refresh / reload buttons — clicking should update something:**

Refresh buttons (text/aria-label matching `/refresh|reload|update|sync/i`, or icon-only buttons with a circular-arrow / rotate icon class) that don't update displayed data are a common production bug.

1. Locate the first visible refresh control. Compute `fp1 = valueFingerprint()` + snapshot any visible "last updated" / "as of" / "Updated HH:MM" timestamp text.
2. Click the control. Wait 1500ms (refresh fetches typically take longer than tab switches).
3. Compute `fp2 = valueFingerprint()` + timestamp.
4. If `fp1 === fp2 AND timestampBefore === timestampAfter` → `refreshNoEffect` (medium), evidence: `{ buttonSelector, timestampBefore, timestampAfter }`. Either nothing fetched, or the response didn't update the DOM.
   - Exception: if data is truly cached/idempotent and nothing changed server-side, this is correctly a non-bug. Emit with `uncertain: true` so Sonnet escalates on the rare case.

**Date-range pickers — changing the range should change the data:**

Targets buttons / dropdowns whose label matches `/last\s+\d+\s+(days|weeks|months)|today|yesterday|this\s+(week|month|year)|custom\s+range/i` or that contain a date input pair (`input[type="date"]`).

1. Locate the first date-range picker. Read its current label. Compute `baseline = valueFingerprint()` and `rowsBefore = rowCount()`.
2. Open it and pick a DIFFERENT preset (e.g. switch "Last 7 days" → "Last 30 days" or vice versa). For raw date pairs, set the start to 90 days earlier than current.
3. Wait 1000ms → `fingerprintAfter`, `rowsAfter`.
4. If `fingerprintAfter === baseline AND rowsAfter === rowsBefore AND rowsBefore > 0` → `dateRangeNoEffect` (high), evidence: `{ from, to, rowsBefore, rowsAfter }`. Either the filter is broken or the page ignores the new range.


## Issues
| issueType | severity | description |
|---|---|---|
| searchNoEffect | high | Filter/search did not narrow results on a no-match query (after live + Enter + button triggers all tried) |
| searchMatchReturnsNothing | high | Searching a value visible on the page returned zero rows |
| searchResultsContainNonMatchingRows | high | After search, visible rows do not contain the searched token (search filtered to wrong rows) |
| searchTotalCountStale | medium | "X total" footer count does not update after a search reduces visible rows |
| searchScopeColumnRestricted | medium | Search filters by only some columns, but the placeholder gives no hint about scope (e.g. "Search budgets..." while Description column is not searched) |
| searchPickedValueNotInResults | high | Token picked from a visible row is missing from search results — search routed to wrong column or logic broken |
| filterClearBroken | medium | Clearing the search/filter did not restore the full list |
| filterDropdownNoEffect | high | Changing a filter dropdown/combobox to a different option did not change the list |
| filterModalNoEffect | high | Setting a criterion in a filter modal/panel and applying it did not change the list |
| filterButtonOpensNothing | medium | A filter button opened no panel/dropdown when clicked |
| noEmptyState | medium | Zero-result filter shows no empty-state message |
| staleResultsAfterEmptyResponse | high | Filter triggered an empty-state response ("Record Not Found" toast/message) but previously-displayed result items are still visible — system reports no data while showing old data |
| duplicateToastSimultaneous | medium | Two or more visible toasts share identical text simultaneously — same notification fired multiple times without de-duplication |
| sortNoEffect | medium | Clicking a sortable column header did not change row order |
| paginationNoEffect | high | Clicking "Next" did not load the next page of results |
| paginationPrevBroken | medium | "Previous" did not return to the prior page |
| paginationNextNotDisabledOnLastPage | medium | "Next" stays enabled past the last page |
| pageSizeNoEffect | medium | Changing rows-per-page did not change the displayed row count |
| tabHasNoEffect | high | Clicking a different tab in a tab group (e.g. Month / Quarter / Year) shows identical content — backend filter not wired |
| segmentedControlNoEffect | high | Clicking a different option in a segmented control / chip group does not change displayed content |
| refreshNoEffect | medium | Refresh / reload button does not update any displayed data or "last updated" timestamp |
| dateRangeNoEffect | high | Changing the date-range filter does not change the displayed data or row count |
| pageSizeNoEffect | medium | Changing rows-per-page did not change the number of rows shown |
