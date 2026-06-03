---
name: qa-argus
description: "Argus � autonomous UI quality verification across browsers and viewports"
---

# �: BOUNDARY ENFORCEMENT � READ THIS BEFORE ANYTHING ELSE

All QA work happens inside `{project-root}` only. Never `cd`, read, write, or run scripts outside `{project-root}`.

- **NEVER** run pre-built Node.js scripts (`discover-routes.mjs`, `capture.mjs`, `inspect.mjs`, or any external `lib/*.mjs`) � they do not exist in this plugin
- **NEVER** access any directory outside `{project-root}`

**Prior run state** is in `{project-root}/.tmp/` and `{project-root}/.claude/qa-state.json` � nowhere else.

---

## Path Resolution

- `{skill-root}` � this skill's base directory (shown as "Base directory for this skill: <path>" on load)
- `{project-root}` � `{skill-root}` with the trailing `skills/qa-argus` segment stripped

---

## ON ACTIVATION � Entry Point

### MANDATORY first action: load state files BEFORE asking anything

Before classifying the prompt or asking ANY question, the orchestrator MUST read all three state files (skip silently if absent):

1. `{project-root}/.claude/automation.config.json` � apps[], ADO config, viewports
2. `{project-root}/.claude/qa-state.json` � userName, lastSettings, chronicIssues, runsTotal
3. `{skill-root}/customize.toml` � dry_run, browsers, enabled detectors, [models]
4. `{project-root}/.claude/secrets.json` (if it exists) � saved credentials

Hold the loaded values in `loadedState`. Use them to pre-populate everything downstream. **NEVER ask the user for information that already exists in any of these files.**

If the user's prompt mentions an app by name (e.g. "undertaking", "audit my X"), match it case-insensitively against `automation.config.json �  apps[].name` AND `qa-state.json �  lastSettings.appName`. If a match is found, treat the prompt as a TASK PROMPT with that app's baseUrl as the implied URL.

### Then classify the prompt

| Case | Trigger | Action |
|------|---------|--------|
| **GREETING** | Prompt is `hi`, `hello`, `hey`, `howdy`, `hi argus`, `hello argus`, `hey argus`, `good morning`, `good afternoon`, `what's up`, `sup` � with NO task intent (no URL, no app name, no browser, no route, no email) | �  Greeting flow �  task menu (Step 0.75) �  **wait** |
| **TASK PROMPT** | Prompt contains any of: a URL (`https?://`), an email address, **an app name matching loadedState.apps[]**, a route path, a browser name, OR action verbs like `audit`, `test`, `scan`, `check`, `inspect` combined with anything from above | �  Skip greeting and task menu �  Step 0 �  Step 1 �  Step 1.5 �  proceed |
| **NUMBERED OPTION** | Prompt is a single number 1�22 or the letter `C` | �  Dispatch directly from the task menu option table in Step 0.75 |
| **NO ARGS** | `/qa-argus` invoked with no additional text | �  Step 0 �  Step 0.5 �  Step 0.75 �  **wait** |

**CRITICAL PRIORITY FIX:** Check TASK PROMPT **before** GREETING. A prompt with a greeting word ("hi argus") + action verb ("audit") + app name ("undertaking") = TASK PROMPT, NOT GREETING. This prevents the bug where "hi argus audit undertaking" incorrectly triggers greeting flow instead of proceeding to Step 1.

### APP NAME MATCHING (Critical Fix #2)

When checking for app names in the prompt, use **fuzzy matching**:

```
1. Exact match (case-insensitive): "undertaking" == "undertakings" (lowercased) → NO
2. Fuzzy match singular/plural:
   - "undertaking" + "s" = "undertakings" → YES ✓
   - "undertakings" - "s" = "undertaking" → YES ✓
3. Levenshtein distance ≤ 1: handle typos
4. Fallback: if only 1 app configured, use it automatically
```

**Why:** Users say "undertaking" but config has "undertakings". Without fuzzy matching, the match fails and setup wizard is invoked unnecessarily.

---

### Trigger matching pseudocode (execute BEFORE any other step)

```javascript
// Classify the user prompt FIRST, before any questions or state checks
const hasURL = /https?:\/\//.test(prompt);
const hasEmail = /@/.test(prompt);
const actionVerbs = /\b(audit|test|scan|check|inspect|run|discover)\b/i;
const hasActionVerb = actionVerbs.test(prompt);

// Load app names from automation.config.json
const appNames = loadedState?.apps?.map(a => a.name.toLowerCase()) || [];
const hasAppName = appNames.some(name => prompt.toLowerCase().includes(name));

const hasRoute = /\/\w+/.test(prompt);
const browsers = /\b(chromium|firefox|webkit)\b/i;
const hasBrowser = browsers.test(prompt);
const isGreetingOnly = /^(hi|hello|hey|howdy|good morning|good afternoon|what's up|sup)\b/i.test(prompt) && 
                       !hasActionVerb && !hasAppName && !hasURL;
const isNumber = /^[1-9]$|^1[0-9]$|^2[0-2]$|^c$/i.test(prompt.trim());

// PRIORITY ORDERING
if (hasURL || hasEmail || (hasActionVerb && (hasAppName || hasRoute || hasBrowser))) {
  return "TASK_PROMPT";  // Skip greeting, proceed to Step 0, 1, 1.5
}
if (isNumber) {
  return "NUMBERED_OPTION";  // Dispatch from menu
}
if (isGreetingOnly) {
  return "GREETING";  // Show greeting + menu
}
return "NO_ARGS";  // Show welcome + menu
```

### FORBIDDEN questions (Hard Stop)

The orchestrator MUST NEVER ask the user any of these questions if the corresponding value exists in `loadedState`:

- "What's the base URL?" � read `automation.config.json �  apps[].baseUrl` or `qa-state.json �  lastSettings.baseUrl`
- "Which app?" � if only one app in `automation.config.json �  apps[]`, use it. If multiple, use `lastSettings.appName` from qa-state.json. Only ask if both fail.
- "Public only or auth?" � read `automation.config.json �  apps[].auth`. If `null`, public only. If configured, both.
- "Which browsers?" � read `customize.toml �  browsers`
- "Which viewports?" � read `automation.config.json �  responsiveness.viewports`
- "What's your name?" � read `qa-state.json �  userName`
- "Email/password?" � read `secrets.json` first

If ALL state files are missing AND the prompt provides no values �  **AUTO-INVOKE `qa-argus-setup` inline at Step 0**. Do NOT hard-stop. The wizard collects everything it needs through interactive prompts and then the audit continues. The user types ONE prompt ("audit my-app") and gets ONE end-to-end response — wizard plus audit. Hard-stops here are forbidden because they break the conversational onboarding flow.

The ONLY question the orchestrator may ask after Step 0 is the Step 1.5 settings confirmation `[Y] [S] [N/C]` � and that uses pre-populated values, not blank prompts.

---

# Argus � Orchestrator

## Greeting / Welcome / Task Menu

For **GREETING**, **NO ARGS**, and **NUMBERED OPTION** cases �  read `{skill-root}/menu.md` and follow it exactly.
For **TASK PROMPT** �  skip `menu.md`, proceed directly to Step 0.

---

## Overview

