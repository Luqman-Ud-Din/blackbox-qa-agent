#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Azure DevOps REST API helper — generic, project-agnostic
# ─────────────────────────────────────────────────────────────────────────────
# Source it from any script that needs to talk to ADO:
#   source "$(git rev-parse --show-toplevel)/.claude/scripts/ado-api.sh"
#
# Configuration is read from .claude/automation.config.json (preferred) or env vars.
# Required keys in automation.config.json:
#   .ado.org           e.g. "https://dev.azure.com/your-org"
#   .ado.project       e.g. "YourProject"
#   .ado.apiVersion    e.g. "7.1"
#   .repos.frontend.name + .baseBranch
#   .repos.backend.name  + .baseBranch + .path (optional, for sibling backend repo)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Path resolution ──────────────────────────────────────────────────────────
# REPO_ROOT       = the frontend repo where this script is being invoked
# WORKSPACE_ROOT  = parent dir (used for sibling backend lookup)
# BACKEND_PATH    = optional sibling backend repo (read from config or env var)

if [[ -z "${REPO_ROOT:-}" ]]; then
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "❌ Not inside a git repo. Run from inside your project root." >&2
    return 1 2>/dev/null || exit 1
  }
fi
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(dirname "$REPO_ROOT")}"

# ── Read config from automation.config.json (single source of truth) ─────────
_ADO_CONFIG="$REPO_ROOT/.claude/automation.config.json"

_cfg() {
  if [[ -f "$_ADO_CONFIG" ]]; then
    jq -r "$1 // empty" "$_ADO_CONFIG" 2>/dev/null
  fi
}

ADO_ORG="${ADO_ORG:-$(_cfg '.ado.org')}"
ADO_PROJECT="${ADO_PROJECT:-$(_cfg '.ado.project')}"
ADO_API_VERSION="${ADO_API_VERSION:-$(_cfg '.ado.apiVersion')}"
ADO_API_VERSION="${ADO_API_VERSION:-7.1}"

# Optional sibling backend repo — config takes a relative path from REPO_ROOT
_BE_PATH_CFG=$(_cfg '.repos.backend.path')
if [[ -n "$_BE_PATH_CFG" ]]; then
  BACKEND_PATH="${BACKEND_PATH:-$(cd "$REPO_ROOT" && cd "$_BE_PATH_CFG" 2>/dev/null && pwd)}"
fi
BACKEND_PATH="${BACKEND_PATH:-}"

if [[ -z "$ADO_ORG" || -z "$ADO_PROJECT" ]]; then
  echo "❌ ADO_ORG and ADO_PROJECT must be set." >&2
  echo "   Either export env vars, or run /qa-setup to write .claude/automation.config.json" >&2
  return 1 2>/dev/null || exit 1
fi

export REPO_ROOT WORKSPACE_ROOT BACKEND_PATH ADO_ORG ADO_PROJECT ADO_API_VERSION

# Auto-load PAT from .claude/secrets.json (Argus secrets store)
_SECRETS_FILE="$REPO_ROOT/.claude/secrets.json"
if [[ -z "${AZURE_DEVOPS_PAT:-}" && -f "$_SECRETS_FILE" ]]; then
  AZURE_DEVOPS_PAT=$(jq -r '.AZURE_DEVOPS_PAT // empty' "$_SECRETS_FILE" 2>/dev/null)
fi

if [[ -z "${AZURE_DEVOPS_PAT:-}" ]]; then
  echo "❌ AZURE_DEVOPS_PAT is not set." >&2
  echo "   Run Argus with dry_run=false and it will prompt you to save your PAT to .claude/secrets.json" >&2
  return 1 2>/dev/null || exit 1
fi

# ── Auth header (Basic auth, empty user, PAT as password) ───────────────────
ADO_AUTH_B64=$(printf ":%s" "${AZURE_DEVOPS_PAT}" | base64 -w0 2>/dev/null || printf ":%s" "${AZURE_DEVOPS_PAT}" | base64)

# ── Reusable curl with auth + JSON content type ─────────────────────────────
ado_curl() {
  curl -sS \
    -H "Authorization: Basic ${ADO_AUTH_B64}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    "$@"
}

# ─────────────────────────────────────────────────────────────────────────────
# WORK ITEMS
# ─────────────────────────────────────────────────────────────────────────────

# Get a work item by ID with all fields, comments, and relations
# Usage: ado_get_work_item <id>
# Output: JSON to stdout
ado_get_work_item() {
  local id="$1"
  ado_curl "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workitems/${id}?\$expand=all&api-version=${ADO_API_VERSION}"
}

