---
name: qa-form-validation
section: interactive
description: "Consolidated form validation skill. Tests BOTH real <form> elements AND form-less input groups (div+inputs+button, the common Angular/React case — so it runs on login/signup/forgot even without a <form> tag). Owns ALL validation testing on EVERY field: required/empty-submit, data-type, size/length, BOUNDARY values (min/max), format/syntax (pattern), CROSS-FIELD (password match, date range, confirm-email), real-time feedback, whitespace, oversize, maxlength, error-summary, aria-describedby, and XSS/SQL/Unicode injection on every field."
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
cacheVersion: "1.0.0"
ownership: "exclusive: any validation finding — required/format/range/feedback/error-summary/help-text — belongs to this skill"
replaces:
  - qa-detect-form-validation
  - qa-detect-form-error-summary
  - qa-test-form-realtime
  - qa-test-form-boundaries
  - qa-test-form-special-chars
  - qa-test-form-submit-state
---

# qa-form-validation — Consolidated Form Validation Skill

**Production-ready replacement** for 5 separately-maintained skills that overlapped in detection. This skill owns EVERY validation-related bug type in the agent. By construction, no other skill emits validation findings — eliminating duplicate ADO tickets.

---

## What it checks (UNION of 22 issue types from 6 source skills + 8 gap-fixes 2026-06-03)

| Issue type | Severity | What it catches | Test phase |
|---|---|---|---|
| `noValidationOnEmptySubmit` | high | Form with `required` fields submits empty without error | Phase 2: empty submit |
| `noEmailValidation` | medium | `input[type=email]` accepts invalid format like "notanemail" | Phase 2: per-field |
| `noRealtimeValidation` | medium | Field accepts type-invalid value with no inline feedback after blur | Phase 2: per-field |
| `whitespaceAccepted` | medium | Required field accepts whitespace-only input | Phase 2: per-field |
| `pageCrashOnLargeInput` | high | 10K character input crashes the page | Phase 2: per-field |
| `maxLengthNotEnforced` | medium | Field has `maxlength` but accepts oversize input | Phase 2: per-field |
| `xssReflection` | high | XSS payload reflected unescaped in DOM | Phase 2: per-field |
| `crashOnSpecialChars` | high | Special-char payload (SQL/XSS/Unicode) crashes page | Phase 2: per-field |
| `noErrorSummary` | medium | Long form (5+ fields) lacks WCAG 3.3.1 error summary at top | Phase 1: passive |
| `helpTextNotAssociated` | low | Hint text near field not linked via `aria-describedby` | Phase 1: passive |
| `ariaDescribedByBrokenRef` | medium | `aria-describedby` references non-existent ID | Phase 1: passive |
| `submitNotDisabledWhenInvalid` | medium | Submit enabled while required fields empty — confusing UX | Phase 3: submit-state |
| `submitNoLoadingState` | low | No loading/spinner/disabled state on submit click — users may double-submit | Phase 3: submit-state |
| `noBeforeUnloadWarning` | low | Dirty form (data entered) has no beforeunload warning — accidental data loss | Phase 3: submit-state |
| `pastePreventedOnPassword` | medium | Password field has `onpaste="return false"` or paste-prevent handler — breaks password managers | Phase 1: passive |
| `hiddenRequiredBlocksSubmit` | high | `[required]` field is `display:none` / `visibility:hidden` — submit fails silently with no visible error | Phase 1: passive |
| `untranslatedFormError` | medium | Error message displays raw i18n key (`error.field.required`, `{{field.required}}`) | Phase 1: passive |
| `serverValidationNotShown` | high | Server returned validation error in response body but no error UI rendered | Phase 4: advanced |
| `doubleSubmitAllowed` | high | Rapid double-click on submit produces two requests (causes duplicate orders/transactions) | Phase 4: advanced |
| `noRateLimitOnSubmit` | low | 10× rapid submit accepted without throttle/429 — DOS risk | Phase 4: advanced |
| `backNavLosesFormData` | medium | Filling form, navigating away, then back via browser back-button loses all entered data | Phase 4: advanced |
| `noPostRedirectGet` | medium | After successful submit, refresh re-POSTs the form (no 302 redirect → duplicate submission) | Phase 4: advanced |
| `happySubmitNoFeedback` | high | Valid data submitted but the UI showed neither success nor error feedback | Phase 5: happy-path (gated) |
| `validRejectedAsInvalid` | high | Form rejected legitimate valid input — over-strict validation blocks real users | Phase 5: happy-path (gated) |
| `boundaryMaxNotEnforced` | medium | Number/date field accepts a value just OVER its `max` | Phase 2: 4f boundary |
| `boundaryMinNotEnforced` | medium | Number/date field accepts a value just UNDER its `min` | Phase 2: 4f boundary |
| `formatNotEnforced` | medium | Field with a `pattern` (or known format: phone/zip/card/date) accepts a malformed value | Phase 2: 4g format |
| `passwordMismatchNotCaught` | high | Two password fields submit with different values, no "passwords don't match" error | Phase 2: 4.5 cross-field |
| `dateRangeNotValidated` | medium | End date accepted before start date with no error | Phase 2: 4.5 cross-field |
| `emailMismatchNotCaught` | medium | Email + confirm-email submit mismatched with no error | Phase 2: 4.5 cross-field |

---

## Self-skip conditions

Skip silently (no findings, no error) ONLY if:
- **Zero testable inputs** on the page (text/email/number/password/tel/url/search/date/textarea/select, visible, not disabled/readonly). ← This is the ONLY input-based skip.
- Page already in an error state (would produce noise).

