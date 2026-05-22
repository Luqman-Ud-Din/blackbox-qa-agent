# QA Sentinel

> Autonomous QA engineer for Claude Code. Crawls every route × viewport × browser of your app, detects defects, and files Azure DevOps bugs with screenshots — automatically.

## What it does

Runs a single command — `/argus-qa:argus` — and gets you:

- **Responsive audit** across mobile / tablet / laptop / desktop viewports
- **Cross-browser testing** in Chromium, Firefox, and WebKit (in parallel)
- **DOM defect detection** — overflow, typography, touch targets, images, layout, forms, accessibility
- **Runtime defect detection** — JavaScript errors, unhandled rejections, failed HTTP requests, CORS errors, slow requests, stuck loading spinners
- **Form validation testing** — submits forms with bad data and checks for proper error messages
- **Per-issue annotated screenshots** — each ADO ticket has a single red box around its specific defect
- **ADO bug filing with deduplication** — same defect across viewports = one ticket; regressions on closed bugs reopen them automatically

Works on any frontend framework (Angular, React, Vue, Next.js, Nuxt, SvelteKit, Remix, Astro, plain HTML — anything Playwright can navigate to).

## Quick start

After installing the plugin, in your project root:

```
/argus-qa:argus
```

On first run, a setup wizard asks for:
- Your Azure DevOps organization + project
- Your ADO Personal Access Token
- Your app's local URL + login route + test credentials

The wizard writes `.claude/automation.config.json` (non-sensitive config) and `.claude/secrets.json` (PAT + passwords, gitignored). Then the audit runs.

On every subsequent run, the agent just runs the audit using your saved config.

## Common commands

| Command | Purpose |
|---|---|
| `/argus-qa:argus` | Full audit — all apps, all routes, all viewports, all browsers |
| `/argus-qa:argus --app <name>` | Audit one app only |
| `/argus-qa:argus --route <path>` | Audit one specific route |
| `/argus-qa:argus --device mobile` | Audit one viewport only |
| `/argus-qa:argus --browser chromium` | Use only one browser |
| `/argus-qa:argus --dry-run` | Detect issues but do not file ADO bugs |
| `/argus-qa:argus --headless` | Run browsers invisibly (faster) |
| `/argus-qa:argus --no-vision` | Skip the optional AI vision review |
| `/argus-qa:qa-setup` | Re-run the setup wizard |

## How it works

```
1. /argus-qa:qa-setup wizard            → writes .claude/automation.config.json on first run
2. /argus-qa:qa-preflight               → verifies tools, server health, auth
3. /argus-qa:qa-route-discovery         → walks your source tree to find every route
4. /argus-qa:qa-phase-strategy          → orders routes into 3 phases (public → login → auth-gated)
5. /argus-qa:qa-spec-runner             → generates and runs a unified Playwright spec
6. /argus-qa:qa-vision-review (opt)     → AI vision pass on screenshots
7. /argus-qa:qa-bug-filer               → deduplicates and files ADO bugs with screenshots
8. /argus-qa:qa-coverage-report         → prints a summary
```

Each step is a separate skill you can read in `skills/`. The orchestrator runs them in order.

## What you'll see

```
🔍 QA Agent — Run qa-20260514-rp02

Phase 1 — Public routes        (4 cells)   ✓
Phase 2 — Login route          (1 cell)    ✓ session established
Phase 3 — Auth-gated routes    (7 cells)   ✓

Filed 11 bugs:
  ✓ Created:    11
  ↻ Reopened:    0
  ✏ Commented:   0
Screenshots:
  ✓ Annotated:  11 (per-issue, ideal)
  ⚠ Clean fb:    0
  ✗ Missing:     0
```

Each ADO bug gets:
- Title: `[QA] <issueType> on <route> — <selector>`
- HTML description with reproduction steps, viewport details, and the failing selector
- Annotated screenshot attached, with a red box around the exact element

## Configuration

Everything project-specific lives in `.claude/automation.config.json` in your own project (created by the wizard). The plugin itself ships only generic defaults.

The config file controls:
- ADO org + project + API version
- Repos and base branches
- Apps to audit (URL, login route, test credentials, source/assets paths)
- Viewports (default mobile / tablet / laptop / desktop)
- Cross-browser settings (which browsers to run)
- Headed vs headless mode
- Per-route priority overrides
- Detection rule thresholds
- Vision review settings

A template with placeholders ships at `skills/qa-setup/templates/automation.config.template.json`.

## Customization

Each detector skill has a `config.json` you can edit to change thresholds, disable rules, or extend selectors. Agent-wide settings (workers, headed/headless, browser list) live in `skills/argus/customize.toml` and `skills/qa-spec-runner/customize.toml`.

## Prerequisites

Before installing, your machine needs Node.js, Playwright (with browser binaries), `jq`, and a few other tools. Your ADO account needs a Personal Access Token with the right scopes.

**See [INSTALL.md](INSTALL.md) for the full prerequisite checklist and setup walkthrough.**

## Architecture

| Layer | What it does |
|---|---|
| **Orchestrator** (`argus`) | Loads config, sequences the 8 pipeline steps |
| **Setup / preflight** (`qa-setup`, `qa-preflight`) | First-run wizard + per-run health checks |
| **Discovery** (`qa-route-discovery`, `qa-phase-strategy`) | Finds routes and orders them into phases |
| **Execution** (`qa-spec-runner`) | Generates Playwright spec, runs against every cell |
| **Detection** (`qa-detect-*`) | 12 detectors run inside Playwright — DOM, Console, Network, Interactive |
| **Reporting** (`qa-bug-filer`, `qa-coverage-report`, `qa-vision-review`) | Files bugs + writes summary |

The 12 detectors are framework-agnostic. They read the rendered DOM, not source code.

## License

MIT — see LICENSE for details.

## Contributing

Pull requests welcome. To add a new detector:

1. Create a folder under `skills/qa-detect-<your-name>/`
2. Add `SKILL.md` describing what it detects (instructions, not code)
3. Add `config.json` with `detectType`, `issueType` array, and rule thresholds
4. Add `detect.js` (or `setup.js`+`collect.js` for Playwright-type)
5. Register the detector in `skills/argus/customize.toml` under `[detectors]`

The orchestrator picks up new detectors automatically. No core changes needed.






