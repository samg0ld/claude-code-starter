#!/usr/bin/env bash
# Claude Code configuration installer
# Works on macOS and Linux. For Windows, use setup.ps1 or run via Git Bash/WSL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "Installing Claude Code configuration from $SCRIPT_DIR"
echo "Target: $CLAUDE_DIR"
echo ""

# Create directories
mkdir -p "$CLAUDE_DIR"/{agents,rules,commands,contexts,scripts/hooks,scripts/lib,skills}

# sync_dir <src_dir> <dst_dir> <glob>
# Copies files newer than dst (or all with FORCE=1), and removes files in dst
# that no longer exist in src (the repo is source of truth). Set NO_PRUNE=1 to
# keep stale files (e.g. if you have local-only commands you manage by hand).
sync_dir() {
  local src_dir="$1"
  local dst_dir="$2"
  local glob="$3"
  [ -d "$src_dir" ] || return 0
  mkdir -p "$dst_dir"

  local had_nullglob=0
  shopt -q nullglob && had_nullglob=1
  shopt -s nullglob

  for src in "$src_dir"/$glob; do
    local dst="$dst_dir/$(basename "$src")"
    if [ ! -f "$dst" ] || [ "$src" -nt "$dst" ] || [ "${FORCE:-}" = "1" ]; then
      cp "$src" "$dst"
    fi
  done

  if [ "${NO_PRUNE:-}" != "1" ]; then
    for dst in "$dst_dir"/$glob; do
      local src="$src_dir/$(basename "$dst")"
      if [ ! -f "$src" ]; then
        rm "$dst"
        echo "    Pruned stale: $(basename "$dst")"
      fi
    done
  fi

  [ "$had_nullglob" = "0" ] && shopt -u nullglob
}

# Agents
if [ -d "$SCRIPT_DIR/agents" ]; then
  sync_dir "$SCRIPT_DIR/agents" "$CLAUDE_DIR/agents" "*.md"
  echo "  Installed $(ls "$SCRIPT_DIR/agents/"*.md | wc -l | tr -d ' ') agents"
fi

# Skills (copy skill folders, but symlink learned/)
if [ -d "$SCRIPT_DIR/skills" ]; then
  for skill_dir in "$SCRIPT_DIR/skills/"*/; do
    skill_name="$(basename "$skill_dir")"
    [ "$skill_name" = "learned" ] && continue
    cp -r "$skill_dir" "$CLAUDE_DIR/skills/"
  done
  echo "  Installed skills"
fi

# Learned skills — symlink so /learn saves to the repo and syncs across machines
LEARNED_TARGET="$SCRIPT_DIR/config/skills/learned"
LEARNED_LINK="$CLAUDE_DIR/skills/learned"
if [ -d "$LEARNED_TARGET" ]; then
  if [ -L "$LEARNED_LINK" ]; then
    existing="$(readlink "$LEARNED_LINK")"
    if [ "$existing" = "$LEARNED_TARGET" ]; then
      echo "  Learned skills symlink already exists"
    else
      rm "$LEARNED_LINK"
      ln -s "$LEARNED_TARGET" "$LEARNED_LINK"
      echo "  Updated learned skills symlink -> $LEARNED_TARGET (was $existing)"
    fi
  elif [ -d "$LEARNED_LINK" ]; then
    mv "$LEARNED_LINK" "${LEARNED_LINK}.bak"
    ln -s "$LEARNED_TARGET" "$LEARNED_LINK"
    echo "  Backed up learned/ to learned.bak/ and created symlink -> $LEARNED_TARGET"
  else
    ln -s "$LEARNED_TARGET" "$LEARNED_LINK"
    echo "  Created learned skills symlink -> $LEARNED_TARGET"
  fi
else
  echo "  Skipped learned skills (config/skills/learned/ not found — will be created on first /learn)"
fi

# Rules
if [ -d "$SCRIPT_DIR/config/rules" ]; then
  sync_dir "$SCRIPT_DIR/config/rules" "$CLAUDE_DIR/rules" "*.md"
  echo "  Installed $(ls "$SCRIPT_DIR/config/rules/"*.md | wc -l | tr -d ' ') rules"
fi

# Commands
if [ -d "$SCRIPT_DIR/config/commands" ]; then
  sync_dir "$SCRIPT_DIR/config/commands" "$CLAUDE_DIR/commands" "*.md"
  echo "  Installed $(ls "$SCRIPT_DIR/config/commands/"*.md | wc -l | tr -d ' ') commands"
fi

# Contexts
if [ -d "$SCRIPT_DIR/config/contexts" ]; then
  sync_dir "$SCRIPT_DIR/config/contexts" "$CLAUDE_DIR/contexts" "*.md"
  echo "  Installed $(ls "$SCRIPT_DIR/config/contexts/"*.md | wc -l | tr -d ' ') contexts"
fi

# Scripts/hooks
if [ -d "$SCRIPT_DIR/config/scripts" ]; then
  sync_dir "$SCRIPT_DIR/config/scripts/hooks" "$CLAUDE_DIR/scripts/hooks" "*.js"
  sync_dir "$SCRIPT_DIR/config/scripts/lib" "$CLAUDE_DIR/scripts/lib" "*.js"
  # Standalone scripts (health check, etc.)
  [ -f "$SCRIPT_DIR/config/scripts/check-mcp-health.js" ] && cp "$SCRIPT_DIR/config/scripts/check-mcp-health.js" "$CLAUDE_DIR/scripts/"
  echo "  Installed hook scripts"
fi

# Data files (regex patterns, etc.)
if [ -d "$SCRIPT_DIR/config/data" ]; then
  mkdir -p "$CLAUDE_DIR/data"
  cp "$SCRIPT_DIR/config/data/"* "$CLAUDE_DIR/data/"
  echo "  Installed data files"
fi

# Statusline (cross-platform Node.js version)
if [ -f "$SCRIPT_DIR/config/statusline.js" ]; then
  cp "$SCRIPT_DIR/config/statusline.js" "$CLAUDE_DIR/statusline.js"
  echo "  Installed statusline.js"
fi

# Settings — substitute $HOME with actual home dir, only copy if not present
if [ ! -f "$CLAUDE_DIR/settings.json" ]; then
  sed "s|\\\$HOME|$HOME|g" "$SCRIPT_DIR/config/settings.template.json" > "$CLAUDE_DIR/settings.json"
  echo "  Installed settings.json (paths resolved to $HOME)"
else
  echo "  Skipped settings.json (already exists — merge manually if needed)"
fi

if [ ! -f "$CLAUDE_DIR/settings.local.json" ]; then
  cp "$SCRIPT_DIR/config/settings.local.json" "$CLAUDE_DIR/settings.local.json"
  echo "  Installed settings.local.json"
else
  echo "  Skipped settings.local.json (already exists)"
fi

echo ""
echo "Done. Restart Claude Code to pick up changes."
echo ""
echo "Still needed:"
echo "  - MCP servers: run 'claude mcp add <name>' for each server"
echo "  - Credentials: copy .env with real API keys"
echo ""
echo "Tip: Re-run with FORCE=1 to overwrite all files regardless of timestamps"
echo "     Re-run with NO_PRUNE=1 to keep files in ~/.claude/ that aren't in this repo"
