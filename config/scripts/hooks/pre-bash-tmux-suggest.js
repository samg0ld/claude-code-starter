#!/usr/bin/env node
/**
 * Pre-Bash Hook: Suggest tmux for long-running commands
 *
 * Non-blocking reminder when running build/test/docker commands
 * outside tmux. Prints suggestion to stderr, passes through stdin.
 */

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const cmd = input.tool_input?.command || '';
    if (!process.env.TMUX && /(npm (install|test)|pnpm (install|test)|yarn (install|test)\b|bun (install|test)|cargo build|make\b|docker\b|pytest|vitest|playwright)/.test(cmd)) {
      console.error('[Hook] Consider running in tmux for session persistence');
      console.error('[Hook] tmux new -s dev  |  tmux attach -t dev');
    }
  } catch (err) { console.error('[Hook] parse error:', err.message); }
  console.log(data);
});
