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
const { execFileSync } = require('child_process');
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
const _planFile = path.join(RUN_DIR, 'audit-plan.json');
const _runPlan  = fs.existsSync(_planFile) ? JSON.parse(fs.readFileSync(_planFile, 'utf8')) : {};
const APP       = _runPlan.app || (CONFIG.apps && CONFIG.apps[0] && CONFIG.apps[0].name) || 'app';
const AREA     = CONFIG.ado.areaPath || PROJECT;
// Bug cap. DEFAULT = unlimited — file EVERY detected issue, never skip one.
// To re-enable a spam guard, set a positive integer via env QA_MAX_BUGS
// or automation.config.json → ado.max_bugs. A value of 0 / negative / unset = unlimited.
const _maxRaw = (process.env.QA_MAX_BUGS != null && process.env.QA_MAX_BUGS !== '')
  ? process.env.QA_MAX_BUGS
  : (CONFIG.ado && CONFIG.ado.max_bugs);
const _maxNum = parseInt(_maxRaw, 10);
const MAX_BUGS = (Number.isNaN(_maxNum) || _maxNum <= 0) ? Infinity : _maxNum;

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
  const baseUrl = _runPlan.baseUrl || (CONFIG.apps && CONFIG.apps[0] && CONFIG.apps[0].baseUrl) || '';
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

// ── Resolve a screenshot path to an existing absolute path ─────────────────
// The stored path may be: (a) absolute from a different install location,
// (b) a plain filename with no directory, or (c) a correct relative path.
// Strategy: try the stored path first; if missing, reconstruct from the
// known canonical location PROJECT_ROOT/.tmp/{RUN_ID}/screenshots/{basename}.
function resolveScreenshotPath(storedPath) {
  if (!storedPath) return null;
  const candidate1 = path.isAbsolute(storedPath)
    ? storedPath
    : path.join(PROJECT_ROOT, storedPath);
  if (fs.existsSync(candidate1)) return candidate1;
  // Fallback: rebuild from the basename alone
  const candidate2 = path.join(PROJECT_ROOT, '.tmp', RUN_ID, 'screenshots', path.basename(storedPath));
  return fs.existsSync(candidate2) ? candidate2 : null;
}

