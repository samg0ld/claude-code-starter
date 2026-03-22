#!/usr/bin/env node
/**
 * Pre-Bash Hook: Block dev server outside tmux
 *
 * Prevents dev servers (npm run dev, pnpm dev, etc.) from running
 * outside tmux, since they'll block the session and logs get lost.
 * Exit code 2 = BLOCK the command.
 */

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const cmd = input.tool_input?.command || '';
    if (/(npm run dev\b|pnpm( run)? dev\b|yarn dev\b|bun run dev\b)/.test(cmd)) {
      console.error('[Hook] BLOCKED: Dev server must run in tmux for log access');
      console.error('[Hook] Use: tmux new-session -d -s dev "npm run dev"');
      console.error('[Hook] Then: tmux attach -t dev');
      process.exit(2);
    }
  } catch (err) { console.error('[Hook] parse error:', err.message); }
  console.log(data);
});
