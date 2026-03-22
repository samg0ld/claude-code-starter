#!/usr/bin/env node
/**
 * Post-Bash Hook: Log PR URL after gh pr create
 *
 * Extracts the PR URL from `gh pr create` output and logs it
 * with a review command hint.
 */

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const cmd = input.tool_input?.command || '';
    if (/gh pr create/.test(cmd)) {
      const out = input.tool_output?.output || '';
      const m = out.match(/https:\/\/github.com\/[^/]+\/[^/]+\/pull\/\d+/);
      if (m) {
        console.error('[Hook] PR created: ' + m[0]);
        const repo = m[0].replace(/https:\/\/github.com\/([^/]+\/[^/]+)\/pull\/\d+/, '$1');
        const pr = m[0].replace(/.*\/pull\/(\d+)/, '$1');
        console.error('[Hook] To review: gh pr review ' + pr + ' --repo ' + repo);
      }
    }
  } catch (err) { console.error('[Hook] parse error:', err.message); }
  console.log(data);
});
