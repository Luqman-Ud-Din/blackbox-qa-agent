---
name: qa-test-cases
description: "Executes human-written test cases from .claude/qa-test-cases.md"
model: sonnet
applyOn: [desktop]
needsSetup: false
viewportSensitive: false
interactive: true
selfSkip: "if {project-root}/.claude/qa-test-cases.md does not exist"
---

## Self-skip
Skip if `{project-root}/.claude/qa-test-cases.md` does not exist.

## Execution
- Read `{project-root}/.claude/qa-test-cases.md`
- Parse sections: split on `/\n(?=#{2,3}\s)/`. Each section = one test case.
- Check `route:` line in section — skip if route doesn't match `cell.route`
- Extract steps: lines starting with `\d+\.|\-|\*`

**Execute up to 10 steps per case (try/catch each):**
- `navigate|go to|visit {dest}` → `page.goto(dest or baseUrl+dest)`
- `click {target}` → `page.locator(target).first().click()`
- `type "{text}" in {selector}` → `page.locator(selector).first().fill(text)`
- `verify {selector} is visible` → check `page.locator(selector).first().isVisible()` — if false → fail
- `verify {selector} (contains|has text) "{expected}"` → check `innerText.includes(expected)` — if false → fail
- Wait 300ms between steps

If step fails → testCaseFailed (high): `"Custom test case \"{title}\" failed at step: \"{failedStep}\""`

## Issues
| issueType | severity | description |
|---|---|---|
| testCaseFailed | high | "Custom test case \"{title}\" failed at step: \"{failedStep}\"" |
