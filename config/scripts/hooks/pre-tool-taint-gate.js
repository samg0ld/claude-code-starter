#!/usr/bin/env node
/**
 * pre-tool-taint-gate.js — PreToolUse hook (the sink gate)
 *
 * If the session has been tainted by an untrusted-content source AND the tool about
 * to run is an outbound/exfil sink (WebFetch, network Bash, email/calendar writes,
 * chat sends), force a confirmation prompt. This is the live defense against
 * indirect prompt injection: it gates the ACTION rather than trying to detect the
 * (undecidable) malicious content.
 *
 * Decision contract (PreToolUse): print to stdout + exit 0:
 *   {"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *     "permissionDecision":"ask","permissionDecisionReason":"…"}}
 * We only ever use "ask" — never hard-deny.
 *
 * Fail-open everywhere: any error / no taint → exit 0 with no output (normal flow).
 *
 * RESIDUAL RISK (be honest): this is an ADVISORY checkpoint, not a tamper-proof
 * perimeter. It is fail-open and ask-only, so it can never brick a session — but that
 * also means it cannot hard-stop a determined, injection-aware attacker. Known bypasses:
 * egress paths not in the Bash deny-list (some interpreter/cloud variants), and clearing
 * the state file. Attempts to clear/disable the gate are themselves gated (tamper-evident),
 * but a single ungated shell command could still defeat it. It raises cost and surfaces the
 * dangerous moment to a human; it does not guarantee prevention.
 *
 * Env: TAINT_GATE_DISABLE=1 disables the gate entirely.
 */

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  if (data.length < 2_000_000) data += c;
});
process.stdin.on('end', run);
process.stdin.on('error', () => allow());

function allow() {
  process.exit(0); // no output = defer to normal permission flow
}

function run() {
  try {
    if (process.env.TAINT_GATE_DISABLE === '1') return allow();

    const input = data.trim() ? JSON.parse(data) : {};
    const toolName = input.tool_name;
    const toolInput = input.tool_input || {};
    const sessionId = input.session_id || null;

    const taint = require('../lib/taint');
    const state = taint.loadTaint(sessionId);
    if (!state.tainted) return allow();

    const sink = taint.classifySink(toolName, toolInput);
    if (!sink.gated) return allow();

    const last = (state.sources && state.sources[state.sources.length - 1]) || {};
    const src = last.tool ? `${last.tool}${last.at ? ` at ${last.at}` : ''}` : 'an untrusted source';
    const reason =
      `Context was tainted by ${src} (untrusted external content is in this session). ` +
      `This call — ${sink.label} — can send data out or take external action. ` +
      `Confirm it's intended and not acting on injected instructions from fetched/received content. ` +
      `(Disable with TAINT_GATE_DISABLE=1.)`;

    // Write the decision, then exit only after stdout has flushed (so a longer
    // reason can never be truncated and silently drop the "ask").
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: reason,
        },
      }),
      () => process.exit(0)
    );
  } catch {
    allow(); // a gate bug must never break a session
  }
}
