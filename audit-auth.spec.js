// @ts-check
/**
 * QA Sentinel — Authenticated Full-Site Audit
 * Run: npx playwright test audit-auth.spec.js --config=playwright-auth.config.js
 */
const { test } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
// Configure via environment variables or edit these defaults.
const BASE_URL    = process.env.BASE_URL    || 'http://localhost:3000';
const EMAIL       = process.env.APP_EMAIL   || '';
const PASSWORD    = process.env.APP_PASSWORD || '';
const APP_NAME    = process.env.APP_NAME    || 'my-app';
const RUN_ID      = process.env.RUN_ID      || ('qa-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-001');
const ROOT        = path.resolve(__dirname);
const OUTPUT_DIR  = path.join(ROOT, '.tmp', RUN_ID);
const ISSUES_DIR  = path.join(OUTPUT_DIR, 'issues', APP_NAME);
const SHOTS_DIR   = path.join(OUTPUT_DIR, 'screenshots');

// Add your app's routes here.
// needsAuth: false  → tested before login
// needsAuth: true   → tested after login
const ROUTES = [
  { path: '/login',     phase: 1, needsAuth: false },
  { path: '/dashboard', phase: 3, needsAuth: true  },
  { path: '/profile',   phase: 3, needsAuth: true  },
];

const VIEWPORTS = [
  { name: 'mobile',  width: 375,  height: 667,  deviceClass: 'mobile'  },
  { name: 'tablet',  width: 768,  height: 1024, deviceClass: 'tablet'  },
  { name: 'laptop',  width: 1280, height: 800,  deviceClass: 'laptop'  },
  { name: 'desktop', width: 1920, height: 1080, deviceClass: 'desktop' },
];

// ── Floor detection code (runs inside page.evaluate) ──────────────────────────
// Each returns an array of issue objects.

const TOUCH_FLOOR = `
(function(cfg) {
  if (cfg.deviceClass !== 'mobile' && cfg.deviceClass !== 'tablet') return [];
  const MIN_TAP = 44, MIN_GAP = 8, MIN_EDGE = 20;
  const issues = [];
  function isInteractive(el) {
    const t = el.tagName.toUpperCase();
    if (['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL'].includes(t)) return true;
    const role = (el.getAttribute('role')||'').toLowerCase();
    if (['button','checkbox','radio','switch','tab','menuitem','option','link'].includes(role)) return true;
    if (el.onclick || (el.getAttribute('tabindex') && +el.getAttribute('tabindex') > 0)) return true;
    return false;
  }
  function sel(el) {
    if (el.id) return '#'+el.id;
    const lbl = el.getAttribute('aria-label') || el.textContent.trim().slice(0,30);
    return el.tagName.toLowerCase()+(lbl?'[label="'+lbl+'"]':'');
  }
  const visible = Array.from(document.querySelectorAll('*')).filter(el => {
    if (!isInteractive(el)) return false;
    const st = getComputedStyle(el);
    if (st.display==='none'||st.visibility==='hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width>0 && r.height>0;
  });
  const vw=window.innerWidth, vh=window.innerHeight;
  for (const el of visible) {
    try {
      const r = el.getBoundingClientRect();
      const s = sel(el);
      if (r.width<MIN_TAP || r.height<MIN_TAP) {
        issues.push({type:'touchTargetTooSmall',severity:'medium',
          description:'Touch target "'+s+'" is '+Math.round(r.width)+'x'+Math.round(r.height)+'px — below 44px minimum (Apple HIG/WCAG 2.5.5)',selector:s});
      }
      const edges=[{name:'left',dist:r.left},{name:'top',dist:r.top},{name:'right',dist:vw-r.right},{name:'bottom',dist:vh-r.bottom}];
      const near=edges.reduce((a,b)=>a.dist<b.dist?a:b);
      if (near.dist>=0 && near.dist<MIN_EDGE) {
        issues.push({type:'touchTargetNearEdge',severity:'medium',
          description:'Touch target "'+s+'" is '+Math.round(near.dist)+'px from '+near.name+' edge — OS gestures/device cases interfere',selector:s});
      }
    } catch(e){}
  }
  const parents=new Set(visible.map(el=>el.parentElement));
  for (const p of parents) {
    if (!p) continue;
    const sibs=visible.filter(el=>el.parentElement===p);
    for (let i=0;i<sibs.length;i++) for (let j=i+1;j<sibs.length;j++) {
      try {
        const a=sibs[i].getBoundingClientRect(), b=sibs[j].getBoundingClientRect();
        const dx=Math.max(0,Math.max(a.left,b.left)-Math.min(a.right,b.right));
        const dy=Math.max(0,Math.max(a.top,b.top)-Math.min(a.bottom,b.bottom));
        const gap=Math.sqrt(dx*dx+dy*dy);
        const sA=sel(sibs[i]),sB=sel(sibs[j]);
        if (gap===0) issues.push({type:'touchTargetSpacing',severity:'high',description:'Touch targets "'+sA+'" and "'+sB+'" overlap — tap ambiguous',selector:sA});
        else if (gap<MIN_GAP) issues.push({type:'touchTargetSpacing',severity:'medium',description:'Touch targets "'+sA+'" and "'+sB+'" are '+Math.round(gap)+'px apart — below 8px minimum (Apple HIG)',selector:sA});
      } catch(e){}
    }
  }
  return issues;
})(cfg)`;

