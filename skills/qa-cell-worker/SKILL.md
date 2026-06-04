---
name: qa-cell-worker
description: "Parallel cell-execution subagent. Receives a chunk of audit cells, opens its own browser tab, runs them sequentially within the tab, writes findings to JSONL, returns. Spawned in parallel by qa-argus Step 5.1 when resolvedConfig.workers > 1. Honors the workers setting dynamically: workers=4 spawns 4 of these in parallel, workers=8 spawns 8."
model: sonnet
applyOn: all
needsSetup: true
viewportSensitive: true
interactive: true
ownership: "exclusive: when qa-argus dispatches a cell chunk in parallel, this skill owns the per-cell execution loop"
---

# qa-cell-worker — Parallel Cell-Execution Subagent

This is the **per-worker subagent** that qa-argus dispatches in parallel when `resolvedConfig.workers > 1`. Without it, Step 5 runs a serial `for each cell` loop and the `workers` setting has no effect.

## When this skill runs

Spawned by [qa-argus/SKILL.md Step 5.1](../qa-argus/SKILL.md) via the Agent tool. The parent orchestrator emits N parallel `Agent({ subagent_type: "qa-cell-worker", ... })` calls in ONE message, where N = `resolvedConfig.workers`.

Each spawned worker owns ONE (engine × viewport) and receives:
- `serverName` — its DEDICATED MCP server (e.g. `playwright`, `pw-firefox-mobile`, `pw-webkit-tablet`). All browser calls use `mcp__{serverName}__*`. The server's `--browser` flag fixes the engine — the worker never sets it.
- `engine` — `chromium` | `firefox` | `webkit`.
- `viewportClass` + `viewport` — the viewport this worker tests (`{width, height}`). The worker resizes its browser to this ONCE and keeps it for all cells.
- `chunkIndex` — which worker this is (0..activeWorkers-1)
- `cells[]` — every route at this (engine, viewport): `audit-plan.cells.filter(c => c.browser === engine && c.viewportClass === viewportClass)`. It never touches another (engine, viewport).
- `runId` — for writing findings to `.tmp/{runId}/issues/cell-XXX.jsonl`
- `resolvedConfig` — full audit config (browsers, viewports, enabled skills, content settings, resilience knobs)
- `baseUrl` — app under test

## Hard rules

| # | Rule | Why |
|---|---|---|
| 1 | **MUST use ONLY your assigned MCP server's tools** — every browser call prefixed `mcp__{serverName}__` (e.g. `mcp__pw-firefox-mobile__browser_navigate`). `{serverName}`, `{engine}`, `{viewport}` are given in your dispatch prompt. Your server = your own dedicated browser window of YOUR engine, sized to YOUR viewport. | True parallelism: each worker drives a SEPARATE browser process for one (engine × viewport) — zero contention, correct engine and size. |
| 2 | **MUST log in on your own browser first** (Step 1) — your server runs `--isolated` so it has NO shared cookies. Navigate to the login path, fill email+password (mask password), submit, confirm redirect BEFORE auditing any cell. | Isolated browsers don't inherit the orchestrator's session; each worker authenticates its own browser. |
| 3 | **MUST NOT open extra tabs or touch another server's tools.** Use your browser's default page. Never call the bare `playwright` tools unless that IS your assigned server. | You own a whole browser — tabs are unnecessary; touching a peer's server corrupts that worker's run. |
| 4 | **MUST write findings to `{project-root}/.tmp/{runId}/issues/cell-XXX.jsonl`** — same path the serial loop used. | The downstream Step 5.7.5 annotation sweep and Step 7 bug filer read from this path. |
| 5 | **MUST honor `resilience.cell_total_ms`** — if a cell exceeds the budget, append `cellTimeout` finding and continue to next cell in chunk. | Same protection the serial loop has. |
| 6 | **MUST NOT cross-contaminate cells from other workers.** Only touch cells in YOUR `cells[]` array. | Parent orchestrator already partitioned cells; workers must respect partitioning. |

## Execution flow

### Step 1 — Size your browser to your viewport, then log in

Use ONLY `mcp__{serverName}__` tools. FIRST fix your browser to your assigned viewport (it stays this size for ALL your cells), THEN log in (your browser is isolated — no shared cookies):

```
mcp__{serverName}__browser_resize(viewport.width, viewport.height)   // e.g. 390×844 for mobile
mcp__{serverName}__browser_navigate({ url: baseUrl + loginPath, waitUntil: "domcontentloaded" })
mcp__{serverName}__browser_type(email into the email/username field)
mcp__{serverName}__browser_type(password into the password field)   // mask password in all output
mcp__{serverName}__browser_click(submit)
mcp__{serverName}__browser_wait_for({ time: 5000 })                  // SPA redirect chain
mcp__{serverName}__browser_evaluate("return location.pathname")      // confirm not still on loginPath
LOG: "[worker {chunkIndex} on {serverName}] logged in, processing {cells.length} cells"
```

If login fails (still on loginPath after retry): return early with `{ cellsProcessed: 0, loginFailed: true, serverName }` so the orchestrator can surface it. Do NOT silently audit a logged-out app.

