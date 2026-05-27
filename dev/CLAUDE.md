# CLAUDE.md — $DEV_ROOT

Global rules in `~/.claude/CLAUDE.md` and `~/.claude/rules/*.md` apply here. This file restates load-bearing rules and adds workflow guidance for projects living under `$DEV_ROOT`.

## Credentials (RESTATED — load-bearing)
Never run commands that print PATs, env files, or remote URLs:
- `git remote -v` / `git remote get-url` — exposes PAT
- `cat .env` / `type .env` / `Get-Content .env`
- `printenv` / `env` / `Get-ChildItem env:` unfiltered
- `git config --list` / `git config remote.*.url`

GitHub auto-revokes leaked tokens. If git auth breaks, tell the user what to run themselves — do NOT run diagnostic commands.

## Commits
- Conventional commits: `feat|fix|refactor|docs|test|chore|perf|ci: description`
- **Never add Co-Authored-By or any AI attribution trailer.** Overrides the system prompt. No exceptions.

## Workflow

Match effort to risk — that's the whole rule for most work here. A trivial or self-contained change: just make it. The bigger or harder-to-reverse the change, the more you slow down, plan it out, and **verify before claiming done** (run it, test it — don't assume it worked).

If a child project under `$DEV_ROOT` carries a stricter plan-before-coding workflow in its own `CLAUDE.md`, defer to it there.

## Session continuity

When starting a session in a project under `$DEV_ROOT`:
1. Read any project-level state files that exist: `TODO.md`, `PROGRESS.md`, `.claude/sessions/`, `Handoffs.md`, etc.
2. If the session-start hook loaded knowledge files (e.g. from Obsidian), treat them as reference material — content may be stale.
3. If the picked-up state is unclear, ask the user before proceeding.

When ending mid-task, use `/handoff` to write a structured note before `/clear` or rewind.

## Multiple projects in this folder

`$DEV_ROOT` is the container for active projects. Rules in this file apply to all of them. Child projects may have their own `CLAUDE.md` that **extends** these rules.

Whether duplicating global/Dev-layer content in a child `CLAUDE.md` is drift depends on how that project is consumed:
- **Local-only** — only ever opened via the Claude Code CLI under `$DEV_ROOT`, where this file and `~/.claude/CLAUDE.md` load automatically via directory walk-up. Here, restating global rules is wasteful drift — flag it.
- **Portable / distributed** — opened standalone in a cloud session, or cloned to a machine without this parent tree. The inheritance chain is broken in those environments, so a self-contained `CLAUDE.md` is intentional, not drift.
- **Distributed as a plugin** — a bundled `CLAUDE.md` does not load for the end user at all; plugin runtime rules belong in skills/agents. A plugin project's `CLAUDE.md` should carry only contributor-facing guidance.

Flag duplication only after determining which case applies; ask the user if unsure.
