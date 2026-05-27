# Performance Optimization

## Model Selection Strategy

Pick by tier, not version number. Use the latest model in each tier; check Anthropic's current model list for the live IDs.

**Haiku** (cheapest tier, ~90% of Sonnet capability):
- Lightweight agents with frequent invocation
- Pair programming and code generation
- Worker agents in multi-agent systems

**Sonnet** (best coding tier):
- Main development work
- Orchestrating multi-agent workflows
- Complex coding tasks

**Opus** (deepest-reasoning tier):
- Complex architectural decisions
- Maximum reasoning requirements
- Research and analysis tasks

### How this is applied

Models are pinned per-agent in each `.md` frontmatter (e.g. `model: sonnet`). Current tiering:

- **Opus** — architect, planner, security-reviewer, function-analyzer, adversarial-reviewer
- **Sonnet** — code-reviewer, database-reviewer, tdd-guide, semgrep-triager
- **Haiku** — build-error-resolver, doc-updater, e2e-runner, refactor-cleaner, semgrep-scanner

Precedence order (per [Claude Code docs](https://code.claude.com/docs/en/agents.md#choose-a-model)): `CLAUDE_CODE_SUBAGENT_MODEL` env var → per-call `model:` param → agent frontmatter → parent session model. Claude Code does NOT auto-downgrade subagents to cheaper models — tiering is explicit via frontmatter.

## Context Window Management

Avoid last 20% of context window for:
- Large-scale refactoring
- Feature implementation spanning multiple files
- Debugging complex interactions

Lower context sensitivity tasks:
- Single-file edits
- Independent utility creation
- Documentation updates
- Simple bug fixes

## Ultrathink + Plan Mode

For complex tasks requiring deep reasoning:
1. Use `ultrathink` for enhanced thinking
2. Enable **Plan Mode** for structured approach
3. "Rev the engine" with multiple critique rounds
4. Use split role sub-agents for diverse analysis

## Build Troubleshooting

If build fails:
1. Use **build-error-resolver** agent
2. Analyze error messages
3. Fix incrementally
4. Verify after each fix
