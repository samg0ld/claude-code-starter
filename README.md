# claude-code-starter

An opinionated configuration layer for [Claude Code](https://claude.ai/code) that enhances the built-in agents, commands, and hooks with specialized workflows, quality gates, and automation. Fork it, customize it, run the setup script.

## What you get

| Component | Count | What it does |
|-----------|-------|-------------|
| **Agents** | 13 | Specialized sub-agents for planning, code review, TDD, security analysis, architecture decisions |
| **Commands** | 19 | Slash commands like `/tdd`, `/code-review`, `/orchestrate` for opinionated workflows |
| **Rules** | 7 | Coding style, security, testing, and git workflow standards enforced across all sessions |
| **Hooks** | 14 | Auto-formatting, type-checking, context freshness guard, session persistence |
| **Skills** | 2+ | Security scanning skill + your own learned patterns via `/learn` |
| **Contexts** | 3 | Switch between dev, research, and review modes |

## Why this exists

Claude Code ships with agents, slash commands, hooks, and memory out of the box. This starter kit builds on that foundation with opinionated defaults so you don't have to configure everything from scratch:

- **Specialized agents with model routing** — 13 purpose-built agents for planning, code review, TDD, security, architecture, and more. Planner and security reviewer use Opus for deep reasoning; everything else uses Sonnet for cost efficiency.
- **Context freshness guard** — Tracks tool calls and context window usage, warns at thresholds, and prevents degraded responses from stale context.
- **Session persistence** — Session hooks save context so the next session can pick up where you left off.
- **Continuous learning** — Run `/learn` after solving a non-trivial problem. The pattern is extracted and saved as a skill file that persists across sessions and machines via git.
- **Auto-formatting and type-checking** — After every edit, Prettier formats and `tsc` type-checks automatically. Issues are caught before they compound.
- **Quality-gated orchestration** — `/orchestrate` chains agents together with automatic quality gates between phases. If blockers are found, it fixes and re-checks before proceeding.
- **Cross-platform** — Works on macOS and Windows. Setup scripts handle the differences.

## Quick start

```bash
# Clone
git clone https://github.com/SamG0ld/claude-code-starter ~/Dev/claude-code-starter
cd ~/Dev/claude-code-starter

# Install (copies config to ~/.claude/)
./setup.sh          # macOS/Linux
# .\setup.ps1       # Windows PowerShell

# Restart Claude Code to pick up changes
```

That's it. You now have 13 agents, 18 commands, and 14 hooks active.

## What this adds over vanilla Claude Code

| Capability | Claude Code (built-in) | With this starter |
|-----------|----------------------|-------------------|
| Agents | General-purpose | 13 specialized agents with model routing |
| Slash commands | Built-in basics | 18 additional workflow commands (`/tdd`, `/orchestrate`, etc.) |
| Hooks | Framework exists | 14 pre-configured hooks (auto-format, type-check, context guard, session persistence) |
| Session memory | Memory system | Session hooks that save/restore context automatically |
| Pattern learning | Skills system | `/learn` extracts and saves reusable patterns via git |
| Multi-agent workflows | Manual | `/orchestrate` chains agents with quality gates |
| Rules | Project-level CLAUDE.md | 7 opinionated rules (style, security, testing, git) |

## What's included

### Agents

Specialized sub-agents launched via the Agent tool. Each has a focused prompt and optional model override.

| Agent | When to use |
|-------|-------------|
| `planner` | Complex features, multi-step tasks |
| `architect` | System design, tech decisions |
| `code-reviewer` | After writing code, before committing |
| `tdd-guide` | New features — writes tests first |
| `security-reviewer` | Security-sensitive code |
| `build-error-resolver` | Build failures, type errors |
| `e2e-runner` | Critical user flow testing |
| `refactor-cleaner` | Dead code, tech debt cleanup |
| `doc-updater` | Documentation updates |
| `database-reviewer` | SQL, schema, query optimization |
| `function-analyzer` | Deep per-function analysis |
| `semgrep-scanner` | Static analysis scans |
| `semgrep-triager` | Triage scan findings |

### Slash commands

Type `/` in Claude Code to see all available commands. Key ones:

- **`/tdd`** — Write tests first, then implement. Enforces 80%+ coverage.
- **`/code-review`** — Review code for quality, security, and maintainability
- **`/orchestrate`** — Run a multi-agent pipeline (plan → implement → review → security)
- **`/learn`** — Extract a reusable pattern from the current session
- **`/security-scan`** — Scan for vulnerabilities with regex fallback + static analysis
- **`/build-fix`** — Resolve build and type errors with minimal diffs

### Hooks

Hooks run automatically at specific lifecycle points:

| Hook | When | What it does |
|------|------|-------------|
| `pre-bash-dev-server.js` | Before Bash | Blocks dev server outside tmux |
| `pre-bash-tmux-suggest.js` | Before Bash | Suggests tmux for long-running commands |
| `pre-bash-git-push.js` | Before Bash | Warns before git push |
| `context-guard.js` | Before Edit/Write/Bash | Warns when context window is getting full |
| `post-edit-format.js` | After Edit | Auto-formats with Prettier |
| `post-edit-typecheck.js` | After Edit (.ts/.tsx) | Runs `tsc --noEmit` |
| `post-edit-console-warn.js` | After Edit | Warns about `console.log` |
| `post-bash-pr-log.js` | After Bash | Logs PR URL after `gh pr create` |
| `check-console-log.js` | On Stop | Audits all modified files for console.log |
| `evaluate-session.js` | On Stop | Signals pattern extraction for long sessions |
| `session-start.js` | Session Start | Loads project knowledge (6 files, 30KB budget) |
| `session-end-obsidian.js` | Session End | Saves status, extracts insights, writes monthly logs |
| `pre-compact.js` | Before Compact | Saves state before context compression |

### Rules

Loaded as project instructions in every session:

- **coding-style** — Immutability, small files, error handling
- **security** — No hardcoded secrets, input validation, OWASP awareness
- **testing** — 80% coverage minimum, TDD workflow
- **git-workflow** — Conventional commits, PR workflow
- **patterns** — API response format, repository pattern, custom hooks
- **agents** — When and how to use each agent
- **performance** — Model selection strategy, context window management

## Customization

### Add your own agent

Create `agents/my-agent.md`:

```markdown
You are a specialized agent for [purpose].

## When to use
[Trigger conditions]

## How to approach
[Instructions]
```

Run `./setup.sh` to install.

### Add your own slash command

Create `config/commands/my-command.md` with the command prompt. The filename becomes `/my-command`.

### Add your own skill

See `examples/custom-skill-example.md` for a complete walkthrough.

### Add MCP servers

See `examples/mcp-server-example.md` for the full pattern including registration, health checks, and cross-platform setup.

### Obsidian Integration (Optional but Recommended)

The session hooks integrate with [Obsidian](https://obsidian.md) to persist project knowledge across sessions. This is optional — hooks silently no-op if Obsidian isn't configured.

**What it does:**
- **Session start:** Loads up to 6 knowledge files (Status, Session Insights, Tech Debt, Bugs, Architecture, Decisions) with a 30KB budget cap
- **Session end:** Writes session status, extracts insights from your messages, appends to monthly session logs
- **Continuous learning:** Patterns and decisions accumulate in `Session Insights.md` with deduplication (20KB cap)

**Setup:**

1. **Install Obsidian** — Download from [obsidian.md](https://obsidian.md) (free for personal use)

2. **Create your vault structure:**
   ```
   Your-Vault/
   └── Development/
       ├── Logs/           # Monthly session logs (auto-created)
       └── <project-name>/ # One folder per project
           ├── Status.md
           ├── Session Insights.md
           ├── Tech Debt.md
           ├── Bugs.md
           ├── Architecture.md
           └── Decisions.md
   ```
   
   You don't need all files — hooks only load what exists.

3. **Set the environment variable:**
   ```bash
   # Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
   export OBSIDIAN_VAULT="/path/to/your/vault"
   ```

4. **Project name mapping:**
   - By default, hooks use your `~/Dev/<project-name>` directory name
   - To override, edit `config/scripts/lib/obsidian.js` and add to `PROJECT_MAP`

**Recommended Obsidian plugins:**
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) — Query your session data
- [Templater](https://github.com/SilentVoid13/Templater) — Templates for new project folders

**Without Obsidian:**
All session hooks check for the vault and skip gracefully if not found. You lose session persistence but everything else works normally.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_TIMEZONE` | System timezone | Timezone for date/time in hooks and logs |
| `CLAUDE_DEV_ROOT` | (none) | Additional project root directory |
| `OBSIDIAN_VAULT` | (none) | Path to Obsidian vault for session persistence |
| `CLAUDE_PACKAGE_MANAGER` | Auto-detected | Force a specific package manager (npm/pnpm/yarn/bun) |

## Platform support

| Item | macOS | Windows |
|------|-------|---------|
| Setup script | `./setup.sh` | `.\setup.ps1` |
| Learned skills link | symlink | junction (`mklink /J`) |
| MCP server command | direct path or `bash` | `cmd /c` wrapper |
| Python venvs | `source .venv/bin/activate` | `.venv\Scripts\activate` |

## Health check

Verify all your MCP servers are healthy:

```bash
node ~/.claude/scripts/check-mcp-health.js
```

## Context Management

Session hooks and context management are designed around Anthropic's guidance on context rot and session hygiene.

**Key principles:**
- **Context rot is real** — Performance degrades as context expands. Use `/clear` for new tasks.
- **Subagents for isolation** — Use when task generates intermediate output you won't need again.
- **Compact with hints** — `pre-compact.js` reads `Focus.md` and git context to guide compaction.
- **Handoff for transitions** — `/handoff` creates structured summaries before `/clear` or rewind.

| Situation | Action |
|-----------|--------|
| New task | `/clear` (session hooks reload context from Obsidian) |
| Wrong approach | Rewind (`Esc Esc`), use `/handoff` first to document what failed |
| Stale context | `/compact` with hint, or let `pre-compact.js` provide one |
| Lots of intermediate output | Delegate to subagent |

### Focus.md

Create `Development/<project>/Focus.md` in your Obsidian vault with a single line describing your current task focus. This file is:
- Loaded first at session start (highest priority)
- Read by `pre-compact.js` to guide compaction summaries

Example content:
```
Implementing OAuth flow for the billing integration
```

## License

MIT

Maintained by [@SamG0ld](https://github.com/SamG0ld)

## Prerequisites

| Dependency | Required | What needs it |
|------------|----------|---------------|
| [Node.js](https://nodejs.org) | Yes (18+) | Hooks, health check |
| [Claude Code CLI](https://claude.ai/code) | Yes | Everything |
| [Git](https://git-scm.com) | Yes | Clone and sync |
| [Obsidian](https://obsidian.md) | Optional | Session persistence, knowledge loading |

## Credits

Built on [Claude Code](https://claude.ai/code) by [Anthropic](https://anthropic.com).

**References:**
- [Claude Code: Session Management and 1M Context](https://claude.com/blog/using-claude-code-session-management-and-1m-context) — Anthropic's guide to context rot, compaction, rewind, and subagents
- [Andrej Karpathy's Claude Code setup](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — Inspiration for session persistence hooks
