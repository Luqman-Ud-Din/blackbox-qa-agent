---
name: qa-test-cases
description: "Read human-written test cases from .claude/qa-test-cases.md and execute each one, reporting pass/fail"
---

# QA Test — Custom Test Cases

## What Claude tests

Every test case defined in `{project-root}/.claude/qa-test-cases.md` by the project team. Each case specifies the steps, expected result, and optional severity. Claude executes them literally using Playwright and reports whether the expected result was observed.

## Test steps

**Self-skip check:**
1. Check whether the test cases file exists:
   `fs.existsSync(path.join(projectRoot, '.claude', 'qa-test-cases.md'))`.
2. If the file does not exist → self-skip with message "no .claude/qa-test-cases.md file found — custom test cases not applicable for this project".

**Parse the test cases file:**
3. Read the file at `{project-root}/.claude/qa-test-cases.md`.
4. Parse each test case block. The expected format for each case in that file is:

   ```
   ## TC-<id>: <title>

   **Route:** <route or "any">
   **Severity:** <high|medium|low>  ← optional, defaults to high

   ### Steps
   1. <step>
   2. <step>

   ### Expected result
   <what Claude should observe to call this test a pass>
   ```

5. Collect all test cases whose `Route` matches the current route (or is `"any"`).
6. If no test cases match the current route → self-skip with message "no test cases defined for route '{route}'".

**Execute each test case:**
7. For each matching test case, in order:
   a. Log which test case is starting: `"Running TC-{id}: {title}"`.
   b. Execute each step literally using Playwright:
      - Steps describing navigation → use `page.goto()`.
      - Steps describing clicks → use `page.click()` with the most specific locator matching the step description.
      - Steps describing text input → use `page.fill()`.
      - Steps describing waiting → use `page.waitForTimeout()` or `page.waitForSelector()`.
      - Steps describing assertions (e.g. "verify X is visible", "check that Y appears") → use `page.locator(...).isVisible()` or `page.locator(...).innerText()`.
   c. After all steps, evaluate the **Expected result** condition:
      - Use the most appropriate Playwright assertion or check.
      - If the condition is met → mark the test case as PASS.
      - If the condition is not met → mark the test case as FAIL and capture:
        - The test case ID and title
        - Which step failed (the last step executed)
        - A screenshot at the point of failure
        - Log issue type `testCaseFailed`.
   d. If a Playwright exception (e.g. element not found, timeout) prevents a step from executing → mark the test case as ERROR and log issue type `testCaseError`.
   e. After each test case, reset state as needed: close any open modals, navigate back to the route if navigation occurred.

**Report:**
8. After all test cases for the route are executed, print a summary:
   ```
   ─────────────────────────────────────
   Custom test cases — {route}
   ─────────────────────────────────────
   PASS: TC-001, TC-003
   FAIL: TC-002 — Expected login redirect, got dashboard
   ERROR: TC-004 — Element '#submit-btn' not found
   ─────────────────────────────────────
   ```

## Pass / Fail criteria

Pass: Every step executes without error AND the Expected result condition is satisfied.

Fail: A step executes but the Expected result is not observed → `testCaseFailed`. Record the test case ID, the failing step number, and what was observed vs expected.

Error: A Playwright exception prevents a step from executing (element not found, timeout, etc.) → `testCaseError`. Record the test case ID, the step that threw, and the error message.

Severity: use the severity defined in the test case block. If not specified, default to `high`.

## Issue schema

- type: "testCaseFailed"
- severity: as specified in the test case (default high)
- selector: the element referenced in the failing step, or null
- description: "TC-{id} '{title}' FAILED — step {stepNumber}: expected '{expected}' but observed '{actual}'"

- type: "testCaseError"
- severity: as specified in the test case (default high)
- selector: null
- description: "TC-{id} '{title}' ERROR — step {stepNumber} threw: {errorMessage}"

## Scope

applyOn: ["desktop"]
Self-skip conditions:
- Skip if `{project-root}/.claude/qa-test-cases.md` does not exist.
- Skip for a specific route if no test cases in the file target that route.
