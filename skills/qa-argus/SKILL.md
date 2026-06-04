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
| 3 | **Permanent operational scripts under `scripts/` are the SOURCE OF TRUTH and must NEVER be regenerated.** The orchestrator INVOKES them, never overwrites them. Permitted permanent scripts: `scripts/ado-api.sh`, `scripts/annotate-cell-prepare.cjs`, `scripts/annotate-cell-finalize.cjs`, `scripts/argus-schema.cjs`, `scripts/file-bugs.cjs`, `scripts/repair-bugs.cjs`. Browser ops happen via Playwright MCP tools OR ephemeral `.cjs` files written under `.tmp/{runId}/` ONLY when no permanent script covers the operation. | If a permanent script exists for an operation, CALL IT. Regenerating a permanent script (especially `file-bugs.cjs`) is the historical root cause of empty ADO tickets and is BANNED. |
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
| `--setup` | flag | Jump directly to /qa-argus-setup before running |
| `--resume <runId>` | string | Skip cells whose `{runId}/issues/{cellId}.jsonl` already exists. Use after a hang/crash to continue from where the previous run died (added 2026-06-02). |
| `--no-batching` | flag | Disable `[resilience].batch_size` chunking and run all cells in one Sonnet dispatch. Risks ~10-min API timeout on audits > 30 cells. |
| `--no-resilience` | flag | Disable all `[resilience]` timeouts and budgets. Restores pre-2026-06-02 behavior. **Only for debugging.** |

---

## Registered Skills

Claude reads each skill's `SKILL.md` at runtime — names only listed here. **This list is the single source of truth and is generated from `ls skills/`. Do NOT dispatch any skill name not in this list.**

- **Pipeline (9):** `qa-argus`, `qa-argus-ready`, `qa-argus-setup`, `qa-bug-filer`, `qa-cell-worker`, `qa-coverage-report`, `qa-phase-strategy`, `qa-preflight`, `qa-route-discovery`
- **Detection (39):** `qa-detect-a11y`, `qa-detect-adaptive-state`, `qa-detect-breakpoint-boundary`, `qa-detect-breakpoint-edge`, `qa-detect-console-errors`, `qa-detect-content-patterns`, `qa-detect-dark-mode`, `qa-detect-dropdown-viewport-clip`, `qa-detect-fluid-sweep`, `qa-detect-forced-colors`, `qa-detect-hover-touch`, `qa-detect-images`, `qa-detect-layout`, `qa-detect-loading`, `qa-detect-loading-states`, `qa-detect-mobile-keyboard`, `qa-detect-modal-viewport-fit`, `qa-detect-network-errors`, `qa-detect-orientation`, `qa-detect-orientation-flip`, `qa-detect-overflow`, `qa-detect-overflow-controls`, `qa-detect-reduced-motion`, `qa-detect-reflow`, `qa-detect-responsive-images`, `qa-detect-rtl-layout`, `qa-detect-safe-area`, `qa-detect-sticky-scroll`, `qa-detect-touch`, `qa-detect-touch-interactions`, `qa-detect-typography`, `qa-detect-typography-advanced`, `qa-detect-viewport-meta`, `qa-detect-viewport-parity`, `qa-detect-viewport-units`, `qa-detect-visual-regression`, `qa-detect-web-vitals`, `qa-detect-word-break`, `qa-detect-zoom-200`
- **Form (6, consolidated 2026-06-03):** `qa-form-a11y`, `qa-form-flow`, `qa-form-input-types`, `qa-form-security`, `qa-form-structure`, `qa-form-validation`
- **Functional (13):** `qa-test-auth-flow`, `qa-test-cases`, `qa-test-data-controls`, `qa-test-dragdrop`, `qa-test-history`, `qa-test-i18n`, `qa-test-idempotency`, `qa-test-keyboard`, `qa-test-mobile-nav`, `qa-test-navigation`, `qa-test-states`, `qa-test-theme`, `qa-test-widgets`
- **Review (3):** `qa-review-content`, `qa-review-hidden-text`, `qa-vision-review`
- **Total: 70 skills**

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
5. If `--setup` flag was passed �  invoke `/qa-argus-setup` and exit.

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

Workers = total dedicated browser windows = **one per (engine × viewport)** = `browsers.length × viewports.length`. Each worker is an engine-pinned MCP browser resized to its viewport (Step 5.0). Never hardcode `workers: 1`.

| Browsers selected | Viewports | Workers (browser windows) |
|---|---|---|
| chromium | 4 (mobile/tablet/laptop/desktop) | **4** |
| chromium + webkit | 4 | **8** |
| chromium + firefox + webkit | 4 | **12** |

**Rule:** `workers = browsers.length × viewports.length`. Actual parallelism is capped by how many (engine × viewport) servers connected (Step 5.0 `activeWorkers`); `qa-preflight` generates `.mcp.json` to match your selection so they line up.

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
**Content-context wiring (must happen on EVERY cell dispatch):**

`resolvedConfig.content` is merged from `automation.config.json → content` + `customize.toml → [content]`. Defaults: `proper_nouns: [appName]`, `languages: ["en"]`, `legal_routes: ["/privacy","/terms","/legal","/cookie","/refund","/shipping","/gdpr","/ccpa","/data-processing"]`, `english_only: true`, `enable_reading_level: true`, `enable_legal_mode: true`.

When invoking `qa-detect-content-patterns`, wrap the probe in an IIFE and pass the arg:
```js
browser_evaluate({
  function: "(ctx)=>(...probe IIFE...)(ctx)",
  arg: {
    properNouns: resolvedConfig.content.proper_nouns,
    englishOnly: resolvedConfig.content.english_only,
    enableReadingLevel: resolvedConfig.content.enable_reading_level
  }
})
```

