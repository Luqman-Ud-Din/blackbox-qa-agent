#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Skill Loader — discovers and loads detection skills for Agent 1.
# ─────────────────────────────────────────────────────────────────────────────
# Skills live in: .claude/skills/<skill-name>/
#   ├── SKILL.md      (prose — frontmatter + Detect/Fix/Verify sections)
#   ├── detect.js     (browser-side detection function — ES module export)
#   └── config.json   (thresholds)
#
# This script:
#   - discovers all valid skill folders
#   - reads each skill's detect.js + config + frontmatter
#   - outputs JS code that can be injected into the audit Playwright spec
#   - the injected JS calls each skill's detect() and merges issues into `out`
#
# Sourced by qa-spec-runner before spec generation:
#   source "<plugin>/scripts/skill-loader.sh"
#   SKILL_DETECT_JS=$(build_skill_detect_js)
#   echo "$SKILL_DETECT_JS"   # → JS to splice into page.evaluate()
# ─────────────────────────────────────────────────────────────────────────────

# Resolve the plugin's OWN skills directory from THIS script's location —
# never from the audited project, never via git. skill-loader.sh lives at
# <plugin>/scripts/, so the skills it loads are always <plugin>/skills/,
# no matter which project is being audited or what the CWD is.
_LOADER_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_ROOT=$(cd "$_LOADER_DIR/.." && pwd)
SKILLS_DIR="$PLUGIN_ROOT/skills"

