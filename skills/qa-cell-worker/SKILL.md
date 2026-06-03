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

Each spawned worker receives:
- `chunkIndex` — which chunk this worker owns (0, 1, 2, ..., workers-1)
- `cells[]` — the slice of audit-plan.cells assigned to this worker
- `runId` — for writing findings to `.tmp/{runId}/issues/cell-XXX.jsonl`
- `resolvedConfig` — full audit config (browsers, viewports, enabled skills, content settings, resilience knobs)
- `baseUrl` — app under test

## Hard rules

| # | Rule | Why |
|---|---|---|
| 1 | **MUST open its own browser tab** via `browser_tabs({ action: "new" })` AT START. Save the returned tab ID. | Without isolation, 4 workers all share the same tab and stomp on each other's navigation. |
| 2 | **MUST select its own tab** via `browser_tabs({ action: "select", tabId })` before EVERY `browser_navigate` / `browser_evaluate` / `browser_take_screenshot`. | Other workers may have switched the active tab between your operations. |
| 3 | **MUST close its tab** via `browser_tabs({ action: "close", tabId })` at the end (success OR failure). | Leaked tabs accumulate in the MCP browser across audit runs. |
| 4 | **MUST write findings to `{project-root}/.tmp/{runId}/issues/cell-XXX.jsonl`** — same path the serial loop used. | The downstream Step 5.7.5 annotation sweep and Step 7 bug filer read from this path. |
| 5 | **MUST honor `resilience.cell_total_ms`** — if a cell exceeds the budget, append `cellTimeout` finding and continue to next cell in chunk. | Same protection the serial loop has. |
| 6 | **MUST NOT cross-contaminate cells from other workers.** Only touch cells in YOUR `cells[]` array. | Parent orchestrator already partitioned cells; workers must respect partitioning. |

## Execution flow

### Step 1 — Acquire tab

```
result = browser_tabs({ action: "new" })
myTabId = result.tabId
LOG: "[worker {chunkIndex}] acquired tab {myTabId}, processing {cells.length} cells"
```

If `browser_tabs new` fails (MCP server doesn't support tabs OR max tabs reached): fall back to using the default tab. Log: `[worker {chunkIndex}] WARN: tab acquisition failed, sharing default tab (parallelism reduced)`.

### Step 2 — Process each cell sequentially

For each `cell` in `cells[]`:

1. Select your tab:
   ```
   browser_tabs({ action: "select", tabId: myTabId })
   ```

2. Run the SAME per-cell execution that `qa-argus` Step 5.4 documents:
   - `browser_navigate({ url: baseUrl + cell.route, waitUntil: "domcontentloaded", timeout: 15000 })`
   - `browser_wait_for({ time: resilience.post_navigate_settle_ms })`
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

### Step 3 — Release tab

Always run (even on errors):
```
browser_tabs({ action: "close", tabId: myTabId })
LOG: "[worker {chunkIndex}] done — {processedCount}/{cells.length} cells, released tab {myTabId}"
```

### Step 4 — Return

Return a summary to the parent orchestrator:
```json
{
  "workerIndex": <chunkIndex>,
  "cellsProcessed": <number>,
  "cellsSkipped":   <number>,
  "cellsTimedOut":  <number>,
  "findingsTotal":  <number>,
  "tabReleased":    <bool>
}
```

The parent orchestrator collects these N summaries when all parallel Agent calls return, prints an aggregate, then continues to Step 5.7.5 (annotation sweep) and Step 7 (bug filing).

## Limitations & honesty

- **True parallelism depends on the Playwright MCP server.** Microsoft's official Playwright MCP runs ONE browser process and serializes MCP RPCs internally. Workers running in parallel browser **tabs** within that process get ~2-4× speedup (mostly I/O overlap), not the full Nx Bash-mode delivered. To get full Nx speedup, run N separate MCP server instances (`claude mcp add playwright-w1 ...`, `claude mcp add playwright-w2 ...`, ...) and route each worker to a different server. The qa-preflight skill can be extended to do this on first run.
- **Workers do NOT share findings.** Each worker writes to its own cell JSONL files; the parent merges by globbing the issues directory. There's no shared state.
- **Failures are isolated.** If worker 2 crashes, workers 0, 1, 3 keep running. Their findings are preserved.

## What this skill is NOT

- NOT a detection or test skill — does not emit issueTypes of its own.
- NOT viewport-pinned — handles all viewports its assigned cells require.
- NOT called outside qa-argus Step 5.1 — never invoke this manually.
