---
name: qa-spec-runner
description: "Generates and executes the Playwright spec from spec-template.ts; Claude substitutes ${AUDIT_TESTS} with generated TypeScript test logic"
---

# qa-spec-runner

## Overview

Execution engine for the argus-qa-plugin audit pipeline. Handles one navigation per cell (route × viewport × browser). the `argus` skill provides the `${AUDIT_TESTS}` block; this skill:

1. Generates `playwright.config.ts` from `customize.toml` settings
2. Substitutes the **one** sentinel `${AUDIT_TESTS}` into `spec-template.ts`
3. Runs the resulting spec via `run-audit.sh`

## Hard Stop

- **NEVER** hand-write a spec file — all test logic comes from `argus` step 5
- **NEVER** call `chromium.launch()` directly; always use Playwright's `test` fixture
- If `spec-template.ts` is missing → stop immediately and report the missing file path

## Conventions

- Generate spec fresh from `{skill-root}/templates/spec-template.ts` for each run
- **ONE sentinel**: `${AUDIT_TESTS}` — the complete TypeScript test suite body provided by `argus` step 5 (includes CELLS array, navigation, detection, functional tests, screenshot paths)
- Write generated spec to `{project-root}/.tmp/qa-<run-id>/audit.spec.ts`
- Copy `annotated-overlay.js` beside the generated spec
- `headless` / `workers` / `browsers` are **NEVER** hardcoded — always read from `customize.toml` via `generate-config.sh`

## On Activation

### Step 1 — Read audit plan

```bash
# Audit plan contains routes, viewports, run metadata
cat "{project-root}/.tmp/qa-<run-id>/audit-plan.json"
```

### Step 2 — Receive `${AUDIT_TESTS}` block from argus-qa

the `argus` skill (step 5) provides the complete TypeScript block that replaces the `${AUDIT_TESTS}` sentinel. This block contains:
- `CELLS` array definition (route × viewport × browser combinations)
- `test.describe` / `test()` blocks
- All navigation, detection, and functional test logic
- Screenshot path construction

### Step 2.5 — Generate playwright.config.ts

```bash
BROWSERS="chromium,firefox,webkit" WORKERS=12 HEADLESS=false bash {skill-root}/scripts/generate-config.sh <run-id>
```

- `BROWSERS` — from `resolvedConfig.browsers` (comma-separated)
- `WORKERS`  — from `resolvedConfig.workers` (derived: `browsers.length * 4`, or user-overridden)
- `HEADLESS` — from `resolvedConfig.headless` (`true` or `false`)
- Always pass all three inline — shell env vars do NOT persist between tool calls.
- When `HEADLESS=false`, Playwright opens a visible browser window for every cell.

### Step 3 — Generate spec (Write tool — never inline shell)

**IMPORTANT — Windows `ENAMETOOLONG` rule:**
The `${AUDIT_TESTS}` block is always large (thousands of lines). On Windows, passing it as a shell argument hits the OS command-line length limit and causes `ENAMETOOLONG: name too long, uv_spawn`. This applies to PowerShell `@'...'@` here-strings, bash `printf`, and all other inline methods.

**ALWAYS use the Write tool directly. Never pass the block through a shell command.**

#### Step 3a — Write the `${AUDIT_TESTS}` block to disk

Use the **Write tool** to write the TypeScript block to:
```
{project-root}/.tmp/qa-<run-id>/audit_tests_block.ts
```

Do NOT use PowerShell or bash to write this file. The Write tool has no length limit.

#### Step 3b — Read the spec template and substitute

1. Use the **Read tool** to read `{skill-root}/templates/spec-template.ts`
2. Use the **Read tool** to read `{project-root}/.tmp/qa-<run-id>/audit_tests_block.ts`
3. Replace the single `${AUDIT_TESTS}` sentinel in the template with the block content (in memory — Claude does this substitution, not a shell command)
4. Use the **Write tool** to write the final combined result to:
   ```
   {project-root}/.tmp/qa-<run-id>/audit.spec.ts
   ```

#### Step 3c — Copy overlay helper

Use the **Read tool** to read `{skill-root}/templates/annotated-overlay.js`, then use the **Write tool** to write it to `{project-root}/.tmp/qa-<run-id>/annotated-overlay.js`. This is cross-platform — do not use `Copy-Item` or `cp`.

#### Step 3d — Validate

Use the **Read tool** to read the generated spec and verify the literal string `${AUDIT_TESTS}` does not appear anywhere in it. If it does → HARD STOP and report which line it appears on.

### Step 4 — Execute

```bash
bash {skill-root}/scripts/run-audit.sh <run-id>
```

## Paths

| Symbol | Resolves to |
|---|---|
| `{skill-root}` | `<repo>/skills/qa-spec-runner` |
| `{project-root}` | Repository root (4 levels up from `scripts/`) |
| `{project-root}/.tmp/qa-<run-id>/` | Per-run working directory |
| `{project-root}/.tmp/qa-<run-id>/audit.spec.ts` | Generated spec (do not edit after generation) |
| `{project-root}/.tmp/qa-<run-id>/playwright.config.ts` | Generated Playwright config |
| `{project-root}/.tmp/qa-<run-id>/annotated-overlay.js` | Overlay helper (copied from templates) |
| `{project-root}/.tmp/qa-<run-id>/issues/` | JSONL issue files per route/viewport |
| `{project-root}/.tmp/qa-<run-id>/screenshots/` | Annotated screenshot PNGs |