const TYPOGRAPHY_FLOOR = `
(function(cfg) {
  const issues = [];
  const FLOOR_CONTRAST = 2.0;
  function parseRgb(s) { const m=s.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); return m?[+m[1],+m[2],+m[3]]:null; }
  function lum([r,g,b]) { return [r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}).reduce((s,c,i)=>s+c*[0.2126,0.7152,0.0722][i],0); }
  function cr(fg,bg) { const l1=lum(fg),l2=lum(bg); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); }
  let count=0;
  for (const el of document.querySelectorAll('p,span,a,button,label,h1,h2,h3,h4,h5,h6,li,td,th')) {
    if (count>=15) break;
    try {
      const st=getComputedStyle(el);
      if (st.display==='none'||st.visibility==='hidden') continue;
      if (!el.textContent.trim()) continue;
      const rect=el.getBoundingClientRect();
      if (rect.width===0&&rect.height===0) continue;
      const fg=parseRgb(st.color), bg=parseRgb(st.backgroundColor);
      if (!fg||!bg) continue;
      const ratio=Math.round(cr(fg,bg)*100)/100;
      if (ratio<FLOOR_CONTRAST) {
        const s=el.id?'#'+el.id:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/)[0]:'');
        issues.push({type:'invisibleText',severity:'high',description:'Text contrast '+ratio.toFixed(2)+':1 is below '+FLOOR_CONTRAST+':1 — functionally unreadable',selector:s});
        count++;
      }
    } catch(e){}
  }
  return issues;
})(cfg)`;

const A11Y_FLOOR = `
(function(cfg) {
  const issues = [];
  const vpMeta=document.querySelector('meta[name="viewport"]');
  if (!vpMeta) {
    issues.push({type:'viewportMetaMissing',severity:'high',description:'No <meta name="viewport"> — mobile browsers render at desktop width, breaking responsive CSS',selector:'head'});
  } else if (/user-scalable\\s*=\\s*no/i.test(vpMeta.getAttribute('content')||'')) {
    issues.push({type:'viewportMetaMissing',severity:'high',description:'<meta name="viewport"> has user-scalable=no — prevents zoom, fails WCAG 1.4.4',selector:'meta[name="viewport"]'});
  }
  const skip=new Set(['hidden','submit','button','reset','image']);
  for (const inp of document.querySelectorAll('input,textarea,select')) {
    try {
      const type=(inp.getAttribute('type')||'').toLowerCase();
      if (skip.has(type)) continue;
      const st=getComputedStyle(inp);
      if (st.display==='none'||st.visibility==='hidden') continue;
      const r=inp.getBoundingClientRect();
      if (r.width===0&&r.height===0) continue;
      const id=inp.id;
      if (!( (id&&document.querySelector('label[for="'+id+'"]')) || inp.closest('label') || inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby') )) {
        const s=inp.id?'#'+inp.id:inp.tagName.toLowerCase()+(inp.getAttribute('type')?'[type="'+inp.getAttribute('type')+'"]':'');
        const hasPH=!!inp.getAttribute('placeholder');
        issues.push({type:'inputMissingLabel',severity:'medium',description:s+(hasPH?' has placeholder only — placeholder disappears when typing, not announced by screen readers as a label':' has no label, aria-label, or aria-labelledby'),selector:s});
      }
    } catch(e){}
  }
  return issues;
})(cfg)`;

