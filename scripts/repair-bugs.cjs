#!/usr/bin/env node
/**
 * repair-bugs.cjs — back-fill empty ADO Bug tickets with proper Repro Steps
 *                   and annotated screenshots based on a prior audit run.
 *
 * Why this exists:
 *   - Old runs of qa-bug-filer wrote only to System.Description (not visible
 *     on the ADO Bug template, which displays Microsoft.VSTS.TCM.ReproSteps).
 *   - Old runs of qa-argus skipped the screenshot capture step (Step 5h).
 *   - This script reads the latest issues/*.jsonl, captures fresh screenshots
 *     using local Playwright, and updates every matching ADO bug.
 *
 * Usage:
 *   node scripts/repair-bugs.cjs <run-id>
 *
 * Reads:
 *   .claude/automation.config.json   — ADO org, project, app, baseUrl
 *   .claude/secrets.json             — AZURE_DEVOPS_PAT
 *   .tmp/<run-id>/issues/*.jsonl     — findings to match against bugs
 *
 * Writes:
 *   .tmp/<run-id>/screenshots/<bugId>__<issueType>.png            (raw)
 *   .tmp/<run-id>/screenshots/<bugId>__<issueType>.annotated.png  (annotated)
 *   .tmp/<run-id>/bugs-repaired.jsonl                              (per-bug log)
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { chromium } = require('playwright');

// ── Args ────────────────────────────────────────────────────────────────────
const RUN_ID = process.argv[2];
if (!RUN_ID) { console.error('Usage: node scripts/repair-bugs.cjs <run-id>'); process.exit(1); }

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUN_DIR      = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_DIR   = path.join(RUN_DIR, 'issues');
const SHOTS_DIR    = path.join(RUN_DIR, 'screenshots');
const LOG_PATH     = path.join(RUN_DIR, 'bugs-repaired.jsonl');

if (!fs.existsSync(RUN_DIR))    { console.error(`Run dir missing: ${RUN_DIR}`); process.exit(1); }
if (!fs.existsSync(ISSUES_DIR)) { console.error(`Issues dir missing: ${ISSUES_DIR}`); process.exit(1); }
fs.mkdirSync(SHOTS_DIR, { recursive: true });

// ── Config + secrets ───────────────────────────────────────────────────────
const CONFIG  = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, '.claude/automation.config.json'), 'utf8'));
const SECRETS = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, '.claude/secrets.json'), 'utf8'));

const PAT          = process.env.ADO_PAT || process.env.AZURE_DEVOPS_PAT || SECRETS.AZURE_DEVOPS_PAT || SECRETS.ADO_PAT;
const ORG_NAME     = (CONFIG.ado.org || '').replace('https://dev.azure.com/', '').replace(/\/$/, '');
const PROJECT_NAME = CONFIG.ado.project;
const _repairPlan  = (() => { try { return JSON.parse(fs.readFileSync(path.join(RUN_DIR, 'audit-plan.json'), 'utf8')); } catch (_) { return {}; } })();
const APP          = _repairPlan.app     || (CONFIG.apps && CONFIG.apps[0] && CONFIG.apps[0].name)    || 'app';
const BASE_URL     = _repairPlan.baseUrl || (CONFIG.apps && CONFIG.apps[0] && CONFIG.apps[0].baseUrl) || '';
const VIEWPORTS    = CONFIG.responsiveness.viewports;

if (!PAT)          { console.error('No ADO PAT found in env or .claude/secrets.json'); process.exit(1); }
if (!ORG_NAME)     { console.error('No ADO org in automation.config.json'); process.exit(1); }
if (!PROJECT_NAME) { console.error('No ADO project in automation.config.json'); process.exit(1); }

// ── Load all issues from this run ──────────────────────────────────────────
const allIssues = [];
for (const f of fs.readdirSync(ISSUES_DIR).filter(x => x.endsWith('.jsonl'))) {
  const txt = fs.readFileSync(path.join(ISSUES_DIR, f), 'utf8');
  for (const line of txt.split('\n').filter(l => l.trim())) {
    try { allIssues.push(JSON.parse(line)); } catch (_) {}
  }
}
console.log(`Loaded ${allIssues.length} findings from ${RUN_ID}`);

// ── ADO REST helper ────────────────────────────────────────────────────────
function adoRequest(method, urlPath, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const auth    = Buffer.from(`:${PAT}`).toString('base64');
    const bodyBuf = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const req = https.request({
      hostname: 'dev.azure.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': contentType,
        'Accept': 'application/json',
        ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {})
      }
    }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (_) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ── Build Repro Steps HTML for an issue ────────────────────────────────────
function buildBody(issue) {
  const bbox = issue.bbox ? `${issue.bbox.x}, ${issue.bbox.y}, ${issue.bbox.w}×${issue.bbox.h}` : 'n/a';
  return `<h3>Issue: ${escape(issue.issueType)}</h3>
<table border="1" cellpadding="4" cellspacing="0">
  <tr><td><b>Skill</b></td><td>${escape(issue.skill)}</td></tr>
  <tr><td><b>Severity</b></td><td>${escape(issue.severity)}</td></tr>
  <tr><td><b>Route</b></td><td>${escape(issue.route)}</td></tr>
  <tr><td><b>Viewport</b></td><td>${escape(issue.viewport)} (${escape(issue.viewportClass)})</td></tr>
  <tr><td><b>Browser</b></td><td>${escape(issue.browser || 'chromium')}</td></tr>
  <tr><td><b>Selector</b></td><td><code>${escape(issue.selector || 'n/a')}</code></td></tr>
  <tr><td><b>BBox</b></td><td>${escape(bbox)}</td></tr>
  <tr><td><b>Run ID</b></td><td>${escape(issue.runId)}</td></tr>
</table>
<h3>What's wrong</h3>
<p>${escape(issue.description)}</p>
<h3>Steps to Reproduce</h3>
<ol>
  <li>Open <a href="${BASE_URL}${escape(issue.route)}">${BASE_URL}${escape(issue.route)}</a> in ${escape(issue.browser || 'chromium')}</li>
  <li>Set the viewport to ${escape(issue.viewport)}</li>
  <li>Observe the element matching <code>${escape(issue.selector || '(see screenshot)')}</code></li>
  <li>Expected: <i>no ${escape(issue.issueType)} present</i></li>
  <li>Actual: <i>${escape(issue.description)}</i></li>
</ol>
<p><em>Filed automatically by argus-qa (Run ID: ${escape(issue.runId)})</em></p>`;
}
function escape(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Match a bug title to a finding ─────────────────────────────────────────
// Title format: "[QA] <issueType> on <route> at <viewports> — <app>"
function parseTitle(title) {
  const m = title.match(/\[QA\]\s+(\S+)\s+on\s+(\S+)\s+at\s+([^—]+?)\s*—\s*(.+)/);
  if (!m) return null;
  return { issueType: m[1].trim(), route: m[2].trim(), viewports: m[3].trim(), app: m[4].trim() };
}
function findMatchingIssue(parsed) {
  if (!parsed) return null;
  // Find best match: same issueType + same route, prefer first viewport listed
  const firstViewport = parsed.viewports.split(',')[0].trim();
  return allIssues.find(i => i.issueType === parsed.issueType && i.route === parsed.route && i.viewport === firstViewport)
      || allIssues.find(i => i.issueType === parsed.issueType && i.route === parsed.route);
}

// ── Capture + annotate screenshot for one finding ──────────────────────────
let browser, context;
async function ensureBrowser() {
  if (browser) return;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ ignoreHTTPSErrors: true });
}
async function captureAnnotated(bugId, issue) {
  await ensureBrowser();
  const vp = VIEWPORTS.find(v => v.class === issue.viewportClass) || VIEWPORTS[0];
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(BASE_URL + issue.route, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
    const rawPath = path.join(SHOTS_DIR, `${bugId}__${safe(issue.issueType)}.png`);
    const annotatedPath = path.join(SHOTS_DIR, `${bugId}__${safe(issue.issueType)}.annotated.png`);
    await page.screenshot({ path: rawPath, fullPage: false });

    // Draw a box on a copy by overlaying via DOM injection
    if (issue.bbox && issue.bbox.w > 0 && issue.bbox.h > 0) {
      await page.evaluate((bbox) => {
        const d = document.createElement('div');
        d.id = '__repair_box__';
        d.style.cssText = `position:fixed;left:${bbox.x}px;top:${bbox.y}px;width:${bbox.w}px;height:${bbox.h}px;border:3px solid #ef4444;background:rgba(239,68,68,0.15);z-index:2147483647;pointer-events:none;box-shadow:0 0 0 2px white;`;
        document.body.appendChild(d);
        const label = document.createElement('div');
        label.textContent = 'argus-qa: issue here';
        label.style.cssText = `position:fixed;left:${bbox.x}px;top:${Math.max(0,bbox.y-22)}px;background:#ef4444;color:white;font:bold 12px sans-serif;padding:2px 6px;z-index:2147483647;`;
        document.body.appendChild(label);
      }, issue.bbox);
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: annotatedPath, fullPage: false });
    return { rawPath, annotatedPath };
  } finally {
    await page.close().catch(() => {});
  }
}

// ── Attach a PNG to an ADO work item ───────────────────────────────────────
async function attachToBug(bugId, filePath) {
  if (!fs.existsSync(filePath)) return false;
  const fileName = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  const upRes = await adoRequest(
    'POST',
    `/${ORG_NAME}/${PROJECT_NAME}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`,
    buf,
    'application/octet-stream'
  );
  if (upRes.status !== 200 && upRes.status !== 201) {
    console.log(`    upload HTTP ${upRes.status}: ${JSON.stringify(upRes.body).slice(0,150)}`);
    return false;
  }
  const url = upRes.body.url;
  const linkRes = await adoRequest(
    'PATCH',
    `/${ORG_NAME}/${PROJECT_NAME}/_apis/wit/workitems/${bugId}?api-version=7.1`,
    [{ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url, attributes: { comment: 'Annotated screenshot (repaired)' } } }],
    'application/json-patch+json'
  );
  return linkRes.status === 200;
}

// ── Query existing argus-qa bugs ───────────────────────────────────────────
async function listExistingBugs() {
  const wiql = { query:
    `SELECT [System.Id], [System.Title] FROM workitems ` +
    `WHERE [System.WorkItemType] = 'Bug' AND [System.Tags] CONTAINS 'argus-qa' AND [System.State] <> 'Closed'`
  };
  const res = await adoRequest('POST', `/${ORG_NAME}/${PROJECT_NAME}/_apis/wit/wiql?api-version=7.1`, wiql);
  if (res.status !== 200) { console.error('WIQL failed:', res.status, res.body); return []; }
  return res.body.workItems || [];
}
async function getBug(id) {
  const res = await adoRequest('GET', `/${ORG_NAME}/${PROJECT_NAME}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`);
  return res.body;
}

// ── Repair a single bug ────────────────────────────────────────────────────
async function repairBug(bug) {
  const id    = bug.id;
  const title = bug.fields['System.Title'];
  const repro = bug.fields['Microsoft.VSTS.TCM.ReproSteps'] || '';
  const desc  = bug.fields['System.Description']           || '';
  const hasAttachment = (bug.relations || []).some(r => r.rel === 'AttachedFile');

  const parsed = parseTitle(title);
  const issue  = findMatchingIssue(parsed);

  if (!issue) {
    console.log(`  #${id} [UNMATCHED] "${title.slice(0,60)}"`);
    return { id, title, status: 'no-issue-match' };
  }

  const reproEmpty = repro.replace(/<[^>]+>/g, '').trim().length < 30;
  const descEmpty  = desc.replace(/<[^>]+>/g, '').trim().length < 30;
  const body       = buildBody(issue);

  const patch = [];
  if (reproEmpty) patch.push({ op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps', value: body });
  if (descEmpty)  patch.push({ op: 'add', path: '/fields/System.Description',            value: body });

  let bodyResult = 'already-ok';
  if (patch.length) {
    const r = await adoRequest('PATCH', `/${ORG_NAME}/${PROJECT_NAME}/_apis/wit/workitems/${id}?api-version=7.1`, patch, 'application/json-patch+json');
    bodyResult = r.status === 200 ? 'filled' : `failed-${r.status}`;
  }

  let attachResult = 'already-attached';
  if (!hasAttachment) {
    try {
      const { annotatedPath } = await captureAnnotated(id, issue);
      const ok = await attachToBug(id, annotatedPath);
      attachResult = ok ? 'attached' : 'attach-failed';
    } catch (e) {
      attachResult = `capture-failed: ${e.message}`.slice(0, 60);
    }
  }

  console.log(`  #${id}  body:${bodyResult}  attach:${attachResult}  "${title.slice(0,55)}"`);
  return { id, title, status: 'repaired', bodyResult, attachResult };
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nRepair-bugs starting`);
  console.log(`  Org:     ${ORG_NAME}`);
  console.log(`  Project: ${PROJECT_NAME}`);
  console.log(`  Run:     ${RUN_ID}`);
  console.log(`  App:     ${APP}`);
  console.log(`  BaseUrl: ${BASE_URL}\n`);

  const refs = await listExistingBugs();
  console.log(`Found ${refs.length} open argus-qa bugs\n`);
  if (!refs.length) { console.log('Nothing to repair.'); process.exit(0); }

  const results = [];
  for (const r of refs) {
    try {
      const bug = await getBug(r.id);
      if (!bug || !bug.fields) { console.log(`  #${r.id} could not fetch`); continue; }
      results.push(await repairBug(bug));
    } catch (e) {
      console.log(`  #${r.id} error: ${e.message}`);
      results.push({ id: r.id, status: 'error', error: e.message });
    }
  }

  if (browser) await browser.close().catch(() => {});

  fs.writeFileSync(LOG_PATH, results.map(r => JSON.stringify(r)).join('\n'));

  const ok       = results.filter(r => r.status === 'repaired').length;
  const unmatched= results.filter(r => r.status === 'no-issue-match').length;
  const errored  = results.filter(r => r.status === 'error').length;
  console.log(`\nSummary: ${ok} processed, ${unmatched} unmatched, ${errored} errored`);
  console.log(`Log: ${LOG_PATH}`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
