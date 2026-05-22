---
name: qa-preflight
description: "Verifies system tools, Playwright install, server health, and auth credentials before the audit starts"
---

# qa-preflight

## Overview

Catches failures before wasting time on a broken run. Runs a series of checks and reports pass/fail for each one. Critical failures halt the audit immediately; non-critical failures produce warnings and allow the audit to continue in a degraded mode.

## Your Role

You are the pre-run validator. Run every check below in order, collect results, print the summary table, and return a `PREFLIGHT_FAILED=true` signal to `argus` if any critical check does not pass.

## Checks

Run in this exact order.

### 1. Node + Playwright

```bash
node --version
npx playwright --version
```

- Node version must be `>= 18.0.0`
- Playwright command must exit with code 0
- **Critical**: yes — if either fails, tell the user to run `/qa-setup` and stop the audit

### 2. jq

```bash
jq --version
```

- Must exit with code 0
- **Critical**: yes — jq is required for JSON processing throughout the audit pipeline. Tell the user to run `/qa-setup` if missing.

### 3. Server Health

```bash
curl -sf -o /dev/null -w "%{http_code}" <BASE_URL>
```

- Accept HTTP status codes: `200`, `302`, `404`
- Status `000` means the server is unreachable — tell the user to start their dev server
- Any 5xx response is treated as unreachable
- **Critical**: yes — if the server is not reachable, there is nothing to audit

### 4. Auth Credentials

Skip this check entirely if no `loginRoute` is configured in `qa-state.json`.

Steps:
1. Navigate to `BASE_URL + loginRoute` in Playwright (Chromium, headless)
2. Locate the email/username and password input fields
3. Fill with credentials from `qa-state.json` (`auth.email`, `auth.password`)
4. Submit the form
5. Wait for navigation to settle
6. Verify success by checking either:
   - `page.url()` no longer contains the login path, OR
   - A session cookie is present in the browser context

If login fails:
- **Non-critical**: warn the user but do NOT stop the audit
- Phase 3 (auth-gated routes) will be skipped automatically
- Log: `⚠ Auth check failed — Phase 3 will be skipped`

### 5. Secrets file safety

Always run this check, regardless of `dry_run` setting.

Steps:
1. Check if `{project-root}/.claude/secrets.json` exists
2. If it exists, verify it is listed in `{project-root}/.gitignore` (or any parent `.gitignore`)
   ```bash
   git -C "{project-root}" check-ignore -q .claude/secrets.json
   ```
3. If the file exists but is **not** gitignored → print a critical warning and add the entry:
   ```bash
   echo ".claude/secrets.json" >> "{project-root}/.gitignore"
   ```
   Print: `⚠ Added .claude/secrets.json to .gitignore — PAT was not protected`

- **Critical only if** secrets.json exists and could not be gitignored (write error)
- Otherwise non-critical (if secrets.json doesn't exist yet, nothing to protect)

### 6. ADO PAT

Skip this check if `dry_run: true` is set in `qa-state.json`.

PAT lookup order (first match wins):
1. `{project-root}/.claude/secrets.json → AZURE_DEVOPS_PAT`
2. Environment variable `AZURE_DEVOPS_PAT`

Steps:
1. Read PAT using the lookup order above
2. If found, make an authenticated request:
   ```
   GET https://dev.azure.com/{ADO_ORG}/_apis/projects/{ADO_PROJECT}?api-version=7.1
   Authorization: Basic base64(:<PAT>)
   ```
3. `200` → pass
4. `401` or `403` → warn the user: invalid PAT or missing scope (`Work Items: Read & Write`)
5. If PAT not found anywhere → warn but do not fail (user will be prompted in Step 1.5)

- **Non-critical**: PAT issues prevent bug filing but do not block the audit itself

## Output Format

Print the summary table to stdout before returning:

```
═══════════════════════════════════════
 🔍 Preflight checks
═══════════════════════════════════════
 ✓ Node 20.11.0
 ✓ Playwright 1.45.0
 ✓ jq 1.6
 ✓ Server: 200 https://app.example.com
 ✓ Auth: login succeeded (session cookie set)
 ✓ Secrets: .claude/secrets.json is gitignored
 ✓ ADO: connected to MyOrg/MyProject
═══════════════════════════════════════
```

Use `✓` for pass, `✗` for critical failure, `⚠` for non-critical warning.

Example with failures:

```
═══════════════════════════════════════
 🔍 Preflight checks
═══════════════════════════════════════
 ✓ Node 20.11.0
 ✗ Playwright — not found. Run /qa-setup
 ✓ jq 1.6
 ✓ Server: 200 https://app.example.com
 ⚠ Auth: login failed — Phase 3 will be skipped
 ✓ Secrets: .claude/secrets.json is gitignored
 ⚠ ADO: PAT not found — will prompt before audit starts
═══════════════════════════════════════
 PREFLIGHT FAILED — fix critical errors above before re-running.
═══════════════════════════════════════
```

## Return Behaviour

| Outcome | Action |
|---------|--------|
| All critical checks pass | Return success; audit proceeds |
| Any critical check fails | Set `PREFLIGHT_FAILED=true`; return error message to `argus`; audit stops |
| Only non-critical warnings | Return success with warnings; audit proceeds in degraded mode |