// ── Attach screenshot ──────────────────────────────────────────────────────
async function attachScreenshot(bugId, screenshotPath) {
  if (!screenshotPath) return 'no-path';
  const absPath = resolveScreenshotPath(screenshotPath);
  if (!absPath) return `file-missing:${path.basename(screenshotPath)}`;

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

  // Run annotation sweep first — stamps annotatedScreenshotPath into every JSONL
  // before we read issues, so file-bugs never depends on the orchestrator having
  // called annotate-cell.cjs during the audit (it often doesn't).
  const annotateScript = path.join(__dirname, 'annotate-cell.cjs');
  try {
    const out = execFileSync(process.execPath, [annotateScript, RUN_ID], { encoding: 'utf8' });
    console.log(`  [annotation] ${out.trim()}`);
  } catch (e) {
    if (e.status === 2) {
      // Some base PNGs missing — annotated what it could, will fall back to base for the rest
      console.log(`  [annotation] ${(e.stdout || '').trim()}`);
    } else if (e.status !== 5 && e.status !== 3) {
      console.log(`  [annotation] warning: ${e.message}`);
    }
  }

  // Load registered skill names from skill-probes.json (built by bundle-probes.cjs).
  // Any finding whose skill field is not in this set was invented by the model
  // (hallucinated skill like "qa-detect-multi") and must be rejected before filing.
  // ── FAIL CLOSED: the issueType/skill allowlist is the only thing standing
  //    between fabricated findings and ADO. If skill-probes.json is missing we do
  //    NOT "skip the filter and file everything" (the old behaviour that let 47 of
  //    119 fabricated-issueType bugs reach ADO in run-005). We rebuild it; if it
  //    still can't be produced, we ABORT — no gate means no filing.
  const probesFile = path.join(PROJECT_ROOT, '.tmp', RUN_ID, 'skill-probes.json');
  if (!fs.existsSync(probesFile)) {
    console.log('  [skill-filter] skill-probes.json missing — rebuilding via bundle-probes.cjs');
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'bundle-probes.cjs'), RUN_ID], { encoding: 'utf8' });
    } catch (e) {
      console.error(`  ✗ bundle-probes.cjs failed: ${e.message}`);
    }
  }
  if (!fs.existsSync(probesFile)) {
    console.error('\n  ✗ ABORT: skill-probes.json could not be produced. The anti-fabrication gate cannot run,');
    console.error('    so filing would let invented issueTypes through to ADO. Fix bundle-probes.cjs and re-run.');
    console.error('    (Filing nothing is correct here — a fake ticket is worse than a missing one.)\n');
    process.exit(1);
  }
  const validSkills = new Set();
  const issueTypesBySkill = new Map();   // skill name → Set of issueTypes it can actually emit
  try {
    const bundle = JSON.parse(fs.readFileSync(probesFile, 'utf8'));
    (bundle.skills || []).forEach(s => {
      validSkills.add(s.name);
      if (Array.isArray(s.issueTypes) && s.issueTypes.length) {
        issueTypesBySkill.set(s.name, new Set(s.issueTypes));
      }
    });
    console.log(`  [skill-filter] ${validSkills.size} registered skills loaded`);
    console.log(`  [issuetype-gate] ${issueTypesBySkill.size} skills have an issueType allowlist`);
  } catch (e) {
    console.error(`\n  ✗ ABORT: skill-probes.json is present but unparseable (${e.message}). Refusing to file without the gate.\n`);
    process.exit(1);
  }
  if (validSkills.size === 0) {
    console.error('\n  ✗ ABORT: skill-probes.json has 0 skills — the gate would pass everything. Refusing to file.\n');
    process.exit(1);
  }

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

  // Reject hallucinated skill names — findings from skills the model invented
  // (e.g. "qa-detect-multi") instead of running real registered skills.
  let afterSkillFilter = valid;
  if (validSkills.size > 0) {
    const hallucinated = valid.filter(i => !validSkills.has(i.skill));
    afterSkillFilter   = valid.filter(i =>  validSkills.has(i.skill));
    if (hallucinated.length > 0) {
      const fakeSkills = [...new Set(hallucinated.map(i => i.skill))].join(', ');
      console.log(`  ⚠ Rejected ${hallucinated.length} findings from unregistered skills: ${fakeSkills}`);
    }
    console.log(`  After skill filter: ${afterSkillFilter.length} real findings remain`);
  }

  // ── ISSUETYPE GATE (anti-fabrication) ────────────────────────────────────
  // A worker must emit ONLY the issueTypes its skill's probe/Issues-table defines.
  // Findings with an invented issueType (e.g. "elementExceedsViewport", which no
  // skill emits) are model fabrications — reject them. This is the deterministic
  // backstop for the qa-cell-worker "verbatim output" rule.
  if (issueTypesBySkill.size > 0) {
    const before = afterSkillFilter.length;
    const fabricated = [];
    afterSkillFilter = afterSkillFilter.filter(i => {
      const allow = issueTypesBySkill.get(i.skill);
      if (!allow) return true;                       // skill has no allowlist → don't gate
      if (allow.has(i.issueType)) return true;
      fabricated.push(i);
      return false;
    });
    if (fabricated.length > 0) {
      const byType = {};
      for (const f of fabricated) byType[`${f.skill}:${f.issueType}`] = (byType[`${f.skill}:${f.issueType}`] || 0) + 1;
      console.log(`  ⚠ Rejected ${fabricated.length} findings with FABRICATED issueTypes (skill cannot emit them):`);
      for (const [k, n] of Object.entries(byType)) console.log(`      ${k}  ×${n}`);
      console.log(`  After issuetype gate: ${afterSkillFilter.length} real findings remain (was ${before})`);
    }
  }

  // ── EVIDENCE GATE (no fake tickets without evidence) ─────────────────────
  // Every filed ticket must be backed by something a developer can verify.
  //   • producedBy === 'runner'  → deterministic Playwright probe, receipt-proven → trusted.
  //   • a numeric bbox           → annotated box pinpoints the element.
  //   • evidenceType             → a console / network DevTools-panel screenshot.
  //   • a concrete CSS selector  → the dev can locate the element.
  // A finding with NONE of these is an unanchored, model-authored claim — the exact
  // "fake ticket with no evidence" class. Drop it rather than file it.
  {
    const hasBbox     = i => i.bbox && typeof i.bbox.x === 'number';
    const realSel     = i => typeof i.selector === 'string' && i.selector.trim().length > 1 && i.selector !== 'null';
    const isEvidenced = i => i.producedBy === 'runner' || hasBbox(i) || i.evidenceType || i.interacted === true || realSel(i);
    const before = afterSkillFilter.length;
    const unverified = afterSkillFilter.filter(i => !isEvidenced(i));
    afterSkillFilter = afterSkillFilter.filter(isEvidenced);
    if (unverified.length > 0) {
      const byType = {};
      for (const u of unverified) byType[`${u.skill}:${u.issueType}`] = (byType[`${u.skill}:${u.issueType}`] || 0) + 1;
      console.log(`  ⚠ Rejected ${unverified.length} UNVERIFIED findings (no bbox, no evidence panel, no selector — not from the deterministic runner):`);
      for (const [k, n] of Object.entries(byType)) console.log(`      ${k}  ×${n}`);
      console.log(`  After evidence gate: ${afterSkillFilter.length} evidenced findings remain (was ${before})`);
    }
  }

  // Deduplicate — two passes:
  // Pass 1: same issueType + route + viewportClass + browser (exact cell duplicate)
  // Pass 2: same issueType + same description prefix across different routes
  //         (e.g. same JS error firing on 10 pages → one ticket, routes listed in description)
  const seen = new Map();
  const descSeen = new Map();
  const unique = [];
  let dups = 0;
  for (const issue of afterSkillFilter) {
    // Pass 1 — exact cell duplicate
    const cellKey = [issue.issueType, issue.route, issue.viewportClass, issue.browser].join('|');
    if (seen.has(cellKey)) { dups++; continue; }
    seen.set(cellKey, true);

    // Pass 2 — same error across routes: key on issueType + first 80 chars of description
    const descKey = issue.issueType + '|' + (issue.description || '').slice(0, 80);
    if (descSeen.has(descKey)) {
      // Merge this route into the winner's description instead of filing a new ticket
      const winner = descSeen.get(descKey);
      if (!winner._extraRoutes) winner._extraRoutes = [];
      winner._extraRoutes.push(issue.route);
      dups++;
      continue;
    }
    descSeen.set(descKey, issue);
    unique.push(issue);
  }
  // Append extra routes to merged tickets
  for (const issue of unique) {
    if (issue._extraRoutes && issue._extraRoutes.length > 0) {
      issue.description += `\n\nAlso occurs on: ${issue._extraRoutes.join(', ')}`;
      delete issue._extraRoutes;
    }
  }
  console.log(`  Deduplicated: ${unique.length} unique (${dups} duplicates/merges dropped)`);

  // Sort by severity
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  unique.sort((a, b) => (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2));

  const toFile = MAX_BUGS === Infinity ? unique : unique.slice(0, MAX_BUGS);
  if (MAX_BUGS !== Infinity && unique.length > MAX_BUGS) {
    console.log(`  ⚠ CAP ACTIVE: ${unique.length} unique issues but max_bugs=${MAX_BUGS} → ${unique.length - MAX_BUGS} will NOT be filed. Set QA_MAX_BUGS=0 (or ado.max_bugs=0) to file ALL.`);
  }
  console.log(`  Filing ${toFile.length} bugs${MAX_BUGS === Infinity ? ' (no cap — filing ALL detected issues)' : ` (cap: ${MAX_BUGS})`}\n`);

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
