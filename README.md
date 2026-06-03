# QA Argus

> Autonomous QA engineer for Claude Code. Crawls every route × viewport × browser of your app, detects defects, and files Azure DevOps bugs with screenshots — automatically.

## What it does

Runs a single command — `/argus-qa:qa-argus` — and gets you:

- **Responsive audit** across mobile / tablet / laptop / desktop viewports
- **Cross-browser testing** in Chromium, Firefox, and WebKit (in parallel)
- **74 specialized skills** — 35 DOM detectors, 28 functional tests, 2 content reviews, 1 AI vision review, 8 pipeline skills
- **DOM defect detection** — overflow, typography, touch targets, images, layout, forms, accessibility, RTL, dark mode, reduced motion, forced colors, mobile keyboard, safe-area, breakpoints, zoom 200%, and 20+ more
- **Form-specific testing** — 15 dedicated form skills covering boundaries, special chars, validation real-time, password rules, conditional logic, file upload, wizards, datetime, OTP, comboboxes, inline edit, tag input, input masks
- **Runtime defect detection** — JavaScript errors, unhandled rejections, failed HTTP requests, CORS errors, slow requests, stuck loading spinners
- **Content quality review** — spelling, grammar, word choice, lorem ipsum leaks, mojibake, untranslated keys (visible text + placeholders + alt + aria-label)
- **AI vision review** — Sonnet vision scans critical-route screenshots for visual bugs DOM probes cannot see (cropped UI, broken icons, modal positioning, color contrast)
- **Per-issue annotated screenshots** — each ADO ticket has a single red box around its specific defect
- **ADO bug filing with deduplication** — same defect across viewports = one ticket; regressions on closed bugs reopen them automatically
- **Resilience built-in** — per-cell timeouts, batched Sonnet dispatches, streaming writes to disk so no single hanging page kills the audit
- **Auto-install on first run** — Playwright MCP and node_modules install themselves if missing

Works on any frontend framework (Angular, React, Vue, Next.js, Nuxt, SvelteKit, Remix, Astro, plain HTML — anything Playwright can navigate to).

## Quick start

After installing the plugin, in your project root:

```
/argus-qa:qa-argus
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
| `/argus-qa:qa-argus` | Full audit — all apps, all routes, all viewports, all browsers |
| `/argus-qa:qa-argus --app <name>` | Audit one app only |
| `/argus-qa:qa-argus --route <path>` | Audit one specific route |
| `/argus-qa:qa-argus --device mobile` | Audit one viewport only |
| `/argus-qa:qa-argus --browser chromium` | Use only one browser |
| `/argus-qa:qa-argus --dry-run` | Detect issues but do not file ADO bugs |
| `/argus-qa:qa-argus --headless` | Run browsers invisibly (faster) |
| `/argus-qa:qa-argus --no-vision` | Skip the AI vision review |
| `/argus-qa:qa-argus --resume <runId>` | Resume an audit that crashed mid-run (skips completed cells) |
| `/argus-qa:qa-argus-setup` | Re-run the setup wizard |

## How it works

```
0. Step 0 auto-invokes qa-argus-setup if .claude/automation.config.json is missing
1. /argus-qa:qa-argus-setup wizard      → writes .claude/automation.config.json on first run
2. /argus-qa:qa-preflight               → URL health, auto-installs Playwright MCP if missing,
                                          auto-installs node_modules, verifies server, secrets
3. /argus-qa:qa-route-discovery         → crawls routes via Playwright MCP (Sonnet for SPA judgment)
4. /argus-qa:qa-phase-strategy          → orders routes into 3 phases (public → login → auth-gated)
5. Per-cell execution                   → orchestrator calls Playwright MCP per cell, dispatches each
                                          enabled skill on its declared model (Haiku for mechanical
                                          probes, Sonnet for judgment, vision review, content review)