When invoking `qa-review-content`, build the Sonnet sub-agent context from:
- `properNouns`: `resolvedConfig.content.proper_nouns`
- `candidateMisspellings`: filter cell findings where `skill === "qa-detect-content-patterns"` AND `issueType === "candidateMisspelling"` → `[{word, snippet}, …]`
- `homophoneCandidates`: same filter for `issueType === "homophoneCandidate"`
- `mode`: `resolvedConfig.content.legal_routes.some(p => cell.route.toLowerCase().includes(p.toLowerCase())) ? "legal" : "standard"`. When `mode === "legal"`, use the **legal-mode prompt** block from `qa-review-content/SKILL.md`. Legal-mode cells are uncapped by `grammar.max_cells` — compliance is mandatory.


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
  Browsers  : {browsers}    Workers: {workers} (parallel via qa-cell-worker subagents)
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

After all 5 inputs: re-derive `workers = browsers.length × viewports.length` (one browser per engine × viewport) unless user entered a custom number. Then re-print the confirmation screen.

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

#### 5.0.A — Build the coverage ledger (MANDATORY checklist — do this BEFORE the per-cell loop)

🚨 This step is what makes silent skips impossible. The audit's deliverable is NOT "some findings" — it is a COMPLETE LEDGER proving every applicable (cell × skill) pair was accounted for. The run may not finish until the ledger is complete (enforced in Step 5.9).

1. Read `{project-root}/.tmp/{runId}/audit-plan.json` → the full cell list (every route × viewport × browser). Assign each cell a STABLE id `cell-NNN` in plan order (001, 002, …). These ids are fixed for the whole run and are what `--resume` keys on.

2. For each cell compute its APPLICABLE skill set with NO model judgment — pure set operation:
   ```
   applicableSkills(cell) = ALL_ENABLED_SKILLS.filter(s =>
        (s.applyOn === 'all' || s.applyOn.includes(cell.viewportClass))
        && (s.viewportSensitive === true || isViewportLeaderFor(s, cell)))
   ```
   - `ALL_ENABLED_SKILLS` = every key set `true` in `customize.toml [detectors]`, PLUS the enabled functional / content / vision skills.
   - `s.applyOn` and `s.viewportSensitive` come from each skill's SKILL.md frontmatter (e.g. `qa-detect-touch` → `applyOn:[mobile,tablet]` so it is NOT applicable on desktop cells; `qa-detect-web-vitals` → `viewportSensitive:false` so it applies only on the viewport-leader cell for that route).
   - You may NOT drop a skill because "the page probably has no forms" — the skill's own probe self-skips and records `skipped` (Step 5.4 j.1). Dropping a skill here is forbidden.

3. Write the ledger to `{project-root}/.tmp/{runId}/coverage-ledger.jsonl` (a plain data file, written via the Write tool — NOT a script, and NEVER written into `issues/*.jsonl`). ONE line per expected (cell × skill) pair, status `expected`:
   ```
   {"cellId":"cell-007","route":"/billing","viewport":"Mobile","viewportClass":"mobile","browser":"chromium","skill":"qa-detect-overflow","status":"expected","reason":""}
   ```

4. Log:
   ```
   📋 Coverage ledger built: {pairs} expected (cell × skill) pairs across {cells} cells
      ({mobileCells} mobile, {tabletCells} tablet, {desktopCells} desktop) × {browsers}
   ```

Every `expected` line MUST become `done` / `clean` / `skipped` / `error` (Step 5.4 j.1) before the audit may finish. Any line left `expected` is a silent skip — Step 5.9's finish-gate will catch it and re-run or surface it.

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

### Step 5.0 — Cell sharding (DYNAMIC parallelism, honors resolvedConfig.workers)

🚨 **CRITICAL: read `resolvedConfig.workers` at runtime — do NOT hardcode.** This value is `browsers.length × viewports.length` (one browser per engine × viewport), capped by how many (engine × viewport) MCP servers connected (Step 5.0 `activeWorkers`). Changing browsers or viewports MUST change the real parallel-worker count next run. Never read a stale or memoized value.

```
workers = resolvedConfig.workers          // 4, 8, 12, etc — whatever the user set
totalCells = audit-plan.cells.length
```

**MCP server pool — ONE BROWSER PER (ENGINE × VIEWPORT) (2026-06-04).**

The parallelism dimension is the **viewport**. Each (engine × viewportClass) gets its OWN visible browser window of the correct engine, resized to that viewport, auditing every route at that combination. So **selection drives the count**:
- `chromium` only → **4 browsers** (mobile, tablet, laptop, desktop — all chromium)
- `chromium + webkit` → **8** (4 + 4)
- `chromium + firefox + webkit` → **12** (4 each)

```
viewportClasses = resolvedConfig.viewports.map(v => v.class)     // e.g. [mobile, tablet, laptop, desktop]

// serverFor(engine, vpClass): the .mcp.json server name for this combination.
// "playwright" is reserved as chromium-desktop AND the default server for route discovery / annotation / serial.
serverFor = (engine, vp) => (engine === "chromium" && vp === "desktop") ? "playwright" : `pw-${engine}-${vp}`

// Build one worker per (engine × viewport) whose server actually connected this session.
workerList = []
for engine in resolvedConfig.browsers:
  for vp in viewportClasses:
    const server = serverFor(engine, vp)
    if (mcp__{server}__browser_navigate is registered)
      workerList.push({ serverName: server, engine, viewportClass: vp,
                        viewport: resolvedConfig.viewports.find(v => v.class === vp) })
activeWorkers = workerList.length        // = browsers × viewports when all servers connected
```

