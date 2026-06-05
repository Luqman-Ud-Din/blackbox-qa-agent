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

# Step 3 - Install Node dependencies (incl. playwright) in the cache directory
echo "Step 3: Installing Node dependencies..."
( cd "$CACHE_DIR" && npm install --omit=dev >/dev/null 2>&1 ) \
  && echo "  [OK] Node packages installed" \
  || echo "  WARNING: npm install failed — open a terminal in $CACHE_DIR and run: npm install"
echo ""

# Step 4 - Install Playwright browser binaries (chromium, firefox, webkit)
echo "Step 4: Installing Playwright browser binaries (may take a few minutes)..."
( cd "$CACHE_DIR" && npx --yes playwright install chromium firefox webkit ) \
  && echo "  [OK] Browser binaries ready (chromium, firefox, webkit)" \
  || echo "  WARNING: browser install failed — run 'npx playwright install' in $CACHE_DIR"
echo ""

# Step 5 - Create default .claude/automation.config.json (if absent)
echo "Step 5: Creating default config..."
DOT_CLAUDE="$CACHE_DIR/.claude"
DEFAULT_CONFIG="$DOT_CLAUDE/automation.config.json"
mkdir -p "$DOT_CLAUDE"
if [ ! -f "$DEFAULT_CONFIG" ]; then
  cat > "$DEFAULT_CONFIG" <<'CFG'
{
  "version": "1.0.0",
  "ado": { "org": "{{ADO_ORG}}", "project": "{{ADO_PROJECT}}", "apiVersion": "7.1", "patEnvVar": "AZURE_DEVOPS_PAT" },
  "responsiveness": {
    "viewports": [
      { "name": "Mobile",  "deviceClass": "mobile",  "width": 375,  "height": 667 },
      { "name": "Tablet",  "deviceClass": "tablet",  "width": 768,  "height": 1024 },
      { "name": "Laptop",  "deviceClass": "laptop",  "width": 1280, "height": 800 },
      { "name": "Desktop", "deviceClass": "desktop", "width": 1920, "height": 1080 }
    ],
    "apps": [],
    "crossBrowser": { "enabled": true, "browsers": ["chromium"] },
    "headless": true
  },
  "dry_run": true
}
CFG
  echo "  [OK] Default automation.config.json created"
else
  echo "  [OK] automation.config.json already exists - skipped"
fi
echo ""

# Step 6 - Write plugin permissions to settings.local.json
echo "Step 6: Writing plugin permissions..."
SETTINGS_DIR="$CACHE_DIR/.claude"
SETTINGS_PATH="$SETTINGS_DIR/settings.local.json"
mkdir -p "$SETTINGS_DIR"
cat > "$SETTINGS_PATH" <<'SETTINGS'
{
  "permissions": {
    "allow": [
      "Bash(bash *)", "Bash(sh *)", "Bash(node *)", "Bash(npx *)", "Bash(npm *)",
      "Bash(curl *)", "Bash(jq *)", "Bash(git *)", "Bash(mkdir *)", "Bash(ls *)",
      "Bash(cat *)", "Bash(echo *)", "Bash(which *)", "Bash(chmod *)", "Bash(grep *)",
      "Bash(find *)", "Bash(cp *)", "Bash(mv *)", "Bash(rm *)", "Bash(head *)", "Bash(tail *)"
    ]
  }
}
SETTINGS
echo "  [OK] permissions written"
echo ""

# Step 7 - Install Playwright MCP globally (browser bridge for interactive tests)
echo "Step 7: Installing Playwright MCP server..."
npm install -g "@playwright/mcp@latest" >/dev/null 2>&1 \
  && echo "  [OK] @playwright/mcp installed globally" \
  || echo "  WARNING: @playwright/mcp install failed — interactive tests need it (npm install -g @playwright/mcp@latest)"
echo ""

# Step 8 - Verify jq (needed only when filing real ADO bugs)
echo "Step 8: Checking jq..."
if command -v jq >/dev/null 2>&1; then
  echo "  [OK] jq $(jq --version)"
else
  echo "  WARNING: jq not found. Needed only when dry_run=false (filing real ADO bugs)."
  echo "          Install: https://jqlang.github.io/jq/download/"
fi
echo ""

# Step 9 - Write .mcp.json so Claude Code finds the Playwright MCP servers
echo "Step 9: Writing project .mcp.json..."
MCP_JSON="$CACHE_DIR/.mcp.json"
cat > "$MCP_JSON" <<'MCP'
{
  "mcpServers": {
    "playwright":         { "command": "npx", "args": ["@playwright/mcp@latest", "--isolated", "--browser", "chromium"] },
    "pw-chromium-mobile": { "command": "npx", "args": ["@playwright/mcp@latest", "--isolated", "--browser", "chromium"] },
    "pw-chromium-tablet": { "command": "npx", "args": ["@playwright/mcp@latest", "--isolated", "--browser", "chromium"] },
    "pw-chromium-laptop": { "command": "npx", "args": ["@playwright/mcp@latest", "--isolated", "--browser", "chromium"] }
  }
}
MCP
echo "  [OK] .mcp.json written"
echo ""

echo "========================================="
echo "  Install complete!"
echo ""
echo "  [OK] Plugin copied + registered"
echo "  [OK] Node packages + Playwright browsers installed"
echo "  [OK] Default config + permissions + .mcp.json written"
echo ""
echo "  Next steps:"
echo "    1. Close Claude Code completely, then re-open it (plugins + MCP load at startup)"
echo "    2. Open your project folder in Claude Code"
echo "    3. Type:  hi   (Argus greets you — paste your app URL to start an audit)"
echo "========================================="
echo ""
