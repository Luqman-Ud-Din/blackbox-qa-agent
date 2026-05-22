#!/usr/bin/env bash
# file-bugs.sh — reads issues.jsonl and files ADO Bug work items
# Usage: bash file-bugs.sh <run-id>
# Requires: AZURE_DEVOPS_PAT env var, jq, curl

set -e

RUN_ID="${1:?usage: file-bugs.sh <run-id>}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SKILL_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/../../../.." && pwd)
RUN_DIR="$PROJECT_ROOT/.tmp/$RUN_ID"

CONFIG="$PROJECT_ROOT/.claude/automation.config.json"
BUGS_LOG="$RUN_DIR/bugs-filed.jsonl"

# Read config
ADO_ORG=$(jq -r '.ado.org' "$CONFIG")
ADO_PROJECT=$(jq -r '.ado.project' "$CONFIG")
ADO_API_VERSION=$(jq -r '.ado.apiVersion // "7.1"' "$CONFIG")

PAT_VAR=$(jq -r '.ado.patEnvVar // "AZURE_DEVOPS_PAT"' "$CONFIG")
PAT="${!PAT_VAR:-}"

DRY_RUN=$(grep -E '^dry_run' "$SKILL_DIR/../argus/customize.toml" 2>/dev/null | grep -oE 'true|false' | head -1 || echo "true")

if [ -z "$PAT" ]; then
  echo "⚠ $PAT_VAR is not set — skipping ADO bug filing" >&2
  exit 0
fi

filed=0
skipped=0
failed=0

# Collect and deduplicate issues
DEDUP_FILE=$(mktemp)
find "$RUN_DIR/issues" -name "*.jsonl" 2>/dev/null | while read -r f; do
  cat "$f"
done | sort -u >> "$DEDUP_FILE" || true

if [ ! -s "$DEDUP_FILE" ]; then
  echo "  ✓ No issues found — nothing to file"
  rm -f "$DEDUP_FILE"
  exit 0
fi

echo "  Filing bugs to $ADO_ORG / $ADO_PROJECT (dry_run=$DRY_RUN)"

while IFS= read -r line; do
  [ -z "$line" ] && continue

  ISSUE_TYPE=$(echo "$line" | jq -r '.issueType')
  SEVERITY=$(echo "$line" | jq -r '.severity')
  DESCRIPTION=$(echo "$line" | jq -r '.description')
  ROUTE=$(echo "$line" | jq -r '.url')
  VIEWPORT=$(echo "$line" | jq -r '.viewport')
  SKILL=$(echo "$line" | jq -r '.skill')
  BROWSER=$(echo "$line" | jq -r '.browser // "chromium"')
  ANNOTATED=$(echo "$line" | jq -r '.annotatedScreenshotPath // ""')
  CLEAN=$(echo "$line" | jq -r '.screenshotPath // ""')

  # Map severity
  case "$SEVERITY" in
    high)   ADO_SEV="1 - Critical" ;;
    medium) ADO_SEV="2 - High" ;;
    low)    ADO_SEV="3 - Medium" ;;
    *)      ADO_SEV="2 - High" ;;
  esac

  TITLE="[QA] $ISSUE_TYPE on $ROUTE ($VIEWPORT) — $SKILL"
  TAGS="argus-qa,$SKILL,$VIEWPORT,$BROWSER"

  if [ "$DRY_RUN" = "true" ]; then
    echo "  [dry-run] Would file: $TITLE"
    ((filed++)) || true
    continue
  fi

  # Create ADO bug
  RESPONSE=$(curl -sf -X POST \
    "https://dev.azure.com/${ADO_ORG//https:\/\/dev.azure.com\//}/$ADO_PROJECT/_apis/wit/workitems/\$Bug?api-version=$ADO_API_VERSION" \
    -H "Content-Type: application/json-patch+json" \
    -H "Authorization: Basic $(echo -n ":$PAT" | base64)" \
    -d "[
      {\"op\":\"add\",\"path\":\"/fields/System.Title\",\"value\":\"$TITLE\"},
      {\"op\":\"add\",\"path\":\"/fields/Microsoft.VSTS.Common.Severity\",\"value\":\"$ADO_SEV\"},
      {\"op\":\"add\",\"path\":\"/fields/System.Tags\",\"value\":\"$TAGS\"},
      {\"op\":\"add\",\"path\":\"/fields/System.Description\",\"value\":\"<p>$DESCRIPTION</p><p>Route: $ROUTE<br/>Viewport: $VIEWPORT<br/>Browser: $BROWSER<br/>Skill: $SKILL</p>\"}
    ]" 2>&1) || { ((failed++)) || true; echo "  ✗ Failed to file: $TITLE"; continue; }

  BUG_ID=$(echo "$RESPONSE" | jq -r '.id // ""')
  if [ -z "$BUG_ID" ]; then
    ((failed++)) || true
    echo "  ✗ No bug ID returned for: $TITLE"
    continue
  fi

  echo "  ✓ Filed #$BUG_ID: $TITLE"
  ((filed++)) || true
  echo "$line" >> "$BUGS_LOG"

done < "$DEDUP_FILE"

rm -f "$DEDUP_FILE"

echo ""
echo "  Summary: $filed filed, $skipped skipped, $failed failed"


