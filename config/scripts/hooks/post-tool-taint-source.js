#!/usr/bin/env node
/**
 * post-tool-taint-source.js — PostToolUse hook (taint source marker)
 *
 * If the tool that just ran is an untrusted-content source (web fetch/search,
 * inbound email/chat), mark the session tainted so the PreToolUse sink gate
 * (pre-tool-taint-gate.js) will require confirmation before the next outbound action.
 *
 * Fail-open: any error exits 0 and does nothing. Never blocks or breaks a session.
 *
 * Env: TAINT_GATE_DISABLE=1 disables taint tracking entirely.
 */

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  if (data.length < 2_000_000) data += c;
});
process.stdin.on('end', () => {
  try {
    if (process.env.TAINT_GATE_DISABLE === '1') return done();
    const input = data.trim() ? JSON.parse(data) : {};
    const toolName = input.tool_name;
    const sessionId = input.session_id || null;

    const taint = require('../lib/taint');
    if (taint.isUntrustedSource(toolName)) {
      taint.setTaint(sessionId, toolName);
    }
  } catch {
    /* fail-open */
  }
  done();
});
process.stdin.on('error', done);

function done() {
  process.exit(0);
}
