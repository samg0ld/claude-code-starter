# Agent Orchestration

## Available Agents

Located in `~/.claude/agents/`. Each agent pins a model in its frontmatter matched to task complexity — see `performance.md` for the tiering rationale.

| Agent | Model | Purpose | When to Use |
|-------|-------|---------|-------------|
| planner | Opus | Implementation planning | Complex features, refactoring |
| architect | Opus | System design | Architectural decisions |
| security-reviewer | Opus | Security analysis | Before commits; user input / auth / sensitive data |
| function-analyzer | Opus | Per-function deep analysis | Security audit context building |
| code-reviewer | Sonnet | Code review | After writing code |
| database-reviewer | Sonnet | PostgreSQL review | SQL / schema / migration work |
| tdd-guide | Sonnet | Test-driven development | New features, bug fixes |
| semgrep-triager | Sonnet | Classify semgrep findings | After semgrep-scanner runs |
| build-error-resolver | Haiku | Fix build errors | When build fails |
| refactor-cleaner | Haiku | Dead code cleanup | Code maintenance |
| doc-updater | Haiku | Documentation | Updating docs / codemaps |
| e2e-runner | Haiku | E2E testing | Critical user flows |
| semgrep-scanner | Haiku | Run semgrep scans | Static analysis |

Override per-call by passing a `model:` param at invocation if an agent needs to be bumped up for a specific task.

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **planner** agent
2. Code just written/modified - Use **code-reviewer** agent
3. Bug fix or new feature - Use **tdd-guide** agent
4. Architectural decision - Use **architect** agent

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth.ts
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utils.ts

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Subagents for Context Isolation

Subagents run with clean context windows. Use them when a task generates lots of intermediate output you won't need again.

**The test:** "Will I need this tool output again, or just the conclusion?"

If just the conclusion → delegate to a subagent. The intermediate noise stays in the child context.

**Good candidates for subagents:**
- Verifying results against specifications (lots of reads, only need pass/fail)
- Reviewing alternate codebases and synthesizing approaches
- Writing documentation based on git changes
- Running test suites and summarizing failures
- Scanning for patterns across many files

**Keep in main context:**
- Debugging sessions where you're iterating on the same code
- Implementation work where prior reads inform next edits
- Conversations where context from earlier matters

Reference: [Claude Code: Session Management and 1M Context](https://claude.com/blog/using-claude-code-session-management-and-1m-context)

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
