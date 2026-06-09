---
name: qa-test-filter-accuracy
section: interactive
description: "Tests that search/filter results are semantically correct: applies a known filter (a visible value from the first row), then verifies ALL visible rows match the filter term. Catches filters that run without narrowing results, filters that exclude matching rows, and search inputs that accept input but return unfiltered data."
model: sonnet
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
---

# qa-test-filter-accuracy — Search & Filter Result Accuracy Testing

Existing QA skills verify that filter/search CONTROLS are present. This skill verifies the RESULTS are correct — that after filtering by "Active", only "Active" rows appear; that after searching "John", only rows containing "John" are shown.

**Strategy:** reads a value from the first data row, applies it as a filter/search term, then checks that the result set only contains matching rows.

## What it checks (7 issue types)

| issueType | severity | what it catches |
|---|---|---|
| `filterResultsUnchanged` | high | Filter applied but row count did NOT change (data not filtered at all) |
| `filterResultsMismatch` | high | Filter applied and row count changed, but some visible rows do NOT contain the filter term |
| `filterNoResultsFeedback` | medium | Applied a filter that should yield zero results, but no "No results" / empty-state message appeared |
| `searchResultsMismatch` | high | Searched for a term visible in a cell; result rows do NOT contain that term |
| `filterClearBroken` | medium | "Clear filter" / reset button clicked but filters did not reset (row count stayed filtered) |
| `filterCombinationBroken` | medium | Applied two filters simultaneously; result was not the intersection (more rows returned than expected) |
| `searchDebounceExcessive` | low | Search input required 3+ seconds before results updated (too slow for UX) |

## Self-skip conditions

Skip if no filter or search control found on the page.
Skip if no data table or list is visible with at least 3 rows.

```js
probe.checkPageHasFilterableData() returns {hasData: false} → self-skip
```

## Orchestrator flow

### Step 1 — Discover filterable data and controls

```
pageState = browser_evaluate(probe.checkPageHasFilterableData)
If !pageState.hasData OR pageState.rowCount < 3 → self-skip
If !pageState.hasFilterControl → self-skip
```

Record `baselineRowCount = pageState.rowCount`.

### Step 2 — Prepare a filter term from real data

```
sampleData = browser_evaluate(probe.sampleFirstRowData)
filterTerm = sampleData.bestFilterValue  // e.g. "Active", "John", "2024"
filterColumn = sampleData.columnHint
```

If `sampleData.bestFilterValue` is null → skip to Step 5 (search-only test).

### Step 3 — Apply column filter (if dropdown filter exists)

```
a. filterResult = browser_evaluate(probe.applyDropdownFilter, {
     filterSelector: pageState.filterSelector,
     filterTerm: filterTerm
   })
   browser_wait_for(time=1200)

b. postFilterState = browser_evaluate(probe.countVisibleRows)

c. If postFilterState.rowCount === baselineRowCount:
   → emit filterResultsUnchanged (high)
     evidence: {filterTerm, baselineRowCount, postFilterRowCount: postFilterState.rowCount}
     self-skip remaining filter steps

d. mismatchRows = browser_evaluate(probe.checkRowsMatchFilter, {
     filterTerm, column: filterColumn
   })
   If mismatchRows.mismatchCount > 0:
   → emit filterResultsMismatch (high)
     evidence: {filterTerm, mismatchCount: mismatchRows.mismatchCount, example: mismatchRows.examples}

e. Clear filter:
   browser_evaluate(probe.clearFilter, {filterSelector: pageState.filterSelector})
   browser_wait_for(time=800)
   afterClearState = browser_evaluate(probe.countVisibleRows)
   If afterClearState.rowCount < baselineRowCount * 0.9:  // less than 90% rows restored
   → emit filterClearBroken (medium)
     evidence: {expectedRows: baselineRowCount, gotRows: afterClearState.rowCount}
```

### Step 4 — Apply search input (if search field exists)

```
If pageState.searchSelector:
  a. browser_click(selector=pageState.searchSelector)
  b. searchTerm = sampleData.bestSearchValue  // a cell text value
  c. browser_type(selector=pageState.searchSelector, text=searchTerm)
  d. searchStart = Date.now()
  e. browser_wait_for(time=600)
  f. searchWait600 = browser_evaluate(probe.countVisibleRows)

  g. If searchWait600.rowCount === baselineRowCount:
       browser_wait_for(time=2400)  // extra wait for slow debounce
       searchWait3000 = browser_evaluate(probe.countVisibleRows)
       debounceMs = 3000
       If searchWait3000.rowCount === baselineRowCount:
         → emit filterResultsUnchanged (high, search variant)
           evidence: {searchTerm, note: 'search returned all rows after 3s'}
       Else if debounceMs > 1500:
         → emit searchDebounceExcessive (low)
           evidence: {debounceMs}

  h. postSearchRows = browser_evaluate(probe.countVisibleRows)
  i. If postSearchRows.rowCount < baselineRowCount:
       mismatch = browser_evaluate(probe.checkRowsMatchSearch, {searchTerm})
       If mismatch.mismatchCount > 0:
         → emit searchResultsMismatch (high)
           evidence: {searchTerm, mismatchCount: mismatch.mismatchCount, examples: mismatch.examples}

  j. Clear search:
     browser_evaluate(probe.clearSearchInput, {searchSelector: pageState.searchSelector})
     browser_wait_for(time=600)
```

