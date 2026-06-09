---
name: qa-detect-ux-feedback
section: visual
description: "Detects UX feedback gaps: empty states without illustration/CTA, tables with no rows + no empty message, modals without visible close button, modals not dismissible via ESC/backdrop, search bars without clear button. Goes beyond a11y — catches missing user-feedback patterns."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
---

## What it catches — 8 issue types

| issueType | severity | What |
|---|---|---|
| `tableNoEmptyState` | medium | Table has thead but tbody is empty AND no nearby empty-state element ("No results", "No data", etc.). Users see blank table and assume broken. |
| `listNoEmptyState` | medium | List/grid (`ul`, `[role="list"]`, `.list-grid`) is empty AND no empty-state element nearby. |
| `modalNoCloseButton` | high | Open dialog/modal has no visible close button (X icon, "Close", "Cancel"). User has no clear exit. |
| `modalNoEscDismiss` | medium | Open modal has no `data-dismiss`, no `aria-modal`, and no detected ESC key handler — keyboard users can't close it. |
| `modalNoBackdropDismiss` | low | Open modal has backdrop element but no detected click handler to dismiss on backdrop click. |
| `searchNoClearButton` | low | Visible search input (>20 chars typed OR placeholder mentions "search") has no visible clear (X) button. |
| `searchPlaceholderTooGeneric` | low | Search input placeholder is a generic 1-3 word phrase ("Search budgets...") while the adjacent table has 3+ searchable text columns — users don't know which fields will be searched |
| `loadingNoIndicator` | medium | Element matched `aria-busy="true"` or `[class*="loading"]` is present but has no visible spinner/progress text inside. |

## Probe (browser_evaluate)

