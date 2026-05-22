#!/usr/bin/env bash
# run-audit.sh — executes the generated audit.spec.ts with the correct Playwright flags.
# Usage: bash {skill-root}/scripts/run-audit.sh <run-id>
# Requires audit.spec.ts and playwright.config.ts to exist under .tmp/<run-id>/
# Run generate-config.sh first.

set -e

RUN_ID="${1:?usage: run-audit.sh <run-id>}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SKILL_DIR=$(cd "$SCRIPT_DIR/.." && pwd)              # qa-spec-runner/
PROJECT_ROOT=$(cd "$SCRIPT_DIR/../../../.." && pwd)  # project root
RUN_DIR="$PROJECT_ROOT/.tmp/$RUN_ID"

SPEC="$RUN_DIR/audit.spec.ts"
CONFIG="$RUN_DIR/playwright.config.ts"

# Guard
[ -f "$SPEC" ]   || { echo "❌ run-audit.sh: spec not found: $SPEC — run qa-spec-runner step 3 first" >&2; exit 1; }
[ -f "$CONFIG" ] || { echo "❌ run-audit.sh: config not found: $CONFIG — run generate-config.sh first" >&2; exit 1; }

# Read settings
get_toml_value() {
  awk -F'=' -v k="$1" '
    $0 ~ "^[[:space:]]*"k"[[:space:]]*=" {
      v=$2; sub(/[[:space:]]*#.*$/, "", v); gsub(/^[[:space:]]+|[[:space:]]+$/, "", v); gsub(/^"|"$/, "", v)
      print v; exit
    }
  ' "$2"
}

HEADLESS=$(get_toml_value "headless" "$SKILL_DIR/customize.toml")
WORKERS=$(get_toml_value  "workers"  "$SKILL_DIR/customize.toml")

# Resolve browser list from generated config (authoritative)
BROWSERS=$(grep -oE "name: '(chromium|firefox|webkit)'" "$CONFIG" | grep -oE '(chromium|firefox|webkit)' | paste -sd,)
if [ -z "${BROWSERS:-}" ]; then
  QA_AGENT_TOML="$SCRIPT_DIR/../../argus/customize.toml"
  [ -f "$QA_AGENT_TOML" ] && BROWSERS=$(grep '^browsers' "$QA_AGENT_TOML" | grep -oE '(chromium|firefox|webkit)' | paste -sd,)
fi
: "${BROWSERS:?Cannot resolve browser list}"

# Build flags
PROJECT_FLAGS=()
IFS=',' read -ra BR <<< "$BROWSERS"
for b in "${BR[@]}"; do
  b=$(echo "$b" | tr -d '[:space:]'); [[ -n "$b" ]] && PROJECT_FLAGS+=("--project=$b")
done

HEADED_FLAG=()
[ "$HEADLESS" = "false" ] && HEADED_FLAG=("--headed")

echo "▶ npx playwright test"
echo "    spec:     $SPEC"
echo "    config:   $CONFIG"
echo "    browsers: $BROWSERS"
echo "    headless: $HEADLESS  workers: $WORKERS"
echo ""

cd "$PROJECT_ROOT"
QA_RUN_DIR="$RUN_DIR" npx playwright test "$SPEC" \
  --config "$CONFIG" \
  "${PROJECT_FLAGS[@]}" \
  "${HEADED_FLAG[@]}" \
  --workers="$WORKERS"


