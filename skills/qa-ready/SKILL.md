---
name: qa-ready
description: "Prepare Argus QA for a user/project by creating local config, protecting secrets, checking dependencies, and printing readiness status"
---

# qa-ready

## Purpose

Use `/qa-ready` when a user wants to prepare this agent for their own machine/project before running an audit.

This command is a safe readiness wizard. It does not run an audit, discover routes, generate Playwright specs, file bugs, or delete existing user data.

It prepares and verifies these local files:

```text
.claude/automation.config.json
.claude/qa-state.json
.claude/secrets.json
.gitignore
```

It also checks required tools:

```text
node
npm
jq
curl
awk
@playwright/test
Playwright browser binaries
```

---

## Command Forms

| Command | Purpose |
|---|---|
| `/qa-ready` | Interactive readiness wizard |
| `/qa-ready --check` | Read-only readiness check; do not write files |
| `/qa-ready --repair` | Repair missing local files and gitignore protection |
| `/qa-ready --secrets` | Update only private credentials in `.claude/secrets.json` |

---

## Safety Rules

1. Never overwrite an existing file without reading it first.
2. Never delete `.claude/automation.config.json`, `.claude/qa-state.json`, `.claude/secrets.json`, `.tmp/`, or any test output.
3. Never print PATs or passwords in plaintext.
4. Never write secrets to `.claude/automation.config.json`, `.claude/qa-state.json`, `.env`, `.env.local`, `.tmp/`, logs, screenshots, or reports.
5. Only write PATs and passwords to `.claude/secrets.json`.
6. Preserve existing manual config values unless the user explicitly confirms a replacement.
7. Do not install packages or download browsers without asking first.
8. Keep this command independent from audit execution.

---

## Readiness Files

### `.claude/automation.config.json`

Project-specific, non-secret configuration.

Create this from:

```text
skills/qa-setup/templates/automation.config.template.json
```

Ask for:

```text
ADO org URL
ADO project name
App name
App base URL
Login route
```

Do not store passwords here.

### `.claude/secrets.json`

Private credentials.

Store only:

```json
{
  "AZURE_DEVOPS_PAT": "<token>",
  "apps": {
    "<appName>": {
      "email": "<test-email>",
      "password": "<test-password>"
    }
  }
}
```

### `.claude/qa-state.json`

User preferences and run state.

Create this from:

```text
skills/qa-setup/templates/qa-state.template.json
```

Ask for:

```text
User name
Default viewport
Default mode
Default browsers
Headless true/false
Vision review true/false
```

### `.gitignore`

Ensure these entries exist:

```text
.claude/secrets.json
.claude/qa-state.json
.claude/settings.local.json
.tmp/
test-results/
playwright-report/
```

---

## `/qa-ready --check`

This mode is read-only.

Check:

1. `.claude/automation.config.json` exists and has real ADO/app values.
2. `.claude/qa-state.json` exists.
3. `.claude/secrets.json` exists.
4. `.claude/secrets.json` is gitignored.
5. `.tmp/` is gitignored.
6. Required tools are installed:
   ```bash
   bash skills/qa-setup/scripts/doctor.sh check
   ```
7. Playwright browser binaries are available:
   ```bash
   npx playwright install --dry-run
   ```

Print a readiness report:

```text
Argus readiness

Config
  ✓ automation.config.json
  ✓ qa-state.json
  ✓ secrets.json saved and protected

Tools
  ✓ node
  ✓ jq
  ✓ curl
  ✓ playwright
  ✓ browsers

Result: ready to run /argus
```

If anything is missing, print the exact repair command or tell the user to run:

```text
/qa-ready --repair
```

---

## Interactive Flow

### Step 1 - Inspect

Read, if present:

```text
.claude/automation.config.json
.claude/qa-state.json
.claude/secrets.json
.gitignore
```

Do not print secret values.

### Step 2 - Tools Check

Run:

```bash
bash skills/qa-setup/scripts/doctor.sh check
```

For missing tools, show the install command and ask before installing.

Suggested installs:

```text
jq: winget install jqlang.jq
Git Bash: winget install Git.Git
Node.js: winget install OpenJS.NodeJS.LTS
Playwright package: npm install -D @playwright/test
Browsers: npx playwright install chromium firefox webkit
```

Never install automatically.

### Step 3 - Create or Repair `.claude/`

Create `.claude/` if missing.

If `.claude/automation.config.json` is missing:

1. Read `skills/qa-setup/templates/automation.config.template.json`.
2. Ask for ADO org, ADO project, app name, app URL, and login route.
3. Write a valid config.

If `.claude/qa-state.json` is missing:

1. Read `skills/qa-setup/templates/qa-state.template.json`.
2. Ask for user preferences.
3. Write the state file.

If `.claude/secrets.json` is missing:

1. Ask whether to save private credentials now.
2. If yes, collect ADO PAT and app test credentials.
3. Write secrets to `.claude/secrets.json`.
4. If no, create no secrets file and mark secrets as pending.

### Step 4 - Protect Local Files

Ensure `.gitignore` contains:

```text
.claude/secrets.json
.claude/qa-state.json
.claude/settings.local.json
.tmp/
test-results/
playwright-report/
```

Append only missing lines. Preserve existing `.gitignore` contents.

### Step 5 - Verify

Run the same checks as `/qa-ready --check`.

If Playwright browsers are missing, ask:

```text
Download Playwright browsers now? [y/N]
```

If yes, run:

```bash
npx playwright install chromium firefox webkit
```

### Step 6 - Summary

Print:

```text
Argus is ready:
  ✓ local config checked
  ✓ local state checked
  ✓ secrets protected
  ✓ tools checked

Next command:
  /argus
```

If not fully ready:

```text
Argus is almost ready:
  ✗ <missing item>

Fix:
  <exact command or action>
```

---

## Secrets-Only Mode

For `/qa-ready --secrets`:

1. Read `.claude/automation.config.json` to discover app names.
2. Ask whether to update ADO PAT.
3. Ask whether to update credentials for each configured app.
4. Merge new values into `.claude/secrets.json`.
5. Ensure `.claude/secrets.json` is gitignored.

Do not modify `.claude/automation.config.json` or `.claude/qa-state.json`.

---

## Repair Mode

For `/qa-ready --repair`:

Repair only missing or invalid local readiness items:

- create `.claude/` if missing
- create missing `automation.config.json` from template
- create missing `qa-state.json` from template
- optionally create/update `secrets.json`
- append missing `.gitignore` entries

Do not overwrite valid existing files.