Argus runs a full autonomous audit. Pipeline: preflight �  route discovery �  phase strategy �  **per-cell execution via Playwright MCP tools** �  vision review �  bug filing �  coverage report �  state persistence. All work stays inside `{project-root}/.claude/` and `{project-root}/.tmp/`.

**Browser bridge:** the orchestrator drives the browser through Playwright MCP tools when available, falling back to inline Bash + Playwright snippets when MCP is not installed. No permanent Playwright runner script exists.

**Model routing:** every skill declares a `model:` field in its SKILL.md frontmatter (`haiku` default, `sonnet` for judgment-heavy skills). The orchestrator dispatches each cell's work on the declared model. Central overrides live in `{skill-root}/customize.toml �  [models]`.

---

## Hard Stop Rules

| # | Rule | Corrective action |
|---|------|------------------|
| 1 | `{project-root}/.claude/automation.config.json` must exist and have �0�1 app in `apps[]` | Print: "HARD STOP � AUTO-INVOKE qa-argus-setup inline. Only hard-stop AFTER the wizard runs AND still fails to produce a valid config. Never hard-stop on first-run missing-config — that is a setup-wizard signal, not an error." |
| 2 | When `dry_run = false`, missing ADO credentials are collected interactively at Step 1.5 � never hard-stop on credentials | Ask in Step 1.5, never abort |
| 3 | **Permanent operational scripts under `scripts/` are the SOURCE OF TRUTH and must NEVER be regenerated.** The orchestrator INVOKES them, never overwrites them. Permitted permanent scripts: `scripts/ado-api.sh`, `scripts/annotate.js`, `scripts/annotate-cell.cjs`, `scripts/argus-schema.cjs`, `scripts/file-bugs.cjs`. Browser ops happen via Playwright MCP tools OR ephemeral `.cjs` files written under `.tmp/{runId}/` ONLY when no permanent script covers the operation. | If a permanent script exists for an operation, CALL IT. Regenerating a permanent script (especially `file-bugs.cjs`) is the historical root cause of empty ADO tickets and is BANNED. |
| 4 | **Probe expressions inside SKILL.md ARE allowed.** They are skill specifications consumed by `browser_evaluate` (MCP) or copied into ephemeral .cjs (Bash). `.cjs` and `.js` files inside `skills/*/` (other than the two listed above) are NOT permitted | Probes live as code blocks inside SKILL.md, not as separate files in skill folders |
| 5 | **NEVER use bash heredoc to embed Node scripts.** `node - <<EOF`, `node -e "..."`, and similar patterns are BANNED. They corrupt JS template literals (backticks, `$`, quotes) on Windows and are fragile on macOS/Linux. ALWAYS use the Write tool to create a `.cjs` file, then `node "{abs-path}"`. | Write �  Bash run, never inline heredoc |
| 6 | NEVER access any path outside `{project-root}` | Confine all reads/writes/subprocesses to `{project-root}/.claude/` and `{project-root}/.tmp/` |
| 7 | Questions only at 5 interaction points: greeting, Step 0.5 welcome, Step 0.75 menu, Step 1.5 settings confirmation, Step 1.5 ADO credentials (only when needed). After Y/S at Step 1.5, run autonomously to completion | No mid-pipeline pauses |

---

## Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `--app <name>` | string | Audit only this app (matches `apps[].name` in automation.config.json) |
| `--route <path>` | string | Audit only this route (e.g. `--route /dashboard`) |
| `--device <class>` | string | Limit to one viewport class: `mobile`, `tablet`, or `desktop` |
| `--browser <name>` | string | Limit to one browser: `chromium`, `firefox`, or `webkit` |
| `--headed` | flag | Run Playwright with visible browser windows (overrides config) |
| `--headless` | flag | Run Playwright in headless mode (overrides config) |
| `--dry-run` | flag | Detect issues only; do not file ADO bugs (overrides config) |
| `--no-vision` | flag | Skip vision review step even if enabled in customize.toml |
| `--rules <list>` | csv | Run only the listed detector/skill names (comma-separated) |
| `--setup` | flag | Jump directly to /qa-setup before running |
| `--resume <runId>` | string | Skip cells whose `{runId}/issues/{cellId}.jsonl` already exists. Use after a hang/crash to continue from where the previous run died (added 2026-06-02). |
| `--no-batching` | flag | Disable `[resilience].batch_size` chunking and run all cells in one Sonnet dispatch. Risks ~10-min API timeout on audits > 30 cells. |
| `--no-resilience` | flag | Disable all `[resilience]` timeouts and budgets. Restores pre-2026-06-02 behavior. **Only for debugging.** |

---

## Registered Skills

Claude reads each skill's `SKILL.md` at runtime � names only listed here.

- **Pipeline (8):** `qa-argus`, `qa-argus-setup`, `qa-argus-ready`, `qa-preflight`, `qa-route-discovery`, `qa-phase-strategy`, `qa-bug-filer`, `qa-coverage-report`
- **Detection (35):** `qa-detect-a11y`, `qa-detect-breakpoint-boundary`, `qa-detect-console-errors`, `qa-detect-dark-mode`, `qa-detect-dropdown-viewport-clip`, `qa-detect-forced-colors`, `qa-detect-form-a11y`, `qa-detect-form-autocomplete`, `qa-detect-form-captcha`, `qa-detect-form-csrf`, `qa-detect-form-error-summary`, `qa-detect-form-validation`, `qa-detect-forms`, `qa-detect-hover-touch`, `qa-detect-images`, `qa-detect-layout`, `qa-detect-loading`, `qa-detect-mobile-keyboard`, `qa-detect-modal-viewport-fit`, `qa-detect-network-errors`, `qa-detect-orientation`, `qa-detect-overflow`, `qa-detect-overflow-controls`, `qa-detect-reduced-motion`, `qa-detect-reflow`, `qa-detect-responsive-images`, `qa-detect-rtl-layout`, `qa-detect-safe-area`, `qa-detect-sticky-scroll`, `qa-detect-touch`, `qa-detect-typography`, `qa-detect-typography-advanced`, `qa-detect-viewport-meta`, `qa-detect-word-break`, `qa-detect-zoom-200`
- **Functional (28):** `qa-test-auth-flow`, `qa-test-cases`, `qa-test-data-controls`, `qa-test-dragdrop`, `qa-test-form-boundaries`, `qa-test-form-combobox`, `qa-test-form-conditional`, `qa-test-form-datetime`, `qa-test-form-file-upload`, `qa-test-form-formatted-inputs`, `qa-test-form-inline-edit`, `qa-test-form-input-mask`, `qa-test-form-otp`, `qa-test-form-password-rules`, `qa-test-form-realtime`, `qa-test-form-special-chars`, `qa-test-form-submit-state`, `qa-test-form-tag-input`, `qa-test-form-wizard`, `qa-test-history`, `qa-test-i18n`, `qa-test-idempotency`, `qa-test-keyboard`, `qa-test-mobile-nav`, `qa-test-navigation`, `qa-test-states`, `qa-test-theme`, `qa-test-widgets`
- **Review (3):** `qa-review-content` (visible text), `qa-review-hidden-text` (placeholders/alt/title/aria), `qa-vision-review` (multimodal screenshot review)
- **Total: 74 skills**
- **Detection (35):** `qa-detect-overflow`, `qa-detect-typography`, `qa-detect-touch`, `qa-detect-images`, `qa-detect-layout`, `qa-detect-forms`, `qa-detect-a11y`, `qa-detect-loading`, `qa-detect-console-errors`, `qa-detect-network-errors`, `qa-detect-form-validation`, `qa-detect-reflow`, `qa-detect-breakpoint-boundary`, `qa-detect-zoom-200`, `qa-detect-responsive-images`, `qa-detect-orientation`, `qa-detect-form-autocomplete`, `qa-detect-form-csrf`, `qa-detect-form-a11y`, `qa-detect-form-captcha`, `qa-detect-form-error-summary`, `qa-detect-dropdown-viewport-clip`, `qa-detect-sticky-scroll`, `qa-detect-modal-viewport-fit`, `qa-detect-hover-touch`, `qa-detect-overflow-controls`, `qa-detect-word-break`, `qa-detect-reduced-motion`, `qa-detect-forced-colors`, `qa-detect-viewport-meta`, `qa-detect-safe-area`, `qa-detect-rtl-layout`, `qa-detect-dark-mode`, `qa-detect-mobile-keyboard`, `qa-detect-typography-advanced`
- **Functional (27):** `qa-test-navigation`, `qa-test-auth-flow`, `qa-test-data-controls`, `qa-test-widgets`, `qa-test-states`, `qa-test-history`, `qa-test-idempotency`, `qa-test-keyboard`, `qa-test-dragdrop`, `qa-test-i18n`, `qa-test-theme`, `qa-test-cases`, `qa-test-form-boundaries`, `qa-test-form-special-chars`, `qa-test-mobile-nav`, `qa-test-form-realtime`, `qa-test-form-password-rules`, `qa-test-form-conditional`, `qa-test-form-file-upload`, `qa-test-form-wizard`, `qa-test-form-submit-state`, `qa-test-form-datetime`, `qa-test-form-formatted-inputs`, `qa-test-form-otp`, `qa-test-form-combobox`, `qa-test-form-inline-edit`, `qa-test-form-tag-input`, `qa-test-form-input-mask`
- **Review (2):** `qa-review-content` — Sonnet-tier; spelling/grammar/word choice/placeholder/untranslated/encoding/markdown in visible page text. `qa-review-hidden-text` — Sonnet-tier; same checks for text hidden in placeholder/alt/title/aria-label/value attributes and select options

