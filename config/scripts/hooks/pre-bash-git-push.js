#!/usr/bin/env node
/**
 * Pre-Bash Hook: Warn before git push
 *
 * Non-blocking warning when about to push. Logs to stderr
 * and passes through stdin unchanged.
 */

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const cmd = input.tool_input?.command || '';
    if (/\bgit\s+push\b/.test(cmd)) {
      console.error('[Hook] Review changes before push...');
      console.error('[Hook] Continuing with push (remove this hook to add interactive review)');
    }
  } catch (err) { console.error('[Hook] parse error:', err.message); }
  console.log(data);
});