- **Each worker owns ONE (engine × viewport)** — it uses ONLY `mcp__{serverName}__*`, `browser_resize`s its browser to `{viewport.width, viewport.height}` once at start, then audits every cell where `cell.browser === engine && cell.viewportClass === vp`. A firefox‑mobile cell runs in a real firefox browser sized to mobile — never a stand‑in.
- **The `.mcp.json` is generated to match `browsers × viewports`** by `qa-preflight` (Check 1.5). The committed default is chromium × 4 viewports (4 servers). When you add firefox/webkit (or change viewports), preflight regenerates `.mcp.json` and asks you to restart — so the pool always equals your selection (no idle servers).
- **A requested (engine × viewport) with no connected server is SURFACED, never silent:** LOG `⚠ {engine}×{vp} requested but its MCP browser isn't connected — run "npx playwright install {engine}" and restart.` and mark those cells `degraded` in the coverage ledger (Step 5.9).
- **Fallback:** if only `playwright` connected (no restart yet), audit chromium cells by resizing that one browser per viewport (serial across viewports) and degrade the rest. Correctness preserved.

**Branching rule (this is THE wire-up of the workers setting):**

| workers value | Path taken |
|---|---|
| `1` | Step 5.1a — SERIAL loop (legacy path, same as pre-MCP behavior with workers=1) |
| `>= 2` | Step 5.1b — PARALLEL dispatch via qa-cell-worker subagents |

### Step 5.1a — Serial execution (workers=1 only)

Run the per-cell loop in this orchestrator's own thread. This is the documented `For each cell` flow below (steps a → h.3 → i → j → k).

### Step 5.1b — Parallel execution (workers >= 2, DEFAULT for MCP mode)

**Sharding — assign each worker the cells for ITS (engine × viewport):**

```
// workerList was built in the server-pool block above (one per connected engine×viewport).
for each w in workerList:
  w.cells = audit-plan.cells.filter(c => c.browser === w.engine && c.viewportClass === w.viewportClass)
// Each worker = all routes at one (engine, viewport). A firefox-mobile cell only ever runs in
// the firefox browser sized to mobile. Browser AND viewport dimensions are both truthful.
// Example: 3 engines × 4 viewports, 16 routes → 12 workers × ~16 cells each.
```

**Parallel dispatch — one Agent call per worker, in ONE message:**

The orchestrator emits exactly `workerList.length` Agent calls in a SINGLE assistant message. Each Agent gets its own conversation context AND its own engine-pinned MCP server (= its own browser window of the correct engine).

```
// IN ONE MESSAGE — one Agent tool call per worker:
for (let i = 0; i < workerList.length; i++) {
  const { serverName, engine, viewportClass, viewport, cells } = workerList[i];
  Agent({
    subagent_type: "qa-cell-worker",
    description: `Worker ${i+1}/${workerList.length} ${engine}×${viewportClass} on ${serverName}: ${cells.length} cells`,
    prompt: `You are worker ${i} of ${workerList.length}, testing ${engine} at the ${viewportClass} viewport (${viewport.width}×${viewport.height}).
FIRST call mcp__${serverName}__browser_resize(${viewport.width}, ${viewport.height}) — your browser stays this size for all your cells.

🚨 YOUR DEDICATED MCP SERVER: "${serverName}"
Every browser tool you call MUST be prefixed mcp__${serverName}__ — e.g.
  mcp__${serverName}__browser_navigate, mcp__${serverName}__browser_evaluate,
  mcp__${serverName}__browser_take_screenshot, mcp__${serverName}__browser_click.
This is YOUR OWN browser window. NEVER call another server's tools. NEVER call the bare
'playwright' tools unless "${serverName}" === "playwright". Do NOT open extra tabs — use your browser's default page.

Your browser is ISOLATED (no shared cookies), so you MUST log in yourself before auditing.

Your assigned cells (all ${engine}, process sequentially in your own browser):
${JSON.stringify(cells)}

Run context:
  runId:          "${runId}"
  baseUrl:        "${resolvedConfig.baseUrl}"
  email:          "${email}"        password: (provided securely; mask in all output)
  resolvedConfig: <full config including resilience, content, viewports, browsers>

Follow qa-cell-worker/SKILL.md exactly:
  1. Log in on YOUR server: mcp__${serverName}__browser_navigate(loginPath) → fill email+password → submit → wait.
  2. For each cell: navigate, run the cell's applicableSkills (from the coverage ledger), screenshot to the ABSOLUTE .tmp/{runId}/screenshots/{cell.id}-base.png path, write findings JSONL + ledger marks, annotate.
  3. Return summary { workerIndex, serverName, cellsProcessed, cellsSkipped, cellsTimedOut, findingsTotal }`
  })
}
```

**After all Agent calls return:**

The harness blocks the orchestrator until ALL parallel Agent calls finish. Each returned summary is logged:

```
✅ Parallel execution complete:
   worker 0: 36/36 cells, 412 findings, 0 timeouts
   worker 1: 36/36 cells, 388 findings, 1 timeout (cell-052)
   worker 2: 36/36 cells, 401 findings, 0 timeouts
   worker 3: 36/36 cells, 394 findings, 0 timeouts
   Total:    144/144 cells, 1595 findings, 1 timeout
   Wall time: 24m 18s (vs ~1h 41m sequential — 4.1× speedup)
```

