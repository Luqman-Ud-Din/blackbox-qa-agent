#!/usr/bin/env node
// PERMANENT. Reads customize.toml -> enabled skills; for each, extracts frontmatter + first
// ```js probe + issueTypes; writes .tmp/<run-id>/skill-probes.json. SKILLS-ONLY, no model memory.
// Usage: node scripts/bundle-probes.cjs <run-id>
'use strict';
const fs = require('fs');
const path = require('path');

const RUN_ID = process.argv[2];
if (!RUN_ID) { console.error('Usage: node scripts/bundle-probes.cjs <run-id>'); process.exit(1); }

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR   = path.join(PROJECT_ROOT, 'skills');
const TOML         = path.join(SKILLS_DIR, 'qa-argus', 'customize.toml');
const OUT          = path.join(PROJECT_ROOT, '.tmp', RUN_ID, 'skill-probes.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const toml = fs.readFileSync(TOML, 'utf8');
const enabled = [];
for (const raw of toml.split('\n')) {
  const line = raw.split('#')[0].trim();
  const m = line.match(/^(qa-[\w-]+)\s*=\s*true\b/);
  if (m) enabled.push(m[1]);
}

function frontmatter(content) {
  const s = content.indexOf('---'); if (s === -1) return {};
  const e = content.indexOf('---', s + 3); if (e === -1) return {};
  const fm = {};
  for (const raw of content.slice(s + 3, e).split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const c = line.indexOf(':'); if (c === -1) continue;
    const k = line.slice(0, c).trim();
    let v = line.slice(c + 1).trim().replace(/^["']|["']$/g, '');
    if (v === 'true') v = true; else if (v === 'false') v = false;
    else if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    fm[k] = v;
  }
  return fm;
}
function firstJsBlock(content) {
  const s = content.indexOf('```js'); if (s === -1) return null;
  const e = content.indexOf('```', s + 5); if (e === -1) return null;
  return content.slice(s + 5, e).trim();
}
function issueTypes(content, probe) {
  const set = new Set();
  const re = /issueType\s*:\s*['"]([A-Za-z0-9_]+)['"]/g; let m;
  if (probe) while ((m = re.exec(probe))) set.add(m[1]);
  const ix = content.indexOf('## Issues');
  if (ix !== -1) for (const line of content.slice(ix).split('\n')) {
    const t = line.match(/^\|\s*`?([a-zA-Z][A-Za-z0-9_]+)`?\s*\|/);
    if (t && !/issueType|severity|---/.test(t[1])) set.add(t[1]);
  }
  return [...set];
}

// BUG 5: a probe is "plain-callable" only if it begins with an arrow/function expression.
// The judgment/MCP-sequence/multi-mode skills carry prose or IIFEs that throw when called as
// new Function('return '+probe)() — tag them so workers/injector SKIP them (no wasted erroring calls).
const isCallable = probe => !!probe && /^\s*(async\s+)?(\(|function)/.test(probe);

const skills = [];
for (const name of enabled) {
  const p = path.join(SKILLS_DIR, name, 'SKILL.md');
  if (!fs.existsSync(p)) continue;
  const content = fs.readFileSync(p, 'utf8');
  const fm = frontmatter(content);
  const probe = firstJsBlock(content);
  skills.push({
    name,
    model: fm.model || 'haiku',
    applyOn: fm.applyOn || 'all',
    requires: Array.isArray(fm.requires) ? fm.requires : (fm.requires ? [fm.requires] : []),
    viewportSensitive: fm.viewportSensitive !== false,
    interactive: fm.interactive === true,
    executable: fm.executable || (isCallable(probe) ? (fm.interactive === true ? true : true) : false),
    probeCallable: isCallable(probe),   // BUG 5: false => skip generic call, handle specially
    section: fm.section || '',
    needsSetup: fm.needsSetup === true,
    probe: probe || null,
    issueTypes: issueTypes(content, probe)
  });
}

fs.writeFileSync(OUT, JSON.stringify({ runId: RUN_ID, builtAt: 'static', skills }, null, 0));

// Compile the page-scout probe — always included in the inject bundle, independent of customize.toml.
// qa-cell-worker calls window.__ARGUS_PROBES.runScout() in Step 4c (after bundle load) to get the
// 100-flag fingerprint. The fingerprint is then passed to runPassive/runInteractive so skills whose
// requires:[] flags are all absent are skipped in-page without any DOM queries running.
const scoutSkillPath = path.join(SKILLS_DIR, 'qa-page-scout', 'SKILL.md');
const scoutProbe = fs.existsSync(scoutSkillPath) ? firstJsBlock(fs.readFileSync(scoutSkillPath, 'utf8')) : null;
if (!scoutProbe) console.warn('  [WARN] qa-page-scout/SKILL.md not found or has no ```js block — runScout() will return {}');
const scoutFn = scoutProbe ? `(${scoutProbe})` : '() => ({})';

// BUG 1/2: emit a PAGE-INJECTABLE probe file. The worker loads this into the page ONCE via
// page.addScriptTag({path}) — so the 271KB of probe SOURCE is loaded by the BROWSER, never read
// into the AI's context. The AI then only calls window.__ARGUS_PROBES.runPassive()/runInteractive()
// (tiny calls) and gets back compact findings. This is the fix for "every worker reads 271KB".
// Exclude from the inject: needsSetup skills (console/network capture, not in-page probes) and
// self-executing IIFE probes (they'd run at load, not on demand). They stay in skill-probes.json.
const isIife = p => /\)\s*\(\s*\)\s*;?\s*$/.test((p || '').trim());
const callable = skills.filter(s => s.probeCallable && !s.needsSetup && !isIife(s.probe));
const entries = callable.map(s =>
  `{name:${JSON.stringify(s.name)},interactive:${s.interactive},applyOn:${JSON.stringify(s.applyOn)},requires:${JSON.stringify(s.requires)},viewportSensitive:${s.viewportSensitive},fn:(${s.probe})}`
).join(',\n');
const injectJs = `/* AUTO-GENERATED by bundle-probes.cjs — page-injectable probe bundle (BUG 1/2 fix).
   Loaded into the page via addScriptTag so probe SOURCE never enters the AI context. */
window.__ARGUS_PROBES = {
  skills: [\n${entries}\n],
  _applies: function(s, vp){ return s.applyOn === 'all' || (Array.isArray(s.applyOn) && s.applyOn.indexOf(vp) !== -1); },
  _scoutPass: function(s, fp){ if(!s.requires||!s.requires.length) return true; if(!fp) return true; return s.requires.some(function(f){ return !!fp[f]; }); },
  _scoutFn: ${scoutFn},
  runScout: function(){ try{ return this._scoutFn(); }catch(e){ return {_error:String(e&&e.message||e)}; } },
  // REPEAT-COLLAPSE: a repeated component (same icon button in 50 rows) is ONE bug, not 50.
  // Group a skill's findings by issueType + normalized selector + normalized description; keep
  // the FIRST (its bbox annotates one instance) and tag instanceCount. This runs IN-PAGE before
  // findings reach the AI, so the ~58 duplicates never cost tokens. Findings without issueType
  // (errors / skips) pass through untouched.
  _collapse: function(arr){ if(!Array.isArray(arr)) return arr; var g={}, order=[];
    for(var i=0;i<arr.length;i++){ var f=arr[i]; if(!f||typeof f!=='object'||!f.issueType){ continue; }
      var ns=(f.selector||'').replace(/-[a-z0-9]{5,}/gi,'').replace(/\\d+/g,'#').slice(0,80);
      var nd=(f.description||'').replace(/[\\u2018\\u2019\\u201C\\u201D"'][^\\u2018\\u2019\\u201C\\u201D"']*[\\u2018\\u2019\\u201C\\u201D"']/g,'').replace(/\\d+/g,'#').slice(0,90);
      var k=f.issueType+'|'+ns+'|'+nd;
      if(!g[k]){ g[k]={f:f,n:1}; order.push(k); } else { g[k].n++; } }
    return order.map(function(k){ var e=g[k], f=e.f; if(e.n>1){ f.instanceCount=e.n; f.description=(f.description||'')+' (×'+e.n+' instances on this page — same component, fix once)'; } return f; }); },
  // BUG 3: run ALL applicable passive probes in ONE call (not one per skill). + repeat-collapse.
  runPassive: function(vp, ctx){ var out={}; var fp=(ctx&&ctx.fingerprint)||null; this.skills.forEach(function(s){ if(s.interactive) return; if(!window.__ARGUS_PROBES._applies(s,vp)) return; if(!window.__ARGUS_PROBES._scoutPass(s,fp)){ out[s.name]={skipped:'scout'}; return; } try{ var r=s.fn(ctx||{}); var rr=Array.isArray(r)?r:(r&&r.findings)||(r&&r.issues)||[]; out[s.name]=window.__ARGUS_PROBES._collapse(rr); }catch(e){ out[s.name]={error:String(e&&e.message||e)}; } }); return out; },
  // BUG 3: run ALL applicable interactive probes in ONE call (awaited in-page). + repeat-collapse.
  runInteractive: async function(vp, fp){ var out={}; for(var i=0;i<this.skills.length;i++){ var s=this.skills[i]; if(!s.interactive) continue; if(!this._applies(s,vp)) continue; if(!this._scoutPass(s,fp||null)){ out[s.name]={skipped:'scout'}; continue; } try{ var r=await s.fn(); var rr=Array.isArray(r)?r:(r&&r.findings)||((r&&r.skipReason)?{skipReason:r.skipReason}:null); out[s.name]=Array.isArray(rr)?window.__ARGUS_PROBES._collapse(rr):rr; }catch(e){ out[s.name]={error:String(e&&e.message||e)}; } } return out; }
};
`;
const INJECT = path.join(PROJECT_ROOT, '.tmp', RUN_ID, 'probes-inject.js');
fs.writeFileSync(INJECT, injectJs);

// BUG 1: a SLIM skill list (names + flags, NO probe source) for the worker to read for
// filtering + receipts — a few KB instead of 271KB. The probe SOURCE stays only in probes-inject.js
// (loaded into the page) and skill-probes.json (used by the deterministic runners), never the AI context.
const slim = skills.map(s => ({ name: s.name, applyOn: s.applyOn, requires: s.requires, viewportSensitive: s.viewportSensitive, interactive: s.interactive, executable: s.executable, probeCallable: s.probeCallable, needsSetup: s.needsSetup, hasProbe: !!s.probe }));
fs.writeFileSync(path.join(PROJECT_ROOT, '.tmp', RUN_ID, 'skill-names.json'), JSON.stringify({ runId: RUN_ID, skills: slim }, null, 0));

const passive = skills.filter(s => s.probe && !s.interactive).length;
const inter   = skills.filter(s => s.interactive).length;
const nonCallable = skills.filter(s => s.probe && !s.probeCallable).map(s => s.name);
console.log(`bundle-probes [${RUN_ID}]: ${enabled.length} enabled  (passive=${passive}, interactive=${inter}) -> skill-probes.json`);
console.log(`  + probes-inject.js written (${callable.length} callable probes, ${(injectJs.length/1024).toFixed(0)}KB) — load via addScriptTag, NOT into AI context`);
if (nonCallable.length) console.log(`  non-callable (tagged probeCallable:false, skipped by injector): ${nonCallable.join(', ')}`);