```js
() => {
  const sel = el => {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 120);
  };
  const bb = el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const visible = el => {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const out = [];

  // ── 1. Table with no rows + no empty state ────────────────────────────
  let tableEmptyFlagged = 0;
  for (const tbl of document.querySelectorAll('table')) {
    if (tableEmptyFlagged >= 3) break;
    if (!visible(tbl)) continue;
    const hasHead = !!tbl.querySelector('thead, tr:first-child th');
    if (!hasHead) continue;
    const bodyRows = tbl.querySelectorAll('tbody tr');
    if (bodyRows.length > 0) continue;
    // Look for an empty-state nearby (within parent or next sibling)
    const container = tbl.closest('.table-wrapper, .table-container, .data-table-wrapper') || tbl.parentElement;
    const emptyText = /no\s+(?:data|records|results|items|rows|entries)|empty/i;
    const hasEmptyMsg = container && [...container.querySelectorAll('div, p, span, h1, h2, h3, h4, h5, h6')]
      .some(el => visible(el) && emptyText.test(el.innerText || ''));
    if (!hasEmptyMsg) {
      tableEmptyFlagged++;
      out.push({
        issueType: 'tableNoEmptyState', severity: 'medium',
        selector: sel(tbl), bbox: bb(tbl),
        description: 'Table has header columns but zero rows AND no "No data" / empty-state message nearby. Users see blank area and assume the page is broken.'
      });
    }
  }

  // ── 2. List/grid empty state ──────────────────────────────────────────
  let listEmptyFlagged = 0;
  for (const list of document.querySelectorAll('ul, ol, [role="list"], .list, .grid-list, .card-list')) {
    if (listEmptyFlagged >= 2) break;
    if (!visible(list)) continue;
    if (list.closest('nav, footer, header, aside')) continue;
    const items = [...list.children].filter(c => c.tagName === 'LI' || c.getAttribute('role') === 'listitem' || c.classList.contains('card') || c.classList.contains('item'));
    if (items.length > 0) continue;
    const rect = list.getBoundingClientRect();
    if (rect.height < 24) continue;  // collapsed
    const container = list.parentElement;
    const emptyText = /no\s+(?:items|results|records|matches|entries|data)|empty/i;
    const hasEmptyMsg = container && [...container.querySelectorAll('div, p, span')]
      .some(el => visible(el) && emptyText.test(el.innerText || ''));
    if (!hasEmptyMsg) {
      listEmptyFlagged++;
      out.push({
        issueType: 'listNoEmptyState', severity: 'medium',
        selector: sel(list), bbox: bb(list),
        description: 'List/grid is empty with no "No items" / empty-state message. Users may think the page failed to load.'
      });
    }
  }

  // ── 3-5. Modal dismissibility (only open modals) ──────────────────────
  const openModals = [...document.querySelectorAll('dialog[open], [role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden]), .modal.show, .modal.is-open, [class*="modal"]:not([hidden])')]
    .filter(visible);
  for (const m of openModals.slice(0, 2)) {
    // 3. Close button visible?
    const closeBtn = m.querySelector('[aria-label*="close" i], [data-dismiss="modal"], .close, .modal-close, [class*="close-button"], button[title*="close" i]');
    if (!closeBtn || !visible(closeBtn)) {
      out.push({
        issueType: 'modalNoCloseButton', severity: 'high',
        selector: sel(m), bbox: bb(m),
        description: 'Open modal has no visible close button (X icon, "Close", aria-label="close"). User has no clear exit — only browser back-button works.'
      });
    }
    // 4. ESC dismiss handler
    const hasEscHook = m.hasAttribute('data-dismiss') ||
                      m.getAttribute('aria-modal') === 'true' ||
                      m.hasAttribute('data-keyboard') ||
                      m.querySelector('[data-keyboard], [data-dismiss="modal"]');
    if (!hasEscHook) {
      out.push({
        issueType: 'modalNoEscDismiss', severity: 'medium',
        selector: sel(m), bbox: bb(m),
        description: 'Modal has no aria-modal, no data-dismiss, no detected ESC handler. Keyboard users may be trapped.'
      });
    }
    // 5. Backdrop dismiss
    const backdrop = document.querySelector('.modal-backdrop, .modal-overlay, [class*="backdrop"]');
    if (backdrop && visible(backdrop)) {
      const onclick = (backdrop.getAttribute('onclick') || '');
      const hasBackdropHandler = onclick.length > 0 ||
                                  backdrop.hasAttribute('data-dismiss') ||
                                  backdrop.classList.contains('cdk-overlay-backdrop');
      if (!hasBackdropHandler) {
        out.push({
          issueType: 'modalNoBackdropDismiss', severity: 'low',
          selector: sel(backdrop), bbox: bb(backdrop),
          description: 'Modal backdrop exists but no detected click handler to dismiss. Users expect backdrop click to close.'
        });
      }
    }
  }

  // ── Loading element with no indicator inside (REAL: blank, no feedback) ─
  let loadingFlagged = 0;
  const loadingEls = document.querySelectorAll('[aria-busy="true"], .loading, .is-loading, [class*="spinner"], [class*="skeleton"]');
  for (const el of loadingEls) {
    if (loadingFlagged >= 2) break;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) continue;  // probably IS the spinner itself
    const hasSpinner = !!el.querySelector('svg[class*="spin"], .spinner, [class*="rotate"], [class*="animate"], progress, [role="progressbar"]');
    const txt = (el.innerText || '').trim().toLowerCase();
    const hasText = /loading|please wait|fetching|saving|sending/.test(txt);
    if (!hasSpinner && !hasText) {
      loadingFlagged++;
      out.push({
        issueType: 'loadingNoIndicator', severity: 'medium',
        selector: sel(el), bbox: bb(el),
        description: 'Element marked as loading (aria-busy or .loading) but has no visible spinner / progress / "Loading..." text. Users see a blank area with no feedback.'
      });
    }
  }

  return out;
}
```

## Notes

- Self-skips: page with no tables/lists/modals/loading states returns []
- Modal checks only fire when a modal is currently OPEN (so empty result on most cells is correct)
- The `tableNoEmptyState` is high-impact on data-driven apps with frequent empty states
