---
name: qa-argus-menu
description: "Greeting flow, welcome screen (Step 0.5), and task menu (Step 0.75). Loaded only for GREETING, NO ARGS, and NUMBERED OPTION cases � never for TASK PROMPT."
---

## Greeting Detection

Check if the user's prompt is a greeting with no task intent.

Greeting phrases: `hi`, `hello`, `hey`, `howdy`, `hi argus`, `hello argus`, `hey argus`, `good morning`, `good afternoon`, `what's up`, `sup`

If matches AND no audit/task intent (no URL, no app name, no browser, no route):

1. Read `{project-root}/.claude/qa-state.json` �  check `userName`.
2. **If `userName` missing** � print exactly, then STOP and wait:

   ```
   Hey there! �x9 I'm Argus � your all-seeing QA agent.
   I don't think we've met. What's your name?
   ```

   When user replies with a name:
   - Save to `qa-state.json �  userName`
   - Print: `Great to meet you, {userName}! Here's what I can do:`
   - Show task menu (Step 0.75), wait for choice.

3. **If `userName` exists** � print exactly:

   ```
   Hey {userName}! �x9 Argus here � your all-seeing QA agent.
   Ready when you are. What would you like to do?
   ```

   Show task menu (Step 0.75), wait for choice.

---

## Step 0.5 � Welcome Screen

```
LOG: "�x9 Step 0.5: Welcome screen"
```

Read `qa-state.json` (create with defaults if absent).

### First run (no userName)

```
�"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
 ARGUS � Autonomous UI Auditor
 Your all-seeing QA agent
�"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�

Welcome! What should I call you?
Name:
```

Wait for input. Save the name. Print `Great to meet you, {userName}! Let's get started.` Proceed to Step 0.75.

### Returning run (userName exists)

```
ARGUS � Autonomous UI Auditor
Welcome back, {userName}!

  Last run      : {lastRun ?? "never"}
  Total runs    : {runsTotal ?? 0}
  Chronic issues: {chronicIssues.length ?? 0}
```

Proceed to Step 0.75.

---

## Step 0.75 � Task Menu

```
LOG: "�x9 Step 0.75: Task menu"
```

Print the menu. Use `{userName ?? "there"}` as fallback.

```
What would you like to do, {userName}?

AUDIT
  [1]  Full audit              � all routes, all browsers
  [2]  Audit single route      � pick one route to test
  [3]  Audit single app        � one app, all its routes
  [4]  Re-run last audit       � same settings as before

DISCOVER
  [5]  Discover routes only    � no tests, just map the app

INSPECT � Visual & Layout
  [6]  Typography & layout     � fonts, spacing, overflow
  [7]  Images                  � alt text, broken src, shift
  [8]  Touch & mobile          � tap targets, mobile layout
  [9]  Loading states          � spinners, skeletons, blanks

INSPECT � Code & Quality
  [10] Accessibility           � ARIA, contrast, focus order
  [11] Forms & validation      � labels, errors, submit
  [12] Console & network       � JS errors, failed requests
  [13] Performance             � slow requests, render time

FUNCTIONAL TESTS
  [14] Navigation              � links, breadcrumb, back/fwd
  [15] Auth flow               � login, logout, session
  [16] Data controls           � sort, filter, pagination
  [17] Widgets                 � modals, tooltips, accordions
  [18] Keyboard                � tab order, Enter, Escape
  [19] Drag & drop             � handles, targets, keyboard
  [20] Theme & i18n            � dark mode, RTL, locale

REPORTS
  [21] Generate report         � from last run results
  [22] File bug tickets        � create tickets for findings

  [C]  Custom task             � tell me what you need
```

### Option dispatch

| Input | Skills invoked | Action |
|-------|----------------|--------|
| 1 | All | Full pipeline �  Step 1 |
| 2 | All | Ask "Which route?" �  set `pinnedRoutes=[input]` �  Step 1 |
| 3 | All | Ask "Which app?" �  set app filter �  Step 1 |
| 4 | All | Load `lastSettings` �  skip Step 1.5 editor �  Step 2 |
| 5 | `qa-route-discovery` | Discovery only �  print routes.json summary �  stop |
| 6 | typography, layout, overflow | Inspect last run* |
| 7 | images | Inspect last run* |
| 8 | touch | Inspect last run* |
| 9 | loading | Inspect last run* |
| 10 | a11y | Inspect last run* |
| 11 | forms, form-validation | Inspect last run* |
| 12 | console-errors, network-errors | Inspect last run* |
| 13 | network-errors (timing) + console perf warnings | Inspect last run* |
| 14 | navigation, history | Functional test last run* |
| 15 | auth-flow | Functional test last run* |
| 16 | data-controls | Functional test last run* |
| 17 | widgets, states, idempotency | Functional test last run* |
| 18 | keyboard | Functional test last run* |
| 19 | dragdrop | Functional test last run* |
| 20 | theme, i18n | Functional test last run* |
| 21 | qa-coverage-report | Generate report from last run* |
| 22 | qa-bug-filer | File tickets from last run* |
| C | Parsed | "Describe what you need:" �  free text �  parse intent �  dispatch |

*For options 6-22, check that `.tmp/` and `.tmp/audit-results.json` exist. If either is missing, print:
`No previous run found. Run a full audit first (option 1).` Then re-show the menu.

### Custom task � intent parsing

| Mentions | Dispatch to |
|---|---|
| `audit`, `test all`, `full scan` | 1 |
| `route`, `page`, `/path` | 2 |
| `discover`, `find routes`, `map the app` | 5 |
| `font`, `typography`, `layout`, `overflow`, `spacing` | 6 |
| `image`, `alt text`, `broken image` | 7 |
| `touch`, `tap`, `mobile target` | 8 |
| `loading`, `spinner`, `skeleton`, `blank` | 9 |
| `accessibility`, `a11y`, `aria`, `contrast`, `focus` | 10 |
| `form`, `input`, `label`, `validation` | 11 |
| `console`, `js error`, `network`, `failed request` | 12 |
| `performance`, `slow`, `render time`, `speed` | 13 |
| `navigation`, `link`, `breadcrumb`, `back` | 14 |
| `login`, `logout`, `auth`, `session` | 15 |
| `filter`, `sort`, `pagination`, `search` | 16 |
| `modal`, `tooltip`, `accordion`, `widget` | 17 |
| `keyboard`, `tab order`, `escape`, `enter key` | 18 |
| `drag`, `drop`, `drag and drop` | 19 |
| `dark mode`, `theme`, `rtl`, `locale`, `i18n` | 20 |
| `report`, `summary`, `findings` | 21 |
| `ticket`, `bug`, `file issue` | 22 |
| anything else | Re-show menu with: "I'm not sure how to handle that � pick from the list or try rephrasing." |
