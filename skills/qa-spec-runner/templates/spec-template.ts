// AUTO-GENERATED at audit run time by argus-qa — do not edit.
import { test, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ── Overlay utility ───────────────────────────────────────────────────────────
const overlaySrc: string = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'annotated-overlay.js'), 'utf8'); }
  catch { console.error('[qa-spec] ❌ annotated-overlay.js not found — annotated screenshots disabled'); return ''; }
})();

// ── Issue schema ──────────────────────────────────────────────────────────────
interface Issue {
  skill: string;
  issueType: string;
  severity: string;
  description: string;
  selector?: string;
  url: string;
  viewport: string;
  viewportClass: string;
  browser?: string;
  screenshotPath?: string;
  annotatedScreenshotPath?: string;
}

// ── Run context (injected by argus-qa via process.env) ────────────────────────
const RUN_DIR: string = process.env.QA_RUN_DIR ?? path.join(__dirname, '..', '..', '.tmp', 'qa-unknown');
const APP_NAME: string = process.env.QA_APP_NAME ?? 'app';

// ── Issue reporter ────────────────────────────────────────────────────────────
function reportIssues(issues: Issue[], route: string, viewport: string): void {
  if (!issues.length) return;
  const issuesDir = path.join(RUN_DIR, 'issues', APP_NAME, route.replace(/\//g, '_') || 'root');
  fs.mkdirSync(issuesDir, { recursive: true });
  const file = path.join(issuesDir, `${viewport}.jsonl`);
  for (const issue of issues) {
    fs.appendFileSync(file, JSON.stringify(issue) + '\n', 'utf8');
  }
}

// ── Annotated screenshot helper ───────────────────────────────────────────────
async function captureAnnotated(
  page: Page,
  issues: Issue[],
  shotKey: string
): Promise<void> {
  if (!overlaySrc || !issues.length) return;
  const screenshotsDir = path.join(RUN_DIR, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const annotatedPath = path.join(screenshotsDir, `${shotKey}__issue-${i + 1}.annotated.png`);
    try {
      await page.evaluate(
        ([src, findings, vpName]) => {
          const fn = new Function(src + '\nreturn injectAuditOverlay;')() as Function;
          (fn as (f: object[], vp: string) => void)(findings, vpName);
        },
        [overlaySrc, [{ type: issue.issueType, severity: issue.severity, description: issue.description, selector: issue.selector ?? '' }], issue.viewport] as [string, object[], string]
      );
      await page.screenshot({ path: annotatedPath, fullPage: false });
      await page.evaluate(() => { document.getElementById('__audit_overlay__')?.remove(); });
      issue.annotatedScreenshotPath = annotatedPath;
    } catch (err) {
      console.warn(`[qa-spec] annotated screenshot failed for ${issue.issueType}: ${err}`);
    }
  }
}

// ── Generated test suite (provided by argus-qa) ───────────────────────────────
${AUDIT_TESTS}

