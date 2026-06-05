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

### Step 1 — Size your browser to your viewport

```
mcp__{serverName}__browser_resize(viewport.width, viewport.height)   // e.g. 390×844 for mobile
```
Do NOT log in yet. Phase 1 cells must be captured in an unauthenticated state first.

### Step 2 — Load skill-probes.json FIRST, then process cells in phase order

**🚨 BEFORE the per-cell loop — read the probe bundle (MANDATORY, do this ONCE):**

```
probeBundle = JSON.parse(fs.readFileSync("{project-root}/.tmp/{runId}/skill-probes.json"))
allSkills   = probeBundle.skills
```

**Phase ordering is MANDATORY — process cells in this exact order:**

```
phase1Cells = cells.filter(c => c.phase === 1)  // public/unauthenticated pages — NO login
phase2Cells = cells.filter(c => c.phase === 2)  // login flow
phase3Cells = cells.filter(c => c.phase === 3)  // auth-gated pages
```

**Process phase1Cells FIRST (no session):** navigate each public page, run probes, write JSONL.
This captures the real unauthenticated state (signin form, forgot-password, 404/500 pages).
The browser has no cookies at this point — public pages render correctly.

**Then log in (between Phase 1 and Phase 2):**
```
mcp__{serverName}__browser_navigate({ url: baseUrl + loginPath, waitUntil: "domcontentloaded" })
mcp__{serverName}__browser_type(email into the email/username field)
mcp__{serverName}__browser_type(password into the password field)   // mask password in all output
mcp__{serverName}__browser_click(submit)
mcp__{serverName}__browser_wait_for({ time: 5000 })
mcp__{serverName}__browser_evaluate("return location.pathname")      // confirm not still on loginPath
LOG: "[worker {chunkIndex}] logged in"
```
If login fails: return early with `{ loginFailed: true }`.

**Then process phase2Cells and phase3Cells** with the active session.

### URL VERIFICATION — MANDATORY after every browser_navigate

After navigating to any cell's route, always verify the actual URL before running probes:

```
actualPath = mcp__{serverName}__browser_evaluate("return location.pathname")
if (actualPath !== cell.route) {
  // Navigation redirected — this cell's probes would run on the WRONG page.
  // Write a single info finding and SKIP all probes for this cell.
  write to JSONL: {
    issueType: "cellRedirected",
    severity:  "info",
    route:     cell.route,
    description: "Navigation to " + cell.route + " redirected to " + actualPath +
                 " — cell skipped to avoid probes running on the wrong page"
  }
  continue to next cell   // DO NOT run any probes
}
```

**Why this matters:** SPA apps like Angular redirect authenticated sessions away from the login page to the dashboard. Without this check, all probe findings get tagged with the INTENDED route (/authentication/signin) even though the browser is actually showing a completely different page (dashboard). This produces tickets that describe issues on the wrong page with wrong screenshots.

### Step 3 — Per-cell execution

**🚨 BEFORE the per-cell loop — read the probe bundle (MANDATORY, do this ONCE):**

```
probeBundle = JSON.parse(fs.readFileSync("{project-root}/.tmp/{runId}/skill-probes.json"))
allSkills   = probeBundle.skills   // ALL enabled skills, pre-extracted from their SKILL.md files
```

🚨 **FAIL CLOSED — if `skill-probes.json` does not exist or `allSkills.length` is 0, ABORT this worker immediately** (return `{ loginFailed: false, aborted: true, reason: "skill-probes.json missing" }`). Do **NOT** fall back to model memory and audit "the skills you know" — that is precisely the bug that produced 9-skill runs labelled as 92-skill coverage. The orchestrator will re-run `bundle-probes.cjs` and re-dispatch. There is no acceptable degraded path here: no bundle = no audit.

This file was written by `bundle-probes.cjs` before workers were dispatched. It contains EVERY enabled skill's probe expression and frontmatter. **Do NOT use model memory to decide which skills to run — use this file exclusively.** This is the fix for the bug where workers ran only ~12 skills from training memory instead of all the enabled skills.

For each `cell` in ordered phase batch (all browser calls prefixed `mcp__{serverName}__`):

1. **Filter skills for this cell** (pure set operation — no judgment):
   ```
   applicableSkills = allSkills.filter(s =>
     (s.applyOn === 'all' || s.applyOn.includes(cell.viewportClass))
   )
   passiveSkills     = applicableSkills.filter(s => s.probe && !s.interactive)
   interactiveSkills = applicableSkills.filter(s => s.interactive)
   ```

2. Navigate, then verify URL before running any probes:
   - `mcp__{serverName}__browser_navigate({ url: baseUrl + cell.route, waitUntil: "domcontentloaded", timeout: 15000 })`
   - `mcp__{serverName}__browser_wait_for({ time: 1500 })`
   - `actualPath = mcp__{serverName}__browser_evaluate("return location.pathname")`
   - **If `actualPath !== cell.route`: write `cellRedirected` info finding, SKIP all probes, continue to next cell.**
     This prevents findings from being tagged to the wrong route when an SPA redirects (e.g. authenticated session redirects `/authentication/signin` → `/admin/dashboard/main`).