const LAYOUT_FLOOR = `
(function(cfg) {
  const issues = [];
  const MIN_ELS=3, ERROR_KW=['404','not found','page not found','error','forbidden','403','500','unavailable'], MAX_WORDS=40;
  function countVis() {
    let n=0;
    for (const el of document.querySelectorAll('p,h1,h2,h3,h4,img,table,form,ul,ol,article,section,main,[role="main"]')) {
      const st=getComputedStyle(el);
      if (st.display==='none'||st.visibility==='hidden') continue;
      const r=el.getBoundingClientRect();
      if (r.width>0&&r.height>0) n++;
    }
    return n;
  }
  const vis=countVis();
  if (vis<MIN_ELS) {
    issues.push({type:'emptyPage',severity:'high',description:'Page appears empty — only '+vis+' visible content element(s) — likely a failed render or broken route',selector:'body'});
  } else {
    const txt=(document.body.innerText||'').trim().toLowerCase();
    const wc=txt.split(/\\s+/).filter(Boolean).length;
    if (wc<=MAX_WORDS) {
      const kw=ERROR_KW.find(k=>txt.includes(k));
      if (kw) issues.push({type:'http404Content',severity:'high',description:'Page looks like an error page — keyword "'+kw+'" with only '+wc+' words',selector:'body'});
    }
  }
  return issues;
})(cfg)`;

const IMAGES_FLOOR = `
(function(cfg) {
  const issues = [];
  function sel(img) {
    if (img.id) return '#'+img.id;
    const cls=img.className&&typeof img.className==='string'?'.'+img.className.trim().split(/\\s+/)[0]:'';
    return cls?'img'+cls:'img';
  }
  for (const img of document.querySelectorAll('img')) {
    try {
      const st=getComputedStyle(img);
      if (st.display==='none'||st.visibility==='hidden') continue;
      const r=img.getBoundingClientRect();
      if (r.width===0&&r.height===0) continue;
      if (img.complete&&img.naturalWidth===0&&img.src&&!img.src.startsWith('data:')) {
        issues.push({type:'brokenImage',severity:'high',description:'Image failed to load: "'+img.getAttribute('src')+'"',selector:sel(img)});
        continue;
      }
      const alt=img.getAttribute('alt');
      if (alt===null) {
        issues.push({type:'missingAltText',severity:'medium',description:'Image missing alt attribute — invisible to screen readers',selector:sel(img)});
      } else if (alt!==''&&/\\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i.test(alt.trim())) {
        issues.push({type:'missingAltText',severity:'low',description:'Image alt text looks like a filename: "'+alt.slice(0,50)+'"',selector:sel(img)});
      }
    } catch(e){}
  }
  return issues;
})(cfg)`;

