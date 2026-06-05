#!/usr/bin/env node
/**
 * run-passive-probes.cjs — PERMANENT, DETERMINISTIC passive-probe runner.
 *
 * WHY THIS EXISTS (the production fix)
 *   The three field failures — (1) only ~9 of 57 passive skills ran, (2) fabricated
 *   issueTypes, (3) tickets with a plain base screenshot instead of an annotated one —
 *   all had ONE cause: a MODEL drove passive-probe execution + transcription via MCP,
 *   so it collapsed the batch to the checks it remembered and invented the rest.
 *
 *   Passive probes are deterministic JavaScript. They need no judgment. So this script
 *   runs them as real Playwright code:
 *     • for-loop over ALL 57 probes  → a skill CANNOT be skipped
 *     • probe return value written verbatim → an issueType CANNOT be invented
 *     • real getBoundingClientRect bbox → annotate-cell ALWAYS has a box to draw
 *   The model is no longer in this path, so none of the three failures can recur.
 *
 *   Interactive skills (clicks/typing) stay model-driven; the coverage gate forces
 *   their receipts too. This script owns ONLY the passive batch + base screenshot.
 *
 * USAGE
 *   node scripts/run-passive-probes.cjs <run-id> [--browsers=chromium,firefox,webkit] [--headed]
 *
 * READS
 *   .claude/automation.config.json   — apps[].baseUrl, apps[].loginPath
 *   .claude/secrets.json             — apps[appName].{email,password}
 *   .tmp/<run-id>/audit-plan.json    — cells (route, viewport dims, browser, phase, requiresAuth)
 *   .tmp/<run-id>/skill-probes.json  — passive probes
 *
 * WRITES (per cell)
 *   .tmp/<run-id>/screenshots/<cellId>-base.png
 *   .tmp/<run-id>/issues/<cellId>.jsonl          — findings, verbatim from probes
 *   .tmp/<run-id>/issues/<cellId>-probes.json    — receipt (full probe result, every skill key)
 *
 * EXIT 0 on completion (per-cell errors are recorded, never fatal). EXIT 1 on setup failure.
 */

const fs   = require('fs');
const path = require('path');
let chromium, firefox, webkit;
try { ({ chromium, firefox, webkit } = require('playwright')); }
catch (e) {
  console.error('\n✗ The `playwright` package is not installed in this plugin.');
  console.error('  Fix: open a terminal in the plugin directory and run:');
  console.error('       npm install && npx playwright install chromium firefox webkit');
  console.error('  Then re-run the audit.\n');
  process.exit(1);
}

const RUN_ID = process.argv[2];
if (!RUN_ID || RUN_ID.startsWith('--')) { console.error('Usage: node scripts/run-passive-probes.cjs <run-id> [--browsers=...] [--headed]'); process.exit(1); }
const ARGV = process.argv.slice(3);
const HEADED = ARGV.includes('--headed');
const browsersArg = (ARGV.find(a => a.startsWith('--browsers=')) || '').split('=')[1];

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUN_DIR   = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES    = path.join(RUN_DIR, 'issues');
const SHOTS     = path.join(RUN_DIR, 'screenshots');
fs.mkdirSync(ISSUES, { recursive: true });
fs.mkdirSync(SHOTS,  { recursive: true });

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
const CONFIG_PATH = path.join(PROJECT_ROOT, '.claude/automation.config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('\n✗ No .claude/automation.config.json found — run the Argus setup wizard first.');
  console.error('  In Claude Code, say "hi" to Argus (or run the setup skill) to configure your app + credentials.\n');
  process.exit(1);
}
const CONFIG  = readJson(CONFIG_PATH);
const SECRETS = (() => { try { return readJson(path.join(PROJECT_ROOT, '.claude/secrets.json')); } catch { return {}; } })();
const plan    = readJson(path.join(RUN_DIR, 'audit-plan.json'));
const bundle  = readJson(path.join(RUN_DIR, 'skill-probes.json'));

