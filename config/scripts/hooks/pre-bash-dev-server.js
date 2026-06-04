#!/usr/bin/env node
/**
 * Pre-Bash Hook: Block dev server outside tmux (only when tmux is available)
 *
 * Prevents dev servers (npm run dev, pnpm dev, etc.) from running in the
 * foreground, since they block the session and logs get lost.
 *
 * The block ONLY applies when `tmux` is actually installed. On hosts without
 * tmux (Windows by default, or a Mac without it), the command is allowed
 * through — forcing a tool that isn't present would be a dead end.
 * Exit code 2 = BLOCK the command.
 */

const { spawnSync } = require('child_process');

function hasTmux() {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(finder, ['tmux'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const cmd = input.tool_input?.command || '';
    if (/(npm run dev\b|pnpm( run)? dev\b|yarn dev\b|bun run dev\b)/.test(cmd) && hasTmux()) {
      console.error('[Hook] BLOCKED: Dev server must run in tmux for log access');
      console.error('[Hook] Use: tmux new-session -d -s dev "npm run dev"');
      console.error('[Hook] Then: tmux attach -t dev');
      process.exit(2);
    }
  } catch (err) { console.error('[Hook] parse error:', err.message); }
  console.log(data);
});