Each worker has already written its findings to `.tmp/{runId}/issues/cell-XXX.jsonl` — no merge step needed (the issues directory is the shared sink).

Proceed to Step 5.7.5 (annotation sweep) as normal.

**Failure isolation:**
- If a worker crashes mid-chunk, its already-written cells are preserved.
- Other workers continue unaffected.
- The Step 5.7.5 annotation sweep + Step 7 validation gate handle any partially-annotated cells.
- Use `--resume {runId}` to re-run just the missing cells.

**Limitations (honest disclosure):**
- Playwright MCP runs ONE browser process. Parallel TABS within that process give ~2-4× speedup via I/O overlap.
- For full Nx speedup (matching pre-MCP Bash mode), run N MCP server instances. qa-preflight can be extended to set this up.
- Even with tab-based parallelism, you'll see significant wall-clock improvement — 144-cell audit drops from ~100 min to ~25-30 min at workers=4.

### Step 5.1a — Serial `for each cell` (the legacy path, used when workers=1)

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
  d. 🚨 **ORCHESTRATOR CONTRACT — MANDATORY skill list, NO INTERPRETATION ALLOWED.**

       Build `enabledForCell` by SET OPERATION only — no LLM judgment, no prediction, no "this skill probably doesn't apply":
       ```
       enabledForCell = ALL_ENABLED_SKILLS.filter(s =>
         (s.applyOn === 'all' || s.applyOn.includes(cell.viewportClass))
         &&
         (s.viewportSensitive === true || isViewportLeaderFor(s, cell))
       )
       ```

       That is the ENTIRE filter. There is no other rule. You may NOT skip a skill because:
       - "the page doesn't look like it has forms" → run qa-form-* anyway; the probe self-skips
       - "this skill is for a different framework" → run it anyway; the probe self-skips
       - "Sonnet thinks this is redundant with another skill" → run both; dedup handles overlap
       - "the cell is broken" → run them all; broken cells emit cellTimeout, not silent skips

       Self-skip happens INSIDE the probe (`return []` on first line if preconditions fail), NEVER at this step.

       Then group:
       - haikuBatch = enabledForCell.filter(s => modelFor(s) === 'haiku' && s.kind === 'probe')
       - sonnetSkills = enabledForCell.filter(s => modelFor(s) === 'sonnet')
       - interactiveSkills = enabledForCell.filter(s => s.kind === 'interactive')

       LOG (mandatory):
       ```
       [cell {id}] enabled={enabledForCell.length}: haiku={haikuBatch.length}, sonnet={sonnetSkills.length}, interactive={interactiveSkills.length}
       [cell {id}] haiku batch will run: {haikuBatch.map(s => s.name).join(', ')}
       ```

       If the log shows fewer than ~30 Haiku skills on a typical cell with 56 enabled in customize.toml, the orchestrator has BYPASSED the contract — abort the run with the error in (e) below.

  e. Haiku tier — MUST batch EVERY skill in `haikuBatch`. No selection, no subset, no "optimization".

       Build the batched browser_evaluate by INCLUDING EVERY probe from `haikuBatch`:
       ```js
       browser_evaluate({
         function: `(probes, cellCtx) => {
           const results = {};
           for (const {name, probe} of probes) {
             try {
               results[name] = (new Function('return ' + probe))()(cellCtx);
             } catch (e) {
               results[name] = { error: e.message };
             }
           }
           return results;
         }`,
         args: { probes: haikuBatch, cellCtx: { route, viewport, properNouns } }
       })
       ```

       🚨 **CONTRACT ASSERTION (mandatory, no exceptions):**

       Before the call, log:
       ```
       [cell {id}] Running {haikuBatch.length} Haiku probes
       ```

       After the call:
       ```
       expectedCount = haikuBatch.length
       actualCount   = Object.keys(result).length
       missingSkills = haikuBatch.map(s => s.name).filter(n => !(n in result))
       if (actualCount !== expectedCount || missingSkills.length > 0) {
         throw new Error(
           `ORCHESTRATOR CONTRACT VIOLATED: expected ${expectedCount} probes in batched call, got ${actualCount}. ` +
           `Missing: ${missingSkills.join(', ')}. ` +
           `This is an orchestrator bug — the assistant did not include every enabled probe in the browser_evaluate call. ` +
           `Audit ABORTED to prevent silent coverage loss.`
         )
       }
       ```

       The assertion above is the SAFETY NET that catches the historical bug where the orchestrator would pick 9 of 67 skills and silently drop the other 58. If you see this error fire, the orchestrator (you) shortcut the skill list. Re-include every skill from `haikuBatch` and re-run.

       Skills whose probe returns `[]` are NORMAL — they self-skipped at runtime, which is the correct behavior. They still appear in `result` with an empty array. They count toward `actualCount`. Only skills MISSING ENTIRELY from `result` trigger the violation.
  f. Sonnet tier:
       For each Sonnet-classified skill, dispatch its probe/sequence on
       Sonnet (using Agent tool with subagent_type=qa-{skill-name}, 
       model=sonnet). The subagent receives skill SKILL.md + cell context
       and returns findings.
  g. Interactive skills (form-validation, data-controls, navigation, widgets, states, etc.) — **ACTIVE PHASES ARE MANDATORY, not optional.**

       🚨 These skills are the ONLY source of the production-grade findings (form validation, filter/sort/pagination, tab switching, empty/error states). They are NOT passive probes — they require a SEQUENCE of MCP tool calls. You MUST NOT fold them into the Haiku `browser_evaluate` batch (step e) and call it done — that runs only their passive phase and silently drops every active test (the historical "only cosmetic findings, no form/pagination bugs" failure).

       For EACH interactive skill in `interactiveSkills`:
       1. Check the skill's **Self-skip** preconditions via a quick `browser_evaluate`. If preconditions are absent (e.g. no `<form>`, no table/search/pager) → ledger mark `skipped` with the concrete reason. This is the ONLY valid skip.
       2. If preconditions ARE present → you MUST drive the skill's "Orchestrator flow" / "Tests" section as a real sequence: `browser_type` / `browser_click` / `browser_wait_for` between `browser_evaluate` reads. Default model = Haiku (the asserts are deterministic comparisons). When a check returns `uncertain: true`, escalate THAT check to `escalation_model` (Sonnet) per Step 5.5 — do NOT route the whole skill to Sonnet.
       3. Emit the skill's findings AND a ledger mark carrying interaction evidence:
          `{ ..., "status":"done|clean", "interacted": true, "evidence": "<before/after counts or text, e.g. rowsBefore=12 rowsAfter=12>" }`

       **Forbidden:** marking an interactive skill `clean` (or `skipped`) on a page that DOES contain its target control without `interacted: true` + evidence. That is a passive-only run masquerading as a pass — Step 5.9 will flag it (see below).
  h. **Evidence capture — DETERMINISTIC, no code generation allowed.**

       🚨 **PRODUCTION RULE:** Do NOT compose chromium calls from the orchestrator. Do NOT write a per-cell .cjs that does annotation. The annotation pipeline is **MCP-driven** — two permanent Node scripts handle HTML generation + JSONL update, MCP renders. Zero local Playwright dependency, works on every plugin install.

       The orchestrator's job at step (h) is only TWO operations:

       (1) Take the cell's base screenshot via MCP — exactly ONE per cell. **MUST use `fullPage: true`** so the entire document is captured. Probes return bboxes in document coordinates; viewport-only screenshots cause every bbox below the fold to be drawn outside the image (the historical "annotation in the wrong place" bug from run-006 cell-007):
           ```
           browser_take_screenshot(
             filename = "<ABSOLUTE-project-root>/.tmp/{runId}/screenshots/{cell.id}-base.png",
             fullPage = true
           )
           ```
           🚨 **MUST pass the FULL ABSOLUTE path** ending in `/.tmp/{runId}/screenshots/{cell.id}-base.png` (resolve `{project-root}` to its absolute form first). A plain name like `billing-desktop.png` makes Playwright MCP save into its OWN default `.playwright-mcp/` directory, where `annotate-cell-prepare.cjs` will NOT find it — it reads exactly `{project-root}/.tmp/{runId}/screenshots/{cell.id}-base.png` and exits "base missing", producing ZERO annotated screenshots. This was the confirmed root cause of the run-audit1 "no annotations on tickets" bug. Step 5.9 also flags any cell missing this exact file.

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

       (h.3) After JSONL is written for the cell, run the MCP-driven annotation pipeline — three sub-steps:

           **(h.3.a) Build HTML (pure Node, no MCP):**
           ```
           node "{project-root}/scripts/annotate-cell-prepare.cjs" "{runId}" "{cell.id}"
           ```
           Exit 0 → prints `{"htmlPath":"…","fileUrl":"file:///…","expectedAnnotatedPath":"…","findingCount":N}` on stdout. Parse it.
           Exit 5 → cell had no findings; skip remaining (h.3) steps.
           Exit 2/3/4 → base PNG missing / JSONL missing / schema fail; log and skip.

           **(h.3.b) Render via MCP (zero local chromium):**
           ```
           browser_navigate(url = <fileUrl>, waitUntil = "load", timeout = 10000)
           browser_take_screenshot(path = <expectedAnnotatedPath>, fullPage = true)
           ```

           **(h.3.c) Update JSONL (pure Node):**
           ```
           node "{project-root}/scripts/annotate-cell-finalize.cjs" "{runId}" "{cell.id}"
           ```
           Reads the annotated PNG, writes `annotatedScreenshotPath` into every finding atomically. Idempotent.

           If any sub-step exits non-zero, the run is degraded — log the error and continue. Step 5.7.5 sweep will retry the cell at the end. `file-bugs.cjs` falls back to the base screenshot if no annotated PNG exists.

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

       **CROSS-SKILL DEDUPLICATION (v2.4.0, added 2026-06-03) — MUST RUN BEFORE THE APPEND BELOW.**

       Before writing the cell's findings to JSONL, run cross-skill deduplication in-orchestrator (no MCP call, no LLM call — pure logic, cost $0).

       **Why this exists:** the agent has 66 skills. Many emit findings on the same DOM element from different angles. Without dedup, one broken button generates 4 ADO tickets and devs lose trust. This step collapses duplicates into a single finding annotated with which skills also caught it. Typical impact: -40 to -60% ticket count with zero coverage loss.

       **Skip rule:** if `customize.toml -> [dedup].enabled = false`, skip this step entirely. Default is `true`.

       **Algorithm:**

       (1) For each finding emitted in this cell, compute a signature:
       ```
       signature = normalizeSelector(finding.selector)
                 + '|' + issueFamily(finding.issueType)
                 + '|' + roundBbox(finding.bbox, gridPx = dedup.bbox_grid_px)
       ```

       (2) Group all findings into buckets by signature.

       (3) For each bucket containing > 1 finding:
            - Sort by (severity desc — critical > high > medium > low > info; then confidence desc; then selector specificity desc)
            - winner = bucket[0]
            - winner.alsoDetectedBy = unique skills of bucket[1..n], excluding winner.skill
            - winner.alsoIssueTypes = unique issueTypes of bucket[1..n], excluding winner.issueType
            - winner.description = winner.description + ' (also detected by: ' + alsoDetectedBy.join(', ') + ')'
            - winner.dedupCount = bucket.length
            - Drop bucket[1..n] from the emission list

       (4) Buckets with exactly 1 finding pass through unchanged with `dedupCount = 1`, `alsoDetectedBy = []`.

       **normalizeSelector(selector)** — strip generated class hashes so CSS-in-JS frameworks don't break dedup:
       ```
       Input                              Output
       "button.css-1lkthfn"             -> "button.css"
       "button.MuiButton-root-12"        -> "button.MuiButton-root"
       ".btn-7f3a2x4"                    -> ".btn"
       "div#user-2358ac > p.text"        -> "div#user > p.text"
       ".css-abc123def"                  -> ".css"
       "#main"                           -> "#main"  (IDs untouched — stable)
       ```
       Pattern: strip trailing `-[a-z0-9]{6,}` or `_[a-z0-9]{6,}` from each class-name segment. IDs (`#xxx`) and tag names are untouched.

       **issueFamily(issueType)** — consult `customize.toml -> [dedup.families]` (extends built-in defaults). Each issueType maps to ONE family. Two findings with the same family + selector + bbox region are duplicates.

       Built-in family map:
       ```
       touch_target:    [touchTargetTooSmall, inputHeightTooSmall, criticalElementHidden]
       labeling:        [fieldWithoutLabel, buttonUnnamed, requiredNotIndicated,
                          ariaLabelMissing, missingAlt, imageMissingAlt]
       validation:      [noValidationOnEmptySubmit, submitNotDisabledWhenInvalid,
                          noRealtimeValidation, whitespaceAccepted, noEmailValidation]
       overflow:        [horizontalOverflow, fixedElementOverflow, tableOverflow,
                          contentTooNarrow, rtlPageOverflow, rtlElementOverflow]
       hierarchy:       [noH1, multipleH1, headingHierarchyBroken, focusOrderMismatch]
       contrast:        [colorContrastIssue, darkModeContrastFail, textContrastInsufficient,
                          forcedColorsBreaksLayout]
       loading:         [stuckSpinner, blankPage, skeletonStuckAfterLoad,
                          loadingSpinnerOverlapsContent, loadingIndicatorMissing]
       security:        [csrfTokenMissing, autocompleteOffAntiPattern, captchaMissingOnSignup]
       images:          [missingAlt, brokenImage, imageStretched, imageOversizedForViewport]
       typography:      [smallFont, tightLineHeight, oversizedHeading, longWordNoBreak]
       motion:          [motionIgnoresReducedPref, parallaxOnReducedMotion]
       breakpoint:      [breakpointEdgeBreaks, breakpointTransitionShift, breakpointMissingMatch]
       ```
       Unmapped issueTypes use the issueType itself as the family (so they only dedup against exact same issueType + selector).

       **roundBbox(bbox, gridPx)** — round element coordinates to a grid so 'same region' overlaps merge:
       ```
       roundBbox({x:103, y:251, w:80, h:32}, 10) -> "100,250,80,30"
       roundBbox(null, 10)                       -> "null"
       ```
       Two findings with same selector but different bbox regions (page-level vs element-level) remain distinct.

       **Cross-family merge at same element:**
       When `[dedup].cross_family_at_same_element = true` (default), findings on the EXACT same selector + bbox region merge regardless of family. The winner is picked by severity. This is what catches the "one broken button, 4 different tickets" case.

       **Example — before and after dedup:**

       Before (step i emitted 4 findings on the login button):
       ```
       {skill:"qa-detect-touch",      issueType:"touchTargetTooSmall",        severity:"medium", selector:"button.btn-7f3a2x4"}
       {skill:"qa-form-a11y",         issueType:"fieldWithoutLabel",          severity:"high",   selector:"button.btn-7f3a2x4"}
       {skill:"qa-detect-a11y",       issueType:"buttonUnnamed",              severity:"high",   selector:"button.btn-7f3a2x4"}
       {skill:"qa-form-validation",   issueType:"submitNotDisabledWhenInvalid", severity:"medium", selector:"button.btn-7f3a2x4"}
       ```

       After dedup (all 4 share normalizeSelector("button.btn-7f3a2x4") = "button.btn" + same bbox region):
       ```
       {skill:"qa-form-a11y", issueType:"fieldWithoutLabel", severity:"high",
        selector:"button.btn-7f3a2x4",
        description:"Button has no accessible label (also detected by: qa-detect-a11y, qa-detect-touch, qa-form-validation)",
        alsoDetectedBy:["qa-detect-a11y", "qa-detect-touch", "qa-form-validation"],
        alsoIssueTypes:["buttonUnnamed", "touchTargetTooSmall", "submitNotDisabledWhenInvalid"],
        dedupCount:4}
       ```

       4 ADO tickets become 1, with full attribution preserved.

       **Hard rules:**

       1. Dedup is cell-scoped. Findings from different cells are NEVER merged here — that's a separate concern in qa-bug-filer.
       2. Information is PRESERVED, not destroyed. `alsoDetectedBy` and `alsoIssueTypes` keep every contribution visible.
       3. Winner is ALWAYS the highest-severity finding in the bucket. No promotion of low above high.
       4. Singletons (buckets of size 1) pass through unchanged with `dedupCount = 1`, `alsoDetectedBy = []`.
       5. Screenshot + annotation in step (h) uses the WINNER's selector and bbox only. No extra screenshots for dropped findings.
       6. Track `dedupCount` per cell — emit in run-summary.json so the coverage report can show "X tickets reduced to Y after dedup".

       **AFTER dedup completes, proceed to the append below with the deduped finding set.**

       **(j.1) COVERAGE MARKS — MANDATORY, before moving to the next cell.** For EVERY skill in this cell's `applicableSkills` (from the Step 5.0.A ledger), update that skill's ledger line in `{project-root}/.tmp/{runId}/coverage-ledger.jsonl`, changing `status` from `expected` to exactly one of:
       - `done`    — the skill ran and emitted ≥1 finding (the finding is also in `issues/{cell.id}.jsonl`)
       - `clean`   — the skill ran and found nothing
       - `skipped` — preconditions absent (e.g. no forms on the page); set `reason` to a one-line cause
       - `error`   — probe threw / cell timed out; set `reason`

       Rules: (1) NO skill in `applicableSkills` may be left `expected` — a skill that produced none of the four states is a silent skip and is forbidden. (2) These marks go ONLY in `coverage-ledger.jsonl`, NEVER in `issues/*.jsonl` (so `file-bugs.cjs` / `argus-schema.cjs` never see them and stay untouched). (3) Pin the set: run EVERY skill in `applicableSkills`, never a model-chosen subset.

       Append findings to {project-root}/.tmp/{runId}/issues/{cell.id}.jsonl
       � one JSON object per line, schema:
       {runId, cellId, skill, issueType, severity, route, viewport,
        viewportClass, browser, selector, description, bbox, screenshotPath, annotatedScreenshotPath,
        dedupCount, alsoDetectedBy[], alsoIssueTypes[]}
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

