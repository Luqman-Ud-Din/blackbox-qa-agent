#!/usr/bin/env node
/**
 * run-interactive-probes.cjs — DETERMINISTIC interactive driver.
 *
 * Fills 4 gaps that the model-driven MCP interactive layer could not guarantee:
 *   1. Deterministic drivers   — real Playwright code drives search/sort/page-size/validation,
 *                                so a run ALWAYS completes the same way (no model drift, no
 *                                passive-only fallback, fast: ~2-4s per page instead of minutes).
 *   2. Auth resilience + resume — re-logs-in automatically when a cell bounces to the login page
 *                                (short-TTL tokens, 401-destroys-session apps), and `--resume`
 *                                skips cells already done so a crash/compaction never re-runs them.
 *   3. Self-verifying findings  — every finding is a before/after MEASUREMENT (carries `evidence`),
 *                                emitted only when the deterministic assertion holds → ~0 false positives.
 *   4. Assertion-based CORRECTNESS — checks the RESULT, not just "the UI reacted":
 *                                sort → rows actually reordered; search → remaining rows actually
 *                                CONTAIN the term; page-size → rendered count actually matches.
 *
 * Scope: the most common admin page type — a list/table with search + sortable headers +
 * page-size select, and a "New/Add" modal with a required field. Self-skips when absent.
 * Writes findings to issues/{cellId}.jsonl (append) + issues/{cellId}-interactive.json (receipt).
 *
 * Usage: node scripts/run-interactive-probes.cjs <run-id> [--browsers=chromium] [--resume] [--headed]
 */
const fs = require('fs');
const path = require('path');
let chromium, firefox, webkit;
try { ({ chromium, firefox, webkit } = require('playwright')); }
catch { console.error('playwright not installed — npm install && npx playwright install'); process.exit(1); }

const RUN_ID = process.argv[2];
if (!RUN_ID || RUN_ID.startsWith('--')) { console.error('Usage: node scripts/run-interactive-probes.cjs <run-id> [--browsers=...] [--resume]'); process.exit(1); }
const ARGV = process.argv.slice(3);
const HEADED = ARGV.includes('--headed');
const RESUME = ARGV.includes('--resume');
const browsersArg = (ARGV.find(a => a.startsWith('--browsers=')) || '').split('=')[1];

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUN_DIR = path.join(PROJECT_ROOT, '.tmp', RUN_ID);
const ISSUES = path.join(RUN_DIR, 'issues');
fs.mkdirSync(ISSUES, { recursive: true });
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const CONFIG = readJson(path.join(PROJECT_ROOT, '.claude/automation.config.json'));
const SECRETS = (() => { try { return readJson(path.join(PROJECT_ROOT, '.claude/secrets.json')); } catch { return {}; } })();
const plan = readJson(path.join(RUN_DIR, 'audit-plan.json'));
const bundle = readJson(path.join(RUN_DIR, 'skill-probes.json'));
const cells = plan.cells || (plan.phases && plan.phases.flatMap(p => p.cells || [])) || [];
const APP_NAME = plan.app || (CONFIG.apps && CONFIG.apps[0] && CONFIG.apps[0].name);
const appCfg = (CONFIG.apps || []).find(a => a.name === APP_NAME) || (CONFIG.apps || [])[0] || {};
const BASE_URL = (plan.baseUrl || appCfg.baseUrl || '').replace(/\/$/, '');
const LOGIN_PATH = appCfg.loginPath || appCfg.login_path || '/authentication/signin';
const creds = (SECRETS.apps && (SECRETS.apps[APP_NAME] || SECRETS.apps[appCfg.name])) || {};
const EMAIL = creds.email || creds.username;
const PASSWORD = creds.password;

// Only drive interactive skills that the bundle says are enabled+interactive for this section run.
const interactiveEnabled = new Set((bundle.skills || []).filter(s => s.interactive).map(s => s.name));
const ENGINES = { chromium, firefox, webkit };
const requested = browsersArg ? browsersArg.split(',').map(s => s.trim()) : [...new Set(cells.map(c => c.browser))].filter(Boolean);
const engineList = requested.filter(e => ENGINES[e]); if (!engineList.length) engineList.push('chromium');