3. **Run ALL passive probes in ONE batched browser_evaluate** — every skill in `passiveSkills`, no skipping:
   ```js
   probeResult = mcp__{serverName}__browser_evaluate({
     function: `(skills) => {
       const out = {};
       for (const s of skills) {
         try { out[s.name] = (new Function('return ' + s.probe))()(); }
         catch(e) { out[s.name] = { error: e.message }; }
       }
       return out;
     }`,
     arg: passiveSkills.map(s => ({ name: s.name, probe: s.probe }))   // ← the WHOLE array, every passive skill
   })
   ```
   Log: `[worker {chunkIndex}] cell {cell.id} — running {passiveSkills.length} passive probes`

   🚨 **`arg` MUST be `passiveSkills.map(...)` over the ENTIRE filtered array — never a hand-picked subset.** `passiveSkills` came from `skill-probes.json` (Step 2). You do NOT choose which skills are "relevant"; you pass ALL of them and let each probe self-skip (return `[]`) when its target isn't on the page. Passing fewer than `passiveSkills.length` entries is the exact bug that collapsed a 57-skill audit down to 9 — it is forbidden and the coverage gate (below) will catch it and force a re-run.

3b. **Dump the probe RECEIPT immediately (MANDATORY — this is the coverage evidence).** Write the FULL `probeResult` object — every skill key, including ones that returned `[]` or `{error}` — to `{project-root}/.tmp/{runId}/issues/{cell.id}-probes.json` (use the Write tool, NOT an `issues/*.jsonl` file):
   ```
   Write("{project-root}/.tmp/{runId}/issues/{cell.id}-probes.json", JSON.stringify(probeResult))
   ```
   This file is the ONLY proof that each passive skill actually executed on this cell. `scripts/coverage-gate.cjs` reads it: a skill whose key is present = ran (covered); a skill whose key is absent = never ran (silent skip → re-dispatched). If you skip this dump, the gate treats the entire cell as uncovered and re-runs it. You CANNOT fake coverage by editing the ledger — only a real receipt with the skill's key counts.

4. **Take base screenshot** (MUST be full absolute path):
   `mcp__{serverName}__browser_take_screenshot({ filename: "{ABSOLUTE-project-root}/.tmp/{runId}/screenshots/{cell.id}-base.png", fullPage: true })`

5. **Drive interactive skills** — for each skill in `interactiveSkills`, read its SKILL.md and execute its MCP-tool sequence. Drive EVERY skill in `interactiveSkills` — never a model-chosen subset. A skill whose target control isn't on the page records `skipReason` (e.g. "no form"), but it is still attempted and still recorded.

5b. **Dump the interactive RECEIPT (MANDATORY — coverage evidence for the 35 interactive skills).** Write `{project-root}/.tmp/{runId}/issues/{cell.id}-interactive.json` (Write tool) with ONE key per interactive skill in `applicableSkills` — including ones that self-skipped:
   ```
   { "qa-form-validation": {"ran":true,"interacted":true,"findings":3},
     "qa-test-data-controls": {"ran":true,"interacted":false,"findings":0,"skipReason":"no table/filter/search on page"},
     "qa-detect-reflow": {"ran":true,"interacted":true,"findings":1}, ... }
   ```
   `scripts/coverage-gate.cjs` reads this: an interactive skill whose key is present = ran (covered); absent = never driven → re-dispatched. Every interactive skill applicable to this cell MUST have a key here, just as every passive skill must have a key in `{cell.id}-probes.json`. Together the two receipts prove all 92 skills were executed on this cell.

6. Write findings to `{project-root}/.tmp/{runId}/issues/{cell.id}.jsonl` (one JSON object per line).

   **🚨 VERBATIM OUTPUT — NEVER FABRICATE (mandatory, no exceptions):**
   Each finding you write MUST be the EXACT object the probe returned. You are a transcriber, not an author. For every probe result object, copy these fields BYTE-FOR-BYTE from the probe's return value:
   - `issueType` — copy exactly. NEVER invent a new one. If the probe returned `horizontalOverflow`, write `horizontalOverflow` — not `elementOverflow`, not `elementExceedsViewport`. If the probe returned `smallTapTarget`, do NOT write `smallTouchTarget`. If it returned `buttonNoName`, do NOT write `unlabelledButton`. Renaming an issueType IS fabrication.
   - `description` — copy the probe's `description` string verbatim. NEVER paraphrase, summarize, embellish, or add facts the probe did not state. The probe says `Image failed to load: {url}` → write that exactly. Do NOT add "(404)", "not found", "naturalWidth=0", "in sidebar", or a page name — the probe never measured those, so asserting them is inventing evidence.
   - `selector` — copy exactly.
   - `bbox` — copy the probe's numeric bbox exactly. NEVER reuse a bbox from another cell, NEVER template a constant box, NEVER guess coordinates. If two cells show the identical bbox, you fabricated it.
   - `severity` — copy exactly.

   You add ONLY the envelope fields the probe cannot know: `runId`, `cellId`, `route` (= the VERIFIED actual path from step 2, not the intended route), `viewport`, `viewportClass`, `browser`, `screenshotPath`. Nothing else.

   If a probe returned `{ error: ... }` for a skill, that skill found nothing fileable on this cell — write NO finding for it. Do not turn an error into an issue. Do not write a finding for a skill that returned an empty array.

   A downstream gate in `file-bugs.cjs` rejects any finding whose `issueType` is not one the skill's probe can emit (loaded from `skill-probes.json → skills[].issueTypes`). Fabricated findings will be dropped and logged — so inventing them wastes the run and produces nothing. Emit only what the probe actually returned.

7. **Annotate immediately after writing JSONL:**
   `node "{project-root}/scripts/annotate-cell.cjs" "{runId}" "{cell.id}"`

8. Cross-skill dedup (in-worker, no MCP call).

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
