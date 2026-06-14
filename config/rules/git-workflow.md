# Git Workflow

## Commit messages
One line, always: `<type>: <description>` and nothing else. No body, no bullet list, no paragraph unless you explicitly ask for a detailed message. The diff explains the change; the message doesn't need to.

Types: feat, fix, refactor, docs, test, chore, perf, ci

AI attribution (Co-Authored-By, "Generated with Claude Code") is never added, and is also disabled via the `attribution` setting in `~/.claude/settings.json`.

## Pull requests
1. Analyze the full commit history, not just the latest commit (`git diff <base-branch>...HEAD`).
2. Draft a clear PR summary.
3. Include a test plan.
4. Push with `-u` for a new branch.

## Feature workflow
Plan first (use the **planner** agent for complex work), write tests first (**tdd-guide**), code-review after writing (**code-reviewer**, addressing critical and high issues), then commit and push.