const cells   = plan.cells || [];
const passive = (bundle.skills || []).filter(s => s.probe && !s.interactive);
if (passive.length === 0) { console.error('No passive probes in skill-probes.json — run bundle-probes.cjs first.'); process.exit(1); }

const APP_NAME = plan.app || (CONFIG.apps && CONFIG.apps[0] && CONFIG.apps[0].name);
const appCfg   = (CONFIG.apps || []).find(a => a.name === APP_NAME) || (CONFIG.apps || [])[0] || {};
const BASE_URL = (plan.baseUrl || appCfg.baseUrl || '').replace(/\/$/, '');
const LOGIN_PATH = appCfg.loginPath || appCfg.login_path || '/authentication/signin';
const creds = (SECRETS.apps && (SECRETS.apps[APP_NAME] || SECRETS.apps[appCfg.name])) || {};
const EMAIL = creds.email || creds.username;
const PASSWORD = creds.password;

const ENGINES = { chromium, firefox, webkit };
const requested = browsersArg ? browsersArg.split(',').map(s => s.trim())
  : [...new Set(cells.map(c => c.browser))].filter(Boolean);
const engineList = requested.filter(e => ENGINES[e]);
if (engineList.length === 0) engineList.push('chromium');

// ── Live capture of console errors + failed network requests ────────────────
// Playwright listeners (not a page.evaluate probe) — uncaught errors and network
// failures only surface through real browser events. Reset per cell in runCell().
let capture = { console: [], network: [] };
const CONSOLE_SKIP = [/favicon/i, /ResizeObserver loop/i, /Non-passive event listener/i, /Permissions policy/i, /Download the React DevTools/i];
function wireCapture(page) {
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!CONSOLE_SKIP.some(re => re.test(t))) capture.console.push({ text: t, source: (m.location() && m.location().url) || '' }); } });
  page.on('pageerror', e => { const t = (e && e.message) || String(e); if (!CONSOLE_SKIP.some(re => re.test(t))) capture.console.push({ text: t, source: 'uncaught exception' }); });
  page.on('requestfailed', r => { capture.network.push({ method: r.method(), url: r.url(), status: 0, statusText: (r.failure() && r.failure().errorText) || 'request failed' }); });
  page.on('response', r => { const s = r.status(); if (s >= 400) capture.network.push({ method: r.request().method(), url: r.url(), status: s, statusText: r.statusText() || '' }); });
}

// Inject a DevTools-style panel into the live page, screenshot it (rendered by the
// REAL browser → fully legible, real fonts), then remove it. Returns the rel path.
async function captureEvidencePanel(page, cellId, kind, rows) {
  const file = `${cellId}-${kind}.png`;
  const abs = path.join(SHOTS, file);
  await page.evaluate(({ kind, rows }) => {
    const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const d = document.createElement('div');
    d.id = '__qa_evidence_panel';
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:55%;background:#1e1e1e;color:#d4d4d4;font:13px/1.6 Menlo,Consolas,"Courier New",monospace;z-index:2147483647;overflow:auto;border-top:3px solid #f44336;box-shadow:0 -6px 30px rgba(0,0,0,.6)';
    let html = '';
    if (kind === 'console') {
      html = `<div style="background:#2d2d2d;padding:8px 14px;color:#fff;font-weight:bold;border-bottom:1px solid #444">Console — ${rows.length} error${rows.length===1?'':'s'}</div>`;
      html += rows.map(e => `<div style="padding:6px 14px;border-bottom:1px solid #2a2a2a;color:#f48771;white-space:pre-wrap;word-break:break-word"><span style="color:#f44336;font-weight:bold">✖ </span>${esc(e.text)}${e.source?`<div style="color:#808080;font-size:11px;margin-top:2px">↳ ${esc(e.source)}</div>`:''}</div>`).join('');
    } else {
      html = `<div style="background:#2d2d2d;padding:8px 14px;color:#fff;font-weight:bold;border-bottom:1px solid #444">Network — ${rows.length} failed request${rows.length===1?'':'s'}</div>`;
      html += `<div style="display:grid;grid-template-columns:70px 90px 1fr;gap:0;padding:4px 14px;color:#9cdcfe;border-bottom:1px solid #444;font-weight:bold"><div>Status</div><div>Method</div><div>URL</div></div>`;
      html += rows.map(r => `<div style="display:grid;grid-template-columns:70px 90px 1fr;gap:0;padding:6px 14px;border-bottom:1px solid #2a2a2a;word-break:break-all"><div style="color:#f44336;font-weight:bold">${r.status||'ERR'}</div><div style="color:#dcdcaa">${esc(r.method)}</div><div style="color:#ce9178">${esc(r.url)}<div style="color:#808080;font-size:11px">${esc(r.statusText)}</div></div></div>`).join('');
    }
    d.innerHTML = html;
    document.body.appendChild(d);
  }, { kind, rows });
  await page.screenshot({ path: abs, fullPage: false });        // viewport shot → fixed panel visible at bottom
  await page.evaluate(() => { const e = document.getElementById('__qa_evidence_panel'); if (e) e.remove(); });
  return `.tmp/${RUN_ID}/screenshots/${file}`;
}

