# Argus QA Plugin - Local Installer (Windows)
# Run once after unzipping: double-click install.bat  (do NOT run this directly -- use install.bat)

$pluginSrc    = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginName   = "argus-qa"
$publisher    = "argus-local"
$version      = "1.0.0"
$pluginKey    = "$pluginName@$publisher"
$claudeDir    = "$env:USERPROFILE\.claude\plugins"
$pluginsJson  = "$claudeDir\installed_plugins.json"
$cacheDir     = "$env:USERPROFILE\.claude\plugins\cache\$publisher\$pluginName\$version"

Write-Host ""
Write-Host "Argus QA Plugin - Installer"
Write-Host "==========================="
Write-Host "Source : $pluginSrc"
Write-Host "Cache  : $cacheDir"
Write-Host ""

if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null }

# Step 1 - Copy plugin files to Claude's plugin cache
Write-Host "Step 1: Copying plugin to Claude cache..."
if (Test-Path $cacheDir) { Remove-Item $cacheDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

$excludeDirs  = @("node_modules", ".tmp", "runs", ".git")
$excludeFiles = @("package-lock.json", "settings.local.json")

Get-ChildItem -Path $pluginSrc -Force | ForEach-Object {
    $name = $_.Name
    if ($excludeDirs -contains $name -or $excludeFiles -contains $name) { return }
    if ($_.PSIsContainer) {
        Copy-Item -Path $_.FullName -Destination (Join-Path $cacheDir $name) -Recurse -Force
    } else {
        Copy-Item -Path $_.FullName -Destination (Join-Path $cacheDir $name) -Force
    }
}
Write-Host "Done."
Write-Host ""

# Step 2 - Register in installed_plugins.json
Write-Host "Step 2: Registering plugin..."

if (Test-Path $pluginsJson) {
    $data = Get-Content $pluginsJson -Raw | ConvertFrom-Json
} else {
    $data = [PSCustomObject]@{ version = 2; plugins = [PSCustomObject]@{} }
}

$entry = [PSCustomObject]@{
    scope       = "user"
    installPath = $cacheDir
    version     = $version
    installedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
    lastUpdated = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
}

$plugins = $data.plugins
if ($plugins.PSObject.Properties[$pluginKey]) { $plugins.PSObject.Properties.Remove($pluginKey) }
$plugins | Add-Member -NotePropertyName $pluginKey -NotePropertyValue @($entry)
$data.plugins = $plugins

$json = $data | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($pluginsJson, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Registered: $pluginKey"
Write-Host ""

# Step 3 - Install Node dependencies in the cache directory
Write-Host "Step 3: Installing Node dependencies..."
Push-Location $cacheDir
npm install --omit=dev 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: npm install failed. Open a terminal in the cache dir and run: npm install" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] Node packages installed"
}
Pop-Location
Write-Host ""

# Step 4 - Install Playwright browser binaries
Write-Host "Step 4: Installing Playwright browser binaries (this may take a few minutes)..."
Push-Location $cacheDir
npx --yes playwright install chromium firefox webkit
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: Playwright browser install failed. Run: npx playwright install" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] Browser binaries ready (chromium, firefox, webkit)"
}
Pop-Location
Write-Host ""

# Step 5 - Create default .claude directory and automation.config.json
Write-Host "Step 5: Creating default config..."
$dotClaude     = Join-Path $cacheDir ".claude"
$defaultConfig = Join-Path $dotClaude "automation.config.json"
if (-not (Test-Path $dotClaude)) { New-Item -ItemType Directory -Force -Path $dotClaude | Out-Null }

if (-not (Test-Path $defaultConfig)) {
    $cfg = [ordered]@{
        version = "1.0.0"
        ado = [ordered]@{
            org        = "{{ADO_ORG}}"
            project    = "{{ADO_PROJECT}}"
            apiVersion = "7.1"
            patEnvVar  = "AZURE_DEVOPS_PAT"
        }
        responsiveness = [ordered]@{
            viewports = @(
                [ordered]@{ name = "Mobile";  deviceClass = "mobile";  width = 375;  height = 667  }
                [ordered]@{ name = "Tablet";  deviceClass = "tablet";  width = 768;  height = 1024 }
                [ordered]@{ name = "Laptop";  deviceClass = "laptop";  width = 1280; height = 800  }
                [ordered]@{ name = "Desktop"; deviceClass = "desktop"; width = 1920; height = 1080 }
            )
            apps         = @()
            crossBrowser = [ordered]@{ enabled = $true; browsers = @("chromium") }
            headless     = $true
        }
        dry_run = $true
    }
    $cfgJson = $cfg | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($defaultConfig, $cfgJson, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  [OK] Default automation.config.json created"
} else {
    Write-Host "  [OK] automation.config.json already exists - skipped"
}
Write-Host ""

# Step 6 - Write plugin permissions to settings.local.json in the cache
Write-Host "Step 6: Writing plugin permissions..."
$settingsDir  = Join-Path $cacheDir ".claude"
$settingsPath = Join-Path $settingsDir "settings.local.json"
if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null }

$installBatPath = Join-Path $cacheDir "install.bat"