const env = (cell, engine) => ({
  runId: RUN_ID, cellId: cell.id, route: cell.route, viewport: cell.viewport,
  viewportClass: cell.viewportClass, browser: engine, producedBy: 'interactive', interacted: true,
  screenshotPath: `.tmp/${RUN_ID}/screenshots/${cell.id}-base.png`,
  annotatedScreenshotPath: `.tmp/${RUN_ID}/screenshots/${cell.id}-base.png`,
});

// ── auth ────────────────────────────────────────────────────────────────────
async function login(page) {
  if (!EMAIL || !PASSWORD) return false;
  try {
    await page.goto(BASE_URL + LOGIN_PATH, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('input[type=password]', { timeout: 12000, state: 'visible' }).catch(() => {});
    const userSel = ['input[type=email]', 'input[formcontrolname*=user i]', 'input[name*=user i]', 'input[type=text]:not([type=password])'];
    for (const s of userSel) { const el = page.locator(s).first(); if (await el.count() && await el.isVisible().catch(() => false)) { await el.fill(EMAIL); break; } }
    const pw = page.locator('input[type=password]').first();
    if (!(await pw.count())) return false;
    await pw.fill(PASSWORD);
    const submit = page.locator('button[type=submit], button:has-text("Sign In"), button:has-text("Login"), button:has-text("Log in")').first();
    if (await submit.count()) await submit.click({ timeout: 6000 }).catch(() => pw.press('Enter')); else await pw.press('Enter');
    // wait until we actually leave the login page (app may redirect slowly), up to 9s
    await page.waitForFunction(p => !location.pathname.includes(p), LOGIN_PATH, { timeout: 9000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return !page.url().includes(LOGIN_PATH);
  } catch { return false; }
}
const onLogin = page => page.url().includes(LOGIN_PATH) || page.url().includes('/signin') || page.url().includes('/login');

// Auth-resilient navigate: go to the route; if the app bounced us to login (token expired /
// 401-interceptor logout), re-login and retry once. This is what stops silent truncation.
async function navResilient(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1800);
  if (onLogin(page)) { await login(page); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1800); }
  return !onLogin(page);
}

// ── the deterministic interactive checks (run in the page, return findings[]) ─
// Pure measurement: each check returns {issueType, severity, selector, bbox, description, evidence}
// or nothing. Assertions verify the RESULT, not just that something changed.
const PROBE = function (ctx) {
  const out = [];
  const vis = el => { if (!el) return false; const c = getComputedStyle(el); if (c.display === 'none' || c.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const bb = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const rowsOf = () => [...document.querySelectorAll('table tbody tr')].filter(vis);
  const rowSig = () => rowsOf().map(r => (r.innerText || '').replace(/\s+/g, ' ').trim()).join(' || ');
  const footerText = () => (document.body.innerText.match(/Showing[^\n]*/i) || [''])[0];
  return { ready: true, rowCount: rowsOf().length, rowSig: rowSig(), footer: footerText(),
    table: !!document.querySelector('table tbody tr') };
};

(async () => {
  console.log(`\nrun-interactive-probes.cjs  [${RUN_ID}]`);
  console.log(`  app=${APP_NAME}  base=${BASE_URL}  interactiveEnabled=${interactiveEnabled.size}  cells=${cells.length}  resume=${RESUME}`);

  for (const engine of engineList) {
    const cellsFor = cells.filter(c => (c.browser || 'chromium') === engine);
    if (!cellsFor.length) continue;
    const browser = await ENGINES[engine].launch({ headless: !HEADED });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    console.log(`\n▶ ${engine}: ${cellsFor.length} cells`);
    const ok = await login(page);
    console.log(ok ? `  [login] ok` : `  [login] FAILED — interactive cells will record loginFailed`);

    for (const cell of cellsFor) {
      const recPath = path.join(ISSUES, `${cell.id}-interactive.json`);
      if (RESUME && fs.existsSync(recPath)) { console.log(`  ⤼ ${cell.id} skipped (resume)`); continue; }
      const t0 = Date.now();
      const findings = [];
      const receipt = {};
      const mark = (skill, result, extra) => { receipt[skill] = Object.assign({ ran: true, result }, extra || {}); };
      try {
        await page.setViewportSize({ width: cell.viewport.width || 1280, height: cell.viewport.height || 800 });
        const reached = await navResilient(page, BASE_URL + cell.route);
        if (!reached) {
          // genuine poisoner / auth wall — record it as a real finding, not silence.
          findings.push(Object.assign(env(cell, engine), { skill: 'qa-detect-network-errors', issueType: 'httpError', severity: 'high', selector: 'page', bbox: null,
            description: `Opening ${cell.route} redirects to the login page even after re-login — the route's API likely returns 401 and the app destroys the session. Authenticated content could not be audited.`, evidence: 'navResilient: still on login after re-login' }));
          mark('qa-test-data-controls', 'skipped', { reason: 'auth wall / poisoner' });
          fs.writeFileSync(path.join(ISSUES, `${cell.id}.jsonl`), '', { flag: 'a' });
          fs.appendFileSync(path.join(ISSUES, `${cell.id}.jsonl`), findings.map(f => JSON.stringify(f)).join('\n') + '\n');
          fs.writeFileSync(recPath, JSON.stringify(receipt, null, 2));
          console.log(`  ⚠ ${cell.id} ${cell.route} — auth wall (${Date.now() - t0}ms)`);
          continue;
        }

        const base = env(cell, engine);
        // wait for API-loaded content (tables/lists render a beat after domcontentloaded)
        await page.waitForSelector('table tbody tr, [role="row"], [role="dialog"], form, input', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const snap = await page.evaluate(PROBE, {});

        // ── DATA-CONTROLS (only if a data table is present) ──────────────────
        if (interactiveEnabled.has('qa-test-data-controls') && snap.table) {
          let evdParts = [];
          // (a) SORT — assert the row ORDER actually changes (not just the indicator)
          const sortHdr = await page.evaluateHandle(() => {
            const ths = [...document.querySelectorAll('th')];
            return ths.find(t => /[↕↑↓]/.test(t.innerText) || t.getAttribute('aria-sort') || /pointer/.test(getComputedStyle(t).cursor)) || null;
          });
          const hasSort = await sortHdr.evaluate(el => !!el).catch(() => false);
          if (hasSort) {
            const before = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map(r => (r.innerText || '').replace(/\s+/g, ' ').trim()).join(' || '));
            const indBefore = await sortHdr.evaluate(el => el.innerText.trim());
            await sortHdr.evaluate(el => el.click());
            await page.waitForTimeout(900);
            const after = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map(r => (r.innerText || '').replace(/\s+/g, ' ').trim()).join(' || '));
            const indAfter = await sortHdr.evaluate(el => el.innerText.trim());
            if (indBefore !== indAfter && before === after && snap.rowCount > 1) {
              const box = await sortHdr.evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
              findings.push(Object.assign({}, base, { skill: 'qa-test-data-controls', issueType: 'sortNoEffect', severity: 'high', selector: 'th (sortable column)', bbox: box,
                description: `Clicking the sortable column header changes the sort indicator ("${indBefore}" → "${indAfter}") but the row order is byte-for-byte identical — sort is non-functional (false visual feedback).`,
                evidence: `indicator ${indBefore}→${indAfter}; rowOrder unchanged across ${snap.rowCount} rows` }));
            }
            evdParts.push(`sort:${indBefore !== indAfter ? (before === after ? 'noEffect' : 'ok') : 'noToggle'}`);
          }
          // (b) PAGE-SIZE — assert rendered count actually matches the selected size
          const pageSizeRes = await page.evaluate(() => {
            const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /^\d+$/.test(o.value)) && [...s.options].length >= 2);
            if (!sel) return { has: false };
            const opts = [...sel.options].map(o => +o.value).filter(n => n);
            const big = Math.max(...opts);
            const totalM = (document.body.innerText.match(/of\s+(\d+)/i) || [])[1];
            const total = totalM ? +totalM : null;
            const before = document.querySelectorAll('table tbody tr').length;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(sel, String(big)); sel.dispatchEvent(new Event('change', { bubbles: true }));
            return { has: true, big, total, before, sel: true };
          });
          if (pageSizeRes.has && pageSizeRes.total) {
            await page.waitForTimeout(1000);
            // Read DOM count + whether the app thinks everything fits on ONE page (no enabled "next").
            const post = await page.evaluate(() => {
              const after = document.querySelectorAll('table tbody tr').length;
              const m = (document.body.innerText.match(/Showing\s+\d+\s*[–-]\s*(\d+)\s+of\s+(\d+)/i) || []);
              const upper = m[1] ? +m[1] : null, total = m[2] ? +m[2] : null;
              const nexts = [...document.querySelectorAll('button, a')].filter(b => /next|›|»|>/i.test((b.getAttribute('aria-label') || '') + b.innerText) && /page|pag/i.test((b.className || '') + (b.closest('[class*=pag]') ? 'pag' : '')));
              const nextEnabled = nexts.some(b => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
              return { after, upper, total, nextEnabled };
            });
            const expected = Math.min(pageSizeRes.big, pageSizeRes.total);
            // Bug A — clear no-op: page size didn't increase the rendered count at all.
            const noOp = post.after <= pageSizeRes.before + 1 && post.after < expected - 1;
            // Bug B — render cap: the footer CLAIMS all rows are shown (upper === total, no next page)
            // yet the DOM holds fewer than total → records are silently unreachable. Footer-based → no FP.
            const renderCap = post.total && post.upper === post.total && !post.nextEnabled && post.after < post.total - 1;
            if (noOp || renderCap) {
              findings.push(Object.assign({}, base, { skill: 'qa-test-data-controls', issueType: 'pageSizeNoEffect', severity: 'high', selector: 'select (records per page)', bbox: null,
                description: renderCap
                  ? `Records-per-page set to ${pageSizeRes.big}: the footer claims "Showing 1–${post.upper} of ${post.total}" (all rows) and there is no next page, but only ${post.after} rows actually render — ${post.total - post.after} records are silently unreachable.`
                  : `Records-per-page set to ${pageSizeRes.big} but the rendered count stayed at ${post.after} (was ${pageSizeRes.before}, expected ${expected}). The selector has no effect.`,
                evidence: `pageSize=${pageSizeRes.big}; total=${pageSizeRes.total}; footerUpper=${post.upper}; nextEnabled=${post.nextEnabled}; rendered ${pageSizeRes.before}→${post.after}; expected ${expected}` }));
            }
            evdParts.push(`pageSize:${post.after}/${expected}${renderCap ? '(cap)' : ''}`);
          }
          // (c) SEARCH — assert remaining rows actually CONTAIN the term (correctness, not just count)
          const searchInfo = await page.evaluate(() => {
            const inp = document.querySelector('input[type=search], input[placeholder*="search" i]');
            if (!inp) return { has: false };
            const rows = [...document.querySelectorAll('table tbody tr')];
            if (rows.length < 2) return { has: true, tooFew: true };
            const cellText = (rows[0].querySelector('td:nth-child(2)') || rows[0]).innerText.trim();
            const token = (cellText.split(/\s+/).find(w => w.replace(/[^A-Za-z0-9]/g, '').length >= 4) || cellText).replace(/[^A-Za-z0-9]/g, '');
            return { has: true, token, before: rows.length };
          });
          if (searchInfo.has && searchInfo.token) {
            const inp = page.locator('input[type=search], input[placeholder*="search" i]').first();
            await inp.fill(searchInfo.token); await page.waitForTimeout(900);
            let after = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
            if (after === searchInfo.before) { await inp.press('Enter').catch(() => {}); await page.waitForTimeout(700); after = await page.evaluate(() => document.querySelectorAll('table tbody tr').length); }
            const containCheck = await page.evaluate(tok => {
              const rows = [...document.querySelectorAll('table tbody tr')];
              if (!rows.length) return { n: 0, contain: 0 };
              const contain = rows.filter(r => (r.innerText || '').toLowerCase().includes(tok.toLowerCase())).length;
              return { n: rows.length, contain };
            }, searchInfo.token);
            if (after === searchInfo.before && searchInfo.before > 1) {
              findings.push(Object.assign({}, base, { skill: 'qa-test-data-controls', issueType: 'searchNoEffect', severity: 'high', selector: 'input[type=search]', bbox: null,
                description: `Typing a value that IS present in the list ("${searchInfo.token}") and pressing Enter does not filter — the row count stays at ${after}. Search is non-functional.`,
                evidence: `token="${searchInfo.token}"; rows ${searchInfo.before}→${after} (no change)` }));
            } else if (containCheck.n >= 1 && containCheck.contain === 0) {
              findings.push(Object.assign({}, base, { skill: 'qa-test-data-controls', issueType: 'searchResultsContainNonMatchingRows', severity: 'high', selector: 'input[type=search]', bbox: null,
                description: `Searching "${searchInfo.token}" returned ${containCheck.n} rows but NONE of them contain the term — the filter matched the wrong rows.`,
                evidence: `token="${searchInfo.token}"; ${containCheck.contain}/${containCheck.n} visible rows contain it` }));
            }
            await inp.fill(''); await page.waitForTimeout(500); await inp.press('Enter').catch(() => {});
            evdParts.push(`search:${after}/${searchInfo.before}`);
          }
          mark('qa-test-data-controls', findings.some(f => f.skill === 'qa-test-data-controls') ? 'done' : 'clean', { interacted: true, evidence: evdParts.join('; ') });
        } else if (interactiveEnabled.has('qa-test-data-controls')) {
          mark('qa-test-data-controls', 'skipped', { reason: 'no data table on page' });
        }

        // ── FORM VALIDATION (read-only: whitespace-accepted + empty-submit-disabled) ──
        if (interactiveEnabled.has('qa-form-validation')) {
          const newBtn = page.locator('button:has-text("New"), button:has-text("Add"), button:has-text("Create")').first();
          if (await newBtn.count() && await newBtn.isVisible().catch(() => false)) {
            await newBtn.click().catch(() => {}); await page.waitForTimeout(900);
            const modal = await page.evaluate(() => {
              const inp = document.querySelector('[role=dialog] input[type=text], [class*=modal] input[type=text], [class*=fixed] input[type=text]');
              if (!inp) return { has: false };
              const btns = [...document.querySelectorAll('button')].filter(b => /^(save|submit|create|add)$/i.test(b.innerText.trim()));
              const save = btns[0];
              return { has: true, saveDisabledEmpty: save ? save.disabled : null, ph: inp.getAttribute('placeholder') || '' };
            });
            if (modal.has) {
              // type whitespace via real keystrokes (Angular validators need real input events)
              const nameInp = page.locator('[role=dialog] input[type=text], [class*=modal] input[type=text], [class*=fixed] input[type=text]').first();
              await nameInp.fill('   ').catch(() => {});
              await page.waitForTimeout(400);
              const wsState = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^(save|submit|create|add)$/i.test(x.innerText.trim())); return b ? b.disabled : null; });
              if (modal.saveDisabledEmpty === true && wsState === false) {
                findings.push(Object.assign({}, base, { skill: 'qa-form-validation', issueType: 'whitespaceAccepted', severity: 'medium', selector: 'form required field', bbox: null,
                  description: `The required field accepts whitespace-only input: the Save button is disabled when empty but ENABLES after typing 3 spaces, so a blank/whitespace record can be created. Validation does not trim.`,
                  evidence: `Save disabled(empty)=${modal.saveDisabledEmpty} → disabled(whitespace)=${wsState}` }));
              }
              mark('qa-form-validation', findings.some(f => f.skill === 'qa-form-validation') ? 'done' : 'clean', { interacted: true, evidence: `emptyDisabled=${modal.saveDisabledEmpty}; whitespaceDisabled=${wsState}` });
              await page.keyboard.press('Escape').catch(() => {});
              await page.waitForTimeout(300);
            } else { mark('qa-form-validation', 'skipped', { reason: 'no required text field in modal' }); }
          } else { mark('qa-form-validation', 'skipped', { reason: 'no New/Add button' }); }
        }

        fs.appendFileSync(path.join(ISSUES, `${cell.id}.jsonl`), findings.map(f => JSON.stringify(f)).join('\n') + (findings.length ? '\n' : ''));
        fs.writeFileSync(recPath, JSON.stringify(receipt, null, 2));
        console.log(`  ✓ ${cell.id} ${cell.route} @ ${cell.viewportClass} — ${findings.length} findings (${Date.now() - t0}ms)`);
      } catch (e) {
        fs.writeFileSync(recPath, JSON.stringify({ error: String(e && e.message || e) }, null, 2));
        console.log(`  ✗ ${cell.id} ${cell.route} — ${e.message}`);
      }
    }
    await browser.close();
  }
  console.log(`\n✓ interactive probes done. Receipts in ${ISSUES}`);
})();