# Get just the comments for a work item
# Usage: ado_get_comments <id>
ado_get_comments() {
  local id="$1"
  ado_curl "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workItems/${id}/comments?api-version=${ADO_API_VERSION}-preview.4"
}

# Add a comment to a work item
# Usage: ado_add_comment <id> "<body markdown>"
ado_add_comment() {
  local id="$1"
  local body="$2"
  local payload response
  payload=$(jq -n --arg text "$body" '{ text: $text }')
  response=$(ado_curl -X POST \
    -d "$payload" \
    "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workItems/${id}/comments?api-version=${ADO_API_VERSION}-preview.4")
  if echo "$response" | jq -e '.id' > /dev/null 2>&1; then
    echo "✓ Comment added to #${id}"
  else
    echo "❌ Comment failed on #${id}: $(echo "$response" | jq -r '.message // .')" >&2
    return 1
  fi
}

# Update fields on a work item via JSON patch
# Usage: ado_update_fields <id> <json-patch-array>
# Example:
#   ado_update_fields 5451 '[
#     { "op": "replace", "path": "/fields/System.State", "value": "Resolved" },
#     { "op": "replace", "path": "/fields/System.Reason", "value": "Fixed" }
#   ]'
#
# NOTE: Uses raw curl (not ado_curl) to avoid duplicate Content-Type header.
# JSON-patch endpoints reject requests when Content-Type appears twice.
ado_update_fields() {
  local id="$1"
  local patch="$2"
  curl -sS \
    -H "Authorization: Basic ${ADO_AUTH_B64}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json-patch+json" \
    -X PATCH \
    -d "$patch" \
    "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workitems/${id}?api-version=${ADO_API_VERSION}"
}

# Set state + reason in one call
# Usage: ado_set_state <id> "Resolved" "Fixed"
ado_set_state() {
  local id="$1"
  local state="$2"
  local reason="${3:-}"
  local patch
  if [[ -n "$reason" ]]; then
    patch=$(jq -n --arg state "$state" --arg reason "$reason" '[
      { op: "replace", path: "/fields/System.State", value: $state },
      { op: "replace", path: "/fields/System.Reason", value: $reason }
    ]')
  else
    patch=$(jq -n --arg state "$state" '[
      { op: "replace", path: "/fields/System.State", value: $state }
    ]')
  fi
  ado_update_fields "$id" "$patch"
}

# Read-modify-write tags (ADO tags are a semicolon-separated string)
# Usage: ado_add_tag <id> "QA:AI_Verified"
ado_add_tag() {
  local id="$1"
  local new_tag="$2"

  local current_tags
  current_tags=$(ado_get_work_item "$id" | jq -r '.fields["System.Tags"] // ""')

  # Skip if already present
  if echo "$current_tags" | grep -qE "(^|; *)${new_tag}( *;|$)"; then
    echo "Tag '${new_tag}' already on item ${id}"
    return 0
  fi

  local merged
  if [[ -z "$current_tags" ]]; then
    merged="$new_tag"
  else
    merged="${current_tags}; ${new_tag}"
  fi

  local patch
  patch=$(jq -n --arg t "$merged" '[
    { op: "replace", path: "/fields/System.Tags", value: $t }
  ]')
  ado_update_fields "$id" "$patch"
}

# Remove a tag (read-modify-write)
# Usage: ado_remove_tag <id> "QA Review"
ado_remove_tag() {
  local id="$1"
  local rm_tag="$2"

  local current_tags
  current_tags=$(ado_get_work_item "$id" | jq -r '.fields["System.Tags"] // ""')

  # Split, filter, rejoin
  local merged
  merged=$(echo "$current_tags" | tr ';' '\n' | sed 's/^ *//;s/ *$//' | grep -v "^${rm_tag}$" || true | grep -v '^$' | paste -sd ';' - | sed 's/;/; /g')

  local patch
  patch=$(jq -n --arg t "$merged" '[
    { op: "replace", path: "/fields/System.Tags", value: $t }
  ]')
  ado_update_fields "$id" "$patch"
}

