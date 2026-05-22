# Installation Guide

**QA Sentinel** (the `/argus-qa:argus` plugin) runs entirely from your machine — there is no SaaS layer. That means a few system tools need to be in place before the first audit. This guide walks through every prerequisite, then how to install and use the plugin.

Most users finish in 10–15 minutes.

---

## 1. System dependencies

Open a terminal and check each one. If a command prints a version number, you're good for that line.

| Tool | Check | Required version |
|---|---|---|
| Node.js | `node -v` | 18 or higher |
| npm | `npm -v` | 9 or higher |
| git | `git --version` | any recent |
| bash | `bash --version` | any (on Windows: Git Bash) |
| jq | `jq --version` | any recent |
| curl | `curl --version` | any recent |
| awk | `awk --version` | usually pre-installed |
| sed | `sed --version` | usually pre-installed |

### Install missing tools

**Windows** (run in PowerShell as Administrator):

```powershell
# jq is the one most likely missing
winget install jqlang.jq

# If you don't have Git Bash:
winget install Git.Git

# Node.js (if missing):
winget install OpenJS.NodeJS.LTS
```

**Mac:**

```bash
brew install jq node git
```

**Linux (Debian / Ubuntu):**

```bash
sudo apt update
sudo apt install jq curl git
# Node.js: follow https://nodejs.org for the LTS installer
```

---

## 2. Playwright

The plugin uses Playwright to drive real browsers. You need both the npm package and the browser binaries.

In your project root (the project you want to audit, not the plugin repo):

```bash
npm install -D @playwright/test
npx playwright install chromium firefox webkit
```

The browser binaries are large (~300 MB each). The install only needs to run once per machine.

Verify:

```bash
npx playwright --version
```

---

## 3. Azure DevOps Personal Access Token

The plugin files bugs into ADO via the REST API. You need a PAT with the right scopes.

### Generate the PAT

1. Open your ADO portal: `https://dev.azure.com/<your-org>/_usersSettings/tokens`
2. Click **New Token**
3. Name it something like `argus`
4. Set expiry as you prefer (90 days is reasonable)
5. **Scopes — these are critical:**
   - ✅ **Work Items**: Read & Write
   - ✅ **Code**: Read & Write (only needed if you also want the fixer agent to push branches)
   - ✅ **Build**: Read (optional, for CI integration)

