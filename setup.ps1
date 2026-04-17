# Claude Code configuration installer for Windows
# Run from PowerShell: .\setup.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$Force = $args -contains "-Force"
$NoPrune = $args -contains "-NoPrune"

Write-Host "Installing Claude Code configuration from $ScriptDir"
Write-Host "Target: $ClaudeDir"
Write-Host ""

# Create directories
$dirs = @("agents", "rules", "commands", "contexts", "scripts\hooks", "scripts\lib", "skills")
foreach ($dir in $dirs) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir $dir) | Out-Null
}

# Sync-Dir: copy newer files from src->dst, and prune files in dst that aren't
# in src (the repo is source of truth). Use -NoPrune to keep local-only files.
function Sync-Dir {
    param($SrcDir, $DstDir, $Glob)
    if (-not (Test-Path $SrcDir)) { return }
    New-Item -ItemType Directory -Force -Path $DstDir | Out-Null

    Get-ChildItem (Join-Path $SrcDir $Glob) -ErrorAction SilentlyContinue | ForEach-Object {
        $dst = Join-Path $DstDir $_.Name
        if ($Force -or -not (Test-Path $dst) -or $_.LastWriteTime -gt (Get-Item $dst).LastWriteTime) {
            Copy-Item $_.FullName $dst -Force
        }
    }

    if (-not $NoPrune) {
        Get-ChildItem (Join-Path $DstDir $Glob) -ErrorAction SilentlyContinue | ForEach-Object {
            $src = Join-Path $SrcDir $_.Name
            if (-not (Test-Path $src)) {
                Remove-Item $_.FullName -Force
                Write-Host "    Pruned stale: $($_.Name)"
            }
        }
    }
}

# Agents
if (Test-Path "$ScriptDir\agents") {
    Sync-Dir "$ScriptDir\agents" (Join-Path $ClaudeDir "agents") "*.md"
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

# Rules
if (Test-Path "$ScriptDir\config\rules") {
    Sync-Dir "$ScriptDir\config\rules" (Join-Path $ClaudeDir "rules") "*.md"
    $count = (Get-ChildItem "$ScriptDir\config\rules\*.md").Count
    Write-Host "  Installed $count rules"
}

# Commands
if (Test-Path "$ScriptDir\config\commands") {
    Sync-Dir "$ScriptDir\config\commands" (Join-Path $ClaudeDir "commands") "*.md"
    $count = (Get-ChildItem "$ScriptDir\config\commands\*.md").Count
    Write-Host "  Installed $count commands"
}

# Contexts
if (Test-Path "$ScriptDir\config\contexts") {
    Sync-Dir "$ScriptDir\config\contexts" (Join-Path $ClaudeDir "contexts") "*.md"
    $count = (Get-ChildItem "$ScriptDir\config\contexts\*.md").Count
    Write-Host "  Installed $count contexts"
}

# Scripts/hooks
if (Test-Path "$ScriptDir\config\scripts") {
    Sync-Dir "$ScriptDir\config\scripts\hooks" (Join-Path $ClaudeDir "scripts\hooks") "*.js"
    Sync-Dir "$ScriptDir\config\scripts\lib" (Join-Path $ClaudeDir "scripts\lib") "*.js"
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
Write-Host "     Re-run with -NoPrune to keep files in ~\.claude\ that aren't in this repo"