#### 5.7.5 — Annotation Sweep (MANDATORY, code-enforced)

After Step 5.7 closes for the LAST cell, run the annotation sweep BEFORE Step 5.8. This is the guarantee that every cell with findings ends up with annotated screenshots — even if Step 5.4(h.3)'s inline call was skipped, retried, or interrupted by a cellTimeout.

🚨 **DO NOT SKIP THIS STEP.** Annotation is a plugin promise — end users install this plugin expecting annotated screenshots in their ADO tickets. The inline call in Step 5.4(h.3) is best-effort; this sweep is the contract.

**Algorithm — MCP-driven, three sub-steps per cell.** For every `cell-*.jsonl` file in `{project-root}/.tmp/{runId}/issues/`:

```
list = glob "{project-root}/.tmp/{runId}/issues/cell-*.jsonl"

for cellId in list:
  # 1a. Build HTML (pure Node)
  result = Bash("node scripts/annotate-cell-prepare.cjs {runId} {cellId}")
  if result.exitCode == 5: continue       # cell has no findings
  if result.exitCode != 0:  log + continue
  paths = JSON.parse(result.stdout)

  # 1b. Render via MCP (no local chromium)
  browser_navigate({ url: paths.fileUrl, waitUntil: "load" })
  browser_take_screenshot({ path: paths.expectedAnnotatedPath, fullPage: true })

  # 1c. Update JSONL (pure Node)
  result = Bash("node scripts/annotate-cell-finalize.cjs {runId} {cellId}")
  if result.exitCode != 0: log + continue
```