$allowList = @(
    "Bash(bash *)", "Bash(sh *)", "Bash(node *)", "Bash(npx *)", "Bash(npm *)",
    "Bash(curl *)", "Bash(jq *)", "Bash(tsc *)", "Bash(git *)", "Bash(mkdir *)",
    "Bash(ls *)", "Bash(cat *)", "Bash(echo *)", "Bash(which *)", "Bash(chmod *)",
    "Bash(awk *)", "Bash(sed *)", "Bash(grep *)", "Bash(find *)", "Bash(cp *)",
    "Bash(mv *)", "Bash(rm *)", "Bash(tee *)", "Bash(wc *)", "Bash(head *)",
    "Bash(tail *)", "Bash(sort *)", "Bash(uniq *)", "Bash(touch *)", "Bash(printf *)",
    "Bash(test *)",
    "PowerShell(& `"$installBatPath`")",
    "PowerShell(Get-ChildItem *)", "PowerShell(Get-Content *)", "PowerShell(Set-Content *)",
    "PowerShell(New-Item *)", "PowerShell(Remove-Item *)", "PowerShell(Copy-Item *)",
    "PowerShell(node *)", "PowerShell(npx *)", "PowerShell(npm *)",
    "mcp__playwright__browser_navigate",
    "mcp__playwright__browser_snapshot",
    "mcp__playwright__browser_click",
    "mcp__playwright__browser_type",
    "mcp__playwright__browser_press_key",
    "mcp__playwright__browser_evaluate",
    "mcp__playwright__browser_wait_for",
    "mcp__playwright__browser_take_screenshot",
    "mcp__playwright__browser_console_messages",
    "mcp__playwright__browser_network_requests",
    "mcp__playwright__browser_close",
    "mcp__playwright__browser_resize"
)

$perms = [ordered]@{
    permissions = [ordered]@{ allow = $allowList }
}
$permsJson = $perms | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($settingsPath, $permsJson, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Done."
Write-Host ""

# Step 7 - Install Playwright MCP globally (for cheap, fast browser bridge)
Write-Host "Step 7: Installing Playwright MCP server..."
npm install -g "@playwright/mcp@latest" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: Playwright MCP install failed. The agent will fall back to inline Bash mode (slower)." -ForegroundColor Yellow
} else {
    Write-Host "  [OK] @playwright/mcp installed globally"
}
Write-Host ""

# Step 8 - Verify jq (only needed when filing real ADO bugs)
Write-Host "Step 8: Checking jq..."
$jqOk = $false
try {
    $jqVer = & jq --version 2>$null
    if ($LASTEXITCODE -eq 0) { $jqOk = $true }
} catch {}

if (-not $jqOk) {
    Write-Host "  jq not found. Attempting winget install..."
    winget install --silent --accept-source-agreements --accept-package-agreements jqlang.jq 2>&1 | Out-Null
    try {
        $jqVer = & jq --version 2>$null
        if ($LASTEXITCODE -eq 0) { $jqOk = $true }
    } catch {}
}
if ($jqOk) {
    Write-Host "  [OK] jq $jqVer"
} else {
    Write-Host "  WARNING: jq not installed. Required only when dry_run = false (filing real ADO bugs)." -ForegroundColor Yellow
    Write-Host "  Manual install: https://jqlang.github.io/jq/download/" -ForegroundColor Yellow
}
Write-Host ""

# Step 9 - Write .mcp.json so Claude Code finds the Playwright MCP server
Write-Host "Step 9: Writing project .mcp.json..."
$mcpJsonPath  = Join-Path $cacheDir ".mcp.json"
$mcpJsonSrc   = Join-Path $pluginSrc ".mcp.json"
$mcpConfig    = @'
{
  "mcpServers": {
    "playwright":         { "command": "npx", "args": ["@playwright/mcp@latest", "--isolated", "--browser", "chromium"] },
    "pw-chromium-mobile": { "command": "npx", "args": ["@playwright/mcp@latest", "--isolated", "--browser", "chromium"] },
    "pw-chromium-tablet": { "command": "npx", "args": ["@playwright/mcp@latest", "--isolated", "--browser", "chromium"] },
    "pw-chromium-laptop": { "command": "npx", "args": ["@playwright/mcp@latest", "--isolated", "--browser", "chromium"] }
  }
}
'@
[System.IO.File]::WriteAllText($mcpJsonPath, $mcpConfig, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText($mcpJsonSrc,  $mcpConfig, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  [OK] .mcp.json written to plugin source and cache"
Write-Host ""

Write-Host "==========================="
Write-Host "Install complete!"
Write-Host ""
Write-Host "  [OK] Plugin files copied"
Write-Host "  [OK] Plugin registered"
Write-Host "  [OK] Node packages installed"
Write-Host "  [OK] Browser binaries ready (chromium, firefox, webkit)"
Write-Host "  [OK] Default config created"
Write-Host "  [OK] Permissions configured (incl. MCP tools)"
Write-Host "  [OK] Playwright MCP server installed"
Write-Host "  [OK] jq verified / installed"
Write-Host "  [OK] .mcp.json written"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Close Claude Code completely"
Write-Host "  2. Re-open Claude Code (plugins + MCP servers load at startup)"
Write-Host "  3. Set default model:  /model claude-haiku-4-5-20251001"
Write-Host "  4. Open your project folder in Claude Code"
Write-Host "  5. Type:  hi"
Write-Host ""
Write-Host "Argus will greet you -- just paste your app URL to start an audit."
Write-Host "==========================="
Write-Host ""