# ─────────────────────────────────────────────────────────────────────────────
# discover_skills — list all skill folders that have SKILL.md (detect.js is
#                   guaranteed by Step 1.55 auto-generation in audit-responsive.md)
#                   AND are not explicitly disabled via config.json "enabled": false
# Usage: discover_skills
# Output: one skill name per line (e.g., "input-height-too-small")
# ─────────────────────────────────────────────────────────────────────────────
discover_skills() {
  [[ -d "$SKILLS_DIR" ]] || return 0
  for skill_dir in "$SKILLS_DIR"/*/; do
    [[ -d "$skill_dir" ]] || continue
    [[ -f "$skill_dir/SKILL.md" ]] || continue
    local skill_name
    skill_name=$(basename "$skill_dir")

    # Skill type → which implementation file(s) it needs.
    local detect_type="dom"
    if [[ -f "$skill_dir/config.json" ]]; then
      detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)
    fi

    # Validate implementation file requirements per detectType.
    # vision and agentic skills need no JS file — Claude is the detector at run time.
    if [[ "$detect_type" == "playwright" ]]; then
      if [[ ! -f "$skill_dir/setup.js" || ! -f "$skill_dir/collect.js" ]]; then
        echo "⚠ skill-loader: '$skill_name' skipped — missing setup.js/collect.js (Step 4.5 must generate it)" >&2
        continue
      fi
    elif [[ "$detect_type" == "interactive" ]]; then
      if [[ ! -f "$skill_dir/interact.js" ]]; then
        echo "⚠ skill-loader: '$skill_name' skipped — missing interact.js (Step 4.5 must generate it)" >&2
        continue
      fi
    elif [[ "$detect_type" == "vision" || "$detect_type" == "agentic" ]]; then
      : # Claude is the detector — no JS file required
    else
      # dom (default)
      if [[ ! -f "$skill_dir/detect.js" ]]; then
        echo "⚠ skill-loader: '$skill_name' skipped — missing detect.js (Step 4.5 must generate it)" >&2
        continue
      fi
    fi

    # Check enabled flag in config.json — use has() not // to avoid jq false-bug
    if [[ -f "$skill_dir/config.json" ]]; then
      local enabled
      enabled=$(jq -r 'if has("enabled") then .enabled else true end' \
        "$skill_dir/config.json" 2>/dev/null)
      [[ "$enabled" == "false" ]] && continue
    fi
    echo "$skill_name"
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# get_skill_field — extract a single field from SKILL.md frontmatter
# Usage: get_skill_field <path-to-SKILL.md> <field-name>
# ─────────────────────────────────────────────────────────────────────────────
get_skill_field() {
  local skill_md="$1"
  local field="$2"
  awk -v f="$field" '
    BEGIN { fm = 0 }
    /^---$/ {
      fm++
      if (fm == 2) exit
      next
    }
    fm == 1 && $0 ~ "^"f":[[:space:]]" {
      sub("^"f":[[:space:]]*", "")
      print
      exit
    }
  ' "$skill_md"
}

# ─────────────────────────────────────────────────────────────────────────────
# skill_issue_types — list issueType values from all skill frontmatters.
# Used to know which hardcoded rules should be skipped (skill takes over).
# Output: one issueType per line (e.g., "inputHeightTooSmall")
# ─────────────────────────────────────────────────────────────────────────────
skill_issue_types() {
  for skill_name in $(discover_skills); do
    local skill_dir="$SKILLS_DIR/$skill_name"
    local issue_type
    issue_type=$(get_skill_field "$skill_dir/SKILL.md" "issueType")
    [[ -z "$issue_type" ]] && issue_type="$skill_name"
    echo "$issue_type"
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# build_skill_detect_js — output the JS to splice into the audit spec.
#
# The returned JS:
#   - declares one detect function per skill (named detect_<skill_name>)
#   - calls each function with merged config + current deviceClass
#   - pushes returned issues into the same `out` array used by hardcoded rules
#   - wraps each call in try/catch so one bad skill can't break the audit
#
# IMPORTANT: this output must be inserted INSIDE the page.evaluate() callback
# in the audit spec, BEFORE the `return out;` line. It assumes:
#   - `out` is the array being populated by detection rules
#   - `cfg.deviceClass` is the current viewport class
# ─────────────────────────────────────────────────────────────────────────────
build_skill_detect_js() {
  local skills
  skills=$(discover_skills)
  if [[ -z "$skills" ]]; then
    echo "// (no skills loaded)"
    return 0
  fi

  printf '%s\n' "// ════════════════════════════════════════════════════════════"
  printf '%s\n' "// SKILL DETECT FUNCTIONS — auto-injected by skill-loader.sh"
  printf '%s\n' "// ════════════════════════════════════════════════════════════"

  while IFS= read -r skill_name; do
    [[ -z "$skill_name" ]] && continue

    local skill_dir="$SKILLS_DIR/$skill_name"
    local detect_code config issue_type fn_name detect_type

    # Emit DOM skills fully; vision skills emit floor.js only (if present); others skip.
    detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)

    if [[ "$detect_type" == "vision" ]]; then
      [[ -f "$skill_dir/floor.js" ]] || continue
      detect_code=$(cat "$skill_dir/floor.js")
      config=$(cat "$skill_dir/config.json" 2>/dev/null || echo '{}')
      fn_name="floor_$(echo "$skill_name" | tr '-' '_')"
      clean_code=$(printf '%s' "$detect_code" \
        | sed -E "s/^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+detect/\1function $fn_name/")
      printf '\n%s\n' "// ── floor checks: $skill_name ──"
      printf '%s\n' "$clean_code"
      printf '%s\n' "try {"
      printf '  %s\n' "const __floorCfg = Object.assign({}, $config, { deviceClass: cfg.deviceClass });"
      printf '  %s\n' "const __floorResult = $fn_name(__floorCfg);"
      printf '  %s\n' "const __floorIssues = (__floorResult instanceof Promise) ? await __floorResult : __floorResult;"
      printf '  %s\n' "if (Array.isArray(__floorIssues)) out.push(...__floorIssues);"
      printf '%s\n' "} catch (__floorErr) {"
      printf '  %s\n' "console.error('[audit] floor checks $skill_name failed:', __floorErr && __floorErr.message);"
      printf '%s\n' "}"
      continue
    elif [[ "$detect_type" != "dom" ]]; then
      continue
    fi

    [[ -f "$skill_dir/detect.js" ]] || continue

    detect_code=$(cat "$skill_dir/detect.js")
    config=$(cat "$skill_dir/config.json" 2>/dev/null || echo '{}')
    issue_type=$(jq -r 'if (.issueType | type) == "array" then .issueType | join(",") else (.issueType // empty) end' \
                 "$skill_dir/config.json" 2>/dev/null || \
                 get_skill_field "$skill_dir/SKILL.md" "issueType")
    [[ -z "$issue_type" ]] && issue_type="$skill_name"

    # JS-safe function name: detect_input_height_too_small
    fn_name="detect_$(echo "$skill_name" | tr '-' '_')"

    # Strip ES module syntax — page.evaluate runs in browser (no module support)
    # Convert:  export function detect(cfg)  →  function detect_<name>(cfg)
    # Also handle:  export async function detect(cfg)  →  async function detect_<name>(cfg)
    local clean_code
    clean_code=$(printf '%s' "$detect_code" \
      | sed -E "s/^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+detect/\1function $fn_name/")

    printf '\n%s\n' "// ── skill: $skill_name (fires as issueType: $issue_type) ──"
    printf '%s\n' "$clean_code"
    printf '%s\n' "try {"
    printf '  %s\n' "const __skillCfg = Object.assign({}, $config, { deviceClass: cfg.deviceClass });"
    printf '  %s\n' "const __skillResult = $fn_name(__skillCfg);"
    printf '  %s\n' "const __skillIssues = (__skillResult instanceof Promise) ? await __skillResult : __skillResult;"
    printf '  %s\n' "if (Array.isArray(__skillIssues)) out.push(...__skillIssues);"
    printf '%s\n' "} catch (__skillErr) {"
    printf '  %s\n' "console.error('[audit] skill $skill_name failed:', __skillErr && __skillErr.message);"
    printf '%s\n' "}"
  done <<< "$skills"

  printf '\n%s\n' "// ════════════════════════════════════════════════════════════"
  printf '%s\n' "// END SKILL DETECT"
  printf '%s\n' "// ════════════════════════════════════════════════════════════"
}

# ─────────────────────────────────────────────────────────────────────────────
# build_skill_setup_code — output the Node.js code to splice BEFORE page.goto()
#
# Emits setup.js content from each "playwright"-type skill.
# This code runs in Node.js context and registers page event listeners.
# Assumes `page` and `__skillCfg` (per-skill config merged at generation time)
# are available in the calling scope.
# ─────────────────────────────────────────────────────────────────────────────
build_skill_setup_code() {
  local skills
  skills=$(discover_skills)
  if [[ -z "$skills" ]]; then
    echo "// (no playwright skills loaded)"
    return 0
  fi

  printf '%s\n' "// ════════════════════════════════════════════════════════════"
  printf '%s\n' "// SKILL SETUP CODE — auto-injected by skill-loader.sh"
  printf '%s\n' "// ════════════════════════════════════════════════════════════"

  while IFS= read -r skill_name; do
    [[ -z "$skill_name" ]] && continue

    local skill_dir="$SKILLS_DIR/$skill_name"
    local detect_type config

    detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)
    [[ "$detect_type" != "playwright" ]] && continue

    [[ -f "$skill_dir/setup.js" ]] || continue

    config=$(cat "$skill_dir/config.json" 2>/dev/null || echo '{}')

    # Derive a JS-safe per-skill config var name to avoid name collisions
    local cfg_var_name
    cfg_var_name="__skillCfg_$(echo "$skill_name" | tr '-' '_')"

    printf '\n%s\n' "// ── skill setup: $skill_name ──"
    # Emit config at outer scope — no block wrapper, so buffer vars stay accessible to collect.js
    printf '%s\n' "const $cfg_var_name = $config;"
    # Emit setup.js with __skillCfg replaced by this skill's unique config var name
    sed "s/__skillCfg/$cfg_var_name/g" "$skill_dir/setup.js"
  done <<< "$skills"

  printf '\n%s\n' "// ════════════════════════════════════════════════════════════"
  printf '%s\n' "// END SKILL SETUP"
  printf '%s\n' "// ════════════════════════════════════════════════════════════"
}

# ─────────────────────────────────────────────────────────────────────────────
# build_skill_collect_code — output the Node.js code to splice AFTER waitForLoadState
#
# Emits collect.js content from each "playwright"-type skill.
# This code drains each skill's buffer and pushes deduplicated issues into
# the `playwrightIssues` array declared in the spec template.
# ─────────────────────────────────────────────────────────────────────────────
build_skill_collect_code() {
  local skills
  skills=$(discover_skills)
  if [[ -z "$skills" ]]; then
    echo "// (no playwright skills loaded)"
    return 0
  fi

  printf '%s\n' "// ════════════════════════════════════════════════════════════"
  printf '%s\n' "// SKILL COLLECT CODE — auto-injected by skill-loader.sh"
  printf '%s\n' "// ════════════════════════════════════════════════════════════"

  while IFS= read -r skill_name; do
    [[ -z "$skill_name" ]] && continue

    local skill_dir="$SKILLS_DIR/$skill_name"
    local detect_type

    detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)
    [[ "$detect_type" != "playwright" ]] && continue

    [[ -f "$skill_dir/collect.js" ]] || continue

    local cfg_var_name
    cfg_var_name="__skillCfg_$(echo "$skill_name" | tr '-' '_')"
    printf '\n%s\n' "// ── skill collect: $skill_name ──"
    # Replace __skillCfg with this skill's unique config var name (set in setup block)
    sed "s/__skillCfg/$cfg_var_name/g" "$skill_dir/collect.js"
  done <<< "$skills"

  printf '\n%s\n' "// ════════════════════════════════════════════════════════════"
  printf '%s\n' "// END SKILL COLLECT"
  printf '%s\n' "// ════════════════════════════════════════════════════════════"
}

# ─────────────────────────────────────────────────────────────────────────────
# build_skill_interact_code — output the Node.js code to splice INTO the test body
#
# Emits interact.js content from each "interactive"-type skill.
# This code runs in the Playwright test scope (it has access to `page`) AFTER
# DOM detection and the clean screenshot, since interactive skills click and
# navigate — they change page state.
#
# The returned JS:
#   - declares one interact function per skill (named interact_<skill_name>)
#   - awaits each function with merged config + current deviceClass
#   - pushes returned issues into the `interactiveIssues` array
#   - wraps each call in try/catch so one bad skill can't break the audit
#
# IMPORTANT: this output must be inserted at the ${SKILL_INTERACT_CODE} sentinel
# in the audit spec. It assumes these are in scope:
#   - `page`               — the Playwright Page
#   - `vp`                 — { width, height, deviceClass } for the current cell
#   - `interactiveIssues`  — the array being populated by interactive skills
# ─────────────────────────────────────────────────────────────────────────────
build_skill_interact_code() {
  local skills
  skills=$(discover_skills)
  if [[ -z "$skills" ]]; then
    echo "// (no interactive skills loaded)"
    return 0
  fi

  printf '%s\n' "// ════════════════════════════════════════════════════════════"
  printf '%s\n' "// SKILL INTERACT CODE — auto-injected by skill-loader.sh"
  printf '%s\n' "// ════════════════════════════════════════════════════════════"

  while IFS= read -r skill_name; do
    [[ -z "$skill_name" ]] && continue

    local skill_dir="$SKILLS_DIR/$skill_name"
    local detect_type config issue_type fn_name interact_code clean_code

    # Emit interactive and agentic skills. Both produce interact.js (agentic generates it fresh
    # each run via Step 4.5; interactive has it pre-committed). Either way the file must exist
    # by the time this function runs.
    detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)
    [[ "$detect_type" != "interactive" && "$detect_type" != "agentic" ]] && continue

    [[ -f "$skill_dir/interact.js" ]] || continue

    interact_code=$(cat "$skill_dir/interact.js")
    config=$(cat "$skill_dir/config.json" 2>/dev/null || echo '{}')
    issue_type=$(jq -r 'if (.issueType | type) == "array" then .issueType | join(",") else (.issueType // empty) end' \
                 "$skill_dir/config.json" 2>/dev/null)
    [[ -z "$issue_type" ]] && issue_type="$skill_name"

    # JS-safe function name: interact_qa_test_navigation
    fn_name="interact_$(echo "$skill_name" | tr '-' '_')"

    # Strip ES module syntax — page runs in Node test scope (module export not valid inline)
    # Convert:  export async function interact(page, cfg)  →  async function interact_<name>(page, cfg)
    clean_code=$(printf '%s' "$interact_code" \
      | sed -E "s/^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+interact/\1function $fn_name/")

    printf '\n%s\n' "// ── interactive skill: $skill_name (fires as issueType: $issue_type) ──"
    printf '%s\n' "$clean_code"
    printf '%s\n' "try {"
    printf '  %s\n' "const __iCfg = Object.assign({}, $config, { deviceClass: vp.deviceClass });"
    printf '  %s\n' "// applyOn gate — run only on the viewport classes this skill targets"
    printf '  %s\n' "if (!Array.isArray(__iCfg.applyOn) || __iCfg.applyOn.includes(__iCfg.deviceClass)) {"
    printf '    %s\n' "const __iResult = await $fn_name(page, __iCfg);"
    printf '    %s\n' "if (Array.isArray(__iResult)) interactiveIssues.push(...__iResult);"
    printf '  %s\n' "}"
    printf '%s\n' "} catch (__iErr) {"
    printf '  %s\n' "console.error('[audit] interactive skill $skill_name failed:', __iErr && __iErr.message);"
    printf '%s\n' "}"
  done <<< "$skills"

  printf '\n%s\n' "// ════════════════════════════════════════════════════════════"
  printf '%s\n' "// END SKILL INTERACT"
  printf '%s\n' "// ════════════════════════════════════════════════════════════"
}

# ─────────────────────────────────────────────────────────────────────────────
# list_vision_skills — output one JSON line per enabled vision skill.
# Used by argus-qa post-spec to know which skills need Claude vision processing.
# Output: {"skill":"<name>","skillMd":"<path>","config":{...}}
# ─────────────────────────────────────────────────────────────────────────────
list_vision_skills() {
  for skill_name in $(discover_skills); do
    local skill_dir="$SKILLS_DIR/$skill_name"
    local detect_type
    detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)
    [[ "$detect_type" == "vision" ]] || continue
    local config
    config=$(cat "$skill_dir/config.json" 2>/dev/null || echo '{}')
    printf '%s\n' "{\"skill\":\"$skill_name\",\"skillMd\":\"$skill_dir/SKILL.md\",\"config\":$config}"
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# list_agentic_skills — output one JSON line per enabled agentic skill.
# Used by argus-qa post-spec to know which skills need Claude agentic testing.
# Output: {"skill":"<name>","skillMd":"<path>","config":{...}}
# ─────────────────────────────────────────────────────────────────────────────
list_agentic_skills() {
  for skill_name in $(discover_skills); do
    local skill_dir="$SKILLS_DIR/$skill_name"
    local detect_type
    detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)
    [[ "$detect_type" == "agentic" ]] || continue
    local config
    config=$(cat "$skill_dir/config.json" 2>/dev/null || echo '{}')
    printf '%s\n' "{\"skill\":\"$skill_name\",\"skillMd\":\"$skill_dir/SKILL.md\",\"config\":$config}"
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# write_skill_detect_js <spec_dir>
#
# Writes all DOM-type skill detect functions to <spec_dir>/skill-detect.js.
# spec-template.ts loads this file as a string and evaluates it inside
# page.evaluate() — keeping audit.spec.ts ~250 lines instead of ~5,000 and
# eliminating TypeScript compilation of skill JS code.
#
# The generated JS defines one detect_<name>(cfg) per skill, calls each, and
# appends results to `out`. Assumes `out` (array) and `cfg` (.deviceClass) are
# already in scope when the string is evaluated in the browser.
# ─────────────────────────────────────────────────────────────────────────────
write_skill_detect_js() {
  local spec_dir="$1"
  if [[ ! -d "$spec_dir" ]]; then
    echo "❌ write_skill_detect_js: '$spec_dir' is not a directory" >&2
    return 1
  fi

  local out_file="$spec_dir/skill-detect.js"
  local skills
  skills=$(discover_skills)

  {
    printf '// Auto-generated by skill-loader.sh — DO NOT EDIT.\n'
    printf '// Loaded as a string by spec-template.ts, evaluated inside page.evaluate().\n'
    printf '// Runs in browser context — no Node.js APIs available.\n'

    while IFS= read -r skill_name; do
      [[ -z "$skill_name" ]] && continue
      local skill_dir="$SKILLS_DIR/$skill_name"
      local detect_type
      detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)
      [[ "$detect_type" != "dom" ]] && continue
      [[ -f "$skill_dir/detect.js" ]] || continue

      local config fn_name clean_code
      config=$(cat "$skill_dir/config.json" 2>/dev/null || echo '{}')
      fn_name="detect_$(echo "$skill_name" | tr '-' '_')"
      clean_code=$(sed -E \
        "s/^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+detect/\1function $fn_name/" \
        "$skill_dir/detect.js")

      printf '\n// ── skill: %s ──\n' "$skill_name"
      printf '%s\n' "$clean_code"
      printf 'try {\n'
      printf '  const __skillCfg = Object.assign({}, %s, { deviceClass: cfg.deviceClass });\n' "$config"
      printf '  const __skillResult = %s(__skillCfg);\n' "$fn_name"
      printf '  const __skillIssues = (__skillResult instanceof Promise) ? await __skillResult : __skillResult;\n'
      printf '  if (Array.isArray(__skillIssues)) out.push(...__skillIssues);\n'
      printf '} catch (__skillErr) {\n'
      printf '  console.error("[audit] skill %s failed:", __skillErr && __skillErr.message);\n' "$skill_name"
      printf '}\n'
    done <<< "$skills"
  } > "$out_file"

  echo "[skill-loader] wrote skill-detect.js ($(wc -l < "$out_file") lines) → $spec_dir" >&2
}

# ─────────────────────────────────────────────────────────────────────────────
# write_skill_interact_js <spec_dir>
#
# Writes all interactive-type skill interact functions into a single
# <spec_dir>/skill-interact-combined.js that defines:
#   async function runAllInteractiveSkills(page, vp)
#
# spec-template.ts loads this file via new Function() and calls it with the
# Playwright `page` object and the viewport descriptor `vp`.
# The applyOn gate is embedded per-skill — skills self-skip on non-target viewports.
# ─────────────────────────────────────────────────────────────────────────────
write_skill_interact_js() {
  local spec_dir="$1"
  if [[ ! -d "$spec_dir" ]]; then
    echo "❌ write_skill_interact_js: '$spec_dir' is not a directory" >&2
    return 1
  fi

  local out_file="$spec_dir/skill-interact-combined.js"
  local skills
  skills=$(discover_skills)

  {
    printf '// Auto-generated by skill-loader.sh — DO NOT EDIT.\n'
    printf '// Defines: async function runAllInteractiveSkills(page, vp)\n'
    printf '// Loaded via new Function() in spec-template.ts — Node.js context, NOT browser.\n'
    printf '\nasync function runAllInteractiveSkills(page, vp) {\n'
    printf '  const allIssues = [];\n'

    while IFS= read -r skill_name; do
      [[ -z "$skill_name" ]] && continue
      local skill_dir="$SKILLS_DIR/$skill_name"
      local detect_type
      detect_type=$(jq -r '.detectType // "dom"' "$skill_dir/config.json" 2>/dev/null)
      [[ "$detect_type" != "interactive" ]] && continue
      [[ -f "$skill_dir/interact.js" ]] || continue

      local config fn_name clean_code
      config=$(cat "$skill_dir/config.json" 2>/dev/null || echo '{}')
      fn_name="interact_$(echo "$skill_name" | tr '-' '_')"
      clean_code=$(sed -E \
        "s/^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+interact/\1function $fn_name/" \
        "$skill_dir/interact.js")

      printf '\n  // ── interactive skill: %s ──\n' "$skill_name"
      printf '%s\n' "$clean_code" | sed 's/^/  /'
      printf '  try {\n'
      printf '    const __iCfg = Object.assign({}, %s, { deviceClass: vp.deviceClass });\n' "$config"
      printf '    if (!Array.isArray(__iCfg.applyOn) || __iCfg.applyOn.includes(__iCfg.deviceClass)) {\n'
      printf '      const __iResult = await %s(page, __iCfg);\n' "$fn_name"
      printf '      if (Array.isArray(__iResult)) allIssues.push(...__iResult);\n'
      printf '    }\n'
      printf '  } catch (__iErr) {\n'
      printf '    console.error("[audit] interactive skill %s failed:", __iErr && __iErr.message);\n' "$skill_name"
      printf '  }\n'
    done <<< "$skills"

    printf '\n  return allIssues;\n'
    printf '}\n'
  } > "$out_file"

  echo "[skill-loader] wrote skill-interact-combined.js ($(wc -l < "$out_file") lines) → $spec_dir" >&2
}

# Export functions so they're available after sourcing
export -f discover_skills get_skill_field skill_issue_types \
          build_skill_detect_js build_skill_setup_code build_skill_collect_code \
          build_skill_interact_code write_skill_detect_js write_skill_interact_js \
          list_vision_skills list_agentic_skills

# When run directly (not sourced), print a summary
if [[ "${BASH_SOURCE[0]:-}" == "${0:-}" ]]; then
  echo "Skill loader — running standalone preview mode"
  echo ""
  echo "Discovered skills:"
  discover_skills | sed 's/^/  - /' || echo "  (none)"
  echo ""
  echo "Issue types covered by skills:"
  skill_issue_types | sed 's/^/  - /' || echo "  (none)"
  echo ""
  echo "DOM detect JS (preview):"
  echo "────────────────────────────────────────────"
  build_skill_detect_js
  echo "────────────────────────────────────────────"
  echo ""
  echo "Playwright setup code (preview):"
  echo "────────────────────────────────────────────"
  build_skill_setup_code
  echo "────────────────────────────────────────────"
  echo ""
  echo "Playwright collect code (preview):"
  echo "────────────────────────────────────────────"
  build_skill_collect_code
  echo "────────────────────────────────────────────"
  echo ""
  echo "Interactive skill code (preview):"
  echo "────────────────────────────────────────────"
  build_skill_interact_code
  echo "────────────────────────────────────────────"
fi