Behavior:
- **Idempotent:** re-running on a cell whose findings already have `annotatedScreenshotPath` is a no-op. Both prepare + finalize handle the case gracefully.
- prepare exits: 0 = HTML written; 2 = base PNG missing; 3 = JSONL missing; 4 = schema fail; 5 = no findings (skip).
- finalize exits: 0 = updated (or no-op); 2 = annotated PNG missing (MCP screenshot failed); 3 = JSONL missing; 4 = schema fail.
- **Do not abort the sweep on a single cell failure.** Log the cellId + exit code and continue. The Step 7 validation gate surfaces any cell that still lacks annotations.

Log per cell:
```
[annotate {n}/{total}] cell-{id} — {newAnnotations}/{findingsCount} screenshots
```

Log at end of sweep:
```
✅ Annotation sweep complete
   Cells processed : {n}
   Newly annotated : {newCount}
   Already done    : {skippedCount}
   Failed          : {failedCount}  ({failedCellIds})
```

If `failedCount > 0`, the run is degraded but not aborted. Step 7's validation gate handles the consequence.

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
  "degradedCells": ["cell-003", "cell-007"],
  "expectedPairs": N,
  "accountedPairs": N,
  "coveragePct": N,
  "degradedPairs": [{"cellId": "cell-012", "skill": "qa-detect-touch", "reason": "mobile 504 — no DOM"}]
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