---

## PIPELINE CONTINUITY

Interactive up to Step 1.5 (4 permitted question points). After the user types Y or S at Step 1.5, run Steps 2�9 in a single continuous response with no pauses, summaries, or "shall I continue?" questions. Only a hard-stop error breaks the flow.

## MODEL POLICY

The audit pipeline (Steps 2–9) MUST run on Sonnet.

Rule applied at Step 2.0:
- If the user's Claude Code session model is **Sonnet** → run Steps 2–9 directly on the session.
- If the session model is **anything else** (Haiku for reliability, Opus for cost, or any other model) → dispatch Steps 2–9 to a Sonnet subagent via the Agent tool, then display its return value to the user.

Why this rule exists:
- Haiku reliably runs single-task probes but is unreliable for the 12-step orchestration loop (real-world test: hallucinated a clean 12-cell audit without opening a browser).
- Opus runs the loop perfectly but is 5× more expensive than Sonnet for identical work quality.
- Sonnet is the sweet spot: reliable, capable of judgment, and cost-efficient.

Per-skill subagents (declared in `customize.toml → [models]`) still use whatever model their skill specifies. Haiku for mechanical probes, Sonnet for judgment work, Opus only when explicitly requested.

Override: pass `--no-downshift` to skip auto-dispatch and run the pipeline directly on the session model. Useful when you specifically want Opus reasoning on an unusually complex audit.
---

## On Activation � Step-by-Step Pipeline

Execute these steps **in order**. Complete each step fully before moving to the next. Log each step heading to the terminal as you begin it.

---

### Step 0 � Setup Check

```
LOG: "�x� Step 0: Setup check"
```

**AUTO-INVOKE SETUP WIZARD (updated 2026-06-02): the orchestrator MUST NEVER hard-stop on missing config. Goal is one-prompt onboarding: a new user typing "audit my-app" should see the setup wizard run automatically inline, then their audit proceed. Hard-stops here treat the user like a CLI operator instead of a conversational partner.**

1. Read `{project-root}/.claude/automation.config.json`.
2. If the file does not exist �  **AUTO-INVOKE** the setup wizard inline: log `🔧 First-time setup detected — running setup wizard automatically...`, read `{skill-root}/../qa-argus-setup/SKILL.md` and execute it inline, then re-read `automation.config.json`. If still missing after wizard completes → THEN hard-stop: `"Setup wizard did not produce automation.config.json. Run /qa-argus-setup manually to diagnose."` Otherwise continue to Step 0.5 with the user's original task.
3. If `apps` array is empty or missing �  **AUTO-INVOKE** the setup wizard inline (same flow as step 2): execute `qa-argus-setup`, re-read `automation.config.json`, continue to Step 0.5 on success. Do NOT hard-stop on missing apps[].
4. If `dry_run = false` in customize.toml AND `ado.org === "YOUR_ADO_ORG"` �  **AUTO-INVOKE** the setup wizard in ADO-only mode: log `🔧 ADO credentials needed — collecting now...`, run the wizard's ADO collection block (Step A + Step B from `qa-argus-setup/SKILL.md`), then re-read `automation.config.json` and `secrets.json`. On success continue to Step 0.5. Do NOT hard-stop. Only hard-stop if the user explicitly cancels the wizard.
5. If `--setup` flag was passed �  invoke `/qa-setup` and exit.

---

### Step 0.5 � Welcome Screen

Read `{skill-root}/menu.md` �  follow the **Step 0.5** instructions there.

---

### Step 0.75 � Task Menu

Read `{skill-root}/menu.md` �  follow the **Step 0.75** instructions there.

---

### Step 1 � Load Configuration

```
LOG: "�a"️  Step 1: Load configuration"
```

Merge configuration from four layers (later layers win):

```
Layer 1: automation.config.json        (base)
Layer 2: customize.toml                (project overrides)
Layer 3: CLI arguments                 (--flag overrides)
Layer 4: Prompt overrides              (parsed from natural-language input)
```

When the user's prompt contains a URL pattern, email address, or password phrase, parse them as Layer 4 overrides:

- Detect URL: any token matching `https?://` �  set as `baseUrl` override for this run
- Detect email: any token matching `\S+@\S+\.\S+` �  use as login credential
- Detect password: any token after `password`, `pass:`, `pw:`, or a quoted string �  use as login credential; **MASK as `⬢⬢⬢⬢⬢⬢⬢⬢` in all log output immediately**

#### Credential save prompt (shown in Step 1.5 when email or password came from the prompt)

After masking, ask once inside the Step 1.5 confirmation block:

```
Save credentials for future runs? [Y/N]:
```

- **Y** �  write to `{project-root}/.claude/secrets.json` under the app's key:
  ```json
  {
    "apps": {
      "<appName>": {
        "email": "user@example.com",
        "password": "the-password"
      }
    }
  }
  ```
  Print: `�S Credentials saved to .claude/secrets.json`

- **N** �  hold email + password in memory only for this run. Discard both after Step 10.