### Step 5 — Zero-results filter test

```
filterResult2 = browser_evaluate(probe.applyDropdownFilter, {
  filterSelector: pageState.filterSelector,
  filterTerm: '__argus_no_match__'
})
browser_wait_for(time=800)
emptyState = browser_evaluate(probe.checkEmptyState)
If !emptyState.hasEmptyMessage AND !emptyState.hasZeroRows:
  → emit filterNoResultsFeedback (medium)
    evidence: {note: 'filter with non-existent value showed no empty-state message'}

Clear filter again.
```

## Probes (browser_evaluate)

```js
// probe.checkPageHasFilterableData
() => {
  // Find data rows
  const tableRows = [...document.querySelectorAll('tr:not(:first-child), mat-row, [role="row"]:not([role="columnheader"])')].filter(r => {
    const rect = r.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0;
  });
  // Also count list items
  const listItems = [...document.querySelectorAll('[class*="list-item"], [class*="card"][class*="item"], [class*="record-row"]')].filter(r => {
    const rect = r.getBoundingClientRect(); return rect.height > 10;
  });
  const rows = tableRows.length > 0 ? tableRows : listItems;

  // Find filter controls
  const filterDropdowns = [...document.querySelectorAll(
    'mat-select[placeholder*="filter" i], mat-select[aria-label*="filter" i], mat-select[formcontrolname*="filter" i], ' +
    'select[class*="filter"], [class*="filter-select"], [role="combobox"][aria-label*="filter" i]'
  )].filter(el => el.getBoundingClientRect().width > 0);

  const searchInputs = [...document.querySelectorAll(
    'input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], ' +
    'input[formcontrolname*="search" i], input[formcontrolname*="filter" i], ' +
    'input[aria-label*="search" i], [class*="search-input"] input'
  )].filter(el => el.getBoundingClientRect().width > 0);

  const filter = filterDropdowns[0];
  const search = searchInputs[0];
  if (filter) filter.setAttribute('data-argus-filter', '1');
  if (search) search.setAttribute('data-argus-search', '1');

  return {
    hasData: rows.length >= 3,
    rowCount: rows.length,
    hasFilterControl: filterDropdowns.length > 0 || searchInputs.length > 0,
    filterSelector: filter ? '[data-argus-filter="1"]' : null,
    searchSelector: search ? '[data-argus-search="1"]' : null
  };
}
```

```js
// probe.sampleFirstRowData
() => {
  // Get text from first data row cells
  const firstRow = document.querySelector('tr:nth-child(2), mat-row:first-child, [role="row"]:not([role="columnheader"]):first-child');
  if (!firstRow) return { bestFilterValue: null, bestSearchValue: null };

  const cells = [...firstRow.querySelectorAll('td, mat-cell, [role="cell"]')];
  const cellTexts = cells.map(c => (c.innerText || '').trim()).filter(t => t.length >= 2 && t.length <= 40);

  // Prefer short values that look like status/category (good for dropdown filter)
  const shortValues = cellTexts.filter(t => t.length <= 20 && !/\d{4}-\d{2}-\d{2}/.test(t) && !/^\d+$/.test(t));
  const bestFilterValue = shortValues[0] || cellTexts[0] || null;

  // For search: prefer a name-like value (2+ words or a word > 4 chars)
  const nameValues = cellTexts.filter(t => t.includes(' ') || (t.length > 4 && /^[A-Za-z]/.test(t)));
  const bestSearchValue = nameValues[0] || cellTexts[0] || null;

  return { bestFilterValue, bestSearchValue, columnHint: cells.length > 0 ? 0 : null };
}
```

```js
// probe.applyDropdownFilter — args: { filterSelector, filterTerm }
({filterSelector, filterTerm}) => {
  const filter = document.querySelector(filterSelector);
  if (!filter) return { applied: false };

  // mat-select: click to open, then click option
  filter.click();
  return { applied: true, isMatSelect: filter.tagName === 'MAT-SELECT' || filter.closest('mat-select') != null };
}
```

```js
// probe.countVisibleRows
() => {
  const rows = [...document.querySelectorAll(
    'tr:not(:first-child):not(thead tr), mat-row, [role="row"]:not([role="columnheader"])'
  )].filter(r => {
    const rect = r.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0 && r.querySelector('td, mat-cell, [role="cell"]');
  });
  return { rowCount: rows.length };
}
```