🚨 **Do NOT skip just because there is no `<form>` element.** Modern apps (Angular/React) commonly build forms as `<div>` + inputs + a button with NO `<form>` tag — `probe.findTestableForms` detects these "form-less" groups too. The old "no `<form>` → skip" rule is what made this skill silently skip login/signup/forgot/register. It is removed.

---

## Orchestrator flow

The skill runs in TWO phases — passive detection first, active testing second. This ordering allows the orchestrator to skip Phase 2 entirely if the page is broken or empty.

### Phase 1 — Passive Detection (no interaction, ~$0.0005 per cell)

1. Run `probe.passiveScan`. Returns array of findings for:
   - Error summary check (every form with 5+ fields)
   - `aria-describedby` integrity (every visible input)
   - Help-text association (every input without `aria-describedby`)
2. Append all Phase 1 findings to JSONL. Total cost: one `browser_evaluate` round-trip.

### Phase 2 — Active Validation Testing (interactive, ~$0.003 per cell)

**Page-state contract:**
- This skill ONLY types into form fields. It NEVER clicks submit on a real submit handler (uses `preventDefault` shim).
- Final cleanup (step 6) clears every modified field.
- If page crashes mid-test, abort remaining tests, emit `crashOnSpecialChars` or `pageCrashOnLargeInput`, run cleanup, exit.

#### Step 1 — Discover forms and fields

Run `probe.findTestableForms`. Returns up to 2 forms × up to 5 fields each, with metadata (type, name, maxLength, required, selector). Self-skip if zero fields.

#### Step 2 — Capture baseline page health

Run `probe.checkPageHealth`. Save `initialBodyChildCount`. If page already in error state, abort.

#### Step 3 — Empty submit test (ONE per form)