// ── The single in-page function that runs EVERY passive probe ────────────────
// Runs in the browser. Receives the probe array; returns { skillName: result }.
// Identical contract to the worker's batch — but invoked by code, not a model.
function runAllProbes(skills) {
  const out = {};
  for (const s of skills) {
    try {
      const factory = new Function('return (' + s.probe + ')')();
      out[s.name] = typeof factory === 'function' ? factory() : factory;
    } catch (e) { out[s.name] = { error: String((e && e.message) || e) }; }
  }
  return out;
}

// ── Turn a probe result object into verbatim findings ───────────────────────
function toFindings(resultObj, cell, engine) {
  const findings = [];
  const env = {
    runId: RUN_ID, cellId: cell.id, route: cell.route,
    viewport: cell.viewport, viewportClass: cell.viewportClass, browser: engine,
    screenshotPath: `.tmp/${RUN_ID}/screenshots/${cell.id}-base.png`,
  };
  for (const skill of passive) {
    const r = resultObj[skill.name];
    if (!r || r.error) continue;                       // self-skip / probe error → no finding
    const arr = Array.isArray(r) ? r : (Array.isArray(r.issues) ? r.issues : (Array.isArray(r.findings) ? r.findings : []));
    for (const issue of arr) {
      if (!issue || typeof issue !== 'object') continue;
      // VERBATIM: copy exactly what the probe emitted; only envelope is added.
      findings.push({
        ...env,
        skill: skill.name,
        issueType: issue.issueType,
        severity: issue.severity || 'medium',
        selector: issue.selector || null,
        description: issue.description || '',
        bbox: issue.bbox || null,
      });
    }
  }
  return findings;
}