#### 5.9 — Coverage finish-gate (MANDATORY — the run may NOT complete until this passes)

🚨 This is the gate that makes "nothing silently skipped" real. Run it after Step 5.8 and BEFORE Step 6. It cannot be skipped by reasoning — "I think coverage is fine" is not allowed; the ledger is the proof.

1. Read `{project-root}/.tmp/{runId}/coverage-ledger.jsonl`.
2. Find every line still `status:"expected"` → these are SILENT SKIPS: a (cell × skill) pair that was planned but never ran (this is exactly what dropped tablet + ~48 skills in run-audit1).
2b. **Interactive-skill evidence check** (restores form/pagination/filter/tab findings). For every interactive skill (`qa-form-validation`, `qa-test-data-controls`, `qa-test-navigation`, `qa-test-widgets`, `qa-test-states`, `qa-form-flow`) marked `clean` or `skipped`: a `skipped` mark MUST carry a precondition-absent reason (no form / no table / no tabs). A `clean` mark on a cell whose page DOES contain the skill's target control REQUIRES `interacted: true` + `evidence`. An interactive `clean`/`skipped` mark WITHOUT evidence on a control-bearing page = a PASSIVE-ONLY run (the active tests never fired) → treat it exactly like an `expected` line: re-dispatch that skill on that cell to drive its active phases (step 5.4g), bounded by `coverage_max_retries`. Log: `🧪 Interactive evidence: {ok} verified, {reRun} re-run for passive-only, {n} skills`.
3. For every cell that has any non-`expected` line, confirm `{project-root}/.tmp/{runId}/screenshots/{cell.id}-base.png` exists. A missing base PNG = that cell needs a re-run (its screenshot landed in the wrong place — see Step 5.4h).
4. If any `expected` lines OR missing base screenshots remain:
   - **retries so far < `customize.toml [resilience] coverage_max_retries` (default 2)?**
     → re-dispatch ONLY the missing (cell × skill) pairs and missing-screenshot cells through the Step 5.4 loop (scoped to those, same as `--resume`), then GO BACK to sub-step 1.
   - **retries exhausted?**
     → set each still-unfinished line to `status:"degraded"` with a concrete `reason` (e.g. `"mobile route 504 — no DOM"`, `"skill did not run after 2 retries"`). It is now SURFACED in the report, never silently dropped.