For each form (real `<form>` **OR** form-less group) with `formHasRequired === true` (or ≥2 fields when `required` can't be detected):

**3a. Install a submit guard that works for BOTH form types** (so the click can't actually submit, navigate, or create data — safe for login/signup):
```js
() => {
  window.__argusSubmitFired = false;
  document.querySelectorAll('form').forEach(f =>
    f.addEventListener('submit', e => { e.preventDefault(); window.__argusSubmitFired = true; }, { capture: true, once: true }));
  // form-LESS groups submit via a button → fetch/XHR/navigation. Block + flag them.
  window.__argusOf = window.fetch;
  window.fetch = function(){ window.__argusSubmitFired = true; return Promise.reject(new Error('argus-blocked')); };
  window.__argusOx = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(){ window.__argusSubmitFired = true; };
  window.onbeforeunload = e => { e.preventDefault(); return ''; };
  return true;
}
```
**3b.** `browser_click` the form's `submitSelector`. If that button is already `disabled`, skip (that's `submitNotDisabledWhenInvalid`, Phase 3).
**3c.** `browser_wait_for(time = 600)`.
**3d.** Run `probe.checkValidationVisible({formIdx})` and read `window.__argusSubmitFired`.
**3e. Decide:**
- An error/validation message appeared → validation works → no finding.
- NO error AND `__argusSubmitFired === true` (a real `<form>` submit or a blocked fetch/XHR was attempted with empty fields) → **`noValidationOnEmptySubmit` (high)** — the form tried to submit empty with no feedback.
**3f.** Restore: `browser_evaluate(() => { window.fetch = window.__argusOf; XMLHttpRequest.prototype.send = window.__argusOx; window.onbeforeunload = null; })`.

#### Step 4 — Per-field testing (EVERY field, up to 25 per form)

For **every** field in each form (not a 5-field sample), run this test sequence. **Order matters** — fastest/cheapest payloads first so we can abort early on a crash. (Old behavior capped at 5 fields, leaving most of a form untested; now it covers all fields up to 25.)

**Test 4a — Type-invalid (real-time validation)**
- `browser_evaluate`: clear field
- `browser_type` text = (type-appropriate invalid value):
  - email → `abc`
  - number → `xyz`
  - url → `not a url`
  - tel → `letters here`
  - other → `x`
- `browser_press_key` 'Tab'
- `browser_wait_for(time = 450)`
- Run `probe.checkInlineFeedback({formIdx, fieldIdx})`
- If `!errorVisible` → emit `noRealtimeValidation` (medium)

**Test 4b — Email-specific (only if `type=email`)**
- `browser_evaluate`: clear field
- `browser_type` text = `'notanemail'`
- `browser_press_key` 'Tab'
- `browser_wait_for(time = 300)`
- Run `probe.checkInlineFeedback({formIdx, fieldIdx})`
- If `!errorVisible` → emit `noEmailValidation` (medium)

**Test 4c — Whitespace-only**
- `browser_evaluate`: clear field
- `browser_type` text = `'     '` (5 spaces)
- `browser_press_key` 'Tab'
- `browser_wait_for(time = 350)`
- Run `probe.checkInlineFeedback({formIdx, fieldIdx})`
- If `formHasRequired` AND `!errorVisible` → emit `whitespaceAccepted` (medium)

**Test 4d — Oversize (10K characters)**
- `browser_evaluate`: clear field then `el.value = 'x'.repeat(10000); dispatchEvent('input')`
- `browser_press_key` 'Tab'
- `browser_wait_for(time = 500)`
- Run `probe.checkPageHealth`
- If `hasErrorPage` → emit `pageCrashOnLargeInput` (high), break out of field loop, jump to cleanup
- Run `probe.checkFieldLength({formIdx, fieldIdx})`
- If `maxLength` set AND `actualLength > maxLength` → emit `maxLengthNotEnforced` (medium)

**Test 4e — Special-char / injection payloads (now EVERY field, not just the first 3)**

For each of these payloads:
```
{ id: 'xss',     value: "<script>alert('argusXss')</script>" }
{ id: 'sqlish',  value: "O'Reilly'; DROP TABLE users;--" }
{ id: 'unicode', value: "测试 🚀 ñ ü العربية" }
```

- `browser_evaluate`: clear field
- `browser_type` text = payload.value
- `browser_press_key` 'Tab'
- `browser_wait_for(time = 250)`
- Run `probe.checkXssReflection({payload, marker: 'argusXss'})`
- If `reflected` → emit `xssReflection` (severity from probe: `critical` or `high`)
- Run `probe.checkPageHealth`
- If `hasErrorPage` → emit `crashOnSpecialChars` (high), break out of payload loop for this field

**Test 4f — Boundary-value testing (only when the field has `min`/`max`/`step` or is a number/date type)** — closes Category 4:
- If `max` is set: clear → type `(max + step|1)` (just OVER the max) → Tab → `probe.checkInlineFeedback`. If `!errorVisible` → `boundaryMaxNotEnforced` (medium).
- If `min` is set: clear → type `(min - step|1)` (just UNDER the min) → Tab → check. If `!errorVisible` → `boundaryMinNotEnforced` (medium).
- For unbounded number fields: try `-1`, `0`, and a very large value (`9999999999`); if a clearly out-of-range value is accepted where context implies a range (age, quantity, price) → `uncertain: true` (escalate to Sonnet to judge).

**Test 4g — Format / syntax testing (when the field has a `pattern`, or is a known format type)** — closes Category 5:
- If `pattern` attribute is set: clear → type a value that violates the pattern (e.g. for `[0-9]+` type `abc`) → Tab → check. If `!errorVisible` → `formatNotEnforced` (medium).
- Heuristic format checks by `name`/`placeholder` keyword (no pattern attr): `phone`/`tel` → type `abc123` ; `zip`/`postal` → `!!!` ; `card`/`cc` → `1234` ; `date` (text field) → `99/99/9999`. If accepted with no feedback → `formatNotEnforced` (low, `uncertain: true`).

#### Step 4.5 — Cross-field / logical validation (per form)** — closes Category 7 (cross-field):
- **Password match:** if the form has ≥2 `isPassword` fields → type DIFFERENT values in them (`Argus#123` vs `Argus#124`) → click submit (guarded as Step 3) → `probe.checkValidationVisible`. If no error → `passwordMismatchNotCaught` (high).
- **Date range:** if the form has two date fields whose names match `start|from` and `end|to|until` → set end **before** start → Tab/submit → check. If no error → `dateRangeNotValidated` (medium).
- **Confirm-email:** two `type=email` fields with names `email` and `confirm*`/`*confirm` → type mismatched → check → `emailMismatchNotCaught` (medium).
Each cross-field check sets `uncertain: true` when the relationship is inferred from names (let Sonnet confirm the fields are actually a pair).

#### Step 5 — Final page-health check

Run `probe.checkPageHealth` one more time. If `hasErrorPage` AND it wasn't true at baseline → emit `crashOnSpecialChars` once for the cell with `selector: 'form'`.

#### Step 5.5 — Phase 3: Submit-state checks (NEW, added 2026-06-03)

Active interaction WITHOUT actually navigating. Tests behaviors developers commonly miss.

**Test 5.5a — Submit disabled when invalid**
- Run `probe.findSubmitContext`. Returns `{found, submitSelector, hasRequiredEmpty, submitDisabled}`
- If `found === true` AND `hasRequiredEmpty === true` AND `submitDisabled === false` → emit `submitNotDisabledWhenInvalid` (medium)

**Test 5.5b — Submit loading state**
- Run `probe.fillRequiredWithMarkers` to make the form valid (placeholder values)
- `browser_click` the submit button — **DO NOT wait for navigation** (test immediate visual state only)
- `browser_wait_for(time = 300)`
- Run `probe.checkSubmitLoadingState({submitSelector})`
- If `hasLoading === false` AND `stillEnabled === true` → emit `submitNoLoadingState` (low)
- **Important:** if the click triggers a real navigation, the orchestrator's resilience layer (cellTimeout) catches it. We do NOT navigate back here.

**Test 5.5c — Beforeunload warning**
- Run `probe.makeFormDirty` — type "argusDirty" into the first text input
- Run `probe.testBeforeUnloadHandler` — synthesizes a beforeunload event, checks if app intercepts
- If `hasHandler === false` → emit `noBeforeUnloadWarning` (low)

#### Step 6 — Cleanup (MANDATORY)

Run `probe.clearAllFields({formCount: 2, fieldCount: 5})` AND `probe.cleanupSubmitTest`. This empties every text/email/number/tel/url/search/textarea input in the first 2 forms AND clears the beforeunload marker. Leaves the page in a clean state for the next skill in the cell.

---

### Step 5.6 — Phase 4: Advanced UX/Security tests (NEW, added 2026-06-03)

Phase 4 runs after Phase 3 completes. These tests require multiple browser interactions and can be skipped by passing `--no-form-phase4` if cost is a concern. Phase 4 covers the 5 highest-impact bugs that need real interaction to detect.

**Skip Phase 4 if:**
- Page has no form with a submit button (nothing to exercise).
- `customize.toml → [form] enable_phase4 = false` is set.
- Previous Phase 2/3 detected `pageCrashOnLargeInput` — page is broken, don't make it worse.

#### 5.6.1 — doubleSubmitAllowed (highest impact)

1. Find the first form's submit button via the same selector used in Phase 3.
2. Fill all required fields with safe valid values (reuse Phase 2 valid-value generator).
3. Install a fetch/XHR counter via `browser_evaluate`:
   ```js
   () => {
     window.__argusSubmitCount = 0;
     const origFetch = window.fetch;
     window.fetch = function(...a) { window.__argusSubmitCount++; return origFetch.apply(this, a); };
     const origOpen = XMLHttpRequest.prototype.open;
     XMLHttpRequest.prototype.open = function(...a) { window.__argusSubmitCount++; return origOpen.apply(this, a); };
   }
   ```
4. `browser_click` on submit twice within 100ms (use same selector, no wait).
5. `browser_wait_for(time = 1000)`.
6. `browser_evaluate(() => window.__argusSubmitCount)` — if ≥ 2 → emit:
   ```json
   { "issueType": "doubleSubmitAllowed", "severity": "high",
     "description": "Two rapid submit clicks produced 2 network requests — site allows duplicate submissions. Add disabled state on submit OR client-side debounce." }
   ```

#### 5.6.2 — backNavLosesFormData

1. Fill form fields with a known sentinel (e.g. `"argus_test_42"`).
2. `browser_evaluate(() => location.href)` → save current URL.
3. `browser_navigate(url = location.origin)` (navigate away to root).
4. `browser_navigate(url = savedUrl)` (or use browser_back if available).
5. `browser_evaluate(probe.checkFormFields)` — read each field's current value.
6. If sentinel value is missing → emit:
   ```json
   { "issueType": "backNavLosesFormData", "severity": "medium",
     "description": "Form fields are blank after browser back-navigation. Add autosave to localStorage/sessionStorage so users don't lose work." }
   ```

#### 5.6.3 — noPostRedirectGet

1. Fill form with safe valid values.
2. Install response observer via `browser_evaluate`:
   ```js
   () => {
     window.__argusResponses = [];
     const origFetch = window.fetch;
     window.fetch = function(...a) {
       return origFetch.apply(this, a).then(r => { window.__argusResponses.push({ status: r.status, redirected: r.redirected, url: r.url }); return r; });
     };
   }
   ```
3. `browser_click` on submit.
4. `browser_wait_for(time = 2000)`.
5. Inspect `window.__argusResponses`. The form-handling response should be one of:
   - HTTP 302/303 redirect followed by a GET, OR
   - HTTP 200 SPA response that triggers `history.pushState` to a new URL
6. If response is HTTP 200 AND `location.href` is unchanged → emit:
   ```json
   { "issueType": "noPostRedirectGet", "severity": "medium",
     "description": "Form submit returned 200 without redirect. Refreshing the page will re-POST the form (duplicate submission). Use Post/Redirect/Get pattern (302) or pushState." }
   ```

#### 5.6.4 — serverValidationNotShown

1. Fill form with valid-looking data that the server will REJECT (use a known sentinel like email = `"server-reject@argus.test"`).
2. Submit. Capture the server response body via the same fetch observer.
3. If response includes `errors`, `error_messages`, or `validationErrors` arrays (or HTTP 422), wait 1000ms then check DOM for error display:
   - `browser_evaluate(() => document.querySelectorAll('[role="alert"], .error, .invalid-feedback').length > 0)`
4. If server returned errors but DOM has none → emit:
   ```json
   { "issueType": "serverValidationNotShown", "severity": "high",
     "description": "Server returned validation errors but UI did not display them. Users have no way to know what went wrong." }
   ```

This test depends on the server actually rejecting the sentinel; skip if the server accepts it (the test is inconclusive, not a bug).

#### 5.6.5 — noRateLimitOnSubmit

1. Submit the form 10 times in 1 second (`browser_click` × 10 with no wait).
2. Capture all response statuses via the fetch observer.
3. If ALL 10 returned 2xx without a single 429/503 → emit:
   ```json
   { "issueType": "noRateLimitOnSubmit", "severity": "low",
     "description": "10 rapid submits all accepted. Server has no rate-limiting on this endpoint — DOS risk and abuse vector. Add throttle middleware." }
   ```

This is server-side; only emit if you confirmed the form actually POSTs to the same origin (CSP/CORS allows it).

### Phase 5 — Happy-path success (GATED — OFF by default)

🚨 **Runs ONLY when `customize.toml [safe_testing] allow_form_submit = true`.** This phase fills VALID data and submits → it **creates a real record** on the target. Default is off, so the audit never mutates data unless you opt in (point it at a dev/sandbox).

**Gate check FIRST:** if `allow_form_submit !== true`, OR `safe_routes` is non-empty and the current route is not in it → SKIP Phase 5 entirely, emit nothing, record ledger evidence `happyPath: "skipped (gated off)"`.

When enabled:
1. Fill every required + visible field with a VALID value by type:
   - email → `argus.qa+{runId}@example.com` · tel → `+15555550123` · number → a mid-range valid value · url → `https://example.com`
   - date → today · select → first non-placeholder option · required checkbox → check
   - text / textarea → `Argus QA test {runId}` (the `{runId}` marker makes the record identifiable for cleanup)
2. Confirm submit is enabled, `browser_click(submit)`, wait 1500ms.
3. Detect success via ANY of: a success toast/alert (`[role=status], .success, .toast-success`), a redirect to a confirmation/list route, or the form clearing/closing.
   - **Success** → no finding; evidence `happyPath: "success: {signal}"`.
   - **No success AND no error shown** → `happySubmitNoFeedback` (high) — valid submit gave the user neither confirmation nor error.
   - **Validation error on VALID data** → `validRejectedAsInvalid` (high) — the form rejected legitimate input (over-strict validation blocks real users); include field + message. If it's plausibly a real business rule → set `uncertain: true` to escalate to Sonnet.
4. **Cleanup:** if `cleanup_after_submit = true` and the app shows a delete/undo for the just-created record (match the `{runId}` marker), attempt it; log success/failure, never fail the audit on cleanup.

New issue types: `happySubmitNoFeedback` (high), `validRejectedAsInvalid` (high).

---

## Probes (browser_evaluate)

```js
// probe.passiveScan — Phase 1, single round-trip
() => {
  const sel = el => {
    const id = el.id ? `#${el.id}` : '';
    return (el.tagName.toLowerCase() + id).slice(0, 120);
  };
  const bb = el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const out = [];

  // 1. Error summary check — every form with 5+ visible fields
  for (const form of document.querySelectorAll('form')) {
    if (out.length >= 6) break;
    const r = form.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const fieldCount = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
    ).length;
    if (fieldCount < 5) continue;

    const firstChild = form.firstElementChild;
    const hasTopSummary =
      !!form.querySelector(':scope > [role="alert"], :scope > .error-summary, :scope > [class*="error-summary"], :scope > [data-testid*="error-summary"]') ||
      (firstChild && /error|invalid|alert/i.test(firstChild.className) && firstChild.querySelector('ul, ol, li'));

    if (!hasTopSummary) {
      out.push({
        issueType: 'noErrorSummary',
        severity: 'medium',
        selector: sel(form),
        description: `Form with ${fieldCount} fields has no error-summary container — WCAG 3.3.1 recommends a top-of-form summary listing all errors`,
        bbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.min(Math.round(r.width), 400), h: 60 }
      });
    }
  }

  // 2. aria-describedby integrity + help-text association
  for (const input of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    if (out.length >= 24) break;
    const r = input.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (input.type === 'submit' || input.type === 'button') continue;

    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy && describedBy.trim().length > 0) {
      const ids = describedBy.trim().split(/\s+/);
      const missingIds = ids.filter(id => !document.getElementById(id));
      if (missingIds.length > 0) {
        out.push({
          issueType: 'ariaDescribedByBrokenRef',
          severity: 'medium',
          selector: sel(input),
          description: `Field has aria-describedby="${describedBy}" but ID(s) "${missingIds.join(', ')}" don't exist`,
          bbox: bb(input)
        });
      }
      continue;
    }

    const container = input.closest('label, div, fieldset, .form-group, .field') || input.parentElement;
    if (!container) continue;
    const hintCandidates = container.querySelectorAll(
      'small, .help-text, .hint, .form-text, .help-block, [class*="description"], p[class*="hint"]'
    );
    for (const hint of hintCandidates) {
      if (hint === input || input.contains(hint)) continue;
      const ht = (hint.innerText || '').trim();
      if (ht.length < 5 || ht.length > 200) continue;
      out.push({
        issueType: 'helpTextNotAssociated',
        severity: 'low',
        selector: sel(input),
        description: `Hint text "${ht.slice(0, 60)}…" near field is not linked via aria-describedby — screen readers won't announce it`,
        bbox: bb(input)
      });
      break;
    }
  }


  // 3. Paste-prevented on password field — known UX antipattern, breaks managers
  for (const pwd of document.querySelectorAll('input[type="password"]')) {
    const onpaste = pwd.getAttribute('onpaste');
    if (onpaste && /return\s+false|preventDefault/i.test(onpaste)) {
      out.push({
        issueType: 'pastePreventedOnPassword',
        severity: 'medium',
        selector: sel(pwd),
        description: 'Password field has onpaste handler that prevents paste — blocks password managers (1Password, Bitwarden, etc.). Known UX antipattern.',
        bbox: bb(pwd)
      });
    }
    // Also check via window event interception — some sites attach listeners
    if (pwd.dataset.preventPaste === 'true' || pwd.classList.contains('no-paste') || pwd.classList.contains('block-paste')) {
      out.push({
        issueType: 'pastePreventedOnPassword',
        severity: 'medium',
        selector: sel(pwd),
        description: 'Password field has data-attribute or class indicating paste is blocked — breaks password managers.',
        bbox: bb(pwd)
      });
    }
  }

  // 4. Hidden required field blocks submit silently
  for (const req of document.querySelectorAll('[required], [aria-required="true"]')) {
    if (req.type === 'hidden') continue;
    if (req.type === 'submit' || req.type === 'button') continue;
    let isVisible = true;
    let cur = req;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') { isVisible = false; break; }
      cur = cur.parentElement;
    }
    if (!isVisible) {
      out.push({
        issueType: 'hiddenRequiredBlocksSubmit',
        severity: 'high',
        selector: sel(req),
        description: `<${req.tagName.toLowerCase()} required> is hidden but \`required\`. Browser HTML5 validation will block submit with no user-visible message — users get stuck. Either remove "required" when hidden or remove the field entirely.`
      });
      if (out.length >= 24) break;
    }
  }

  // 5. Untranslated i18n keys in error/feedback containers
  const errorContainers = document.querySelectorAll(
    '[role="alert"], .error, .invalid-feedback, [class*="error"]:not([class*="errorless"]), ' +
    '[class*="invalid"], small.help-block.error, [data-error]'
  );
  for (const ec of errorContainers) {
    if (out.length >= 24) break;
    const txt = (ec.innerText || ec.getAttribute('data-error') || '').trim();
    if (!txt || txt.length < 4 || txt.length > 200) continue;
    let kind = null;
    if (/^[a-z][a-z0-9_]+(?:\.[a-z][a-z0-9_]+){2,}$/i.test(txt)) kind = 'dot.notation';
    else if (/^\{\{[\w.]+\}\}$/.test(txt)) kind = 'handlebars';
    else if (/^__MSG_\w+__$/.test(txt)) kind = 'chrome-extension';
    else if (/^\[[\w.]+\]$/.test(txt) && /^\[[a-z]/.test(txt)) kind = 'bracket-key';
    if (kind) {
      out.push({
        issueType: 'untranslatedFormError',
        severity: 'medium',
        selector: sel(ec),
        description: `Error message displays raw i18n ${kind} key "${txt.slice(0, 60)}" — translation pipeline did not resolve it. Users will not understand the error.`,
        bbox: bb(ec)
      });
    }
  }

  return out;
}
```

```js
// probe.findTestableForms — detects BOTH real <form> elements AND form-LESS input
// groups (the common Angular/React case: <div> + inputs + a button, no <form> tag).
// This is THE fix for "form-validation never runs on login/signup/forgot": those pages
// are usually form-less, so the old <form>-only detector skipped them entirely.
// Returns up to 6 forms × up to 25 fields, with min/max/pattern/password metadata
// for boundary-value, cross-field and format tests.
() => {
  const FIELD_SEL = 'input[type="text"],input[type="email"],input[type="number"],' +
    'input[type="password"],input[type="search"],input[type="tel"],input[type="url"],' +
    'input[type="date"],input[type="time"],input[type="datetime-local"],input[type="month"],' +
    'input:not([type]),textarea,select';
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly; };
  const SUBMIT_TXT = /sign ?in|log ?in|sign ?up|sign ?on|register|submit|continue|next|save|send|create|update|apply|confirm|verify|search|add\b/i;
  const cssPath = el => el.id ? '#' + CSS.escape(el.id) : (el.name ? `${el.tagName.toLowerCase()}[name="${el.name}"]` : el.tagName.toLowerCase());
  const mapField = (el, i) => ({
    fieldIdx: i,
    type: (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') ? el.tagName.toLowerCase() : (el.type || 'text'),
    name: el.name || el.id || `field${i}`,
    maxLength: el.maxLength > 0 ? el.maxLength : null,
    min: el.min !== '' && el.min != null ? el.min : null,     // for boundary tests
    max: el.max !== '' && el.max != null ? el.max : null,
    step: el.step !== '' && el.step != null ? el.step : null,
    pattern: el.pattern || null,                              // for format/syntax tests
    isPassword: el.type === 'password',                       // for cross-field match
    required: el.required || el.getAttribute('aria-required') === 'true',
    selector: cssPath(el)
  });
  const findSubmit = root => {
    const cand = [...root.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(vis);
    return cand.find(b => b.type === 'submit')
        || cand.find(b => SUBMIT_TXT.test(b.textContent || b.value || b.getAttribute('aria-label') || ''))
        || cand[cand.length - 1] || null;
  };

  const out = [];
  const claimed = new Set();

  // 1. Real <form> elements
  for (const f of document.querySelectorAll('form')) {
    const fields = [...f.querySelectorAll(FIELD_SEL)].filter(vis);
    fields.forEach(el => claimed.add(el));
    if (!fields.length) continue;
    const sub = findSubmit(f);
    out.push({ formIdx: out.length, isRealForm: true, formSelector: cssPath(f),
      formHasRequired: fields.some(el => el.required || el.getAttribute('aria-required') === 'true'),
      hasEmail: fields.some(el => el.type === 'email'),
      submitSelector: sub ? cssPath(sub) : null,
      fields: fields.slice(0, 25).map(mapField) });
  }

  // 2. FORM-LESS input groups — inputs not inside any <form>
  const loose = [...document.querySelectorAll(FIELD_SEL)].filter(el => vis(el) && !claimed.has(el) && !el.closest('form'));
  if (loose.length) {
    const groups = new Map();
    for (const el of loose) {
      const c = el.closest('[class*="form" i],[class*="card" i],[role="dialog"],[class*="modal" i],[class*="login" i],[class*="signup" i],[class*="auth" i],section,fieldset') || document.body;
      (groups.get(c) || groups.set(c, []).get(c)).push(el);
    }
    for (const [c, fields] of groups) {
      const sub = findSubmit(c) || findSubmit(document.body);
      out.push({ formIdx: out.length, isRealForm: false, formSelector: null,   // no <form> → submit is a button, not a form-submit event
        formHasRequired: fields.some(el => el.required || el.getAttribute('aria-required') === 'true'),
        hasEmail: fields.some(el => el.type === 'email'),
        submitSelector: sub ? cssPath(sub) : null,
        fields: fields.slice(0, 25).map(mapField) });
    }
  }

  return out.filter(f => f.fields.length > 0).slice(0, 6);
}
```

```js
// probe.checkValidationVisible — after empty submit
({formIdx}) => {
  const f = document.querySelectorAll('form')[formIdx];
  if (!f) return { errorCount: 0, formHasRequired: false };
  const errors = f.querySelectorAll(
    '[role="alert"], .error, .invalid-feedback, [aria-invalid="true"], :invalid, ' +
    '.field-error, [data-testid*="error"]'
  );
  return {
    errorCount: errors.length,
    formHasRequired: !!f.querySelector('[required], [aria-required="true"]')
  };
}
```

```js
// probe.checkInlineFeedback — after typing into a field and blurring
({formIdx, fieldIdx}) => {
  const f = document.querySelectorAll('form')[formIdx];
  if (!f) return { errorVisible: false, formHasRequired: false };
  const inputs = f.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="number"], ' +
    'input[type="search"], input[type="tel"], input[type="url"], ' +
    'input:not([type]), textarea'
  );
  const field = inputs[fieldIdx];
  if (!field) return { errorVisible: false, formHasRequired: false };
  const ariaInvalid = field.getAttribute('aria-invalid') === 'true';
  let cssInvalid = false;
  try { cssInvalid = field.matches(':invalid'); } catch (_) {}
  const container = field.closest('label, div, fieldset, .form-group, .field') || field.parentElement;
  const nearbyError = container && container.querySelector(
    '[role="alert"], .error, .invalid-feedback, [data-testid*="error"], ' +
    '.text-red-500, .text-danger, .field-error, .error-message, .form-error'
  );
  return {
    errorVisible: ariaInvalid || cssInvalid || !!nearbyError,
    formHasRequired: !!f.querySelector('[required], [aria-required="true"]'),
    fieldName: field.name || field.id || `field${fieldIdx}`
  };
}
```

```js
// probe.checkFieldLength — after oversize input
({formIdx, fieldIdx}) => {
  const f = document.querySelectorAll('form')[formIdx];
  if (!f) return { actualLength: 0, maxLength: null };
  const inputs = f.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="number"], ' +
    'input[type="search"], input[type="tel"], input[type="url"], ' +
    'input:not([type]), textarea'
  );
  const field = inputs[fieldIdx];
  if (!field) return { actualLength: 0, maxLength: null };
  return {
    actualLength: field.value.length,
    maxLength: field.maxLength > 0 ? field.maxLength : null,
    fieldName: field.name || field.id || `field${fieldIdx}`
  };
}
```

```js
// probe.checkXssReflection — after special-char input
({payload, marker}) => {
  for (const s of document.querySelectorAll('script')) {
    if (s.textContent && s.textContent.includes(marker)) {
      return { reflected: true, severity: 'critical', evidence: 'script tag with payload marker injected into DOM' };
    }
  }
  const bodyHTML = (document.body && document.body.innerHTML || '');
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
// probe.checkPageHealth — used at baseline and after every payload
() => {
  const bodyText = (document.body && document.body.innerText || '').slice(0, 500);
  return {
    hasBody: !!document.body,
    bodyChildCount: document.body ? document.body.children.length : 0,
    hasErrorPage:
      !!document.querySelector('.error-page, [data-error], #__next-error, .next-error-h1') ||
      /Application error|Internal Server Error|500|something went wrong|Uncaught/i.test(bodyText)
  };
}
```

```js
// probe.clearAllFields — Step 6 mandatory cleanup
({formCount, fieldCount}) => {
  const forms = [...document.querySelectorAll('form')].slice(0, formCount);
  let cleared = 0;
  for (const f of forms) {
    const inputs = f.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="number"], ' +
      'input[type="search"], input[type="tel"], input[type="url"], ' +
      'input:not([type]), textarea'
    );
    for (let i = 0; i < Math.min(inputs.length, fieldCount); i++) {
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

### Phase 3 probes (submit-state, added 2026-06-03 to cover qa-test-form-submit-state)

```js
// probe.findSubmitContext — Phase 3 setup
() => {
  const forms = [...document.querySelectorAll('form')].slice(0, 1);
  if (!forms.length) return { found: false };
  const f = forms[0];
  const submit = f.querySelector('button[type="submit"], input[type="submit"]') ||
                 [...f.querySelectorAll('button')].find(b => !b.type || b.type === 'submit');
  if (!submit) return { found: false };
  const r = submit.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { found: false };
  const required = [...f.querySelectorAll('[required], [aria-required="true"]')];
  const hasRequiredEmpty = required.some(el => {
    if (el.type === 'checkbox' || el.type === 'radio') return !el.checked;
    return !el.value || el.value.trim() === '';
  });
  return {
    found: true,
    formIdx: 0,
    submitSelector: submit.id ? `#${submit.id}` : 'form button[type="submit"]',
    hasRequiredEmpty,
    submitDisabled: submit.disabled || submit.getAttribute('aria-disabled') === 'true'
  };
}
```

```js
// probe.fillRequiredWithMarkers — fill required fields so we can test the submit click without triggering validation errors
() => {
  const forms = [...document.querySelectorAll('form')].slice(0, 1);
  if (!forms.length) return { filled: 0 };
  const required = [...forms[0].querySelectorAll('[required], [aria-required="true"]')];
  let filled = 0;
  for (const el of required) {
    try {
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (!el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); filled++; }
      } else if (el.tagName === 'SELECT') {
        if (!el.value && el.options.length > 1) { el.value = el.options[1].value; el.dispatchEvent(new Event('change', { bubbles: true })); filled++; }
      } else if (!el.value) {
        // Type-appropriate placeholder
        if (el.type === 'email') el.value = 'argus@example.com';
        else if (el.type === 'tel') el.value = '5551234567';
        else if (el.type === 'url') el.value = 'https://example.com';
        else if (el.type === 'number') el.value = '1';
        else el.value = 'argus';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        filled++;
      }
    } catch (_) {}
  }
  return { filled };
}
```

```js
// probe.checkSubmitLoadingState — args: { submitSelector }
({submitSelector}) => {
  let submit;
  try { submit = document.querySelector(submitSelector); } catch (_) { return { hasLoading: false, stillEnabled: true }; }
  if (!submit) return { hasLoading: false, stillEnabled: true };
  const disabled = submit.disabled || submit.getAttribute('aria-disabled') === 'true';
  const ariaBusy = submit.getAttribute('aria-busy') === 'true';
  const spinner = submit.querySelector('.spinner, .loader, [class*="loading"], svg.animate-spin, [data-loading="true"]');
  const loadingText = /loading|please wait|submitting|saving|sending/i.test(submit.innerText);
  return {
    hasLoading: disabled || ariaBusy || !!spinner || loadingText,
    stillEnabled: !disabled
  };
}
```

```js
// probe.makeFormDirty — type a marker into first text input
() => {
  const input = document.querySelector('form input[type="text"], form input[type="email"], form textarea');
  if (!input) return { marked: false };
  input.value = 'argusDirty';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { marked: true, selector: input.id ? `#${input.id}` : 'form input' };
}
```

```js
// probe.testBeforeUnloadHandler — synthesize beforeunload event, check if app handler fires
() => {
  let handlerFired = false;
  const probe = (e) => {
    if (e.defaultPrevented || (typeof e.returnValue === 'string' && e.returnValue !== '')) {
      handlerFired = true;
    }
  };
  window.addEventListener('beforeunload', probe, true);
  const evt = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(evt);
  window.removeEventListener('beforeunload', probe, true);
  return { hasHandler: handlerFired || evt.defaultPrevented };
}
```

```js
// probe.cleanupSubmitTest — clear the beforeunload marker, restore form state
() => {
  const input = document.querySelector('form input[type="text"], form input[type="email"], form textarea');
  if (input) {
    try { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
  }
  return { ok: true };
}
```

---

## Cost analysis

| Phase | Round-trips | Estimated cost |
|---|---|---|
| Phase 1 passive | 1 `browser_evaluate` | ~$0.0005 |
| Phase 2 setup | 1 `browser_evaluate` | ~$0.0003 |
| Phase 2 empty submit | 2 forms × (1 evaluate + 1 click + 1 wait + 1 evaluate) | ~$0.001 |
| Phase 2 per-field | 2 forms × 5 fields × ~4 round-trips per test | ~$0.0024 |
| Phase 2 cleanup | 1 `browser_evaluate` | ~$0.0002 |
| **Total per cell with forms** | ~50 round-trips | **~$0.005** |
| Self-skip (no forms) | 1 `browser_evaluate` | ~$0.0001 |

**Cost vs replacing 5 separate skills:** The 5 original skills did duplicate form discovery (each ran its own `probe.findTestableForms`). Consolidated probe runs that once. **Net saving: ~$0.002 per cell with forms.** Plus eliminating duplicate findings reduces bug-filer Sonnet calls by ~$0.005.

---

## Migration from old skills

This skill REPLACES these 6 — disable them in `customize.toml` after parallel verification:

```toml
[detectors]
qa-form-validation             = true    # NEW (this skill)
qa-detect-form-validation      = false   # REPLACED by qa-form-validation
qa-detect-form-error-summary   = false   # REPLACED by qa-form-validation
qa-test-form-realtime          = false   # REPLACED by qa-form-validation
qa-test-form-boundaries        = false   # REPLACED by qa-form-validation
qa-test-form-special-chars     = false   # REPLACED by qa-form-validation
qa-test-form-submit-state      = false   # REPLACED by qa-form-validation (Phase 3 added 2026-06-03)
```

### Verification procedure

Before flipping the disable flags:
1. Enable `qa-form-validation = true` AND keep all 5 old skills enabled
2. Run one full audit (e.g. on the production app `undertakings`)
3. Compare `issueType` values emitted by the new skill vs the 5 old skills
4. Expect: every issueType from the old 5 is also present in the new skill's output
5. Tolerance: ±10% in count (timing variance on dynamic forms)
6. If gaps found: extend the new skill's probe to cover, re-run, until coverage matches
7. After 2 consecutive audits show coverage parity → disable the old 5 skills

---

## Hard rules

1. **NEVER click submit** without the `preventDefault` shim. A real submit may navigate away, breaking subsequent skills in the cell.
2. **ALWAYS run cleanup (Step 6)** before exit, even on crash detection. Leaves the page sane for the next skill.
3. **ALWAYS check page health** between special-char payloads — one crashing payload should not run the next.
4. **NEVER emit a finding without `selector`** — the bug-filer can't attach evidence otherwise.
5. **NEVER exceed 2 forms × 5 fields** per cell — bounded run time is non-negotiable.
6. **`cacheVersion: "1.0.0"`** in frontmatter — bump when issue detection logic changes so DOM-hash cache can invalidate this skill's results selectively.

---

## Notes

- This is the FIRST skill of the production consolidation effort (22 form skills → 6 well-bounded skills).
- The other 5 new form skills will follow the same pattern: parallel-verify, then disable old, then delete folders.
- The 11 issue types preserved here are the exact UNION of what the 5 source skills emitted — devs see the same vocabulary in ADO tickets, just emitted by one canonical skill.
- Token cost is comparable to the 5 old skills combined, but with zero duplicate findings → net cost reduction at the bug-filer stage.
