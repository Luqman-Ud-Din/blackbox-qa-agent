---
name: qa-bug-filer
description: "Deduplicates issues.jsonl and files Azure DevOps Bug work items with annotated screenshots attached"
---

# qa-bug-filer

## Overview

Reads `issues.jsonl` files produced by audit skills, deduplicates them, creates Azure DevOps Bug work items via REST API, and attaches annotated screenshots to each filed bug.

---

## Your Role

You are the bug filer. Your responsibilities:

- **Never file duplicate bugs** for the same defect. One Bug work item per unique `(issueType + url + viewport + browser)` combination, per run.
- **Respect dry-run mode.** If `dry_run = true` in `argus/customize.toml`, print what would be filed but do not create anything in ADO.
- **Attach evidence.** Every filed bug should have a screenshot — annotated if available, clean otherwise.

---

## On Activation

Execute the following steps in order:

### Step 1 — Collect Issues

Read all `.jsonl` files matching:
```
{project-root}/.tmp/qa-<run-id>/issues/**/*.jsonl
```

Each line is a JSON object (one issue per line).

### Step 2 — Deduplicate

Parse all lines into Issue objects. Deduplicate by the composite key:

```
issueType + url + viewport + browser
```

Keep only one issue per unique key combination. If duplicates exist (same key from multiple skill runs), retain the first occurrence. Log the count of duplicates dropped.

### Step 3 — Run the Filing Script

```bash
bash {skill-root}/scripts/file-bugs.sh <run-id>
```

The script reads the deduplicated issue set, calls the ADO REST API for each, and writes a `bugs-filed.jsonl` log.

### Step 4 — Attach Screenshots

For each successfully filed bug:

1. If `annotatedScreenshotPath` is set and the file exists → attach it to the ADO work item.
2. Else if `screenshotPath` is set and the file exists → attach the clean screenshot.
3. If neither is available → log a warning but do not fail the bug filing.

Attachment endpoint:
```
POST https://dev.azure.com/{org}/{project}/_apis/wit/attachments?api-version=7.1
PATCH /fields/System.AttachedFiles  (add relation)
```

### Step 5 — Print Summary

```
  N bugs filed, M skipped (duplicates), P failed
```

---

## Dry-Run Mode

If `dry_run = true` in `{project-root}/.claude/skills/argus/customize.toml`:

- Print each bug that **would** be filed with its title, severity, route, and viewport.
- Do **not** call any ADO REST endpoint.
- Do **not** write to `bugs-filed.jsonl`.
- Exit with code 0.

---

## Bug Title Format

```
[QA] <issueType> on <route> at <viewportClass> — <app>
```

Example:
```
[QA] overflow-x on /dashboard at mobile — MyApp
```

---

## Bug Description

Use `{skill-root}/templates/repro-steps.html` as the template. Substitute all `{{PLACEHOLDER}}` tokens with values from the issue object before sending to ADO.

---

## ADO Fields

| ADO Field | Value |
|---|---|
| `System.Title` | Bug title (see format above) |
| `System.Description` | HTML from `repro-steps.html` template |
| `System.AreaPath` | `area_path` from `customize.toml`; if empty, use the project root |
| `System.Tags` | `argus-qa,<skill>,<viewport>,<browser>` |
| `Microsoft.VSTS.Common.Severity` | Mapped from issue severity (see below) |
| `System.WorkItemType` | `Bug` |

---

## Severity Mapping

| Issue severity | ADO Severity field value |
|---|---|
| `high` | `1 - Critical` |
| `medium` | `2 - High` |
| `low` | `3 - Medium` |
| *(unknown)* | `2 - High` |

---

## Paths Reference

| Resource | Path |
|---|---|
| Issues input | `{project-root}/.tmp/qa-<run-id>/issues/**/*.jsonl` |
| Filed bugs log | `{project-root}/.tmp/qa-<run-id>/bugs-filed.jsonl` |
| Filing script | `{skill-root}/scripts/file-bugs.sh` |
| Description template | `{skill-root}/templates/repro-steps.html` |
| Config | `{project-root}/.claude/automation.config.json` |
| PAT source | `.claude/secrets.json → AZURE_DEVOPS_PAT` (preferred), or env var `AZURE_DEVOPS_PAT` |

---

## customize.toml Options

| Key | Type | Default | Description |
|---|---|---|---|
| `dedup_key` | string | `issueType+url+viewport` | Fields used to deduplicate issues |
| `area_path` | string | `""` | ADO area path; empty = project root |
| `max_bugs` | integer | `50` | Maximum bugs to file per run (spam cap) |
| `attach_screenshots` | bool | `true` | Whether to attach screenshots to filed bugs |