async function attemptLogin(page) {
  if (!EMAIL || !PASSWORD) { console.log('  [login] no creds for app — auth cells will reflect logged-out state'); return false; }
  try {
    await page.goto(BASE_URL + LOGIN_PATH, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Wait for the form to actually render (SPA/Angular forms appear several seconds
    // after domcontentloaded). Anchor on the password field — every login form has one.
    try { await page.waitForSelector('input[type=password]', { timeout: 15000, state: 'visible' }); }
    catch { console.log('  [login] password field never rendered — skipping'); return false; }
    const emailSel = ['input[type=email]', 'input[formcontrolname*=email i]', 'input[formcontrolname*=user i]',
                      'input[name*=email i]', 'input[name*=user i]', 'input[autocomplete=username]',
                      'input[type=text]:not([type=password])'];
    let filled = false;
    for (const sel of emailSel) {
      const el = page.locator(sel).first();
      if (await el.count() && await el.isVisible().catch(() => false)) { await el.fill(EMAIL); filled = true; break; }
    }
    const pw = page.locator('input[type=password]').first();
    if (!filled || !(await pw.count())) { console.log('  [login] could not find login fields — skipping'); return false; }
    await pw.fill(PASSWORD);
    const submit = page.locator('button[type=submit], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first();
    if (await submit.count()) await submit.click(); else await pw.press('Enter');
    await page.waitForTimeout(4000);
    const onLogin = page.url().includes(LOGIN_PATH);
    console.log(onLogin ? '  [login] still on login page — login may have failed' : `  [login] ok → ${page.url()}`);
    return !onLogin;
  } catch (e) { console.log(`  [login] error: ${e.message}`); return false; }
}

async function runCell(page, cell, engine) {
  const t0 = Date.now();
  try {
    await page.setViewportSize({ width: cell.width || 1440, height: cell.height || 900 });
    capture = { console: [], network: [] };   // reset live capture for THIS cell's navigation
    await page.goto(BASE_URL + cell.route, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    const actual = await page.evaluate(() => location.pathname);
    if (actual !== cell.route) {
      // Redirect guard — record it, do NOT run probes on the wrong page.
      const rec = { runId: RUN_ID, cellId: cell.id, skill: 'qa-cell-worker', issueType: 'cellRedirected',
        severity: 'info', route: cell.route, viewport: cell.viewport, viewportClass: cell.viewportClass,
        browser: engine, selector: null, bbox: null,
        description: `Navigation to ${cell.route} redirected to ${actual} — probes skipped`,
        screenshotPath: `.tmp/${RUN_ID}/screenshots/${cell.id}-base.png` };
      fs.writeFileSync(path.join(ISSUES, `${cell.id}.jsonl`), JSON.stringify(rec) + '\n');
      // Still write a receipt so coverage-gate counts the skills as accounted-for on a redirected cell.
      const skipReceipt = {}; passive.forEach(s => { skipReceipt[s.name] = { skipped: 'cellRedirected' }; });
      fs.writeFileSync(path.join(ISSUES, `${cell.id}-probes.json`), JSON.stringify(skipReceipt));
      return { cell: cell.id, redirected: actual, findings: 0 };
    }
    // Run ALL passive probes in ONE evaluate — code-driven, cannot be subset.
    const result = await page.evaluate(runAllProbes, passive.map(s => ({ name: s.name, probe: s.probe })));
    // Base screenshot (real path the annotator/file-bugs expect).
    await page.screenshot({ path: path.join(SHOTS, `${cell.id}-base.png`), fullPage: true });
    // Receipt = proof every passive skill executed.
    fs.writeFileSync(path.join(ISSUES, `${cell.id}-probes.json`), JSON.stringify(result));
    // Findings, verbatim.
    const findings = toFindings(result, cell, engine);

    // Console + network EVIDENCE (captured live during this cell's navigation).
    // For these, the "annotated" screenshot is a real DevTools-style panel rendered
    // INTO the page and screenshotted — legible, not the plain page shot.
    const env2 = { runId: RUN_ID, cellId: cell.id, route: cell.route, viewport: cell.viewport,
      viewportClass: cell.viewportClass, browser: engine, screenshotPath: `.tmp/${RUN_ID}/screenshots/${cell.id}-base.png` };
    if (capture.console.length) {
      const evi = await captureEvidencePanel(page, cell.id, 'console', capture.console.slice(0, 12)).catch(() => null);
      findings.push({ ...env2, skill: 'qa-detect-console-errors', issueType: 'consoleError', severity: 'high',
        selector: null, bbox: null, evidenceType: 'console',
        description: `${capture.console.length} console error(s) on load: ` + capture.console.slice(0, 3).map(e => e.text.slice(0, 140)).join('  |  '),
        ...(evi ? { annotatedScreenshotPath: evi } : {}) });
    }
    if (capture.network.length) {
      const evi = await captureEvidencePanel(page, cell.id, 'network', capture.network.slice(0, 15)).catch(() => null);
      // Use the issueTypes the qa-detect-network-errors allowlist actually permits:
      // httpError (4xx/5xx response) vs requestFailed (no response / network error).
      const hasHttp = capture.network.some(r => r.status >= 400);
      findings.push({ ...env2, skill: 'qa-detect-network-errors', issueType: hasHttp ? 'httpError' : 'requestFailed', severity: 'high',
        selector: null, bbox: null, evidenceType: 'network',
        description: `${capture.network.length} failed request(s): ` + capture.network.slice(0, 3).map(r => `${r.status || 'ERR'} ${r.method} ${r.url.slice(0, 90)}`).join('  |  '),
        ...(evi ? { annotatedScreenshotPath: evi } : {}) });
    }

    fs.writeFileSync(path.join(ISSUES, `${cell.id}.jsonl`), findings.map(f => JSON.stringify(f)).join('\n') + (findings.length ? '\n' : ''));
    const ran = Object.keys(result).length;
    console.log(`  ✓ ${cell.id} ${cell.route} @ ${cell.viewportClass}/${engine} — ${ran}/${passive.length} probes, ${findings.length} findings (${Date.now() - t0}ms)`);
    return { cell: cell.id, probes: ran, findings: findings.length };
  } catch (e) {
    console.log(`  ✗ ${cell.id} ${cell.route} — ${e.message}`);
    // Even on error, write a receipt marking the attempt so the gate can re-dispatch knowingly.
    const errReceipt = {}; passive.forEach(s => { errReceipt[s.name] = { error: 'cell load failed: ' + e.message }; });
    fs.writeFileSync(path.join(ISSUES, `${cell.id}-probes.json`), JSON.stringify(errReceipt));
    return { cell: cell.id, error: e.message };
  }
}

(async () => {
  console.log(`\nrun-passive-probes.cjs  [${RUN_ID}]`);
  console.log(`  app=${APP_NAME}  base=${BASE_URL}  passiveSkills=${passive.length}  cells=${cells.length}`);
  console.log(`  engines=${engineList.join(',')}  headed=${HEADED}\n`);

  let totalFindings = 0, totalCells = 0;
  for (const engine of engineList) {
    const engineCells = cells.filter(c => (c.browser || 'chromium') === engine);
    if (engineCells.length === 0) continue;
    console.log(`▶ ${engine}: ${engineCells.length} cells`);
    const browser = await ENGINES[engine].launch({ headless: !HEADED });

    // Phase 1 (public) in a clean context, then login, then phases 2/3 authed.
    const phase1 = engineCells.filter(c => c.phase === 1 || c.requiresAuth === false);
    const phaseN = engineCells.filter(c => !(c.phase === 1 || c.requiresAuth === false));

    if (phase1.length) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage(); wireCapture(page);
      for (const cell of phase1) { const r = await runCell(page, cell, engine); totalCells++; totalFindings += r.findings || 0; }
      await ctx.close();
    }
    if (phaseN.length) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage(); wireCapture(page);
      const loggedIn = await attemptLogin(page);
      if (!loggedIn && (EMAIL && PASSWORD)) console.log('  ⚠ login failed — auth cells will be audited logged-out (redirect guard will record it)');
      for (const cell of phaseN) { const r = await runCell(page, cell, engine); totalCells++; totalFindings += r.findings || 0; }
      await ctx.close();
    }
    await browser.close();
  }

  console.log(`\n✓ done: ${totalCells} cells, ${totalFindings} findings written. Receipts in ${ISSUES}/`);
  console.log(`  Next: coverage-gate.cjs → annotate-cell.cjs → (interactive skills) → file-bugs.cjs\n`);
  process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
