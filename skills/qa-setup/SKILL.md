---
name: qa-setup
description: "First-run doctor + wizard — checks system tools, installs Playwright, configures ADO and app settings"
---

# qa-setup

## Overview

First-time setup wizard for the `argus-qa-plugin`. Walks through **7 phases** to ensure the environment is fully ready before any audit run. The wizard is **idempotent** — it reads the current state and skips any phase that is already passing, so it is safe to re-run at any time.

At the end of a successful run, `/argus-qa:argus` is guaranteed to work.

---

## Skip if Already Configured

Before starting the wizard, read `{project-root}/.claude/automation.config.json`.

Skip the wizard entirely (print a summary of what is already configured) if **all three** conditions are true:

1. `ado.org` is not a placeholder (i.e. not `"{{ADO_ORG}}"` and not empty)
2. `responsiveness.apps` array is non-empty
3. All system tools checked in Phase 1 pass without error

If any condition fails, run the full wizard starting from the first failing phase.

---

## On Activation

1. Print the banner:

```
╔══════════════════════════════════════════╗
║         argus-qa  ·  First-Run Setup     ║
╚══════════════════════════════════════════╝
```

2. Run each phase in order (Phases 1–7). After all phases complete, print the Final Summary.

---

## Phase 1 — System Dependencies

Run the doctor script:

```bash
bash {skill-root}/scripts/doctor.sh check
```

- If all tools pass → print `✓ Phase 1 — all dependencies present` and continue.
- If `node`, `jq`, `curl`, or `awk` is missing → print the install hint and **HARD STOP**. These are OS-level tools that must be installed by the user before Argus can run.
- If only `@playwright/test` is missing → do **not** stop; Phase 2 handles it automatically.

Tools checked: `node` (≥18), `jq`, `curl`, `awk`, `@playwright/test`

---

## Phase 2 — Playwright + Browser Binaries

> **Note:** `install.ps1` / `install.sh` (the one-time installer) handles this automatically. If the installer was run, this phase will already pass. Phase 2 only takes action when something is missing.

1. Check whether `node_modules/@playwright/test` exists in `{project-root}`.
   - If missing: run `npm install --omit=dev` silently. Print `✓ @playwright/test installed`.

2. Check whether Chromium, Firefox, and WebKit binaries are present (`npx playwright install --dry-run`).
   - If any binaries are missing: run `npx playwright install chromium firefox webkit` automatically. Print progress. This may take a few minutes on a first run.
   - Do **not** ask for confirmation — missing binaries are always installed.

---

## Phase 3 — Project Setup

1. Check for a `.gitignore` file in the project root.
2. Verify that `.claude/secrets.json` and `.tmp/` are listed as entries.
3. If either is missing, ask: `Add missing .gitignore entries? [Y/n]`
4. If confirmed: run `bash {skill-root}/scripts/doctor.sh install gitignore`

**Note:** `argus-qa-plugin` does **not** require `git init`. There is no git-init requirement in this phase. Only `.gitignore` entries are checked.

---

## Phase 4 — Azure DevOps Authentication

Prompt the user for:

| Field | Prompt |
|---|---|
| Org URL | `ADO org URL (e.g. https://dev.azure.com/myorg):` |
| Project name | `ADO project name:` |
| PAT | `Personal Access Token (input hidden):` |

After collecting the PAT, **verify it live** before proceeding to Phase 5:

```bash
curl -sf -u ":$PAT" \
  "https://dev.azure.com/{ORG}/{PROJECT}/_apis/wit/workitemtypes?api-version=7.1" \
  -o /dev/null
```

- If the request succeeds (HTTP 200): print `✓ PAT verified`
- If the request fails: print the error, ask the user to re-enter the PAT, retry once. If it fails again, abort the wizard with instructions to check PAT scopes (requires `Work Items: Read & Write`).

**Security rule:** The PAT is **never** written to `automation.config.json`. It will be written to `.claude/secrets.json` in Phase 6.

---

## Phase 5 — Apps to Audit

Collect one or more app definitions. For each app:

