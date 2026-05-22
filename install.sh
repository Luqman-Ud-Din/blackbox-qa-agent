#!/usr/bin/env bash
# Argus QA Plugin - Local Installer (Linux / macOS)
# Usage: bash install.sh

set -e

PLUGIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="argus-qa"
PUBLISHER="argus-local"
VERSION="1.0.0"
PLUGIN_KEY="${PLUGIN_NAME}@${PUBLISHER}"
CLAUDE_DIR="$HOME/.claude/plugins"
PLUGINS_JSON="$CLAUDE_DIR/installed_plugins.json"
CACHE_DIR="$CLAUDE_DIR/cache/$PUBLISHER/$PLUGIN_NAME/$VERSION"

echo ""
echo "========================================="
echo "  Argus QA Plugin - Installer"
echo "========================================="
echo ""
echo "Source : $PLUGIN_SRC"
echo "Cache  : $CACHE_DIR"
echo ""

mkdir -p "$CLAUDE_DIR"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

# Step 1 - Copy plugin files to Claude's plugin cache
echo "Step 1: Copying plugin to Claude cache..."
rm -rf "$CACHE_DIR"
mkdir -p "$CACHE_DIR"

rsync -a --exclude="node_modules" --exclude=".tmp" --exclude="runs" \
         --exclude=".git" --exclude="package-lock.json" \
         "$PLUGIN_SRC/" "$CACHE_DIR/" 2>/dev/null \
|| cp -r "$PLUGIN_SRC/." "$CACHE_DIR/"

echo "Done."
echo ""

# Step 2 - Register in installed_plugins.json
echo "Step 2: Registering plugin..."

python3 - <<PYEOF
import json, os

path    = "$PLUGINS_JSON"
key     = "$PLUGIN_KEY"
install = "$CACHE_DIR"
now     = "$NOW"
version = "$VERSION"

data = {"version": 2, "plugins": {}}
if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

data.setdefault("plugins", {})[key] = [{
    "scope":       "user",
    "installPath": install,
    "version":     version,
    "installedAt": now,
    "lastUpdated": now
}]

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print(f"Registered: {key} → {install}")
PYEOF

echo ""

# Step 3 - Write plugin permissions to settings.local.json in the cache
echo "Step 3: Writing plugin permissions..."

SETTINGS_DIR="$CACHE_DIR/.claude"
SETTINGS_PATH="$SETTINGS_DIR/settings.local.json"
mkdir -p "$SETTINGS_DIR"

cat > "$SETTINGS_PATH" <<SETTINGS
{
  "permissions": {
    "allow": [
      "Bash(bash *)",
      "Bash(select-object -first 60)",
      "Bash(claude plugin *)",
      "Bash(claude plugins *)",
      "Bash(ls ${CACHE_DIR}*)",
      "Bash(find ${CACHE_DIR} *)"
    ]
  }
}
SETTINGS

echo "Done."
echo ""

echo "========================================="
echo "  Install complete!"
echo ""
echo "  Close Claude Code completely, then re-open it (plugins load at startup)."
echo "  Then run:"
echo "    /argus-qa:argus"
echo "========================================="
echo ""
