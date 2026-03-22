# claude-code-starter

An opinionated configuration layer for [Claude Code](https://claude.ai/code) that enhances the built-in agents, commands, and hooks with specialized workflows, quality gates, and automation. Fork it, customize it, run the setup script.

## What you get

| Component | Count | What it does |
|-----------|-------|-------------|
| **Agents** | 13 | Specialized sub-agents for planning, code review, TDD, security analysis, architecture decisions |
| **Commands** | 18 | Slash commands like `/tdd`, `/code-review`, `/orchestrate` for opinionated workflows |
| **Rules** | 7 | Coding style, security, testing, and git workflow standards enforced across all sessions |
| **Hooks** | 12 | Auto-formatting, type-checking, context freshness guard, session persistence |
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

That's it. You now have 13 agents, 18 commands, and 12 hooks active.

## What this adds over vanilla Claude Code

| Capability | Claude Code (built-in) | With this starter |
|-----------|----------------------|-------------------|
| Agents | General-purpose | 13 specialized agents with model routing |
| Slash commands | Built-in basics | 18 additional workflow commands (`/tdd`, `/orchestrate`, etc.) |
| Hooks | Framework exists | 9 pre-configured hooks (auto-format, type-check, context guard) |
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
| `session-start.js` | Session Start | Loads previous session context |
| `session-end-obsidian.js` | Session End | Saves session status (optional, needs Obsidian) |
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