6. /argus-qa:qa-vision-review           → AI vision pass on critical-route screenshots (Sonnet vision)
7. /argus-qa:qa-bug-filer               → deduplicates and files ADO bugs with screenshots (Sonnet)
8. /argus-qa:qa-coverage-report         → prints a summary
9. qa-state.json updated                → tracks chronic issues across runs
```

Each skill is self-contained. Browser operations happen through Playwright MCP tools (or inline-Bash fallback). No permanent Playwright runner script exists.

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

A template with placeholders ships at `templates/.claude/automation.config.template.json`. The setup wizard copies it to `.claude/automation.config.json` on first run.

## Customization

Agent-wide settings (workers, headed/headless, browser list, model routing, vision scoping, grammar scoping, resilience timeouts) all live in **`skills/qa-argus/customize.toml`**. Each detector and test skill optionally has a `config.json` you can edit to change thresholds, disable rules, or extend selectors.

## Prerequisites

Before installing, your machine needs Node.js, Playwright (with browser binaries), `jq`, and a few other tools. Your ADO account needs a Personal Access Token with the right scopes.

**See [INSTALL.md](INSTALL.md) for the full prerequisite checklist and setup walkthrough.**

## Architecture

| Layer | What it does | Default model |
|---|---|---|
| **Orchestrator** (`qa-argus`) | Loads config, sequences the pipeline, dispatches per-cell work, applies resilience gates (timeouts, batching, streaming writes) | Sonnet (session) |
| **Setup / preflight** (`qa-argus-setup`, `qa-argus-ready`, `qa-preflight`) | First-run wizard (auto-invoked) + URL health + auto-installs Playwright MCP and node_modules | Haiku |
| **Discovery** (`qa-route-discovery`, `qa-phase-strategy`) | Finds routes via MCP + orders them into phases | Sonnet (discovery), Haiku (strategy) |
| **Execution** | Orchestrator calls Playwright MCP per cell; runs each enabled skill's probe | Per-skill |
| **Detection** (`qa-detect-*` × 35) | Layout, typography, touch, images, forms, a11y, loading, console, network, RTL, dark mode, reduced-motion, forced-colors, mobile keyboard, safe-area, orientation, breakpoints, zoom-200, sticky scroll, modal viewport fit, hover-touch, word break, form-csrf, form-a11y, form-captcha, form-error-summary, dropdown-viewport-clip, overflow-controls, responsive-images, viewport-meta, form-validation, form-autocomplete | Haiku |
| **Functional tests** (`qa-test-*` × 28) | Navigation, mobile-nav, auth-flow, data-controls, widgets, states, history, idempotency, keyboard, dragdrop, i18n, theme, test-cases, plus 15 form skills (boundaries, special-chars, realtime, password-rules, conditional, file-upload, wizard, submit-state, datetime, formatted-inputs, OTP, combobox, inline-edit, tag-input, input-mask) | Haiku (Sonnet for auth-flow + test-cases) |
| **Content review** (`qa-review-content`, `qa-review-hidden-text` × 2) | Spelling, grammar, word choice, lorem ipsum, mojibake, untranslated keys in visible text and hidden text (placeholders, alt, title, aria-label) | Sonnet |
| **Vision review** (`qa-vision-review` × 1) | Multimodal screenshot review for cropped UI, broken icons, modal positioning, dropdown clipping, color contrast — visual bugs DOM probes cannot see | Sonnet vision |
| **Reporting** (`qa-bug-filer`, `qa-coverage-report`) | Files ADO bugs + writes summary | Sonnet (filer for prose), Haiku (report) |

All detectors and functional tests are framework-agnostic. They read the rendered DOM / page state via Playwright MCP, not source code.

## Prerequisites

In addition to Node.js, Playwright, and `jq`, install **Playwright MCP** (once per machine):

```
npm install -g @playwright/mcp@latest
```

Add it to your Claude Code MCP servers config so tools like `browser_navigate`, `browser_evaluate`, `browser_click` are available. If MCP isn't installed, the orchestrator falls back to inline Bash + Playwright snippets — slower but functional.

## License

MIT — see LICENSE for details.

## Contributing

Pull requests welcome. To add a new detector:

1. Create a folder under `skills/qa-detect-<your-name>/`
2. Add `SKILL.md` describing what it detects (instructions, not code)
3. Add `config.json` with `detectType`, `issueType` array, and rule thresholds
4. Add `detect.js` (or `setup.js`+`collect.js` for Playwright-type)
5. Register the detector in `skills/qa-argus/customize.toml` under `[detectors]`

The orchestrator picks up new detectors automatically. No core changes needed.






