---
name: qa-coverage-report
description: "Reads issues.jsonl after the audit and prints a grouped markdown summary table of all findings"
---

# qa-coverage-report

## Overview

Reads all `issues.jsonl` files from `.tmp/qa-<run-id>/issues/` and produces a formatted report grouped by severity, skill, and route coverage. The report is printed to stdout and can be piped to a file by the caller.

## Your Role

You are the report formatter. You do not run any tests or re-visit any pages. You only read the data that was written by other skills during the audit and present it clearly so the user can act on findings immediately.

## On Activation

1. Scan `{project-root}/.tmp/qa-<run-id>/issues/` recursively for all `.jsonl` files
2. Parse every JSON line from every file into Issue objects
3. Deduplicate: if the same `issueId` appears in multiple files, keep only the first occurrence
4. Load `qa-state.json` to read `chronicIssues` (issues seen in 3 or more consecutive runs)
5. Group issues: severity → skill → issueType
6. Build the coverage matrix from the full cell list in `audit-plan.json`
7. Print the report

## Issue Object Shape

Each line in a `.jsonl` file is expected to have at minimum:

```json
{
  "issueId": "overflow-abc123",
  "skill": "qa-detect-overflow",
  "issueType": "horizontalOverflow",
  "severity": "high",
  "route": "/dashboard",
  "viewport": "mobile",
  "browser": "chromium",
  "description": "Page has horizontal scroll at 375px",
  "screenshotPath": ".tmp/<run-id>/screenshots/overflow-abc123.png",
  "adoWorkItemId": 1042
}
```

`adoWorkItemId` may be absent if bugs were not filed or `dry_run: true`.

## Report Format

```
═══════════════════════════════════════════════════════════════
 🔍 QA Audit Report — <run-id>
 Completed: <timestamp>   Total issues: N   Bugs filed: M
═══════════════════════════════════════════════════════════════

## By Severity

### 🔴 High (N issues)
| Skill | Issue Type | Route | Viewport | Browser | Description |
|-------|-----------|-------|----------|---------|-------------|
| qa-detect-overflow | horizontalOverflow | /dashboard | mobile | chromium | Page has horizontal scroll at 375px |

### 🟡 Medium (N issues)
| Skill | Issue Type | Route | Viewport | Browser | Description |
|-------|-----------|-------|----------|---------|-------------|

### 🟢 Low (N issues)
| Skill | Issue Type | Route | Viewport | Browser | Description |
|-------|-----------|-------|----------|---------|-------------|

## By Skill
| Skill | Issues Found |
|-------|-------------|
| qa-detect-overflow | 3 |
| qa-test-navigation | 2 |

## Coverage Matrix
| Route | mobile | tablet | laptop | desktop |
|-------|--------|--------|--------|---------|
| / | ✓ 0 issues | ✓ 0 issues | ⚠ 2 issues | ✓ 0 issues |
| /login | ✓ 0 issues | ✓ 0 issues | ✓ 0 issues | ✓ 0 issues |
| /dashboard | ⚠ 1 issue | ✓ 0 issues | ✓ 0 issues | ✓ 0 issues |

## Chronic Issues (3+ consecutive runs)
(Read from qa-state.json chronicIssues — skip this block entirely if the list is empty)

| Issue ID | Skill | Route | Description | Runs Seen |
|----------|-------|-------|-------------|-----------|
| overflow-abc123 | qa-detect-overflow | /dashboard | Horizontal scroll at 375px | 4 |

═══════════════════════════════════════════════════════════════
 Next steps:
 • View annotated screenshots: .tmp/<run-id>/screenshots/
 • Re-run audit:  /argus-qa:argus
 • File bugs now: /argus-qa:qa-bug-filer <run-id>
═══════════════════════════════════════════════════════════════
```

## Coverage Matrix Rules

- Source the full list of planned cells from `audit-plan.json` (not just cells that produced issues)
- A cell with 0 issues gets `✓ 0 issues`
- A cell with 1 or more issues gets `⚠ N issue(s)`
- A cell that was skipped (not in audit-plan) gets `—`
- Rows are routes; columns are viewport classes

## Severity Ordering

Always print in this order: High → Medium → Low. Omit a severity block entirely if it has 0 issues.

## Bugs Filed Count

Count the number of Issue objects where `adoWorkItemId` is present and non-null. This is the `Bugs filed: M` value in the header.

## Paths

| Artifact | Path |
|----------|------|
| Issues (all runs) | `{project-root}/.tmp/qa-<run-id>/issues/**/*.jsonl` |
| Audit plan | `{project-root}/.tmp/qa-<run-id>/audit-plan.json` |
| Screenshots | `{project-root}/.tmp/qa-<run-id>/screenshots/` |
| State (chronic issues) | `{project-root}/.tmp/qa-state.json` |