⚠️ Without "Work Items: Read & Write", the plugin will create bugs but **screenshot attachments will silently fail** (we've seen this — the upload succeeds but the link step requires write).

6. Click **Create** and copy the token IMMEDIATELY. You cannot view it again later.

### Save the PAT

You do not need to create any file manually. When you run Argus with `dry_run = false` for the first time, it will prompt:

```
ADO Personal Access Token (scope: Work Items Read & Write):
Save for future runs? [Y/N]:
```

Answering **Y** saves the PAT to `.claude/secrets.json` — a gitignored file inside the Argus config directory. Your project's own files (`.env`, `.env.local`, etc.) are never touched.

---

## 4. Test user account in your app

The plugin audits both public and authenticated routes. For auth routes, it needs to log in. Create a dedicated test user in your application — do NOT use your real account.

Requirements:
- Has access to the routes you want audited
- Password is stable (not auto-expiring)
- Credentials saved to `.claude/secrets.json` when you first run the audit (Argus prompts to save)

If your app doesn't allow account creation, ask a backend dev to seed one.

---

## 5. Install the plugin

Argus is a **local plugin** — it is not published to any marketplace. Install it directly from the folder you unzipped.

**Windows:**

Double-click `install.bat` in the unzipped folder.

> If Windows shows a "Windows protected your PC" SmartScreen popup, click **More info → Run anyway**. The script is safe — Windows flags unsigned scripts from the internet by default.

**Mac / Linux:**

```bash
bash install.sh
```

The installer will:
- Copy the plugin to `~/.claude/plugins/cache/`
- Register it in Claude Code's plugin list
- Write the correct permissions automatically

When it prints `Install complete!`, you are done.

**Then:**
1. Close Claude Code completely
2. Re-open it (plugins load at startup)
3. Open your project folder in Claude Code
4. Type `hi` — Argus will greet you and guide you through the rest automatically

---

## 6. First-time setup

After install, just type `hi` in Claude Code. Argus will:

1. Ask your name
2. Show the task menu
3. When you pick an audit option, automatically run the setup wizard

The setup wizard asks one question at a time:
4. For each app to audit:
   - Name (any identifier you want)
   - Local dev URL (e.g. `http://localhost:3000`)
   - Login route (e.g. `/login`)
   - Test email + password

The wizard writes `.claude/automation.config.json` and confirms everything works by:
- Calling the ADO API to verify the PAT
- Hitting your local dev server to confirm it's running
- Logging in with the test credentials to confirm they work

If any step fails, the wizard tells you exactly what to fix.

---

## 7. Run the first audit

```
/argus-qa:argus --dry-run
```

`--dry-run` skips the ADO filing step — detection runs and prints results to the terminal without creating real bugs. Great for verifying everything works before going live.

When the dry run looks right:

```
/argus-qa:argus
```

This files real ADO bugs with attached screenshots.

---

## Troubleshooting

### "jq: command not found"

You skipped Step 1. Install jq:
- Windows: `winget install jqlang.jq`
- Mac: `brew install jq`
- Linux: `sudo apt install jq`

### "Executable doesn't exist for project 'firefox'"

Playwright browser binaries are missing:

```bash
npx playwright install chromium firefox webkit
```

### Bugs file but screenshots show "0 attachments"

Your PAT lacks "Work Items: Read & Write" scope. Regenerate the PAT with the correct scopes. Then run Argus again — it will prompt you to re-enter and save it to `.claude/secrets.json`. The upload step works without write scope, but the link step (which puts the attachment into the work item's relations) does not.

### Browser windows don't appear during audit

By default, the plugin runs in headless mode for speed. To watch the browsers:

Edit `skills/qa-spec-runner/customize.toml` (inside the plugin) and set:
```toml
[playwright]
headless = false
```

### Cross-browser only runs Chromium

Firefox / WebKit binaries are not installed. Run:

```bash
npx playwright install firefox webkit
```

### "Not inside a git repo"

The plugin uses `git rev-parse --show-toplevel` to find your project root. Initialize a git repo:

```bash
git init
```

### Setup wizard keeps re-asking the same questions

The wizard skips itself only when `automation.config.json` has all required real values (not placeholders like `<YOUR_ADO_ORG_URL>`). If you see the wizard repeatedly, open the config and check for unreplaced `<...>` placeholders.

### Login fails during preflight

Your test user credentials are wrong, OR your login form fields don't match the standard selectors. The plugin looks for `#email`, `input[type="email"]`, `[name="email"]` etc. — if your form uses different selectors, edit the credentials in the config and verify them manually first.

---

## What gets created in your project

After setup + first run, your project has:

```
your-project/
├── .claude/
│   ├── automation.config.json     ← non-sensitive config (safe to commit)
│   └── secrets.json               ← PAT + passwords — gitignored, NEVER commit
├── .gitignore                     ← updated to exclude .claude/secrets.json and .tmp/
└── .tmp/                          ← per-run output (gitignored, safe to delete anytime)
    └── qa-<run-id>/
        ├── audit.spec.ts
        ├── playwright.config.ts
        ├── audit-plan.json
        ├── routes.json
        ├── issues/                ← one JSONL per cell
        ├── screenshots/           ← clean + per-issue annotated
        ├── filed-bugs.json
        └── filed-bugs.log
```

Old `.tmp/qa-*` directories accumulate over time. They're useful for debugging — keep them or delete them, your choice.

---

## Next steps

- Read [README.md](README.md) for the command reference
- Run `/argus-qa:argus --dry-run --route /your-most-important-page` to test a single page first
- Open `skills/argus/customize.toml` to toggle individual detectors on/off
- Open `skills/qa-spec-runner/customize.toml` to change workers, headless mode, timeout

If you hit an issue not covered here, check the logs in `.tmp/qa-<latest-run-id>/filed-bugs.log` — the plugin is designed to surface real errors visibly, not silence them.




