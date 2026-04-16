#!/usr/bin/env node
/**
 * PreCompact Hook - Guide compaction with context hints
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs before Claude compacts context. Outputs hints to stdout so Claude
 * knows what to prioritize in the summary. Reads hints from:
 *   1. Obsidian Focus.md (if configured)
 *   2. Recent git activity (current branch, recent commits)
 *   3. Fallback: generic guidance
 *
 * Reference: https://claude.com/blog/using-claude-code-session-management-and-1m-context
 * "You can steer [compaction] with instructions like /compact focus on the auth refactor"
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  getSessionsDir,
  getDateTimeString,
  getTimeString,
  getProjectRoot,
  findFiles,
  ensureDir,
  appendFile,
  readFile,
  log,
  output
} = require('../lib/utils');

// Optional Obsidian integration
let getObsidianProjectDir;
try {
  ({ getObsidianProjectDir } = require('../lib/obsidian'));
} catch {
  getObsidianProjectDir = () => null;
}

/**
 * Get current git context (branch, recent commits)
 */
function getGitContext(cwd) {
  try {
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const recentCommits = execSync('git log --oneline -3 2>/dev/null', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { branch, recentCommits };
  } catch {
    return null;
  }
}

/**
 * Get focus hint from Obsidian Focus.md
 */
function getFocusFromObsidian(cwd) {
  const projectDir = getObsidianProjectDir ? getObsidianProjectDir(cwd) : null;
  if (!projectDir) return null;

  const focusPath = path.join(projectDir, 'Focus.md');
  const content = readFile(focusPath);
  if (!content) return null;

  // Strip frontmatter and get first non-empty line
  const stripped = content.replace(/^---[\s\S]*?---\n*/, '').trim();
  const firstLine = stripped.split('\n').find(l => l.trim() && !l.startsWith('#'));
  return firstLine ? firstLine.trim() : null;
}

/**
 * Build compaction hint from available context
 */
function buildCompactionHint(cwd) {
  const hints = [];

  // Priority 1: Explicit focus from Obsidian
  const focus = getFocusFromObsidian(cwd);
  if (focus) {
    hints.push(`Current focus: ${focus}`);
  }

  // Priority 2: Git context
  const git = getGitContext(cwd);
  if (git) {
    if (git.branch && git.branch !== 'main' && git.branch !== 'master') {
      hints.push(`Working on branch: ${git.branch}`);
    }
    if (git.recentCommits) {
      const commits = git.recentCommits.split('\n').slice(0, 2).join('; ');
      hints.push(`Recent work: ${commits}`);
    }
  }

  // Build the hint message
  if (hints.length > 0) {
    return `COMPACTION HINT: Prioritize the following in your summary:\n${hints.map(h => `- ${h}`).join('\n')}`;
  }

  // Fallback: generic guidance
  return 'COMPACTION HINT: Prioritize recent tool calls, current task context, and any unresolved errors or blockers.';
}

async function main() {
  const cwd = process.cwd();
  const sessionsDir = getSessionsDir();
  const compactionLog = path.join(sessionsDir, 'compaction-log.txt');

  ensureDir(sessionsDir);

  // Log compaction event with timestamp
  const timestamp = getDateTimeString();
  appendFile(compactionLog, `[${timestamp}] Context compaction triggered\n`);

  // If there's an active session file, note the compaction
  const sessions = findFiles(sessionsDir, '*.tmp');

  if (sessions.length > 0) {
    const activeSession = sessions[0].path;
    const timeStr = getTimeString();
    appendFile(activeSession, `\n---\n**[Compaction occurred at ${timeStr}]** - Context was summarized\n`);
  }

  // Build and output compaction hint
  const hint = buildCompactionHint(cwd);
  output(hint);

  log('[PreCompact] Compaction hint provided');
  process.exit(0);
}

main().catch(err => {
  console.error('[PreCompact] Error:', err.message);
  process.exit(0);
});
