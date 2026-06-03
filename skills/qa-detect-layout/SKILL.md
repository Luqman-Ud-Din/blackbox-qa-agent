---
name: qa-detect-layout
description: "Detects fixed/sticky overflow, narrow content, CTA below fold, dropdown cutoff, content bleed-through, critical-element-hidden, excessive whitespace, sticky-covers-action, table overflow, fixed header obstructing content"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: true
---

## What it checks
- `fixedElementOverflow` — fixed/sticky element extending past viewport
- `contentTooNarrow` — main content < 280px wide
- `ctaBelowFold` — primary CTA below the fold
- `dropdownCutOff` — visible dropdown/menu/listbox extending past viewport
- `contentBleedThrough` — drawer/modal open without making background inert
- `criticalElementHidden` — submit/CTA covered by overlay OR completely off-screen
- `excessiveWhitespace` — section with >300px combined padding+margin taking >60% of viewport with little content
- `stickyElementCoversAction` — fixed/sticky bottom element overlapping a button
- `tableOverflow` — `<table>` wider than its container with no horizontal scroll wrapper (mobile/tablet only)
- `fixedHeaderObstructsContent` — fixed/sticky top navbar covers the first main content element

## Probe (browser_evaluate)
```js
() => {
  const sel = el => (el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')).slice(0,120);
  const out = [];
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vw = innerWidth, vh = innerHeight;

  // 1. fixedElementOverflow
  for (const el of document.querySelectorAll('*')) {
    if (out.length >= 20) break;
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 2 || r.bottom > vh + 2) {
      out.push({ issueType:'fixedElementOverflow', severity:'high', selector:sel(el),
        description:`${s.position} element extends beyond viewport: right=${Math.round(r.right)}px (vw=${vw}px)`, bbox: bb(el) });
    }
  }

  // 2. contentTooNarrow
  const main = document.querySelector('main, [role="main"], #main, #content, .content, .container');
  if (main) {
    const r = main.getBoundingClientRect();
    if (r.width > 0 && r.width < 280) {
      out.push({ issueType:'contentTooNarrow', severity:'medium', selector:sel(main),
        description:`Main content area is only ${Math.round(r.width)}px wide (minimum usable: 280px)`, bbox: bb(main) });
    }
  }

  // 3. ctaBelowFold
  const cta = document.querySelector('button[type="submit"], a.cta, .btn-primary, [data-testid*="cta"]');
  if (cta) {
    const r = cta.getBoundingClientRect();
    if (r.top > vh) {
      out.push({ issueType:'ctaBelowFold', severity:'medium', selector:sel(cta),
        description:`Primary CTA is below the fold: top=${Math.round(r.top)}px, viewport height=${vh}px`, bbox: bb(cta) });
    }
  }

  // 4. dropdownCutOff — visible dropdowns/menus/listboxes extending past viewport
  const dropdownSel = '[role="menu"],[role="listbox"],[role="combobox"][aria-expanded="true"],.dropdown-menu.show,.dropdown.open .dropdown-menu,[class*="dropdown"][class*="open"] [class*="menu"],.menu-open .menu-content,[data-testid*="dropdown"][aria-expanded="true"]';
  for (const el of document.querySelectorAll(dropdownSel)) {
    if (out.length >= 20) break;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 2 || r.bottom > vh + 2 || r.left < -2 || r.top < -2) {
      out.push({ issueType:'dropdownCutOff', severity:'medium', selector:sel(el),
        description:`Dropdown/menu panel extends beyond viewport: rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}] vw=${vw} vh=${vh}`, bbox: bb(el) });
    }
  }

  // 5. contentBleedThrough — open dialog/drawer without making main content inert
  const openDialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]),.drawer.open,.sidebar.open,.modal.show,[class*="drawer"][class*="open"]');
  let hasOpenDialog = false;
  for (const d of openDialogs) {
    const r = d.getBoundingClientRect();
    const s = getComputedStyle(d);
    if (s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0) {
      hasOpenDialog = true; break;
    }
  }
  if (hasOpenDialog) {
    const bgMain = document.querySelector('main, [role="main"]');
    if (bgMain && !bgMain.hasAttribute('inert') && bgMain.getAttribute('aria-hidden') !== 'true') {
      const tabs = bgMain.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (tabs.length > 0) {
        out.push({ issueType:'contentBleedThrough', severity:'high', selector:sel(bgMain),
          description:`Open drawer/modal but background <main> still has ${tabs.length} tabbable elements — add inert or aria-hidden="true"`, bbox: bb(bgMain) });
      }
    }
  }

  // 6. criticalElementHidden — submit/CTA either off-screen OR covered by another element
  const criticals = document.querySelectorAll('button[type="submit"]:not([disabled]), input[type="submit"]:not([disabled]), a.cta, .btn-primary, .primary-button, [data-testid*="submit"]');
  for (const el of criticals) {
    if (out.length >= 20) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const offScreen = r.right < 0 || r.left > vw || r.bottom < 0 || r.top > vh;
    if (offScreen) {
      out.push({ issueType:'criticalElementHidden', severity:'high', selector:sel(el),
        description:`Critical button completely off-screen: rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}] viewport=${vw}x${vh}`, bbox: bb(el) });
      continue;
    }
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx >= 0 && cx <= vw && cy >= 0 && cy <= vh) {
      const topEl = document.elementFromPoint(cx, cy);
      if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
        out.push({ issueType:'criticalElementHidden', severity:'high', selector:sel(el),
          description:`Critical button covered by another element at center: ${sel(topEl)} is on top`, bbox: bb(el) });
      }
    }
  }

  // 7. excessiveWhitespace — section with massive padding+margin and little content
  for (const el of document.querySelectorAll('section, main > div, .container > div, .row, .row > div')) {
    if (out.length >= 20) break;
    const s = getComputedStyle(el);
    const padTop = parseFloat(s.paddingTop) || 0;
    const padBot = parseFloat(s.paddingBottom) || 0;
    const marTop = parseFloat(s.marginTop) || 0;
    const marBot = parseFloat(s.marginBottom) || 0;
    const totalSpace = padTop + padBot + marTop + marBot;
    if (totalSpace < 300) continue;
    const r = el.getBoundingClientRect();
    if (r.height < vh * 0.6) continue;
    const innerText = (el.innerText || '').trim();
    if (innerText.length > 100) continue;
    out.push({ issueType:'excessiveWhitespace', severity:'medium', selector:sel(el),
      description:`Section has ${Math.round(totalSpace)}px combined padding+margin, ${Math.round(r.height)}px tall, only ${innerText.length} chars of text — wasted screen space`, bbox: bb(el) });
  }

  // 8. stickyElementCoversAction — fixed/sticky bottom element overlapping a button
  const stickies = [];
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // bottom-anchored: bottom of element in lower 1/3 of viewport
    if (r.bottom > vh - vh / 3 && r.top > vh / 2) {
      stickies.push({ el, r });
    }
  }
  for (const { el: fixed, r: fr } of stickies) {
    if (out.length >= 20) break;
    const buttons = document.querySelectorAll('button:not([disabled]), [role="button"], input[type="submit"]:not([disabled]), a.btn, .btn');
    for (const btn of buttons) {
      if (fixed.contains(btn) || btn.contains(fixed)) continue;
      const br = btn.getBoundingClientRect();
      if (br.width === 0 || br.height === 0) continue;
      const overlapH = Math.min(br.right, fr.right) - Math.max(br.left, fr.left);
      const overlapV = Math.min(br.bottom, fr.bottom) - Math.max(br.top, fr.top);
      if (overlapH > 0 && overlapV > 0) {
        out.push({ issueType:'stickyElementCoversAction', severity:'medium', selector:sel(btn),
          description:`Button covered by sticky/fixed bottom element (${sel(fixed)}): button at top=${Math.round(br.top)}, sticky at top=${Math.round(fr.top)}`, bbox: bb(btn) });
        break;
      }
    }
  }

  // 9. tableOverflow — table wider than container without horizontal scroll wrapper (mobile/tablet only)
  const isMobileOrTablet = vw <= 1024;
  if (isMobileOrTablet) {
    for (const table of document.querySelectorAll('table')) {
      if (out.length >= 20) break;
      const parent = table.parentElement;
      if (!parent) continue;
      const tr = table.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      if (tr.width === 0 || pr.width === 0) continue;
      if (table.scrollWidth <= parent.clientWidth + 5) continue;
      const parentOverflow = getComputedStyle(parent).overflowX;
      if (parentOverflow === 'auto' || parentOverflow === 'scroll') continue;
      out.push({ issueType:'tableOverflow', severity:'medium', selector:sel(table),
        description:`Table wider than container without horizontal scroll: tableScrollWidth=${table.scrollWidth}px, parentClientWidth=${parent.clientWidth}px, parent overflow-x=${parentOverflow}`, bbox: bb(table) });
    }
  }

  // 10. fixedHeaderObstructsContent — fixed/sticky top navbar covers first main content element
  let topFixed = null;
  let topFixedHeight = 0;
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Anchored at top
    if (r.top > 5) continue;
    if (r.bottom > topFixedHeight) {
      topFixed = el;
      topFixedHeight = r.bottom;
    }
  }
  if (topFixed && topFixedHeight > 0) {
    const main = document.querySelector('main, [role="main"], #main, router-outlet, ng-component');
    if (main) {
      // Find first visible child of main with text content
      let firstChild = null;
      for (const child of main.querySelectorAll('h1, h2, h3, p, button, a, section, article, div')) {
        const cr = child.getBoundingClientRect();
        if (cr.width === 0 || cr.height === 0) continue;
        const cs = getComputedStyle(child);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        firstChild = child;
        break;
      }
      if (firstChild) {
        const cr = firstChild.getBoundingClientRect();
        if (cr.top < topFixedHeight) {
          out.push({ issueType:'fixedHeaderObstructsContent', severity:'medium', selector:sel(firstChild),
            description:`Fixed/sticky header (${sel(topFixed)}, height=${Math.round(topFixedHeight)}px) covers first content element (${sel(firstChild)}, top=${Math.round(cr.top)}px). Add padding-top or scroll-margin-top to compensate.`, bbox: bb(firstChild) });
        }
      }
    }
  }

  return out;
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| fixedElementOverflow | high | "{position} element extends beyond viewport" |
| contentTooNarrow | medium | "Main content area is only {w}px wide" |
| ctaBelowFold | medium | "Primary CTA is below the fold" |
| dropdownCutOff | medium | "Dropdown/menu panel extends beyond viewport" |
| contentBleedThrough | high | "Open drawer/modal but background still tabbable" |
| criticalElementHidden | high | "Critical button off-screen or covered" |
| excessiveWhitespace | medium | "Section has {N}px padding+margin with little text" |
| stickyElementCoversAction | medium | "Button covered by sticky/fixed bottom element" |
| tableOverflow | medium | "Table wider than container ({tableScrollWidth}px vs {parentClientWidth}px) without horizontal scroll wrapper" |
| fixedHeaderObstructsContent | medium | "Fixed/sticky header covers first content element — add padding-top or scroll-margin-top" |