# Create a new work item
# Usage: ado_create_work_item <type> <title> <json-patch-array>
# Type is "Bug", "Issue", "Task", or "User Story"
ado_create_work_item() {
  local type="$1"
  local title="$2"
  local extra_fields="${3:-[]}"

  # Always set System.Title
  local base_patch
  base_patch=$(jq -n --arg title "$title" '[
    { op: "add", path: "/fields/System.Title", value: $title }
  ]')

  # Merge with extra fields
  local full_patch
  full_patch=$(jq -n --argjson base "$base_patch" --argjson extra "$extra_fields" '$base + $extra')

  # URL-encode the work item type for the path segment
  local type_encoded
  type_encoded=$(printf '%s' "$type" | jq -sRr @uri)

  ado_curl -X POST \
    -H "Content-Type: application/json-patch+json" \
    -d "$full_patch" \
    "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workitems/\$${type_encoded}?api-version=${ADO_API_VERSION}"
}

# File an ADO Bug with named args — the STABLE bug-filer for Agent 1.
# Uses `jq --arg` so ALL string values (HTML repro steps, multi-line text,
# unicode, special chars) are escaped correctly. No inline JSON construction,
# no shell-quoting bugs, no per-run improvisation.
#
# Usage:
#   ado_file_bug \
#     --title    "Responsive: <app>/<route> breaks on mobile (oversizedHeading)" \
#     --repro    "$REPRO_HTML" \
#     --tags     "responsiveness; auto-reported; mobile; oversizedHeading" \
#     --priority 2 \
#     --area     "<Project>\\\\Frontend" \
#     --iteration "<Project>\\\\Sprint 24" \
#     --severity "3 - Medium"
#
# Returns: the full JSON response on stdout (contains .id, .url, .fields, etc.).
# Caller extracts: BUG_ID=$(echo "$RESPONSE" | jq -r '.id // empty')
#
# Required: --title
# Optional: --repro, --tags, --priority (default 2), --area, --iteration, --severity
ado_file_bug() {
  local title="" repro="" tags="" priority="2" area="" iteration="" severity=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title)     title="$2";     shift 2 ;;
      --repro)     repro="$2";     shift 2 ;;
      --tags)      tags="$2";      shift 2 ;;
      --priority)  priority="$2";  shift 2 ;;
      --area)      area="$2";      shift 2 ;;
      --iteration) iteration="$2"; shift 2 ;;
      --severity)  severity="$2";  shift 2 ;;
      *)
        echo "❌ ado_file_bug: unknown arg: $1" >&2
        return 1 ;;
    esac
  done

  if [[ -z "$title" ]]; then
    echo "❌ ado_file_bug: --title is required" >&2
    return 1
  fi

  # Build the JSON patch using --arg (handles ANY string content safely)
  local patch
  patch=$(jq -n \
    --arg     title    "$title" \
    --arg     repro    "$repro" \
    --arg     tags     "$tags" \
    --arg     area     "$area" \
    --arg     iter     "$iteration" \
    --arg     sev      "$severity" \
    --argjson priority "$priority" \
    '[
      { op: "add", path: "/fields/System.Title", value: $title }
    ]
    + (if $repro != "" then [{ op: "add", path: "/fields/Microsoft.VSTS.TCM.ReproSteps",     value: $repro }] else [] end)
    + (if $tags  != "" then [{ op: "add", path: "/fields/System.Tags",                       value: $tags  }] else [] end)
    + (if $area  != "" then [{ op: "add", path: "/fields/System.AreaPath",                   value: $area  }] else [] end)
    + (if $iter  != "" then [{ op: "add", path: "/fields/System.IterationPath",              value: $iter  }] else [] end)
    + (if $sev   != "" then [{ op: "add", path: "/fields/Microsoft.VSTS.Common.Severity",    value: $sev   }] else [] end)
    + [
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: $priority }
    ]')

  # Raw curl (not ado_curl) so we can set the patch-specific Content-Type cleanly.
  # IMPORTANT: pipe via stdin + --data-binary (NOT -d "$patch") because curl's -d flag
  # mangles multi-byte UTF-8 in shell-quoted strings (em-dash —, ×, →, unicode symbols).
  # printf preserves the bytes; --data-binary @- sends them through unchanged.
  printf '%s' "$patch" | curl -sS \
    -H "Authorization: Basic ${ADO_AUTH_B64}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json-patch+json" \
    -X POST \
    --data-binary @- \
    "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workitems/\$Bug?api-version=${ADO_API_VERSION}"
}

# ─────────────────────────────────────────────────────────────────────────────
# WIQL QUERIES
# ─────────────────────────────────────────────────────────────────────────────