| Field | Prompt |
|---|---|
| Name | `App name (e.g. MyApp):` |
| Base URL | `Base URL (e.g. http://localhost:3000):` |
| Login route | `Login route (e.g. /login):` |
| Test email | `Test account email:` |
| Test password | `Test account password (input hidden):` |

After collecting each app:

1. Verify the dev server is alive: `curl -sf {baseUrl} -o /dev/null`
2. Attempt a login check using Playwright (headless) to confirm credentials work.
3. Report success or failure. If login fails, ask whether to retry with different credentials or skip this app.

After each app, ask: `Add another app? [Y/n]`

Repeat until the user answers N.

**Security rule:** Passwords collected here are saved only to `.claude/secrets.json` (gitignored) if the user confirms. Never written to `automation.config.json`, `qa-state.json`, or `.env.local`.

---

## Phase 6 — Write Config

1. Read the template from:
   ```
   {skill-root}/templates/automation.config.template.json
   ```

2. Substitute the following placeholders:

   | Placeholder | Value |
   |---|---|
   | `{{ADO_ORG}}` | Org URL from Phase 4 |
   | `{{ADO_PROJECT}}` | Project name from Phase 4 |
   | `{{APPS_JSON}}` | JSON array of app objects (name, baseUrl, loginRoute, email) |

3. Write the result to:
   ```
   {project-root}/.claude/automation.config.json
   ```

4. Write the PAT and app passwords to `.claude/secrets.json` (create or merge if it already exists):
   ```json
   {
     "AZURE_DEVOPS_PAT": "<collected-PAT>",
     "apps": {
       "<appName>": { "email": "<email>", "password": "<password>" }
     }
   }
   ```

5. Ensure `.claude/secrets.json` is listed in `.gitignore` (already handled in Phase 3, but double-check).

**Absolute rule:** The PAT and passwords must **never** appear in `automation.config.json`. Only non-sensitive config (org, project, URLs) goes there.

---

## Phase 7 — Personalize

Ask the user 6 questions to populate `qa-state.json`:

| # | Question | Key | Default |
|---|---|---|---|
| 1 | `Your name (for run reports):` | `user.name` | `QA Agent` |
| 2 | `Default viewport (mobile/tablet/laptop/desktop/all):` | `defaults.viewport` | `all` |
| 3 | `Default mode (dry-run/file):` | `defaults.mode` | `dry-run` |
| 4 | `Browsers to test (comma-separated: chromium,firefox,webkit):` | `defaults.browsers` | `["chromium","firefox","webkit"]` |
| 5 | `Run headless by default? (true/false):` | `defaults.headless` | `false` |
| 6 | `Enable vision review (AI screenshot review)? (true/false):` | `defaults.visionReview` | `false` |

Read the template from:
```
{skill-root}/templates/qa-state.template.json
```

Substitute the collected values and write to:
```
{project-root}/.claude/qa-state.json
```

---

## Final Summary

Print a ✓ or ✗ for each phase:

```
Setup complete:
  ✓ Phase 1  System dependencies
  ✓ Phase 2  Playwright + browser binaries
  ✓ Phase 3  Project setup
  ✓ Phase 4  Azure DevOps authentication
  ✓ Phase 5  Apps to audit (2 configured)
  ✓ Phase 6  Config written → .claude/automation.config.json
  ✓ Phase 7  Preferences written → .claude/qa-state.json

Run /argus-qa:argus to start your first audit.
```

If any phase failed or was skipped, show ✗ with a brief reason and instructions to re-run `/argus-qa:qa-setup` to retry only that phase.

---

## Conventions

- **Never auto-install** any tool, binary, or package without a `[Y/n]` prompt.
- **Always show the exact command** that will be run before running it.
- **Never write the PAT** to `automation.config.json` or any file except `.env.local`.
- **Never write prompt-supplied passwords** (app login passwords) to any file.
- **Read before write:** always read an existing config before overwriting to preserve manual edits.
- **Idempotent:** re-running the wizard must not clobber a correctly configured state.




