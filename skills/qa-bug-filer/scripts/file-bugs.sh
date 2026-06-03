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

  # Build the HTML body (used for both ReproSteps and Description)
  BODY_HTML="<h3>$ISSUE_TYPE</h3><p>$DESCRIPTION</p><table><tr><td><b>Route</b></td><td>$ROUTE</td></tr><tr><td><b>Viewport</b></td><td>$VIEWPORT</td></tr><tr><td><b>Browser</b></td><td>$BROWSER</td></tr><tr><td><b>Skill</b></td><td>$SKILL</td></tr></table>"

  # Create ADO bug — set BOTH ReproSteps (primary Bug field) AND Description
  ORG_NAME="${ADO_ORG//https:\/\/dev.azure.com\//}"
  RESPONSE=$(curl -sf -X POST \
    "https://dev.azure.com/$ORG_NAME/$ADO_PROJECT/_apis/wit/workitems/\$Bug?api-version=$ADO_API_VERSION" \
    -H "Content-Type: application/json-patch+json" \
    -H "Authorization: Basic $(echo -n ":$PAT" | base64)" \
    -d "[
      {\"op\":\"add\",\"path\":\"/fields/System.Title\",\"value\":\"$TITLE\"},
      {\"op\":\"add\",\"path\":\"/fields/Microsoft.VSTS.Common.Severity\",\"value\":\"$ADO_SEV\"},
      {\"op\":\"add\",\"path\":\"/fields/System.Tags\",\"value\":\"$TAGS\"},
      {\"op\":\"add\",\"path\":\"/fields/Microsoft.VSTS.TCM.ReproSteps\",\"value\":\"$BODY_HTML\"},
      {\"op\":\"add\",\"path\":\"/fields/System.Description\",\"value\":\"$BODY_HTML\"}
    ]" 2>&1) || { ((failed++)) || true; echo "  ✗ Failed to file: $TITLE"; continue; }

  BUG_ID=$(echo "$RESPONSE" | jq -r '.id // ""')
  if [ -z "$BUG_ID" ]; then
    ((failed++)) || true
    echo "  ✗ No bug ID returned for: $TITLE"
    continue
  fi

  echo "  ✓ Filed #$BUG_ID: $TITLE"

  # Attach screenshot — prefer annotated, fall back to clean
  SCREENSHOT=""
  if [ -n "$ANNOTATED" ] && [ -f "$ANNOTATED" ]; then
    SCREENSHOT="$ANNOTATED"
  elif [ -n "$CLEAN" ] && [ -f "$CLEAN" ]; then
    SCREENSHOT="$CLEAN"
  fi

  if [ -n "$SCREENSHOT" ]; then
    FILENAME=$(basename "$SCREENSHOT")
    # 4a — upload bytes
    UPLOAD_RES=$(curl -sf -X POST \
      "https://dev.azure.com/$ORG_NAME/$ADO_PROJECT/_apis/wit/attachments?fileName=$FILENAME&api-version=$ADO_API_VERSION" \
      -H "Content-Type: application/octet-stream" \
      -H "Authorization: Basic $(echo -n ":$PAT" | base64)" \
      --data-binary "@$SCREENSHOT" 2>&1)
    ATT_URL=$(echo "$UPLOAD_RES" | jq -r '.url // ""')

    if [ -n "$ATT_URL" ]; then
      # 4b — link to bug
      curl -sf -X PATCH \
        "https://dev.azure.com/$ORG_NAME/$ADO_PROJECT/_apis/wit/workitems/$BUG_ID?api-version=$ADO_API_VERSION" \
        -H "Content-Type: application/json-patch+json" \
        -H "Authorization: Basic $(echo -n ":$PAT" | base64)" \
        -d "[{\"op\":\"add\",\"path\":\"/relations/-\",\"value\":{\"rel\":\"AttachedFile\",\"url\":\"$ATT_URL\",\"attributes\":{\"comment\":\"Annotated screenshot\"}}}]" \
        > /dev/null 2>&1 && echo "    ✓ attached $FILENAME" || echo "    ⚠ attach-link failed"
    else
      echo "    ⚠ upload failed for $FILENAME"
    fi
  else
    echo "    ⚠ no screenshot available for bug #$BUG_ID"
  fi

  ((filed++)) || true
  echo "$line" >> "$BUGS_LOG"

done < "$DEDUP_FILE"

rm -f "$DEDUP_FILE"

echo ""
echo "  Summary: $filed filed, $skipped skipped, $failed failed"


