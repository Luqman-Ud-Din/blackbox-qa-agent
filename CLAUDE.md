# argus-qa-plugin  Workspace Manifest

## What this project is

**argus-qa-plugin**  a standalone Claude Code plugin that provides autonomous QA auditing skills. `{plugin-root}` = the directory containing this CLAUDE.md file.

Architecture (post 2026-06-01 refactor): skill-driven, Playwright-MCP-bridged, multi-model. Each skill ships its rules as a probe expression inside SKILL.md (consumed via `browser_evaluate`). The orchestrator dispatches each skill on the model declared in its frontmatter  Haiku by default, Sonnet for judgment-heavy skills (route discovery, auth flow, test cases, bug filer). No permanent Playwright runner.

## Workspace boundaries

| Directory | Status | Rule |
|-----------|--------|------|
| `{plugin-root}/` |  THIS plugin | All reads, writes, and subprocess calls must stay here |
| `{plugin-root}/.claude/` |  Config | `automation.config.json`, `qa-state.json`, `secrets.json` (gitignored) live here |
| `{plugin-root}/.tmp/` |  Run output | All audit output goes here  routes.json, audit-plan.json, issues/, screenshots/ |
| `{plugin-root}/skills/` |  Skills | **74 skills** — 8 pipeline + 35 detectors + 28 functional tests + 2 reviews + 1 vision review. Each has a `SKILL.md` (operating instructions + probe expressions). |
| `{plugin-root}/scripts/` |  Utilities | `ado-api.sh` (ADO REST helper), `annotate.js` (screenshot overlay), `md-to-doc.cjs` (markdown→Word doc converter). New scripts go here. |
| Any path outside `{plugin-root}/` | L OFF-LIMITS | Never access unless explicitly reading a user-provided file path |

## Prior run state lives HERE  nowhere else

- `{plugin-root}/.claude/qa-state.json`  saved user preferences, last run summary
- `{plugin-root}/.tmp/qa-<run-id>/audit-plan.json`  discovered routes  cells
- `{plugin-root}/.tmp/qa-<run-id>/issues/`  detected issues (`.jsonl` shards)
- `{project-root}/.tmp/qa-<run-id>/screenshots/`  screenshots

**Never look for prior state outside `{plugin-root}/.tmp/`.**

## Entry point

All QA interaction is handled by the `argus-qa:qa-argus` skill. Read `{plugin-root}/skills/qa-argus/SKILL.md` for the full orchestrator instructions.

**Trigger matching  on EVERY user message, check IN ORDER (first match wins):**

| Priority | Pattern | Action |
|----------|---------|--------|
| 1 | URL in message (`https://` or `http://`) | → `argus-qa:qa-argus` TASK PROMPT path |
| 2 | Single number `1`-`22` or letter `C` | → `argus-qa:qa-argus` NUMBERED OPTION path |
| 3 | **Action verb** (`audit`, `test`, `scan`, `check`, `inspect`, `run`, `discover`) + any of: app name from `automation.config.json → apps[].name`, route path, browser name, viewport name, OR referring to a known app | → `argus-qa:qa-argus` TASK PROMPT path. **MUST check BEFORE greeting** to prevent "hi argus audit X" from matching greeting rule |
| 4 | Greeting (`hi`, `hello`, `hey`, `howdy`, `hi argus`, etc.) with NO action verb (no audit/test/scan/etc) | Read `qa-state.json` → greeting flow → task menu |
| 5 | Anything else QA-related (mentions of "bug", "ticket", "issue", "ado", "playwright") | → `argus-qa:qa-argus` with menu |

**FORBIDDEN default responses when a trigger fires:**
- NEVER print "Ready to help with the QA agent plugin"
- NEVER print "Hi! What can I help you with today?"
- NEVER ask "What's the base URL?" before reading `automation.config.json` and `qa-state.json`
- NEVER ask "Which app?" if there's only one in `automation.config.json → apps[]`
- NEVER ask any settings question if the value exists in `automation.config.json`, `qa-state.json`, or `customize.toml`
- NEVER skip reading `qa-state.json`
- NEVER reply with a generic assistant greeting