# Run a WIQL query, return matching work item IDs
# Usage: ado_query_wiql "SELECT [System.Id] FROM WorkItems WHERE ..."
# Output: One ID per line
ado_query_wiql() {
  local query="$1"
  local payload
  payload=$(jq -n --arg q "$query" '{ query: $q }')
  ado_curl -X POST \
    -d "$payload" \
    "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/wiql?api-version=${ADO_API_VERSION}" \
  | jq -r '.workItems[]?.id'
}

# Batch fetch full work item details for a list of IDs
# Usage: echo "5451 5432" | ado_get_work_items_batch
ado_get_work_items_batch() {
  local ids
  ids=$(cat | tr ' \n' ',,' | sed 's/,$//;s/^,//')
  if [[ -z "$ids" ]]; then
    echo '{"value": []}'
    return
  fi
  ado_curl "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workitems?ids=${ids}&\$expand=all&api-version=${ADO_API_VERSION}"
}

# ─────────────────────────────────────────────────────────────────────────────
# ATTACHMENTS
# ─────────────────────────────────────────────────────────────────────────────

# Upload a file as attachment, return URL to attach to work item
# Usage: ado_upload_attachment <file-path>
# Output: Attachment URL on stdout
ado_upload_attachment() {
  local file_path="$1"

  # Normalize Windows backslash paths (C:\...) → forward slashes.
  # issues.jsonl is written by Node.js on Windows and may contain backslash paths
  # that bash and curl cannot read with the @ prefix.
  file_path="${file_path//\\//}"

  if [[ ! -f "$file_path" ]]; then
    echo "❌ ado_upload_attachment: file not found: $file_path" >&2
    return 1
  fi

  local file_name
  file_name=$(basename "$file_path")
  local file_name_encoded
  file_name_encoded=$(printf '%s' "$file_name" | jq -sRr @uri)

  local response
  response=$(curl -sS \
    -H "Authorization: Basic ${ADO_AUTH_B64}" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${file_path}" \
    "${ADO_ORG}/${ADO_PROJECT}/_apis/wit/attachments?fileName=${file_name_encoded}&api-version=${ADO_API_VERSION}")

  local url
  url=$(echo "$response" | jq -r '.url // empty')
  if [[ -z "$url" ]]; then
    echo "❌ ado_upload_attachment: upload failed for $file_name — $(echo "$response" | jq -r '.message // .')" >&2
    return 1
  fi

  echo "$url"
}

# Attach a file to a work item (upload + link)
# Usage: ado_attach_file <work-item-id> <file-path> "<comment>"
ado_attach_file() {
  local id="$1"
  local file_path="$2"
  local comment="${3:-Attached by Claude}"

  local url
  url=$(ado_upload_attachment "$file_path") || return 1

  if [[ -z "$url" || "$url" == "null" ]]; then
    echo "❌ ado_attach_file: empty URL for $file_path — skipping" >&2
    return 1
  fi

  local patch
  patch=$(jq -n --arg url "$url" --arg comment "$comment" '[
    {
      op: "add",
      path: "/relations/-",
      value: {
        rel: "AttachedFile",
        url: $url,
        attributes: { comment: $comment }
      }
    }
  ]')

  # CRITICAL: capture the PATCH response and check it actually succeeded.
  # ado_update_fields returns 0 on HTTP errors too (it just prints the error JSON),
  # so we inspect the response body for an "id" field — present on success only.
  local patch_response
  patch_response=$(ado_update_fields "$id" "$patch")
  local patch_exit=$?

  if [[ $patch_exit -ne 0 ]]; then
    echo "❌ ado_attach_file: PATCH step failed for #${id} ($(basename "$file_path"))" >&2
    echo "   Response: $patch_response" >&2
    return 1
  fi

  # Verify the work item now contains the AttachedFile relation we just added
  if ! echo "$patch_response" | jq -e --arg url "$url" '.relations // [] | any(.url == $url)' >/dev/null 2>&1; then
    echo "❌ ado_attach_file: PATCH appeared to succeed but the AttachedFile relation is not on #${id}" >&2
    echo "   This usually means: PAT lacks Work Items Read & Write, work item is locked, or wrong API version" >&2
    echo "   Response: $(echo "$patch_response" | jq -c '.message // .typeName // .' 2>/dev/null)" >&2
    return 1
  fi

  echo "✓ Attached $(basename "$file_path") to #${id}"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────────────────────────────────────

# Get current authenticated user — uses the profile API which returns reliable data.
# (connectionData endpoint sometimes returns nulls when authenticated via PAT.)
ado_whoami() {
  ado_curl "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1" \
  | jq -r '.displayName // .emailAddress // "unknown"'
}

# Get current authenticated user's email
ado_my_email() {
  ado_curl "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1" \
  | jq -r '.emailAddress // "unknown"'
}

# Health check — verify auth + project access
ado_smoke_test() {
  echo "── ADO Smoke Test ──"
  echo "Org:     ${ADO_ORG}"
  echo "Project: ${ADO_PROJECT}"

  # Try whoami via profile API
  local me
  me=$(ado_whoami 2>&1)
  if [[ "$me" == "unknown" || -z "$me" ]]; then
    # Fall back: prove auth by reading projects list
    me="(auth proven via project access)"
  fi

  local projects
  projects=$(ado_curl "${ADO_ORG}/_apis/projects?api-version=${ADO_API_VERSION}" | jq -r '.value[].name' 2>&1) || {
    echo "❌ Cannot list projects — PAT may be invalid or expired"
    return 1
  }
  echo "✓ Auth OK — ${me}"

  if echo "$projects" | grep -qx "${ADO_PROJECT}"; then
    echo "✓ Project '${ADO_PROJECT}' accessible"
  else
    echo "❌ Project '${ADO_PROJECT}' not found in org"
    echo "   Available: $(echo "$projects" | tr '\n' ',')"
    return 1
  fi

  echo "✓ Smoke test passed"
}

# ─────────────────────────────────────────────────────────────────────────────
# REPO / BRANCH HELPERS — values come from .claude/automation.config.json
# ─────────────────────────────────────────────────────────────────────────────

# Get the base branch for the given repo name.
# Reads .repos.frontend / .repos.backend from automation.config.json.
# Usage: ado_base_branch_for "<frontend-repo-name>"  → ".repos.frontend.baseBranch"
ado_base_branch_for() {
  local repo="$1"
  if [[ -z "$repo" ]]; then
    echo "❌ ado_base_branch_for: repo name is required" >&2
    return 1
  fi
  if [[ ! -f "$_ADO_CONFIG" ]]; then
    echo "❌ automation.config.json not found — cannot resolve base branch for $repo" >&2
    return 1
  fi

  local branch
  branch=$(jq -r --arg r "$repo" '
    if .repos.frontend.name == $r then .repos.frontend.baseBranch
    elif .repos.backend.name == $r then .repos.backend.baseBranch
    else empty
    end
  ' "$_ADO_CONFIG" 2>/dev/null)

  if [[ -z "$branch" || "$branch" == "null" ]]; then
    local known
    known=$(jq -r '[.repos.frontend.name, .repos.backend.name] | map(select(. != null)) | join(", ")' "$_ADO_CONFIG" 2>/dev/null)
    echo "❌ Unknown repo: '$repo'. Known repos in config: ${known:-none}" >&2
    return 1
  fi
  echo "$branch"
}

# Get the branch prefix for a work item type — reads from
# .branchConventions in automation.config.json so each project can override.
# Usage: ado_branch_prefix_for "Bug" → "fix" (or whatever .branchConventions.Bug says)
ado_branch_prefix_for() {
  local type="$1"
  if [[ -z "$type" ]]; then
    echo "❌ ado_branch_prefix_for: work item type is required" >&2
    return 1
  fi

  local prefix
  if [[ -f "$_ADO_CONFIG" ]]; then
    prefix=$(jq -r --arg t "$type" '.branchConventions[$t] // .branchConventions["default"] // empty' "$_ADO_CONFIG" 2>/dev/null)
  fi
  if [[ -z "$prefix" || "$prefix" == "null" ]]; then
    # Fallback defaults when no config available
    case "$type" in
      "Bug")        prefix="fix" ;;
      "Issue")      prefix="issue" ;;
      "Task")       prefix="chore" ;;
      "User Story") prefix="feat" ;;
      *)            prefix="fix" ;;
    esac
  fi
  echo "$prefix"
}

# Detect which configured repo we're currently in (by `git remote get-url origin`).
# Matches the origin URL against .repos.frontend.name and .repos.backend.name from config.
# Output: the matched repo name, or empty if no match.
ado_current_repo() {
  local url
  url=$(git remote get-url origin 2>/dev/null) || { echo ""; return 1; }
  if [[ ! -f "$_ADO_CONFIG" ]]; then
    echo ""
    return 1
  fi
  jq -r --arg u "$url" '
    [.repos.frontend.name, .repos.backend.name]
    | map(select(. != null))
    | map(select($u | contains(.)))
    | .[0] // ""
  ' "$_ADO_CONFIG" 2>/dev/null
}