5. Log the gate result:
   ```
   🔍 Coverage finish-gate
      Expected pairs : {expected}
      Accounted      : {done+clean+skipped+error}  ({coveragePct}%)
      Re-running     : {rerunCount}
      Degraded       : {degradedCount}  → {cellId:skill — reason, ...}
   ```
6. **ANNOTATION ENFORCEMENT (part of THIS gate — annotated screenshots are a plugin promise, and the inline Step 5.4 h.3 is routinely skipped).** This is the ONLY place annotation is guaranteed. For every `issues/cell-*.jsonl` that has at least one real finding (ignore `_coverage` lines), run the 3-step pipeline NOW:
   ```
   for each cell-*.jsonl with findings:
     a. node "{project-root}/scripts/annotate-cell-prepare.cjs" "{runId}" "{cellId}"
        • exit 5 → no findings → skip cell
        • exit 2 → base PNG missing → re-take this cell's base screenshot first, then retry (a)
        • exit 0 → parse stdout JSON → { fileUrl, expectedAnnotatedPath }
     b. browser_navigate(url = fileUrl, waitUntil = "load")
        browser_take_screenshot(filename = "<same screenshots dir that holds {cellId}-base.png>/{cellId}-annotated.png", fullPage = true)
        ← MUST land next to the base PNG in .tmp/{runId}/screenshots/. Use the IDENTICAL path form you used for the base screenshot (that location is confirmed writable). A bare name lands in .playwright-mcp/ and finalize won't find it.
     c. node "{project-root}/scripts/annotate-cell-finalize.cjs" "{runId}" "{cellId}"
        • exit 0 → annotatedScreenshotPath written into every finding of the cell
        • exit 2 → annotated PNG not found → the screenshot in (b) landed in the wrong dir → redo (b) with the correct path
   ```
   Then RE-SCAN every finding: each must have a non-empty `annotatedScreenshotPath` whose file exists. Any finding still missing it after one retry → set `screenshotSkipReason` (e.g. `"annotated render failed"`) so file-bugs falls back to base KNOWINGLY, and log it. Emit:
   ```
   🖼️  Annotation gate
      Findings         : {findingsTotal}
      Annotated        : {annotatedCount}
      Fallback to base : {fallbackCount}  → {cellIds + reason}
   ```
   **Hard stop:** if `annotatedCount === 0` while `findingsTotal > 0`, the annotation pipeline was bypassed entirely (this run's exact failure) — re-run sub-step 6 from the top; do NOT proceed to bug filing with zero annotations.
7. The audit may proceed to Step 6/7 (vision + bug filing) ONLY when BOTH hold: (a) EVERY ledger line is terminal (`done`|`clean`|`skipped`|`error`|`degraded`) with no `expected` left, AND (b) the annotation gate ran and every finding has `annotatedScreenshotPath` OR an explicit logged `screenshotSkipReason`. A run with `expected` lines, or with findings that have neither an annotated path nor a skip reason, is INCOMPLETE: say so loudly and do NOT report success.

The final coverage report (Step 8) MUST list every `degraded` pair with its reason, and MUST state the real coverage (`accounted/expected`) — never present a partial run as complete (the run-audit1 report claimed "done" at ~1/60 cells; that is now forbidden).

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

**Annotation validation gate (run BEFORE invoking bug filer):**

Scan every `{project-root}/.tmp/{runId}/issues/cell-*.jsonl` line and check that each finding has a non-empty `annotatedScreenshotPath`. If any finding is missing it:

1. Re-run the annotation sweep from Step 5.7.5 for those specific cell IDs only.
2. Re-scan. If findings are still missing `annotatedScreenshotPath`:
   - If `screenshotPath` is present, the bug filer will attach the base PNG as fallback (degraded mode).
   - If `screenshotPath` is also missing, the cell had no screenshot at all — log a warning and let the bug filer file the bug text-only.
3. Log the gate result:

```
🔍 Annotation gate
   Findings total      : {n}
   Annotated           : {annotatedCount}
   Repaired by sweep   : {repairedCount}
   Degraded (base PNG) : {degradedCount}
   Missing all         : {missingCount}
```

This gate is **mandatory and code-enforced**. It cannot be skipped by orchestrator reasoning.

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


