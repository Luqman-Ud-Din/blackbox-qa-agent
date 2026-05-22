---
name: qa-phase-strategy
description: "Organises discovered routes into a three-phase audit plan ordered by risk — public → login flow → auth-gated"
---

# qa-phase-strategy

## Overview

Takes `routes.json` and produces `audit-plan.json` — a structured list of `(route × viewport × browser)` cells grouped into 3 phases. Phases are ordered by risk so the most impactful issues surface first and login is validated before auth-gated routes are tested.

## Your Role

You are the audit planner. Your job is to sort routes into the correct phases, expand each route across all configured viewports and browsers, and calculate the total cell count. You do not run any tests — you only plan.

## Phase Definitions

### Phase 1 — Public Routes

- **Routes**: All routes where `requiresAuth: false`
- **Viewports**: All configured viewports
- **Browsers**: All configured browsers
- **Skills**: All passive detection skills + console error monitoring + network failure monitoring
- **Goal**: Catch layout, overflow, accessibility, and JS errors on publicly accessible pages

### Phase 2 — Login Flow

- **Routes**: The login route only (e.g. `/login`, `/signin`)
- **Viewports**: All configured viewports
- **Browsers**: `chromium` only (for speed)
- **Skills**: Auth-flow functional tests (`qa-test-auth-flow`)
- **Goal**: Verify credentials work before entering auth-gated territory. If Phase 2 login fails, Phase 3 is automatically skipped.

### Phase 3 — Auth-Gated Routes

- **Routes**: All routes where `requiresAuth: true`
- **Viewports**: All configured viewports
- **Browsers**: All configured browsers
- **Skills**: All skills (passive detection + functional)
- **Precondition**: Only runs if Phase 2 login succeeded. Log a skip notice if Phase 2 failed.

## Viewport Dimensions

| Viewport Class | Width | Height |
|----------------|-------|--------|
| `mobile` | 375 | 667 |
| `tablet` | 768 | 1024 |
| `laptop` | 1280 | 800 |
| `desktop` | 1920 | 1080 |

Use these exact dimensions when building cells. Read the active viewport list from `qa-state.json` (field: `config.viewports`). If that field is absent, default to all four classes.

## Skipped Routes

Before building cells, read `qa-state.json` for `routes.skipped`. Exclude any matching paths from all phases. Log each skipped route:

```
⏭ Skipping /admin/debug (in qa-state.json skipped list)
```

## Output Schema

Write the result to `{project-root}/.tmp/qa-<run-id>/audit-plan.json`.

```json
{
  "runId": "<run-id>",
  "createdAt": "<ISO timestamp>",
  "phases": [
    {
      "phase": 1,
      "label": "Public routes",
      "cells": [
        {
          "app": "<app-name>",
          "route": "/",
          "viewport": "mobile",
          "viewportClass": "mobile",
          "width": 375,
          "height": 667,
          "browser": "chromium",
          "requiresAuth": false,
          "tabs": []
        }
      ]
    },
    {
      "phase": 2,
      "label": "Login flow",
      "cells": []
    },
    {
      "phase": 3,
      "label": "Auth-gated routes",
      "cells": [
        {
          "app": "<app-name>",
          "route": "/dashboard",
          "viewport": "desktop",
          "viewportClass": "desktop",
          "width": 1920,
          "height": 1080,
          "browser": "chromium",
          "requiresAuth": true,
          "tabs": ["Overview", "Details", "History"]
        }
      ]
    }
  ],
  "totalCells": 42
}
```

`totalCells` is the sum of all cell counts across all phases.

## Cell Expansion Logic

For each route in a given phase:

1. Iterate over every active viewport class
2. For each viewport, iterate over every active browser
3. Emit one cell object per `(route, viewport, browser)` combination
4. Attach `width` and `height` from the viewport dimension table above
5. Propagate the `tabs` array from the matching `routes.json` entry into the cell. If the route has no tabs entry or an empty array, set `tabs: []`.

Example: 5 public routes × 4 viewports × 2 browsers = 40 cells in Phase 1. A route with 5 in-page tabs does NOT add extra cells — the tab testing happens inside the same cell (see `argus` step 5.6).

## Log Line

```
📋 Audit plan: N cells across 3 phases (Phase1: X, Phase2: Y, Phase3: Z)
```

Print this to stdout after writing `audit-plan.json`.