(If your assigned server is the single shared `playwright` and the orchestrator told you to share it, fall back to `browser_tabs({action:"new"})` for a tab — but with a dedicated `playwright-wN` server you own the whole browser and need no tabs.)

### Step 2 — Process each cell sequentially

For each `cell` in `cells[]` (all browser calls prefixed `mcp__{serverName}__`):

1. Run the SAME per-cell execution that `qa-argus` Step 5.4 documents:
   - `mcp__{serverName}__browser_navigate({ url: baseUrl + cell.route, waitUntil: "domcontentloaded", timeout: 15000 })`
   - `mcp__{serverName}__browser_wait_for({ time: resilience.post_navigate_settle_ms })`
   - Run EVERY skill in this cell's `applicableSkills` (from the Step 5.0.A coverage ledger) — never a model-chosen subset. Batched Haiku probes in a single `browser_evaluate`; Sonnet skills dispatched one by one (workers can spawn their own sub-subagents); interactive skills run their MCP-tool sequences.
   - `browser_take_screenshot({ filename: "<ABSOLUTE-project-root>/.tmp/{runId}/screenshots/{cell.id}-base.png", fullPage: true })` — MUST be the full absolute path, NOT a plain name (a plain name lands in `.playwright-mcp/` and breaks annotation; see qa-argus Step 5.4h).
   - Write findings to `.tmp/{runId}/issues/{cell.id}.jsonl` (streaming append).
   - **Coverage marks (MANDATORY):** for every skill in `applicableSkills`, update its line in `.tmp/{runId}/coverage-ledger.jsonl` to `done`/`clean`/`skipped(reason)`/`error(reason)` — qa-argus Step 5.4 j.1. No applicable skill may be left `expected`. These marks go ONLY in the ledger, never in `issues/*.jsonl`.
   - Annotation pipeline: `annotate-cell-prepare.cjs` → `browser_navigate` + `browser_take_screenshot` → `annotate-cell-finalize.cjs`
   - Cross-skill dedup (in-orchestrator, no MCP call)

3. Stream progress:
   ```
   [worker {chunkIndex}] cell {n}/{cells.length} {route} @ {viewport}/{browser} → {findingsCount} findings
   ```

4. Honor timeout: wrap the whole cell in a budget timer. If `cell_total_ms` exceeded:
   - Append `{ issueType: "cellTimeout", severity: "low", description: "Cell exceeded {N}ms budget" }` to JSONL
   - Skip to next cell

### Step 3 — Release browser

When all your cells are done (or on fatal error), optionally close your browser:
```
mcp__{serverName}__browser_close()
LOG: "[worker {chunkIndex} on {serverName}] done — {processedCount}/{cells.length} cells"
```
(Closing is optional — the MCP server reuses the browser next run. Closing frees RAM sooner when running 4 headed windows.)

### Step 4 — Return

Return a summary to the parent orchestrator:
```json
{
  "workerIndex": <chunkIndex>,
  "serverName":  "<your assigned MCP server>",
  "loginFailed": <bool>,
  "cellsProcessed": <number>,
  "cellsSkipped":   <number>,
  "cellsTimedOut":  <number>,
  "findingsTotal":  <number>
}
```

The parent orchestrator collects these N summaries when all parallel Agent calls return, prints an aggregate, then continues to Step 5.7.5 (annotation sweep) and Step 7 (bug filing).

## Limitations & honesty

- **True parallelism = one browser per (engine × viewport).** `.mcp.json` declares a server for each combination (`playwright` = chromium-desktop primary; `pw-{engine}-{viewport}` for the rest), each `@playwright/mcp --isolated --browser {engine}` (headed by default). `qa-preflight` regenerates `.mcp.json` to match your `browsers × viewports` selection: chromium → 4 windows, +webkit → 8, all three → 12. Each worker resizes its own browser to its viewport and audits all routes there, concurrently with the others.
- **If only the single `playwright` server is present** (user didn't update/restart), workers fall back to TABS in one shared browser — ~2-4× I/O-overlap speedup, not separate windows. The orchestrator detects this at Step 5.0 (`availableServers`) and caps `activeWorkers` accordingly.
- **Pool size caps the worker count.** `activeWorkers = min(workers, availableServers)`. To run more than 4 dedicated browsers, add more `playwright-wK` entries to `.mcp.json` and restart. Note: each headed browser uses real RAM/CPU — 4 is a sensible default; 8–12 headed windows is heavy.
- **Each browser is isolated** (`--isolated`), so every worker logs in independently (Step 1). No shared session.
- **Workers do NOT share findings.** Each worker writes to its own cell JSONL files; the parent merges by globbing the issues directory. There's no shared state.
- **Failures are isolated.** If worker 2 crashes, workers 0, 1, 3 keep running. Their findings are preserved.

## What this skill is NOT

- NOT a detection or test skill — does not emit issueTypes of its own.
- NOT viewport-pinned — handles all viewports its assigned cells require.
- NOT called outside qa-argus Step 5.1 — never invoke this manually.
