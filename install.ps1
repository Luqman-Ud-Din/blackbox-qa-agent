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
    "PowerShell(node *)", "PowerShell(npx *)", "PowerShell(npm *)"
)

$perms = [ordered]@{
    permissions = [ordered]@{ allow = $allowList }
}
$permsJson = $perms | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($settingsPath, $permsJson, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Done."
Write-Host ""

Write-Host "==========================="
Write-Host "Install complete!"
Write-Host ""
Write-Host "  [OK] Plugin files copied"
Write-Host "  [OK] Plugin registered"
Write-Host "  [OK] Node packages installed"
Write-Host "  [OK] Browser binaries ready (chromium, firefox, webkit)"
Write-Host "  [OK] Default config created"
Write-Host "  [OK] Permissions configured"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Close Claude Code completely"
Write-Host "  2. Re-open Claude Code (plugins load at startup)"
Write-Host "  3. Open your project folder in Claude Code"
Write-Host "  4. Type:  hi"
Write-Host ""
Write-Host "Argus will greet you -- just paste your app URL to start an audit."
Write-Host "No further setup needed."
Write-Host "==========================="
Write-Host ""
