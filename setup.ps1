# Claude Code configuration installer for Windows
# Run from PowerShell: .\setup.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$Force = $args -contains "-Force"

Write-Host "Installing Claude Code configuration from $ScriptDir"
Write-Host "Target: $ClaudeDir"
Write-Host ""

# Create directories
$dirs = @("agents", "rules", "commands", "contexts", "scripts\hooks", "scripts\lib", "skills")
foreach ($dir in $dirs) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir $dir) | Out-Null
}

# Agents
if (Test-Path "$ScriptDir\agents") {
    Get-ChildItem "$ScriptDir\agents\*.md" | ForEach-Object {
        $dst = Join-Path $ClaudeDir "agents\$($_.Name)"
        if ($Force -or -not (Test-Path $dst) -or $_.LastWriteTime -gt (Get-Item $dst).LastWriteTime) {
            Copy-Item $_.FullName $dst -Force
        }
    }
    $count = (Get-ChildItem "$ScriptDir\agents\*.md").Count
    Write-Host "  Installed $count agents"
}

# Skills (copy skill folders, but symlink learned/)
if (Test-Path "$ScriptDir\skills") {
    Get-ChildItem "$ScriptDir\skills" -Directory | Where-Object { $_.Name -ne "learned" } | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $ClaudeDir "skills\$($_.Name)") -Recurse -Force
    }
    Write-Host "  Installed skills"
}

# Learned skills — junction so /learn saves to the repo and syncs across machines
$learnedTarget = Join-Path $ScriptDir "config\skills\learned"
$learnedLink = Join-Path $ClaudeDir "skills\learned"
if (Test-Path $learnedTarget) {
    if (Test-Path $learnedLink) {
        $item = Get-Item $learnedLink -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            $existingTarget = ($item | Select-Object -ExpandProperty Target)[0]
            if ($existingTarget -eq $learnedTarget) {
                Write-Host "  Learned skills junction already exists"
            } else {
                Remove-Item $learnedLink -Force
                cmd /c mklink /J "$learnedLink" "$learnedTarget" | Out-Null
                Write-Host "  Updated learned skills junction -> $learnedTarget (was $existingTarget)"
            }
        } else {
            $backupPath = "${learnedLink}.bak"
            Move-Item $learnedLink $backupPath -Force
            cmd /c mklink /J "$learnedLink" "$learnedTarget" | Out-Null
            Write-Host "  Backed up learned/ to learned.bak/ and created junction -> $learnedTarget"
        }
    } else {
        cmd /c mklink /J "$learnedLink" "$learnedTarget" | Out-Null
        Write-Host "  Created learned skills junction -> $learnedTarget"
    }
} else {
    Write-Host "  Skipped learned skills (config\skills\learned\ not found - will be created on first /learn)"
}

# Helper: copy if newer (or if -Force)
function Copy-IfNewer {
    param($SrcPattern, $DstDir)
    Get-ChildItem $SrcPattern | ForEach-Object {
        $dst = Join-Path $DstDir $_.Name
        if ($Force -or -not (Test-Path $dst) -or $_.LastWriteTime -gt (Get-Item $dst).LastWriteTime) {
            Copy-Item $_.FullName $dst -Force
        }
    }
}

# Rules
if (Test-Path "$ScriptDir\config\rules") {
    Copy-IfNewer "$ScriptDir\config\rules\*.md" (Join-Path $ClaudeDir "rules")
    $count = (Get-ChildItem "$ScriptDir\config\rules\*.md").Count
    Write-Host "  Installed $count rules"
}

# Commands
if (Test-Path "$ScriptDir\config\commands") {
    Copy-IfNewer "$ScriptDir\config\commands\*.md" (Join-Path $ClaudeDir "commands")
    $count = (Get-ChildItem "$ScriptDir\config\commands\*.md").Count
    Write-Host "  Installed $count commands"
}

# Contexts
if (Test-Path "$ScriptDir\config\contexts") {
    Copy-IfNewer "$ScriptDir\config\contexts\*.md" (Join-Path $ClaudeDir "contexts")
    $count = (Get-ChildItem "$ScriptDir\config\contexts\*.md").Count
    Write-Host "  Installed $count contexts"
}

# Scripts/hooks
if (Test-Path "$ScriptDir\config\scripts") {
    Copy-IfNewer "$ScriptDir\config\scripts\hooks\*.js" (Join-Path $ClaudeDir "scripts\hooks")
    Copy-IfNewer "$ScriptDir\config\scripts\lib\*.js" (Join-Path $ClaudeDir "scripts\lib")
    # Standalone scripts (health check, etc.)
    if (Test-Path "$ScriptDir\config\scripts\check-mcp-health.js") {
        Copy-Item "$ScriptDir\config\scripts\check-mcp-health.js" (Join-Path $ClaudeDir "scripts\check-mcp-health.js") -Force
    }
    Write-Host "  Installed hook scripts"
}

# Data files (regex patterns, etc.)
if (Test-Path "$ScriptDir\config\data") {
    New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir "data") | Out-Null
    Copy-Item "$ScriptDir\config\data\*" (Join-Path $ClaudeDir "data") -Force
    Write-Host "  Installed data files"
}

# Statusline
if (Test-Path "$ScriptDir\config\statusline.js") {
    Copy-Item "$ScriptDir\config\statusline.js" (Join-Path $ClaudeDir "statusline.js") -Force
    Write-Host "  Installed statusline.js"
}

# Settings — substitute $HOME with actual home dir, only copy if not present
$settingsPath = Join-Path $ClaudeDir "settings.json"
if (-not (Test-Path $settingsPath)) {
    $content = Get-Content "$ScriptDir\config\settings.template.json" -Raw
    $content = $content.Replace('$HOME', $env:USERPROFILE.Replace('\', '/'))
    Set-Content -Path $settingsPath -Value $content -Encoding UTF8
    Write-Host "  Installed settings.json (paths resolved to $env:USERPROFILE)"
} else {
    Write-Host "  Skipped settings.json (already exists - merge manually if needed)"
}

$localSettingsPath = Join-Path $ClaudeDir "settings.local.json"
if (-not (Test-Path $localSettingsPath)) {
    Copy-Item "$ScriptDir\config\settings.local.json" $localSettingsPath
    Write-Host "  Installed settings.local.json"
} else {
    Write-Host "  Skipped settings.local.json (already exists)"
}

Write-Host ""
Write-Host "Done. Restart Claude Code to pick up changes."
Write-Host ""
Write-Host "Still needed:"
Write-Host "  - MCP servers: run 'claude mcp add <name>' for each server"
Write-Host "  - Credentials: copy .env with real API keys"
Write-Host ""
Write-Host "Tip: Re-run with -Force to overwrite all files regardless of timestamps"
