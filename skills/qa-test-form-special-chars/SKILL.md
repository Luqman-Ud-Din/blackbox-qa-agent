---
name: qa-test-form-special-chars
description: "Tests text inputs with SQL-quote, XSS payload, Unicode + emoji to detect XSS reflection, crashes, and server 5xx on special characters"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## What it checks

Types three classes of special-character payloads into text inputs:

| Payload | What it detects |
|---------|-----------------|
| `<script>alert('argusXss')</script>` | XSS reflection — payload rendered as HTML without escaping |
| `O'Reilly--DROP` | SQL apostrophe handling — pages that 500 on quotes |
| `测试 🚀 ñ ü العربية` | Unicode + emoji + RTL handling |

Verifies the page does not crash, the payload does not get reflected unescaped, and (if the user submits) the server does not return 5xx.

## Orchestrator flow

**Page-state-safe rules:**
- This skill ONLY types into form fields. It does NOT click submit.
- Final cleanup (step 5) clears every field that was modified.

1. Run `probe.findTextInputs` — returns up to 3 visible text/textarea inputs in the first form.
   - If zero inputs are returned, **self-skip** the cell with no findings.
2. Define the payloads array (in orchestrator memory):
   ```
   PAYLOADS = [
     { id: 'xss',     value: "<script>alert('argusXss')</script>" },
     { id: 'sqlish',  value: "O'Reilly--DROP" },
     { id: 'unicode', value: "测试 🚀 ñ ü العربية" }
   ]
   ```
3. For each input from step 1 (max 3):
   For each payload in PAYLOADS:
     a. `browser_evaluate`: clear field via `el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true}))`
     b. `browser_type` text=payload.value into the field (use `browser_type` — events must fire)
     c. `browser_press_key` 'Tab' to blur
     d. `browser_wait_for(time=250)`
     e. Run `probe.checkXssReflection({payload: payload.value, marker: 'argusXss'})`
        - If `reflected` is true → emit `xssReflection` (high)
     f. Run `probe.checkPageHealth`
        - If `hasErrorPage` is true → emit `crashOnSpecialChars` (high) and break out of the payload loop for this field (the page is broken; further input would be noise)
4. Network 5xx detection is performed separately by `qa-detect-network-errors` running in the same cell — no extra probe needed here.
5. Run `probe.clearAllTextInputs({count: <number of inputs from step 1>})` to leave the page clean for the next skill.

## Probes (browser_evaluate)

```js
// probe.findTextInputs
() => {
  const forms = [...document.querySelectorAll('form')].slice(0, 1);
  const out = [];
  for (const f of forms) {
    const inputs = [...f.querySelectorAll(
      'input[type="text"], input[type="search"], input[type="email"], ' +
      'input[type="url"], input[type="tel"], input:not([type]), textarea'
    )]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
      })
      .slice(0, 3);
    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i];
      out.push({
        idx: i,
        name: el.name || el.id || `field${i}`,
        selector: el.id ? `#${el.id}` : `input[name="${el.name}"]`
      });
    }
  }
  return out;
}
```

```js
// probe.checkXssReflection  — args: { payload, marker }
({payload, marker}) => {
  // Detection 1 — a real <script> element with our marker was added to the DOM (worst case)
  for (const s of document.querySelectorAll('script')) {
    if (s.textContent && s.textContent.includes(marker)) {
      return { reflected: true, severity: 'critical', evidence: 'script tag with payload marker injected into DOM' };
    }
  }
  // Detection 2 — the raw payload string appears in document.body.innerHTML as-is (un-encoded)
  const bodyHTML = (document.body && document.body.innerHTML || '');
  // The dangerous case: the literal "<" character from the payload is in innerHTML.
  // Properly encoded output would have "&lt;" instead. So we look for the marker text
  // appearing AFTER an unencoded "<" within a small neighborhood.
  if (payload.includes('<') && bodyHTML.includes(marker)) {
    const markerIdx = bodyHTML.indexOf(marker);
    const before = bodyHTML.slice(Math.max(0, markerIdx - 60), markerIdx);
    if (before.includes('<')) {
      return { reflected: true, severity: 'high', evidence: 'payload appears unescaped in document HTML' };
    }
  }
  return { reflected: false };
}
```

```js
// probe.checkPageHealth
() => {
  const bodyText = (document.body && document.body.innerText || '').slice(0, 500);
  return {
    hasBody: !!document.body,
    hasErrorPage:
      !!document.querySelector('.error-page, [data-error], #__next-error, .next-error-h1') ||
      /Application error|Internal Server Error|500|something went wrong|Uncaught/i.test(bodyText)
  };
}
```

```js
// probe.clearAllTextInputs  — args: { count }
({count}) => {
  const forms = [...document.querySelectorAll('form')].slice(0, 1);
  let cleared = 0;
  for (const f of forms) {
    const inputs = f.querySelectorAll(
      'input[type="text"], input[type="search"], input[type="email"], ' +
      'input[type="url"], input[type="tel"], input:not([type]), textarea'
    );
    for (let i = 0; i < Math.min(inputs.length, count); i++) {
      try {
        inputs[i].value = '';
        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
        cleared++;
      } catch (_) {}
    }
  }
  return { cleared };
}
```

## Issues
| issueType | severity | description |
|---|---|---|
| xssReflection | high | "Field '{name}' reflects XSS payload into DOM unescaped — possible cross-site scripting vulnerability" |
| crashOnSpecialChars | high | "Page entered error state after typing special-character payload '{payloadId}' into field '{name}'" |

## Notes
- Skill is **non-destructive**: never submits, never navigates.
- 5xx server errors triggered by special-character submissions are caught by the separate `qa-detect-network-errors` skill — no overlap here.
- Caps at 1 form × 3 fields × 3 payloads = max 9 typed inputs per cell.
- The marker string `argusXss` is intentionally distinctive to avoid false positives from legitimate page text.
