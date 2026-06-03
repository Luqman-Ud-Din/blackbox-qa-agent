#!/usr/bin/env node
/**
 * file-bugs.cjs — PERMANENT bug-filing script.
 *
 * DO NOT regenerate this file. The qa-bug-filer SKILL.md calls this script
 * directly with `node scripts/file-bugs.cjs <run-id>`. The runtime orchestrator
 * must NEVER write its own copy of this script.
 *
 * Why permanent:
 *   - Older runs had a runtime-regenerated file-bugs.cjs that wrote ONLY to
 *     System.Description. ADO's Bug template displays Microsoft.VSTS.TCM.ReproSteps
 *     — so tickets looked empty even though the description was populated.
 *   - This file writes BOTH ReproSteps AND Description with the same HTML, every time.
 *
 * Usage:
 *   node scripts/file-bugs.cjs <run-id>
 *
 * Reads:
 *   .claude/automation.config.json   — ADO org/project/app/baseUrl
 *   .claude/secrets.json             — AZURE_DEVOPS_PAT
 *   .tmp/<run-id>/issues/*.jsonl     — findings to file
 *
 * Writes:
 *   .tmp/<run-id>/bugs-filed.jsonl   — per-bug log with adoBugId
 *
 * Attaches: annotatedScreenshotPath (preferred) OR screenshotPath (fallback)
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const schema = require('./argus-schema.cjs');

// ── Args ────────────────────────────────────────────────────────────────────
const RUN_ID = process.argv[2];
if (!RUN_ID) {
  console.error('Usage: node scripts/file-bugs.cjs <run-id>');
  process.exit(1);
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUN_DIR      = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES_DIR   = path.join(RUN_DIR, 'issues');
const BUGS_LOG     = path.join(RUN_DIR, 'bugs-filed.jsonl');

if (!fs.existsSync(RUN_DIR))    { console.error(`Run dir missing: ${RUN_DIR}`); process.exit(1); }
if (!fs.existsSync(ISSUES_DIR)) { console.error(`Issues dir missing: ${ISSUES_DIR}`); process.exit(1); }

// ── Config + secrets ───────────────────────────────────────────────────────
const CONFIG  = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, '.claude/automation.config.json'), 'utf8'));
const SECRETS = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, '.claude/secrets.json'), 'utf8'));

const PAT      = process.env.ADO_PAT || process.env.AZURE_DEVOPS_PAT || SECRETS.AZURE_DEVOPS_PAT || SECRETS.ADO_PAT;
const ORG_NAME = (CONFIG.ado.org || '').replace('https://dev.azure.com/', '').replace(/\/$/, '');
const PROJECT  = CONFIG.ado.project;
const APP      = (CONFIG.apps && CONFIG.apps[0] && CONFIG.apps[0].name) || 'app';
const AREA     = CONFIG.ado.areaPath || PROJECT;
const MAX_BUGS = 50;

if (!PAT)     { console.error('No ADO PAT found in env or .claude/secrets.json'); process.exit(1); }
if (!ORG_NAME){ console.error('No ADO org configured'); process.exit(1); }
if (!PROJECT) { console.error('No ADO project configured'); process.exit(1); }

const AUTH = Buffer.from(':' + PAT).toString('base64');

// ── ADO REST helper ────────────────────────────────────────────────────────
function adoRequest(method, urlPath, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const bodyBuf = body == null ? null
      : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const req = https.request({
      hostname: 'dev.azure.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': 'Basic ' + AUTH,
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

// ── HTML-escape user-provided strings ──────────────────────────────────────
function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Build the rich-text body (used for BOTH ReproSteps AND Description) ────
function buildBody(issue) {
  const baseUrl = (CONFIG.apps && CONFIG.apps[0] && CONFIG.apps[0].baseUrl) || '';
  const fullUrl = baseUrl + (issue.route || '');
  const bboxStr = issue.bbox
    ? `x:${issue.bbox.x}, y:${issue.bbox.y}, ${issue.bbox.w}×${issue.bbox.h}`
    : 'n/a';
  return `<h3>Issue: ${escape(issue.issueType || 'unknown')}</h3>
<table border="1" cellpadding="4" cellspacing="0">
  <tr><td><b>Skill</b></td><td>${escape(issue.skill)}</td></tr>
  <tr><td><b>Severity</b></td><td>${escape(issue.severity)}</td></tr>
  <tr><td><b>Route</b></td><td><a href="${escape(fullUrl)}">${escape(issue.route)}</a></td></tr>
  <tr><td><b>Viewport</b></td><td>${escape(issue.viewport)} (${escape(issue.viewportClass)})</td></tr>
  <tr><td><b>Browser</b></td><td>${escape(issue.browser || 'chromium')}</td></tr>
  <tr><td><b>Selector</b></td><td><code>${escape(issue.selector || 'n/a')}</code></td></tr>
  <tr><td><b>BBox</b></td><td>${escape(bboxStr)}</td></tr>
  <tr><td><b>Run ID</b></td><td>${escape(issue.runId)}</td></tr>
</table>
<h3>What's wrong</h3>
<p>${escape(issue.description)}</p>
<h3>Steps to Reproduce</h3>
<ol>
  <li>Open <a href="${escape(fullUrl)}">${escape(fullUrl)}</a> in ${escape(issue.browser || 'chromium')}</li>
  <li>Set the viewport to ${escape(issue.viewport)} (${escape(issue.viewportClass)})</li>
  <li>Observe the element matching <code>${escape(issue.selector || '(see annotated screenshot)')}</code></li>
  <li><b>Expected</b>: no <code>${escape(issue.issueType)}</code> at this viewport</li>
  <li><b>Actual</b>: ${escape(issue.description)}</li>
</ol>
<p><em>Filed automatically by argus-qa (Run ID: ${escape(issue.runId)})</em></p>`;
}

// ── Attach screenshot ──────────────────────────────────────────────────────
async function attachScreenshot(bugId, screenshotPath) {
  if (!screenshotPath) return 'no-path';
  // Path may be project-relative ('.tmp/xxx/...') or absolute
  const absPath = path.isAbsolute(screenshotPath)
    ? screenshotPath
    : path.join(PROJECT_ROOT, screenshotPath);
  if (!fs.existsSync(absPath)) return `file-missing:${absPath}`;

  const fileName = path.basename(absPath);
  const buf      = fs.readFileSync(absPath);

  const upRes = await adoRequest(
    'POST',
    `/${ORG_NAME}/${PROJECT}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`,
    buf,
    'application/octet-stream'
  );
  if (upRes.status !== 200 && upRes.status !== 201) return `upload-${upRes.status}`;
  const attUrl = upRes.body.url;
  if (!attUrl) return 'no-url-returned';

  const linkRes = await adoRequest(
    'PATCH',
    `/${ORG_NAME}/${PROJECT}/_apis/wit/workitems/${bugId}?api-version=7.1`,
    [{ op: 'add', path: '/relations/-',
       value: { rel: 'AttachedFile', url: attUrl, attributes: { comment: 'Argus QA evidence' } } }],
    'application/json-patch+json'
  );
  return linkRes.status === 200 ? 'attached' : `link-${linkRes.status}`;
}

// ── File one bug ───────────────────────────────────────────────────────────
const SEV_MAP = { critical: '1 - Critical', high: '1 - Critical', medium: '2 - High', low: '3 - Medium' };

async function fileBug(issue) {
  const title = `[QA] ${issue.issueType} on ${issue.route} @ ${issue.viewportClass} — ${issue.app || APP}`;
  const tags  = `argus-qa,${issue.skill || 'qa'},${issue.viewportClass || 'unknown'},${issue.browser || 'chromium'}`;
  const sev   = SEV_MAP[issue.severity] || '2 - High';
  const body  = buildBody(issue);

  // CRITICAL: write the body HTML to BOTH ReproSteps AND Description.
  // ADO's Bug template displays ReproSteps; only setting Description leaves the ticket looking blank.
  const patch = [
    { op: 'add', path: '/fields/System.Title',                   value: title },
    { op: 'add', path: '/fields/Microsoft.VSTS.Common.Severity', value: sev   },
    { op: 'add', path: '/fields/System.Tags',                    value: tags  },
    { op: 'add', path: '/fields/System.AreaPath',                value: AREA  },
    { op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps',  value: body  },  // PRIMARY (Bug template body)
    { op: 'add', path: '/fields/System.Description',             value: body  }   // FALLBACK (some templates show this)
  ];

  const createRes = await adoRequest(
    'POST',
    `/${ORG_NAME}/${PROJECT}/_apis/wit/workitems/$Bug?api-version=7.1`,
    patch,
    'application/json-patch+json'
  );

  if (createRes.status !== 200 && createRes.status !== 201) {
    const msg = createRes.body && createRes.body.message ? createRes.body.message : '';
    console.log(`  ✗ Create failed [${createRes.status}]: ${title}` + (msg ? ` — ${msg.slice(0,120)}` : ''));
    return { status: 'failed', httpStatus: createRes.status, message: msg };
  }

  const bugId = createRes.body.id;
  // Prefer annotated, fall back to clean
  const shotPath = issue.annotatedScreenshotPath || issue.screenshotPath;
  const attachStatus = await attachScreenshot(bugId, shotPath).catch(e => `error:${e.message}`);

  console.log(`  ✓ #${bugId}  body:both-fields  attach:${attachStatus}  ${title.slice(0,70)}`);

  return { status: 'filed', adoBugId: bugId, adoTitle: title, attachStatus };
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nfile-bugs.cjs (permanent) starting`);
  console.log(`  Org:     ${ORG_NAME}`);
  console.log(`  Project: ${PROJECT}`);
  console.log(`  App:     ${APP}`);
  console.log(`  Run:     ${RUN_ID}\n`);

  // Collect all issues using the schema-aware reader
  const allIssues = schema.readAllJsonl(ISSUES_DIR);
  console.log(`  Collected ${allIssues.length} raw issues from ${ISSUES_DIR}`);

  // Validate against the canonical schema. Reject malformed issues with a clear report.
  const { valid, invalid } = schema.validateMany(allIssues);
  if (invalid.length > 0) {
    console.error(`\n  ⚠ ${invalid.length} of ${allIssues.length} issues failed schema validation and will NOT be filed:`);
    for (const { error, field, issue } of invalid.slice(0, 10)) {
      console.error(`    - skill=${issue && issue.skill}  field=${field}  ${error}`);
    }
    if (invalid.length > 10) console.error(`    ...and ${invalid.length - 10} more`);
    console.error('  Fix the probe that emitted these — do not bypass this gate.\n');
  }
  if (valid.length === 0) {
    console.log('  No valid issues to file — exiting cleanly.');
    return;
  }
  console.log(`  Validated: ${valid.length} ok, ${invalid.length} rejected`);

  // Deduplicate by issueType + route + viewportClass + browser
  const seen = new Map();
  const unique = [];
  let dups = 0;
  for (const issue of valid) {
    const key = [issue.issueType, issue.route, issue.viewportClass, issue.browser].join('|');
    if (seen.has(key)) { dups++; continue; }
    seen.set(key, true);
    unique.push(issue);
  }
  console.log(`  Deduplicated: ${unique.length} unique (${dups} duplicates dropped)`);

  // Sort by severity
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  unique.sort((a, b) => (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2));

  const toFile = unique.slice(0, MAX_BUGS);
  console.log(`  Filing ${toFile.length} bugs (cap: ${MAX_BUGS})\n`);

  const results = [];
  let filed = 0, failed = 0;
  for (const issue of toFile) {
    try {
      const r = await fileBug(issue);
      if (r.status === 'filed') filed++;
      else                       failed++;
      results.push({ ...issue, ...r });
    } catch (e) {
      console.log(`  ✗ Exception: ${issue.issueType} on ${issue.route} — ${e.message}`);
      failed++;
      results.push({ ...issue, status: 'error', error: e.message });
    }
    await new Promise(r => setTimeout(r, 200));  // small delay
  }

  fs.writeFileSync(BUGS_LOG, results.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\n  Summary: ${filed} filed, ${failed} failed`);
  console.log(`  Log: ${BUGS_LOG}\n`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
