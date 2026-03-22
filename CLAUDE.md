# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

**Portable Claude Code configuration — agents, commands, rules, hooks, skills, and tooling.** Fork this repo, customize it, and run the setup script to bring any machine's Claude Code environment up to speed.

What this means in practice:
- **Edit config here, not in `~/.claude/`** — the setup scripts overwrite `~/.claude/` from this repo (except `settings.json` and `settings.local.json` which are preserved if they exist)
- **Learned skills are symlinked** — `/learn` writes directly to `config/skills/learned/`, which is linked from `~/.claude/skills/learned/`. Commit and push to sync across machines.
- **Hooks and scripts are copied** — after editing hook scripts here, re-run the setup script or manually copy to `~/.claude/scripts/`
- **MCP server registrations live in `~/.claude.json`** — these are per-machine and include credentials, so they are NOT tracked in git

There is no build step, linter, or test suite. The config files are markdown and JSON; scripts are Node.js (builtins only, no npm install needed).

## Architecture

### Config (`config/`)

Installed to `~/.claude/` by setup scripts. Most files are copied (not symlinked), so edits here must be re-installed to take effect. Exception: `learned/` skills are symlinked/junctioned so they stay in sync automatically.

- `settings.template.json` — Uses `$HOME` placeholders, resolved to actual paths at install time
- `rules/` — 7 coding rule files loaded as project instructions
- `commands/` — 24 slash command definitions
- `contexts/` — 3 context profiles (dev, research, review)
- `scripts/hooks/` — Hook scripts for session lifecycle, edit validation, formatting
- `scripts/check-mcp-health.js` — Cross-platform MCP health checker (reads configs from `~/.claude.json`)
- `scripts/lib/` — Shared utilities: `utils.js` (generic), `obsidian.js` (optional Obsidian integration), `package-manager.js` (auto-detection)
- `data/` — Static data files (e.g., security regex patterns)

### Agents (`agents/`)

13 agent definitions installed to `~/.claude/agents/`. These are markdown prompts that define specialized Claude Code behaviors.

| Agent | Purpose | Model |
|-------|---------|-------|
| planner | Implementation planning | Opus (deep reasoning) |
| architect | System design decisions | Default |
| code-reviewer | Code quality review | Default |
| tdd-guide | Test-driven development | Default |
| security-reviewer | Security analysis | Default |
| build-error-resolver | Fix build/type errors | Default |
| e2e-runner | End-to-end testing | Default |
| refactor-cleaner | Dead code cleanup | Default |
| doc-updater | Documentation updates | Default |
| database-reviewer | SQL/schema review | Default |
| function-analyzer | Deep function analysis | Default |
| semgrep-scanner | Static analysis scans | Default |
| semgrep-triager | Triage scan findings | Default |

### Skills (`skills/`)

- `security-scan/` — Hybrid security scanning skill
- `learned/` — Patterns extracted from sessions via `/learn` (symlinked from `~/.claude/skills/learned/`)

### Commands

24 slash commands organized into core and advanced tiers:

**Core** (use these first):
| Command | What it does |
|---------|-------------|
| `/code-review` | Review code for quality and issues |
| `/tdd` | Test-driven development workflow |
| `/build-fix` | Resolve build and type errors |
| `/learn` | Extract reusable patterns from current session |
| `/checkpoint` | Save progress state |
| `/verify` | Run verification checks |
| `/security-scan` | Scan for vulnerabilities |

**Advanced** (multi-agent orchestration):
| Command | What it does |
|---------|-------------|
| `/orchestrate` | Multi-agent pipeline (plan → implement → review) |
| `/multi-plan` | Collaborative planning across models |
| `/multi-execute` | Parallel execution with multiple agents |
| `/multi-workflow` | Full collaborative development workflow |
| `/multi-frontend` | Frontend-focused multi-agent development |
| `/multi-backend` | Backend-focused multi-agent development |

**Utility:**
| Command | What it does |
|---------|-------------|
| `/refactor-clean` | Dead code cleanup |
| `/e2e` | Generate and run E2E tests |
| `/test-coverage` | Analyze test coverage |
| `/update-docs` | Update documentation |
| `/update-codemaps` | Update code maps |
| `/eval` | Evaluate skill/command performance |
| `/audit-context` | Build deep architectural context |
| `/sessions` | Manage session state |
| `/pm2` | PM2 process management setup |

## Setup

### Prerequisites

| Dependency | Version | What needs it |
|------------|---------|---------------|
| Node.js | 18+ | Hooks, health check, MCP servers |
| Claude Code CLI | latest | Everything |
| Git | any | Clone and sync this repo |

### Quick Start

```bash
git clone <this-repo> ~/Dev/claude-code-starter
cd ~/Dev/claude-code-starter

./setup.sh          # macOS/Linux
# .\setup.ps1       # Windows PowerShell
```

### What the setup script does

1. Copies agents, rules, commands, contexts, hooks, and skills to `~/.claude/`
2. Creates a symlink (macOS) or junction (Windows) for `learned/` skills
3. Installs `settings.json` from template (only if one doesn't already exist)
4. Copies standalone scripts (health checker)

### Platform Notes

| Item | macOS | Windows |
|------|-------|---------|
| Setup script | `./setup.sh` | `.\setup.ps1` |
| Learned skills link | symlink (`ln -s`) | junction (`mklink /J`) |
| Python venvs | `source .venv/bin/activate` | `.venv\Scripts\activate` |
| MCP `command` field | `bash` or direct path | `cmd` with `/c` wrapper |

## Customization

### Adding your own agent
Create a `.md` file in `agents/` and re-run setup. See existing agents for the format.

### Adding your own command
Create a `.md` file in `config/commands/`. The filename becomes the slash command name.

### Adding your own skill
Create a directory under `skills/` with a `SKILL.md` inside. See `examples/custom-skill-example.md`.

### Adding MCP servers
See `examples/mcp-server-example.md` for the full pattern.

### Obsidian integration (optional)
Set `OBSIDIAN_VAULT` env var to your vault path. The session-start hook loads prior context from `Development/<project>/Status.md`, and session-end-obsidian writes status updates and monthly session logs. See `config/scripts/lib/obsidian.js`.

### Timezone
Set `CLAUDE_TIMEZONE` env var (e.g., `America/New_York`). Defaults to system timezone.

### Dev roots
Set `CLAUDE_DEV_ROOT` env var if your projects aren't in `~/Dev`. The hooks use this to resolve project names.

## Key Files

| File | Purpose |
|------|---------|
| `setup.sh` / `setup.ps1` | Installers that copy config to `~/.claude/` |
| `config/settings.template.json` | Hook configuration template |
| `config/scripts/check-mcp-health.js` | Verify all MCP servers are healthy |
| `examples/` | Templates for custom skills and MCP servers |
