#!/usr/bin/env bash
# generate-config.sh — produces .tmp/qa-<run-id>/playwright.config.ts
# Usage: BROWSERS="chromium,firefox,webkit" WORKERS=12 bash {skill-root}/scripts/generate-config.sh <run-id>
# WORKERS is derived by the agent as browsers.length * 4; BROWSERS is the comma-separated list.

set -e

RUN_ID="${1:?usage: generate-config.sh <run-id>}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SKILL_DIR=$(cd "$SCRIPT_DIR/.." && pwd)              # qa-spec-runner/
PROJECT_ROOT=$(cd "$SCRIPT_DIR/../../../.." && pwd)  # project root (4 levels up from scripts/)
TEMPLATE="$SKILL_DIR/templates/playwright.config.template.ts"
OUT_DIR="$PROJECT_ROOT/.tmp/$RUN_ID"
OUT="$OUT_DIR/playwright.config.ts"

mkdir -p "$OUT_DIR"

# ── Read customize.toml values ────────────────────────────────────────────────
get_toml_value() {
  awk -F'=' -v k="$1" '
    $0 ~ "^[[:space:]]*"k"[[:space:]]*=" {
      v=$2
      sub(/[[:space:]]*#.*$/, "", v)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      gsub(/^"|"$/, "", v)
      print v; exit
    }
  ' "$2"
}

# Env vars set by the agent (from resolvedConfig) always win over customize.toml defaults
WORKERS="${WORKERS:-$(get_toml_value "workers"  "$SKILL_DIR/customize.toml")}"
HEADLESS="${HEADLESS:-$(get_toml_value "headless" "$SKILL_DIR/customize.toml")}"
TIMEOUT_MS=$(get_toml_value "timeout_ms" "$SKILL_DIR/customize.toml")

# headless:false → always fullyParallel:true (all browsers visible simultaneously)
if [[ "$HEADLESS" == "false" ]]; then
  FULLY_PARALLEL="true"
else
  FULLY_PARALLEL=$(get_toml_value "fully_parallel" "$SKILL_DIR/customize.toml")
  FULLY_PARALLEL="${FULLY_PARALLEL:-true}"
fi

: "${BROWSERS:?BROWSERS env var must be set (e.g. chromium,firefox,webkit)}"

# ── Build projects block ──────────────────────────────────────────────────────
PROJECTS=""
IFS=',' read -ra BR <<< "$BROWSERS"
for b in "${BR[@]}"; do
  b=$(echo "$b" | tr -d '[:space:]')
  case "$b" in
    chromium) PROJECTS+="    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },"$'\n' ;;
    firefox)  PROJECTS+="    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },"$'\n' ;;
    webkit)   PROJECTS+="    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },"$'\n' ;;
    *) echo "⚠ unknown browser '$b' — skipping" >&2 ;;
  esac
done

# ── Substitute ────────────────────────────────────────────────────────────────
TMP_PROJECTS=$(mktemp)
printf '%s' "$PROJECTS" > "$TMP_PROJECTS"

awk -v workers="$WORKERS" -v timeout="$TIMEOUT_MS" -v headless="$HEADLESS" -v fp="$FULLY_PARALLEL" -v projfile="$TMP_PROJECTS" '
  /<<WORKERS>>/        { gsub(/<<WORKERS>>/, workers) }
  /<<TIMEOUT_MS>>/     { gsub(/<<TIMEOUT_MS>>/, timeout) }
  /<<HEADLESS>>/       { gsub(/<<HEADLESS>>/, headless) }
  /<<FULLY_PARALLEL>>/ { gsub(/<<FULLY_PARALLEL>>/, fp) }
  /<<PROJECTS>>/       { while ((getline line < projfile) > 0) print line; next }
  { print }
' "$TEMPLATE" > "$OUT"

rm -f "$TMP_PROJECTS"

# ── Verify ────────────────────────────────────────────────────────────────────
if grep -q '<<' "$OUT"; then
  echo "❌ generate-config.sh: unsubstituted placeholder in $OUT" >&2
  grep -n '<<' "$OUT" >&2; exit 1
fi

echo "✓ Generated $OUT"
echo "   workers=$WORKERS  headless=$HEADLESS  fullyParallel=$FULLY_PARALLEL  browsers=$BROWSERS"
grep -E '^[[:space:]]*(fullyParallel|workers|headless|name:)' "$OUT" | sed 's/^/   /'
