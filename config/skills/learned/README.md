# Learned Skills

This directory is symlinked from `~/.claude/skills/learned/` by the setup scripts. When you run `/learn` in a Claude Code session, extracted patterns are saved here as `.md` files and sync across machines via git.

Skills saved here are automatically loaded into future sessions, teaching Claude to avoid past mistakes and repeat successful approaches.

## How it works

1. During a session, solve a non-trivial problem
2. Run `/learn` — Claude analyzes the session and extracts the pattern
3. A `.md` file is created here with the pattern, solution, and trigger conditions
4. Next session, the pattern is available as context

## File format

```markdown
# Pattern Name

**Extracted:** YYYY-MM-DD
**Context:** When this applies

## Problem
What went wrong or what was solved

## Solution
The technique/workaround/pattern

## When to Use
Trigger conditions
```
