# claude-code-starter

A batteries-included configuration for [Claude Code](https://claude.ai/code) that adds specialized agents, slash commands, automated hooks, and session persistence out of the box. Fork it, customize it, run the setup script.

## What you get

| Component | Count | What it does |
|-----------|-------|-------------|
| **Agents** | 13 | Specialized sub-agents for planning, code review, TDD, security analysis, architecture decisions |
| **Commands** | 19 | Slash commands like `/plan`, `/tdd`, `/code-review`, `/orchestrate` for opinionated workflows |
| **Rules** | 7 | Coding style, security, testing, and git workflow standards enforced across all sessions |
| **Hooks** | 9 | Auto-formatting, type-checking, context freshness guard, session persistence |
| **Skills** | 2+ | Security scanning skill + your own learned patterns via `/learn` |
| **Contexts** | 3 | Switch between dev, research, and review modes |

## Why this exists

A fresh Claude Code install gives you a chat interface with tool access. That's it. No agents, no slash commands, no hooks, no session memory. This starter kit fills those gaps:

- **Agents with model routing** — The planner and security reviewer use Opus for deep reasoning; all other agents use default Sonnet for cost efficiency. Code reviewer runs automatically after you write code.
- **Context freshness guard** — Claude Code doesn't warn you when context is getting stale. This hook tracks tool calls and context window usage, warns at thresholds, and prevents degraded responses.
- **Session persistence** — Sessions end and knowledge is lost. The session hooks save context so the next session can pick up where you left off.
- **Continuous learning** — Run `/learn` after solving a non-trivial problem. The pattern is extracted and saved as a skill file that persists across sessions and machines via git.
- **Auto-formatting and type-checking** — After every edit, Prettier formats and `tsc` type-checks automatically. Issues are caught before they compound.
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

That's it. You now have 13 agents, 19 commands, and 9 hooks active.

## Coming from ChatGPT / Codex?

If you're switching from ChatGPT or GitHub Copilot/Codex to Claude Code, here's what this gives you that those tools don't have:

| Capability | ChatGPT | Codex | Claude Code + this starter |
|-----------|---------|-------|---------------------------|
| Specialized sub-agents | No | No | 13 agents with model routing |
| Custom slash commands | No | No | 19 commands (`/plan`, `/tdd`, `/orchestrate`, etc.) |
| Pre/post tool hooks | No | No | Auto-format, type-check, context guard |
| Session memory | Chat history only | No | Persistent context across sessions |
| Pattern learning | No | No | `/learn` extracts and saves reusable patterns |
| Multi-agent orchestration | No | No | `/orchestrate` chains planner → TDD → reviewer |
| MCP server integration | Plugins (limited) | No | Full MCP protocol for any API |

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

- **`/plan`** — Create an implementation plan, wait for your confirmation before coding
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
| `context-guard.js` | Before Edit/Write/Bash | Warns when context window is getting full |
| `post-edit-format.js` | After Edit | Auto-formats with Prettier |
| `post-edit-typecheck.js` | After Edit (.ts/.tsx) | Runs `tsc --noEmit` |
| `post-edit-console-warn.js` | After Edit | Warns about `console.log` |
| `check-console-log.js` | On Stop | Audits all modified files for console.log |
| `session-start.js` | Session Start | Loads previous session context |
| `session-end-obsidian.js` | Session End | Saves session status (optional, needs Obsidian) |
| `pre-compact.js` | Before Compact | Saves state before context compression |
| `evaluate-session.js` | Session End | Flags sessions worth running `/learn` on |

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

### Optional: Obsidian integration

If you use [Obsidian](https://obsidian.md) as a knowledge base:

1. Set `OBSIDIAN_VAULT=/path/to/your/vault` in your environment
2. The session-start hook loads prior context from `Development/<project>/Status.md`
3. The session-end hook writes status updates and monthly session logs

This is disabled by default if `OBSIDIAN_VAULT` is not set.

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

## License

MIT

## Credits

Built on [Claude Code](https://claude.ai/code) by [Anthropic](https://anthropic.com).