// Combine all floor checks into one page.evaluate call
const ALL_FLOOR_CODE = `
(function(cfg) {
  const out = [];
  out.push(...(${TOUCH_FLOOR}));
  out.push(...(${TYPOGRAPHY_FLOOR}));
  out.push(...(${A11Y_FLOOR}));
  out.push(...(${LAYOUT_FLOOR}));
  out.push(...(${IMAGES_FLOOR}));
  return out;
})(cfg)
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function shotKey(routePath, vpName) {
  return APP_NAME + '__' + routePath.replace(/\//g, '_') + '__' + vpName;
}

function writeIssues(routePath, vpName, issues) {
  const dir = path.join(ISSUES_DIR, routePath);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, vpName + '.jsonl');
  const lines = issues.map(i => JSON.stringify(i));
  fs.writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''));
}

// ── Test ──────────────────────────────────────────────────────────────────────
test.setTimeout(600_000);

test('QA Sentinel — authenticated full audit', async ({ browser }) => {
  // Ensure output dirs exist
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.mkdirSync(ISSUES_DIR, { recursive: true });

  const allSummary = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🔍 Viewport: ${vp.name} (${vp.width}×${vp.height})`);
    console.log(`${'═'.repeat(60)}`);

    // Fresh browser context per viewport
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // ── Collect console errors ───────────────────────────────────────────────
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push({ text: msg.text(), location: msg.location() });
      }
    });
    page.on('pageerror', err => {
      consoleErrors.push({ text: err.message, stack: err.stack });
    });

    // ── Collect network errors & slow requests ───────────────────────────────
    const networkIssues = [];
    const requestTimes = new Map();
    page.on('request', req => requestTimes.set(req.url(), Date.now()));
    page.on('requestfailed', req => {
      networkIssues.push({
        type: 'requestFailed',
        url: req.url(),
        reason: req.failure()?.errorText || 'unknown',
      });
    });
    page.on('response', resp => {
      const start = requestTimes.get(resp.url());
      const dur = start ? Date.now() - start : 0;
      const status = resp.status();
      if (status >= 400) {
        networkIssues.push({ type: 'httpError', url: resp.url(), status, dur });
      } else if (dur > 3000) {
        networkIssues.push({ type: 'slowRequest', url: resp.url(), status, dur });
      }
    });

    // ── Step 1: Audit public/login routes (unauthenticated) ──────────────────
    for (const route of ROUTES.filter(r => !r.needsAuth)) {
      consoleErrors.length = 0;
      networkIssues.length = 0;

      const url = BASE_URL + route.path;
      console.log(`  [${vp.name}] ${route.path} …`);

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForTimeout(1500);
      } catch (e) {
        console.warn(`    ⚠ Navigation failed: ${e.message}`);
        continue;
      }

      // Screenshot
      const key = shotKey(route.path, vp.name);
      const shotPath = path.join(SHOTS_DIR, key + '.png');
      await page.screenshot({ path: shotPath, fullPage: false });

      // Floor checks
      let domIssues = [];
      try {
        domIssues = await page.evaluate(
          new Function('cfg', `return (${ALL_FLOOR_CODE})`),
          { deviceClass: vp.deviceClass }
        );
      } catch (e) {
        console.warn(`    ⚠ Floor checks failed: ${e.message}`);
      }

      // Build console error issues
      const consoleIssues = consoleErrors.slice(0, 10).map(e => ({
        type: 'consoleError',
        severity: 'high',
        description: e.text.slice(0, 200),
        selector: null,
      }));

      // Build network issues
      const netIssues = networkIssues.slice(0, 20).map(n => ({
        type: n.type === 'slowRequest' ? 'slowRequest'
             : n.type === 'httpError'   ? 'httpError'
             : 'requestFailed',
        severity: n.type === 'httpError' && n.status >= 500 ? 'high' : 'medium',
        description: n.type === 'slowRequest'
          ? `GET ${n.url.slice(0, 100)} took ${n.dur}ms — exceeds 3000ms`
          : n.type === 'httpError'
          ? `HTTP ${n.status} — ${n.url.slice(0, 100)}`
          : `Request failed: ${n.url.slice(0, 100)} (${n.reason})`,
        selector: null,
        extra: { url: n.url, status: n.status || null, durationMs: n.dur || null },
      }));

      const allIssues = [...domIssues, ...consoleIssues, ...netIssues].map(i => ({
        ...i,
        app: APP_NAME,
        route: route.path,
        viewport: vp.name,
        browser: 'chromium',
        screenshotPath: shotPath,
      }));

      writeIssues(route.path, vp.name, allIssues);
      allSummary.push({ route: route.path, viewport: vp.name, count: allIssues.length, issues: allIssues });
      console.log(`    → ${allIssues.length} issues`);
    }

    // ── Step 2: Login ─────────────────────────────────────────────────────────
    console.log(`\n  [${vp.name}] 🔐 Logging in …`);
    let authenticated = false;
    try {
      await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle', timeout: 20_000 });
      await page.waitForTimeout(1000);

      // Fill email
      for (const sel of ['#email', 'input[type="email"]', 'input[name="email"]']) {
        if (await page.locator(sel).count() > 0) {
          await page.locator(sel).first().fill(EMAIL);
          break;
        }
      }
      // Fill password
      for (const sel of ['#password', 'input[type="password"]', 'input[name="password"]']) {
        if (await page.locator(sel).count() > 0) {
          await page.locator(sel).first().fill(PASSWORD);
          break;
        }
      }
      // Submit
      for (const sel of ['button[type="submit"]', 'button.btn-login', 'button:has-text("Login")', 'button:has-text("Sign In")']) {
        if (await page.locator(sel).count() > 0) {
          await Promise.all([
            page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15_000 }).catch(() => null),
            page.locator(sel).first().click(),
          ]);
          break;
        }
      }
      await page.waitForTimeout(2000);
      authenticated = !page.url().includes('/login');
      console.log(`  [${vp.name}] Auth: ${authenticated ? '✅ SUCCESS — ' + page.url() : '❌ FAILED — still at ' + page.url()}`);
    } catch (e) {
      console.warn(`  [${vp.name}] Auth failed: ${e.message}`);
    }

    // ── Step 3: Audit authenticated routes ────────────────────────────────────
    for (const route of ROUTES.filter(r => r.needsAuth)) {
      consoleErrors.length = 0;
      networkIssues.length = 0;

      const url = BASE_URL + route.path;
      console.log(`  [${vp.name}] ${route.path} ${authenticated ? '' : '(unauthenticated)'} …`);

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForTimeout(2000);
      } catch (e) {
        console.warn(`    ⚠ Navigation failed: ${e.message}`);
        continue;
      }

      // Detect redirect back to login
      const finalUrl = page.url();
      const redirectedToLogin = finalUrl.includes('/login');
      if (redirectedToLogin && authenticated) {
        console.warn(`    ⚠ Redirected to login — session may have expired`);
      }

      // Screenshot
      const key = shotKey(route.path, vp.name);
      const shotPath = path.join(SHOTS_DIR, key + '.png');
      await page.screenshot({ path: shotPath, fullPage: false });

      // Floor checks
      let domIssues = [];
      try {
        domIssues = await page.evaluate(
          new Function('cfg', `return (${ALL_FLOOR_CODE})`),
          { deviceClass: vp.deviceClass }
        );
      } catch (e) {
        console.warn(`    ⚠ Floor checks failed: ${e.message}`);
      }

      // Tag redirect-to-login as an issue if it happened
      if (redirectedToLogin) {
        domIssues.unshift({
          type: 'authRedirect',
          severity: 'high',
          description: `Route "${route.path}" redirected to /login — authenticated session not maintained or route guard blocking`,
          selector: null,
        });
      }

      // Console + network issues
      const consoleIssues = consoleErrors.slice(0, 10).map(e => ({
        type: 'consoleError',
        severity: 'high',
        description: e.text.slice(0, 200),
        selector: null,
      }));

      const netIssues = networkIssues.slice(0, 20).map(n => ({
        type: n.type === 'slowRequest' ? 'slowRequest'
             : n.type === 'httpError'   ? 'httpError'
             : 'requestFailed',
        severity: n.type === 'httpError' && n.status >= 500 ? 'high' : 'medium',
        description: n.type === 'slowRequest'
          ? `GET ${n.url.slice(0, 100)} took ${n.dur}ms — exceeds 3000ms`
          : n.type === 'httpError'
          ? `HTTP ${n.status} — ${n.url.slice(0, 100)}`
          : `Request failed: ${n.url.slice(0, 100)} (${n.reason})`,
        selector: null,
        extra: { url: n.url, status: n.status || null, durationMs: n.dur || null },
      }));

      const allIssues = [...domIssues, ...consoleIssues, ...netIssues].map(i => ({
        ...i,
        app: APP_NAME,
        route: route.path,
        viewport: vp.name,
        browser: 'chromium',
        authenticated,
        screenshotPath: shotPath,
      }));

      writeIssues(route.path, vp.name, allIssues);
      allSummary.push({ route: route.path, viewport: vp.name, count: allIssues.length, issues: allIssues });
      console.log(`    → ${allIssues.length} issues`);
    }

    await context.close();
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🔍 QA Sentinel — Run ${RUN_ID} Complete`);
  console.log(`${'═'.repeat(70)}`);
  const total = allSummary.reduce((s, r) => s + r.count, 0);
  console.log(`Total issues: ${total}\n`);

  // Write combined all-issues.json
  const allIssues = allSummary.flatMap(r => r.issues);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'all-issues.json'), JSON.stringify(allIssues, null, 2));

  // Summary by route
  const routeSummary = {};
  for (const s of allSummary) {
    if (!routeSummary[s.route]) routeSummary[s.route] = { total: 0, byVp: {} };
    routeSummary[s.route].total += s.count;
    routeSummary[s.route].byVp[s.viewport] = s.count;
  }
  console.log('Route                                    | Mobile | Tablet | Laptop | Desktop | Total');
  console.log('─'.repeat(95));
  for (const [route, data] of Object.entries(routeSummary)) {
    const m = data.byVp['mobile']  || 0;
    const t = data.byVp['tablet']  || 0;
    const l = data.byVp['laptop']  || 0;
    const d = data.byVp['desktop'] || 0;
    console.log(`${route.padEnd(40)} | ${String(m).padStart(6)} | ${String(t).padStart(6)} | ${String(l).padStart(6)} | ${String(d).padStart(7)} | ${data.total}`);
  }
  console.log(`${'═'.repeat(95)}`);
});
