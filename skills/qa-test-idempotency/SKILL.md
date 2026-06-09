---
name: qa-test-idempotency
section: interactive
description: "Tests that double-clicking submit does not allow duplicate form submissions"
model: haiku
applyOn: all
needsSetup: false
viewportSensitive: false
interactive: true
---

## Self-skip
Skip if no visible `form`.

## Test
- Locate first visible `form`. Find `button[type="submit"], input[type="submit"]` (first, visible).
- Fill required inputs (up to 3): `input[required]:not([type="hidden"]):not([type="submit"])`
  - type email → `test@example.com`
  - type password → `TestPass123!`
  - else → `test`
- Click submit. Wait 200ms.
- Check `submitBtn.isDisabled()` → `isDisabledAfterFirst`
- Click submit again. Wait 600ms.
- If `!isDisabledAfterFirst`: count `[role="alert"], .alert-success, [class*="success"], [data-testid*="success"]`
  - If count > 1 → doubleSubmitAllowed (high)

## Issues
| issueType | severity | description |
|---|---|---|
| doubleSubmitAllowed | high | "Submit button is not disabled after first click — double-submission may create duplicate records" |