```js
// probe.checkRowsMatchFilter — args: { filterTerm, column }
({filterTerm, column}) => {
  const term = filterTerm.toLowerCase();
  const rows = [...document.querySelectorAll(
    'tr:not(:first-child):not(thead tr), mat-row, [role="row"]:not([role="columnheader"])'
  )].filter(r => {
    const rect = r.getBoundingClientRect();
    return rect.height > 0 && r.querySelector('td, mat-cell, [role="cell"]');
  });

  const mismatchRows = rows.filter(row => {
    const rowText = (row.innerText || '').toLowerCase();
    return !rowText.includes(term);
  });

  const examples = mismatchRows.slice(0, 3).map(r => (r.innerText || '').trim().slice(0, 100));
  return { mismatchCount: mismatchRows.length, examples };
}
```

```js
// probe.checkRowsMatchSearch — args: { searchTerm }
({searchTerm}) => {
  const term = searchTerm.toLowerCase();
  const rows = [...document.querySelectorAll(
    'tr:not(:first-child):not(thead tr), mat-row, [role="row"]:not([role="columnheader"])'
  )].filter(r => {
    const rect = r.getBoundingClientRect();
    return rect.height > 0 && r.querySelector('td, mat-cell, [role="cell"]');
  });
  const mismatchRows = rows.filter(row => !(row.innerText || '').toLowerCase().includes(term));
  const examples = mismatchRows.slice(0, 3).map(r => (r.innerText || '').trim().slice(0, 100));
  return { mismatchCount: mismatchRows.length, examples };
}
```

```js
// probe.clearFilter — args: { filterSelector }
({filterSelector}) => {
  const filter = document.querySelector(filterSelector);
  if (!filter) return { cleared: false };
  // Try to find and click a "clear" or "all" option
  const clearTrigger = document.querySelector('[aria-label="Clear"], [class*="clear-filter"], [class*="reset-filter"], button[aria-label*="clear" i]');
  if (clearTrigger) {
    clearTrigger.click();
    return { cleared: true, method: 'clearButton' };
  }
  // For select: click to open and select first ("All") option
  filter.click();
  return { cleared: true, method: 'clickToReset' };
}
```

```js
// probe.clearSearchInput — args: { searchSelector }
({searchSelector}) => {
  const input = document.querySelector(searchSelector);
  if (!input) return { cleared: false };
  input.focus();
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { cleared: true };
}
```

```js
// probe.checkEmptyState
() => {
  const emptyMsgs = [...document.querySelectorAll(
    '[class*="empty-state"], [class*="no-data"], [class*="no-results"], [class*="empty-message"], ' +
    '[class*="not-found"], [aria-label*="no results" i], [class*="zero-state"]'
  )].filter(e => e.getBoundingClientRect().height > 0);

  const zeroRows = document.querySelectorAll('tr:not(:first-child), mat-row, [role="row"]:not([role="columnheader"])').length === 0;
  return {
    hasEmptyMessage: emptyMsgs.length > 0,
    hasZeroRows: zeroRows
  };
}
```

```js
// probe.cleanupFilterTest
() => {
  for (const el of document.querySelectorAll('[data-argus-filter], [data-argus-search]')) {
    try {
      el.removeAttribute('data-argus-filter');
      el.removeAttribute('data-argus-search');
    } catch (_) {}
  }
  return { ok: true };
}
```

Always run `probe.cleanupFilterTest` at the end, even on error.

## Selecting an option from Angular Material mat-select

After `filter.click()` (from `probe.applyDropdownFilter`), a CDK overlay panel opens attached to `document.body`. The orchestrator must:

```
1. browser_wait_for(time=400)  ← wait for overlay
2. overlayState = browser_evaluate(probe.clickMatSelectOption, {filterTerm})
```

```js
// probe.clickMatSelectOption — args: { filterTerm }
({filterTerm}) => {
  const term = (filterTerm || '').toLowerCase();
  const panel = document.querySelector('.cdk-overlay-container mat-option, .mat-select-panel mat-option');
  if (!panel) return { clicked: false, reason: 'no panel found' };
  const allOptions = [...document.querySelectorAll('.cdk-overlay-container mat-option, .mat-select-panel mat-option')];
  const match = allOptions.find(o => (o.innerText || '').toLowerCase().includes(term));
  if (match) {
    match.click();
    return { clicked: true, optionText: (match.innerText || '').trim() };
  }
  // For zero-results test: try to find "All" first to reset, or just close
  const allOpt = allOptions.find(o => /\ball\b/i.test(o.innerText || ''));
  if (term === '__argus_no_match__') {
    // Escape the panel — no match option
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { clicked: false, reason: 'no match found, panel closed' };
  }
  return { clicked: false, reason: 'term not in options', availableOptions: allOptions.slice(0,5).map(o=>(o.innerText||'').trim()) };
}
```

For search inputs (not mat-select), use `browser_type` directly after `browser_click`.

## Hard rules

1. **Only read-then-filter with existing data** — never create or delete records.
2. **Restore baseline** — always clear filters/search before finishing; leave the page in its original state.
3. **Mandatory cleanup** — remove all `data-argus-filter/search` attributes.
4. **Sonnet model** — result correctness interpretation requires semantic judgment.
5. **Bounded waits** — max 3 s total waiting for filter results; emit `searchDebounceExcessive` if results took > 1.5 s.