#### Credential lookup order (applied at the start of Step 1, before the prompt is parsed)

For each configured app, load credentials in this priority order (first match wins):

| Priority | Source | Notes |
|----------|--------|-------|
| 1 | Prompt (email + password detected in user's message) | Layer 4 � always wins, offer to save |
| 2 | `{project-root}/.claude/secrets.json �  apps.<appName>.email / .password` | Saved from a previous run |
| 3 | `automation.config.json �  apps[].email / .password` (if not `USE_ENV_VAR`) | Static config � least preferred |

If credentials are loaded from secrets.json (priority 2), do NOT ask "Save for future runs?" � they are already saved.

**Security rules for passwords:**
- NEVER log, print, or echo the password in full at any point � always `⬢⬢⬢⬢⬢⬢⬢⬢`
- NEVER write to `.env.local`, `qa-state.json`, `.tmp/*`, or any audit output file
- ONLY write to `.claude/secrets.json` when user explicitly says Y
- `.claude/secrets.json` MUST be gitignored (verified by Preflight check 5)

#### Browser Resolution

Apply in this priority order (first match wins):

1. `--browser <name>` CLI flag �  use only that browser
2. Natural-language phrase in prompt (see table below) �  use those browsers
3. `crossBrowser.enabled = false` in automation.config.json �  use `chromium` only
4. `browsers` array in customize.toml �  use those browsers
5. **Hard default: `["chromium"]` only** � never assume more browsers than the user asked for

**Natural-language browser detection � scan the prompt for any of these phrases:**

| If prompt contains | Resolve to |
|--------------------|------------|
| `chromium only`, `only chromium`, `just chromium`, `chrome only` | `["chromium"]` |
| `firefox only`, `only firefox`, `just firefox` | `["firefox"]` |
| `webkit only`, `only webkit`, `safari only`, `just safari` | `["webkit"]` |
| `chromium and firefox`, `chrome and firefox`, `chromium firefox` | `["chromium","firefox"]` |
| `chromium and webkit`, `chrome and safari`, `chromium webkit` | `["chromium","webkit"]` |
| `firefox and webkit`, `firefox and safari`, `firefox webkit` | `["firefox","webkit"]` |
| `all browsers`, `every browser`, `cross browser`, `chromium firefox webkit`, `chrome firefox safari` | `["chromium","firefox","webkit"]` |

Export as env var: `BROWSERS=chromium,firefox,webkit`

#### Worker Count Derivation

Workers are derived automatically from the number of resolved browsers. Never hardcode `workers: 1`.

| Browsers | workers |
|----------|---------|
| 1 browser | 4 |
| 2 browsers | 8 |
| 3 browsers | 12 |

**Rule:** `workers = browsers.length * 4`

Export as env var: `WORKERS=<derived value>`

#### Headless Resolution

Apply in this priority order (first match wins):

1. `--headed` CLI flag �  `HEADLESS=false`
2. `--headless` CLI flag �  `HEADLESS=true`
3. Natural-language phrase in prompt (see table below) �  use that value
4. `responsiveness.headless` in automation.config.json �  use that value
5. Default: `HEADLESS=true`

**Phrases that mean headed (HEADLESS=false):**
`show browser`, `open browser`, `headed`, `visible browser`, `watch it run`

**Phrases that mean headless (HEADLESS=true):**
`headless`, `silent`, `background`, `no browser`, `invisible`

Export as env var: `HEADLESS=true` or `HEADLESS=false`

#### Final Config Object

After merging, hold `resolvedConfig` in memory with these fields: `apps`, `browsers`, `workers` (browsers.length�4), `headless`, `dryRun`, `viewports`, `pinnedRoutes`, `skippedRoutes`, `visionReview`, `enabledDetectors`, `enabledFunctionalTests`, `runLabel`.

Log the resolved config summary (mask any passwords).

---

### Step 1.5 � Settings Confirmation

```
LOG: "�S& Step 1.5: Confirm settings"
```

Read `{project-root}/.claude/qa-state.json`. If `lastSettings` exists, load it into `resolvedConfig`. Print the confirmation screen:

```
Resolved Settings
  App       : {appName}
  URL       : {baseUrl}
  Login     : {email} / ⬢⬢⬢⬢⬢⬢⬢⬢  {credSource}
  Browsers  : {browsers}    Workers: {workers}
  Viewports : {viewports}   Headless: {headless}
  Dry run   : {dryRun}      Vision : {visionReview}
  Bug filing: {dryRun ? "disabled" : adoOrg + "/" + adoProject}
  ADO PAT   : {adoPat ? "⬢⬢⬢⬢⬢⬢⬢⬢ �S" : "�a� will prompt"}

  [Y] Start (first run)  |  [S] Use these (return run)  |  [N/C] Change
```

- **[Y]** or **[S]** �  proceed to Step 2
- **[N]** or **[C]** �  show inline editor �  re-print this screen �  wait for Y/S

**`{credSource}` resolves to:**

| Credential origin | Display |
|-------------------|---------|
| From prompt, not yet saved | `(from prompt � will ask to save)` |
| Loaded from `.claude/secrets.json` | `�S (saved)` |
| Loaded from `automation.config.json` | `(from config)` |
| Missing � no credentials found | `�a� credentials needed` |

---

#### Inline settings editor (shown on [N] or [C])

**IMPLEMENTATION:** Show NUMBERED MENU OPTIONS. Users SELECT [1] [2] [3] [4], do NOT type values. Press Enter to keep current value.

**For each of 5 settings, show this exact format:**

```
Browsers  [{current}] �  chromium / firefox / webkit / all: 
Workers   [{current}] �  auto (browsers � 4) or enter number: 
Viewports [{current}] �  mobile / tablet / laptop / desktop / all: 
Headless  [{current}] �  true / false: 
Dry run   [{current}] �  true / false: 
```

After all 5 inputs: re-derive `workers = browsers.length * 4` unless user entered a custom number. Then re-print the confirmation screen.

---

#### ADO Credentials Prompt (shown inside Step 1.5 when `dry_run = false`)

After showing the confirmation screen (Path A or B), check ADO readiness:

```
adoOrg     = ado.org     from automation.config.json
adoProject = ado.project from automation.config.json
adoPat     = read .claude/secrets.json FIRST for AZURE_DEVOPS_PAT, then env var, then prompt
```

**CRITICAL FIX:** Load from `.claude/secrets.json` BEFORE asking the user. If PAT exists in secrets.json, display it as `⬢⬢⬢⬢⬢⬢⬢⬢ (saved)` and do NOT prompt again.

**Condition: `dry_run = false` AND (`adoOrg` is a placeholder OR `adoPat` is empty)**

Print this block BEFORE the [Y]/[N] or [S]/[C] prompt:

```
�"�"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"
�"  Bug Filing Setup  (dry_run is OFF � real bugs will be filed)�"
�"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
�"  PAT     : {⬢⬢⬢⬢⬢⬢⬢⬢  if set, or "�a� not set � will prompt"}  �"
�"  Org     : {adoOrg   � or "�a� auto-discover after PAT entry"} �"
�"  Project : {adoProject � or "�a� auto-discover after PAT entry"}�"
�"a�"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
```

**PAT lookup order:** `.claude/secrets.json �  AZURE_DEVOPS_PAT` �  env var `AZURE_DEVOPS_PAT` �  interactive prompt.

If `dry_run = true`, skip this entire block.

#### Step A � Collect PAT (if missing)

Prompt for PAT (scope: Work Items Read & Write). Mask as `⬢⬢⬢⬢⬢⬢⬢⬢` immediately. Ask "Save for future runs? [Y/N]". On Y �  write to `.claude/secrets.json �  AZURE_DEVOPS_PAT`. On N �  keep in memory only, discard after Step 10.

#### Step B � Auto-discover org and project via ADO API

Use Basic auth: `curl -sf -u ":$PAT" <url>`. Try in order:

1. `GET https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1` �  on 200, follow with `/_apis/accounts?memberId={memberId}&api-version=7.1` to list orgs. On 401/403, go to step 2.
2. Ask user for org name. Verify with `GET https://dev.azure.com/{org}/_apis/projects?api-version=7.1`. 200 OK, 404 = not found, 401/403 = PAT scope issue.
3. From step 1 or 2, list projects. If 1 �  auto-select. If many �  ask user to pick.
4. Verify final access: `GET https://dev.azure.com/{org}/{project}/_apis/wit/workitemtypes?api-version=7.1`. On 401/403 �  loop back to Step A (re-enter PAT).

Save org as `https://dev.azure.com/{org}` to `automation.config.json �  ado.org`. Save project name to `ado.project`. Re-print the confirmation screen with ADO populated, then show the [Y/S/N/C] prompt.

**PAT security:** never write to `qa-state.json`, `automation.config.json`, `.env.local`, `.tmp/*`, or any log. Only `.claude/secrets.json` (must be gitignored � verified in Step 2). Always mask as `⬢⬢⬢⬢⬢⬢⬢⬢` in output.

---

**NEVER proceed past Step 1.5 without explicit confirmation (Y or S) from the user.**

---

### Step 2 � Preflight

```
LOG: "�x:� Step 2: Preflight"
```

#### 2.0 Model verification + auto-dispatch decision

1. Detect the current session model. The exact model ID is in the system prompt (e.g. `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-opus-4-7`).

2. Apply the decision:

   ```
   if model_id contains "sonnet"  AND --no-downshift was NOT passed:
       → RUN Steps 2.1 through 9 directly on this session.

   elif --no-downshift was passed:
       → RUN Steps 2.1 through 9 directly. Log warning if Haiku.

   else (model is Haiku, Opus, or any non-Sonnet model):
       → AUTO-DISPATCH to Sonnet subagent (see Subagent Dispatch Protocol below).
   ```

3. After dispatch (if used), the orchestrator's remaining responsibilities are:
   - Display the subagent's returned summary to the user.
   - Run Step 9 (update qa-state.json) — small cost, single tool call, OK on any model.

#### Subagent Dispatch Protocol

When auto-dispatch fires, build a self-contained prompt and call the Agent tool:

```
Agent({
  subagent_type: "general-purpose",
  model: "sonnet",
  description: "Argus audit runner",
  prompt: <self-contained prompt as below>
})
```

The dispatch prompt MUST include:
- The full `resolvedConfig` JSON (app, baseUrl, browsers, viewports, headless, dryRun, viewports list, enabled skills).
- The absolute path to `{project-root}` and `{run-dir}` (= `{project-root}/.tmp/{runId}/`).
- The `runId` string.
- Login credentials placeholders: email + masked password reference (real password held by orchestrator, passed via env vars when running ephemeral scripts inside the subagent if Bash fallback is needed).
- A directive: "You are the Argus QA audit runner. Read `{project-root}/skills/qa-argus/SKILL.md` and execute Steps 2.1 through 8 of the pipeline. Use `{project-root}/skills/{skill-name}/SKILL.md` for each enabled skill. Follow all Hard Stop Rules. Use Playwright MCP tools if available; otherwise use the Write+Run pattern. When complete, return the final summary box only."

Fallback if dispatch fails twice in a row: run Steps 2.1–8 directly on the session model. Log a warning so the user can switch to Sonnet next run.

Skip dispatch entirely if `--no-downshift` was passed.
#### 2.1 � Run preflight (subagent, or direct if downshift skipped)

Read `{skill-root}/../qa-preflight/SKILL.md` and execute its instructions fully.

The preflight skill will:
- Verify Node.js and Playwright versions
- Check network connectivity to each app's `baseUrl`
- **URL health check** (added 2026-06-02): when `resilience.preflight_url_health = true`, send HTTP HEAD to `baseUrl` with a 5 s timeout. If the target is unreachable (timeout, DNS failure, 5xx), HARD STOP **before** any LLM cost is incurred. Prevents 9-minute hangs on dead targets.
- Verify Playwright browsers are installed
- Check disk space in `.tmp/`
- Abort with a clear error message if any check fails

---

### Step 3 � Route Discovery

```
LOG: "�x�️  Step 3: Route discovery"
```

�: **TOOL LOCK � route discovery rules (checked before any action):**
- **NEVER** `cd` to any path outside `{project-root}`.
- **NEVER** run `node lib/discover-routes.mjs`, `node lib/capture.mjs`, or ANY Node.js script not written inline right now.
- **NEVER** use any tool, library, or script that lives outside `{project-root}/.claude/` or `{project-root}/.tmp/`.
- If you catch yourself about to `cd` somewhere outside the project root �  **STOP**. That is the wrong approach.
- Route discovery is done by writing and running a **small inline Node.js+Playwright script** as described in `{skill-root}/../qa-route-discovery/SKILL.md`. That is the ONLY correct method.

Read `{skill-root}/../qa-route-discovery/SKILL.md` and follow the **Inline Script Method** exactly as written there.

The route discovery skill will:
- Crawl each app starting from `baseUrl`
- Respect `pinnedRoutes` (always include) and `skippedRoutes` (always exclude)
- Deduplicate and normalise discovered URLs
- Write the result to `{project-root}/.tmp/routes.json`

`routes.json` shape (produced by `qa-route-discovery`):

```json
{
  "runId": "qa-20260520-abc1",
  "discoveredAt": "ISO-8601",
  "app": "string",
  "baseUrl": "https://example.com",
  "loginSucceeded": true,
  "routes": [
    { "path": "/",          "title": "Home",      "requiresAuth": false, "tabs": [] },
    { "path": "/dashboard", "title": "Dashboard", "requiresAuth": true,
      "tabs": ["Overview", "Details", "History"] }
  ]
}
```

`tabs` is an array of visible tab labels for routes that have in-page `[role=tab]` content switching. Empty array means no tabs. `qa-phase-strategy` propagates `tabs` into each `audit-plan.json` cell; `argus` step 5.6 consumes them to generate per-tab detection tests.

---

### Step 4 � Phase Strategy

```
LOG: "�x9 Step 4: Phase strategy"
```

Read `{skill-root}/../qa-phase-strategy/SKILL.md` and execute its instructions fully.

The phase strategy skill will:
- Read `routes.json`
- Score and prioritise routes (pinned routes score highest)
- Assign each route to a phase (smoke / regression / full)
- Cross-product with viewports and browsers from `resolvedConfig`
- Write the audit plan to `{project-root}/.tmp/audit-plan.json`

`audit-plan.json` shape:

```json
{
  "generatedAt": "ISO-8601",
  "app": "string",
  "totalCells": 42,
  "cells": [
    {
      "id": "cell-001",
      "route": "/dashboard",
      "viewport": { "name": "iPhone 12", "width": 390, "height": 844 },
      "viewportClass": "mobile",
      "browser": "chromium",
      "phase": "smoke",
      "priority": 1
    }
  ]
}
```

---

### Step 5 � Execute Skills (Playwright MCP, per-cell, multi-model)

```
LOG: "�xa� Step 5: Running skill checks"
```

No permanent runner. The orchestrator drives the browser via Playwright MCP tools (or inline Bash + Playwright fallback) and dispatches each cell's work on the model the skill declares.

#### 5.1 � Determine enabled skills + model routing

Read `customize.toml`:
- `[detectors]` section �  every key with value `true` is enabled (overridable via `--rules`)
- `[models]` section �  resolves each skill's model. Per-skill `model:` frontmatter is the default; `[models]` overrides it; CLI flag `--model` overrides both

Build two lists:
- `mechanicalSkills` � detectors that run as a single `browser_evaluate(probe)` per cell
- `interactiveSkills` � skills with `interactive: true` in frontmatter; orchestrator follows their MCP-tool-sequence steps

#### 5.2 � Detect browser bridge

Check tool availability:
- If `browser_navigate` (Playwright MCP) is registered �  **MCP mode**
- Otherwise �  **Bash fallback mode** (see fallback pattern below)

Log which mode is active. Both modes produce the same findings; only token cost differs.

##### Bash fallback pattern � MUST follow exactly (Hard Stop Rule #5)

**FORBIDDEN:** `node - <<EOF`, `node -e "..."`, any heredoc with embedded JS code. These corrupt template literals on Windows.

**REQUIRED:** Two-tool pattern for every browser op or batched-cell sweep:

1. **Use the Write tool** to create `.tmp/{runId}/cell-{cellId}.cjs` (or `sweep-{N}.cjs` for batched). The file content is a complete standalone Node script that:
   - `require`s `@playwright/test` from `node_modules/`
   - Reads needed paths from `process.env` (set in step 2 below)
   - Does the browser ops (navigate, evaluate probes, etc.)
   - Writes findings to `.tmp/{runId}/issues/{cellId}.jsonl` directly (does NOT print to stdout)
   - Exits with code 0 on success
2. **Use the Bash tool** to run it. PowerShell-safe form on Windows:
   ```bash
   QA_BASE_URL="..." QA_STORAGE="..." QA_VIEWPORT_W=1440 QA_VIEWPORT_H=900 \
     node "{abs-project-root}/.tmp/{runId}/cell-{cellId}.cjs"
   ```
   Or for Windows PowerShell tool:
   ```powershell
   $env:QA_BASE_URL="..."; $env:QA_STORAGE="..."; $env:QA_VIEWPORT_W=1440; $env:QA_VIEWPORT_H=900
   node "{abs-project-root}/.tmp/{runId}/cell-{cellId}.cjs"
   ```
3. After successful run, optionally delete the `.cjs` file.

**Never put script content inline in the Bash command itself.** Always Write first, then run.

#### 5.3 � Login once per browser

For each browser in `resolvedConfig.browsers`:
- MCP mode: open a browser session, navigate to `QA_LOGIN_PATH`, fill email + password (mask password in any output), click submit, wait for navigation. Use `browser_save_storage_state` if MCP exposes it; otherwise the MCP session persists cookies automatically across subsequent tool calls.
- Bash mode: run a one-shot snippet that produces `storage-state-{browser}.json`. Pass this path on every subsequent navigation snippet.

#### 5.4 � Per-cell execution loop

**RESILIENCE GATES (added 2026-06-02 after run qa-20260602-005 hung 9m 32s on cell-004 `/undertakings/add-undertakings`, killing the whole 57-cell audit and losing findings from cells 1-3 because writes were buffered).**

At the start of Step 5, read `customize.toml -> [resilience]` and apply on every cell:

| Cap | Default | What it bounds |
|---|---|---|
| `navigate_timeout_ms` | 15000 | Hard timeout on `browser_navigate` |
| `navigate_wait_until` | `domcontentloaded` | **NEVER `networkidle`** — polling SPAs never reach it |
| `post_navigate_settle_ms` | 1500 | Short wait after DOM ready |
| `evaluate_timeout_ms` | 8000 | Hard timeout on each `browser_evaluate` |
| `mcp_call_total_ms` | 20000 | Any single MCP call ceiling |
| `cell_total_ms` | 90000 | Whole cell must complete within budget |
| `cell_max_retries` | 1 | One retry on timeout/error before skipping |
| `batch_size` | 12 | Audits > N cells split into multiple Sonnet dispatches |
| `network_capture_cap` | 100 | Trim `browser_network_requests()` output |
| `stream_writes` | true | Append findings JSONL **per-finding**, not per-cell |
| `preflight_url_health` | true | HEAD baseUrl with 5 s timeout in Step 2 |

**Batching rule:** if `audit-plan.json.totalCells > batch_size`, DO NOT run all cells in one Sonnet session. Split into chunks of `batch_size` cells each and dispatch each chunk via a separate Sonnet subagent call. Merge findings at the end. This prevents the ~10-minute Anthropic streaming-API ceiling from killing long audits.

**On any MCP error, timeout, or hang inside the per-cell loop:**

1. Append a synthetic finding to the cell's JSONL IMMEDIATELY: `{ issueType: "cellTimeout" | "cellFailed" | "mcpHang", severity: "low", description: "...reason..." }`.
2. Attempt one retry of the failing operation (only if `cell_max_retries > 0`).
3. If retry fails -> log the cell in `run-summary.json -> cellsFailed`, continue to next cell. **One bad cell must never block the entire audit.**

**RESUME SUPPORT:** if `--resume {runId}` was passed, list existing files under `{project-root}/.tmp/{runId}/issues/`. Build a set of completed cellIds. Before starting each cell below, check `if (completedCellIds.has(cell.id)) continue;` -- skip cells already audited. This lets you recover from a hang or crash without re-running the entire audit. New cells append to the same `.tmp/{runId}/` directory.

For each cell in `audit-plan.json` (grouped by browser, then by viewport):

```
For each cell (route � viewport � browser):
  a. needsSetup skills: call browser_console_messages() and
     browser_network_requests() to START capture BEFORE navigation.
     Apply resilience.network_capture_cap = 100 to trim the result before returning.
  b. browser_navigate({
       url:       baseUrl + cell.route,
       waitUntil: resilience.navigate_wait_until,  // "domcontentloaded" -- NEVER "networkidle"
       timeout:   resilience.navigate_timeout_ms   // 15000ms hard cap
     })
     On timeout: append {issueType:"cellTimeout", severity:"low", description:"Navigation timeout"}
     to the cell JSONL IMMEDIATELY, skip remaining steps of this cell, continue to next cell.
  b'. browser_wait_for({ time: resilience.post_navigate_settle_ms })  // ~1.5s settle
  c. If any skill has preWait: N �  browser_wait_for(time = N)
  d. Group enabled-skills-for-this-cell by viewport applicability + model:
       - skipped: skill's applyOn doesn't include cell.viewportClass
       - skipped: skill's viewportSensitive=false AND this isn't the
                  viewport-leader cell for this route � browser
       - Haiku tier: all enabled mechanical skills mapping to Haiku
       - Sonnet tier: all enabled skills mapping to Sonnet
       - skill-specific: each interactive skill runs its own MCP-tool sequence
  e. Haiku tier:
       Dispatch ONE batched browser_evaluate call that runs ALL enabled
       Haiku-mechanical probes for this cell in one round-trip. Pass an
       array of {name, probe} entries and return findings keyed by skill.
  f. Sonnet tier:
       For each Sonnet-classified skill, dispatch its probe/sequence on
       Sonnet (using Agent tool with subagent_type=qa-{skill-name}, 
       model=sonnet). The subagent receives skill SKILL.md + cell context
       and returns findings.
  g. Interactive skills (auth-flow, cases, data-controls, widgets, etc.):
       The orchestrator follows the skill's "Orchestrator flow" section,
       calling browser_click / browser_type / browser_wait_for as needed,
       then evaluating probes to check the resulting state.
  h. **Evidence capture — DETERMINISTIC, no code generation allowed.**

       🚨 **PRODUCTION RULE:** Do NOT compose annotate.js calls from the orchestrator. Do NOT write a per-cell .cjs that does annotation. Use the permanent script `scripts/annotate-cell.cjs` — it reads the cell's already-written JSONL and produces the annotated screenshot from validated data. No field-name mismatches possible.

       The orchestrator's job at step (h) is only TWO operations:

       (1) Take the cell's base screenshot via MCP — exactly ONE per cell. **MUST use `fullPage: true`** so the entire document is captured. Probes return bboxes in document coordinates; viewport-only screenshots cause every bbox below the fold to be drawn outside the image (the historical "annotation in the wrong place" bug from run-006 cell-007):
           ```
           browser_take_screenshot(
             path     = "{project-root}/.tmp/{runId}/screenshots/{cell.id}-base.png",
             fullPage = true
           )
           ```

       (2) For every finding emitted by a skill in this cell, before writing
           it to JSONL ensure the finding has a `bbox` resolved:
           - If the skill already returned a bbox → use it
           - If the skill returned a selector → resolve via:
             ```
             browser_evaluate(`
               (sel) => { const el = document.querySelector(sel);
                          if (!el) return null;
                          const r = el.getBoundingClientRect();
                          if (r.width === 0 && r.height === 0) return null;
                          return { x:Math.round(r.left), y:Math.round(r.top),
                                   w:Math.round(r.width), h:Math.round(r.height) }; }
             `, { args: finding.selector })
             ```
           - If neither yields a bbox → omit `bbox` entirely from the finding.
             Page-level findings without bbox are valid; they appear in the legend without a marker.

       Then write the cell's findings to `{run-dir}/issues/{cell.id}.jsonl`.

       The annotation itself runs in step (h.3), **after** step (j) writes the JSONL:

       (h.3) After JSONL is written for the cell, invoke the permanent annotator:
           ```
           node "{project-root}/scripts/annotate-cell.cjs" "{runId}" "{cell.id}"
           ```
           This script:
             - Reads the cell's JSONL
             - Validates every finding against the canonical schema (scripts/argus-schema.cjs)
             - Calls scripts/annotate.js with the correct field names and full description data
             - Produces `{cell.id}-annotated.png` with numbered markers on the screenshot and a descriptive legend below
             - Updates every line in the JSONL with `screenshotPath` and `annotatedScreenshotPath`
           If `annotate-cell.cjs` exits non-zero, the run is degraded — print the error and continue. The base screenshot is still on disk and `file-bugs.cjs` will attach it as fallback.

       Color scale used by the annotator:
           critical=#b91c1c, high=#ef4444, medium=#f97316, low=#3b82f6

  i. needsSetup skills: read final console + network state, apply each
     skill's filters, emit findings. **These new findings ALSO go through step (h) — no skipping.**

  j. **JSONL write — GATED on screenshot completion. Before writing a single line, run this checklist for each finding currently in memory:**

       1. Is `screenshotPath` set to a file that exists on disk? If NO → go back to step (h) for this finding right now.
       2. Is `annotatedScreenshotPath` set to a file that exists on disk? If NO → re-run the annotator now.
       3. If after one retry either is still missing → set `screenshotSkipReason` to a specific one-line cause (e.g. `"browser disconnected"`, `"bbox resolved to zero size"`, `"selector not found in DOM"`). Empty string is forbidden.
       4. Only after every finding passes 1+2 OR has a non-empty 3 → write the line to the JSONL.

       Track and emit counters in `run-summary.json`:
       - `screenshotsCaptured` += findings written with `screenshotPath`
       - `screenshotsSkipped`  += findings written with `screenshotSkipReason`

       **STREAMING WRITE RULE (added 2026-06-02):** when `resilience.stream_writes = true`,
       append each finding to the JSONL IMMEDIATELY after its screenshot pipeline finishes
       (one fs.appendFileSync per finding). Do NOT buffer all findings in memory until cell end.
       Reason: a hang or socket close mid-cell must not lose the findings already produced.
       Cells 1-3 of run qa-20260602-005 were lost because findings were buffered until cell end
       and the cell-004 hang killed the process before any disk write occurred.

       Append findings to {project-root}/.tmp/{runId}/issues/{cell.id}.jsonl
       � one JSON object per line, schema:
       {runId, cellId, skill, issueType, severity, route, viewport,
        viewportClass, browser, selector, description, bbox, screenshotPath, annotatedScreenshotPath}
```

#### 5.5 � Escalation rule (Haiku �  Sonnet)

When a Haiku-tier batched evaluate returns a finding with `uncertain: true`, the orchestrator re-runs THAT specific skill's probe for THAT specific cell on the model specified in `customize.toml �  [models] �  escalation_model` (default: sonnet). The Sonnet result replaces the uncertain Haiku result.

If a Haiku batch silently returns zero findings on a complex page (DOM has >100 interactive elements), the orchestrator runs one Sonnet "sanity check" pass on that cell. Rare; rarely fires.

#### 5.6 � In-page tabs

For each cell whose route has a non-empty `tabs[]` array (from `routes.json`):
After running the base cell's skills, for each tab label:
- `browser_click(text = tab label)`
- `browser_wait_for(time = 500)`
- Re-run viewport-sensitive mechanical skills (overflow, typography, touch, layout, loading) against the new tab content
- Append findings with `cellId = "{cell.id}-tab-{tabSlug}"`

#### 5.7 � Cell completion

After each cell:
- Close any opened browser context if MCP mode requires explicit cleanup (most MCP servers manage this automatically)
- Stream a progress line: `[cell {n}/{total}] {route} @ {viewport}/{browser} �  {findingsCount} findings`

#### 5.8 � Run summary

After all cells, write `{project-root}/.tmp/{runId}/run-summary.json`:
```json
{
  "cellsTotal": N,
  "issuesTotal": N,
  "critical": N, "high": N, "medium": N, "low": N,
  "mode": "mcp|bash",
  "screenshotsCaptured": N,
  "screenshotsSkipped": N,
  "degradedCells": ["cell-003", "cell-007"]
}
```

**Visibility check before continuing to Step 6:**
If `screenshotsCaptured` is 0 but `issuesTotal` is greater than 0, the run is INCOMPLETE — the screenshot gate was bypassed somewhere. Print a loud warning to the terminal:

```
🚨 RUN INCOMPLETE — {issuesTotal} findings written but 0 screenshots captured.
   The screenshot gate in Step 5.4(h) was not executed. ADO tickets will be filed
   without visual evidence. Re-run the audit to repair, or run /qa-bug-filer
   --repair-existing to back-fill screenshots on the bugs already filed.
```

Do not silently continue when this condition holds.

Log:
```
�S& Skill checks complete
   Mode     : {mode}
   Cells    : {cellsTotal}
   Issues   : {issuesTotal}
     critical: {critical}  high: {high}  medium: {medium}  low: {low}
```

All downstream steps read from `{project-root}/.tmp/{runId}/issues/`.

---

### Step 6 � Vision Review

```
LOG: "�x�️  Step 6: Vision review"
```

If `visionReview = false` in the resolved config (or `--no-vision` was passed), log:

```
⏭️  Vision review disabled � skipping
```

Otherwise, read `{skill-root}/../qa-vision-review/SKILL.md` and execute its instructions fully.

The vision review skill will:
- Load all screenshots captured during Step 5
- Use Claude's vision capability to scan each screenshot for visual anomalies not caught by DOM queries
- Append any new issues to the `.jsonl` shards in `{project-root}/.tmp/{runId}/issues/`

---

### Step 7 � File Bugs

```
LOG: "�x�: Step 7: Filing bugs"
```

If `dryRun = true` in the resolved config, log:

```
�x�� Dry-run mode � bug filing skipped (set dry_run = false in customize.toml to file real bugs)
```

Otherwise, read `{skill-root}/../qa-bug-filer/SKILL.md` and execute its instructions fully.

The bug-filer skill will:
- Deduplicate issues against open ADO work items
- Create ADO bugs for new issues with full reproduction steps and screenshots
- Update existing ADO bugs if an issue has changed severity or gained new evidence
- Write a filing summary to `{project-root}/.tmp/filed-bugs.json`

---

### Step 8 � Coverage Report

```
LOG: "�x` Step 8: Coverage report"
```

Read `{skill-root}/../qa-coverage-report/SKILL.md` and execute its instructions fully.

The coverage report skill will:
- Read `audit-results.json` and `filed-bugs.json`
- Compute coverage metrics (routes tested, skills exercised, issues by severity)
- Write `{project-root}/.tmp/coverage-report.md` and `{project-root}/.tmp/coverage-report.json`
- Print the summary table to the terminal

The final terminal summary must include:

```
�R��������������������������������������������������������������������������������������������������������������������������
�  Argus � Run Complete                                �
�S��������������������������������������������������������������������������������������������������������������������������
�  Run label  : {runLabel}                                   �
�  Duration   : {duration}                                   �
�  Cells      : {cellsRun} / {cellsTotal}                    �
�  Routes     : {routeCount}                                 �
�  Browsers   : {browserList}                                �
�S��������������������������������������������������������������������������������������������������������������������������
�  Issues found                                              �
�    Critical : {criticalCount}                              �
�    High     : {highCount}                                  �
�    Medium   : {mediumCount}                                �
�    Low      : {lowCount}                                   �
�    Total    : {totalCount}                                 �
�S��������������������������������������������������������������������������������������������������������������������������
�  Bugs filed : {filedCount} (dry-run: {dryRun})             �
�  Report     : .tmp/coverage-report.md                      �
���������������������������������������������������������������������������������������������������������������������������
```

---

### Step 9 � Update qa-state.json

```
LOG: "�x� Step 9: Persisting run state"
```

Write the following fields to `{project-root}/.claude/qa-state.json`:

```json
{
  "userName": "string � preserve existing value, never overwrite",
  "lastRun": "string � ISO-8601 timestamp of this run",
  "lastRunLabel": "string � runLabel from resolvedConfig",
  "runsTotal": "number � increment existing value by 1",
  "lastSettings": {
    "appName": "string � app name from resolvedConfig",
    "baseUrl": "string � baseUrl from resolvedConfig",
    "email": "string � login email used this run (never the password)",
    "browsers": "array of strings � browsers from resolvedConfig",
    "workers": "number � derived workers count from resolvedConfig",
    "headless": "boolean � headless flag from resolvedConfig",
    "dryRun": "boolean � dryRun flag from resolvedConfig",
    "viewports": "array of strings � viewport class names from resolvedConfig",
    "pinnedRoutes": "array of strings � pinnedRoutes from resolvedConfig",
    "skippedRoutes": "array of strings � skippedRoutes from resolvedConfig",
    "visionReview": "boolean � visionReview flag from resolvedConfig"
  },
  "chronicIssues": [
    {
      "description": "string � issue description text",
      "skill": "string � skill name that detected the issue",
      "route": "string � route path where the issue was found",
      "seenCount": "number � total consecutive runs this issue appeared in",
      "firstSeen": "string � ISO-8601 timestamp of first appearance",
      "lastSeen": "string � ISO-8601 timestamp of most recent appearance"
    }
  ]
}
```

Chronic issues are issues that appeared in 3 or more consecutive runs on the same route. Promote any newly qualifying issue to the `chronicIssues` array. Retire any issue that has not appeared in the last 3 runs.

Save `email` to `lastSettings` so it can be shown in the returning-user screen � but **NEVER save the password**. The password is always re-supplied via the prompt or env var each run.

---

## Error Handling

| Situation | Behaviour |
|-----------|-----------|
| Playwright MCP not installed AND inline Bash Playwright snippet fails | HARD STOP: "Browser bridge unavailable. Install Playwright MCP (`npm install -g @playwright/mcp@latest`) or verify @playwright/test is in node_modules." |
| Single cell's evaluate call throws | Log the cell, mark `error: true` on that cell in summary, continue to next cell |
| `browser_navigate` exceeds `resilience.navigate_timeout_ms` | Append `{issueType:"cellTimeout", severity:"low", description:"Navigation timeout after Nms"}` to cell JSONL, skip remaining cell steps, continue to next cell |
| Single MCP call exceeds `resilience.mcp_call_total_ms` | Append `{issueType:"mcpHang", severity:"low", description:"MCP call {tool} hung for Nms"}`, retry once, then continue to next cell on failure |
| Cell exceeds `resilience.cell_total_ms` (90 s) total budget | Append `{issueType:"cellTimeout", severity:"low", description:"Cell total budget exceeded"}`, log to `cellsFailed`, continue to next cell |
| Anthropic API socket closed unexpectedly mid-audit | Findings already streamed to disk are preserved (no re-run loss). If a runId already has partial JSONLs, allow `--resume {runId}` to skip completed cells |
| Route discovery finds 0 routes | HARD STOP: "Route discovery returned 0 routes. Check baseUrl and auth config." |
| `preflight_url_health` HEAD on baseUrl fails | HARD STOP: "Target {baseUrl} not reachable. Aborting before any LLM cost is incurred." |
| Login fails during Step 5.3 | HARD STOP for that browser; skip remaining cells for that browser, continue with other browsers |
| ADO filing fails (non-dry-run) | Log each failure with HTTP status. Continue filing remaining bugs. |
| Vision review model error | Log warning. Skip vision review. Continue to Step 7. |


