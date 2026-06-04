/**
 * taint.js — shared taint-tracking logic for the indirect-injection sink gate
 *
 * Used by:
 *   - hooks/post-tool-taint-source.js  (PostToolUse: marks the session tainted)
 *   - hooks/pre-tool-taint-gate.js     (PreToolUse: gates outbound sinks when tainted)
 * isUntrustedSource is imported from mcp-scan.js (the shared foundation) and re-exported
 * here for the source hook; the audit/scanner import it from mcp-scan.js directly.
 *
 * Model (classic taint analysis):
 *   SOURCE  = a tool that pulls in untrusted external content (web/email/chat)
 *   SINK    = a tool that sends data out / takes external action
 *   GATE    = if the session is tainted by a source, require confirmation before a sink
 *
 * Detection-free by design: it never decides whether content is malicious; it just
 * inserts a human checkpoint before an irreversible/outbound action once untrusted
 * content has entered the context. Node builtins only.
 */

const fs = require('fs');
const path = require('path');

const { getClaudeDir, ensureDir, readFile, writeFile, getDateTimeString } = require('./utils');
// The source classifier is the shared foundation in mcp-scan.js so the audit and the
// gate agree on it without depending on each other.
const { isUntrustedSource } = require('./mcp-scan');

const STATE_DIR = path.join(getClaudeDir(), 'state');
const TAINT_PRUNE_MS = 7 * 86400000; // drop per-session taint files older than 7 days

// Per-session state file (avoids concurrent sessions clobbering each other's taint).
// sessionId is harness-generated, but sanitize anyway so it can never escape STATE_DIR.
function taintFile(sessionId) {
  const safe = String(sessionId || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(STATE_DIR, `taint-gate.${safe}.json`);
}

// ── Sink classifier (outbound / exfil only) ──────────────────────────────────────

// Bash egress detection. These are deliberately several SMALL, independent linear
// tests (each is plain alternation of literals with \b boundaries — no unbounded
// `.*`/`[\s\S]*` with a trailing literal, which is the classic quadratic-backtracking
// trap). Honest scope note: this is a DENY-LIST and cannot be exhaustive — an
// injection-aware attacker can pick an egress path not listed here. The gate is an
// advisory checkpoint that catches realistic/naive exfil, not a tamper-proof control.
const EGRESS_TOOL_RE = /\b(curl|wget|aria2c|axel|nc|ncat|netcat|telnet|scp|sftp|ssh|rsync|ftp|tftp|socat)\b/i;
const EGRESS_PS_RE = /\b(invoke-webrequest|invoke-restmethod|iwr|start-bitstransfer|webclient|tcpclient|downloadstring|downloadfile)\b/i;
const EGRESS_DEVNET_RE = /\/dev\/(tcp|udp)\//;
const EGRESS_DNS_RE = /\b(nslookup|dig|host|getent)\b/i;
const EGRESS_CLOUD_RE = /\b(rclone|gsutil|s3cmd|b2|aws|az|gcloud|gh|kubectl|heroku|vercel|netlify)\b/i;
const GIT_PUSH_RE = /\bgit\b[^\n]{0,80}?\bpush\b/i;
const INTERP_RE = /\b(python3?|node|deno|bun|perl|ruby|php|pwsh|powershell|osascript)\b/i;
const INTERP_INLINE_RE = /\s-(c|e|r|m|command)\b/i;
const GWS_RE = /\bgws\b/i;
const BASECAMP_RE = /\bbasecamp\b/i;
const SEND_VERB_RE = /\b(send|message|post|chat|campfire|comment|upload|share)\b/i;
// Attempts to disable/clear the gate itself are worth a confirmation, too (tamper-evident).
const TAMPER_RE = /TAINT_GATE_DISABLE|taint-gate|\.claude[\\/]state/i;

/** Linear, bounded egress test over a Bash command string. */
function isBashEgress(command) {
  const cmd = (typeof command === 'string' ? command : '').slice(0, 8192);
  if (!cmd) return false;
  if (EGRESS_TOOL_RE.test(cmd) || EGRESS_PS_RE.test(cmd) || EGRESS_DEVNET_RE.test(cmd)) return true;
  if (EGRESS_DNS_RE.test(cmd) || EGRESS_CLOUD_RE.test(cmd) || GIT_PUSH_RE.test(cmd)) return true;
  if (INTERP_RE.test(cmd) && INTERP_INLINE_RE.test(cmd)) return true; // python -c / node -e / etc.
  if ((GWS_RE.test(cmd) || BASECAMP_RE.test(cmd)) && SEND_VERB_RE.test(cmd)) return true;
  if (TAMPER_RE.test(cmd)) return true;
  return false;
}

/**
 * Classify whether a tool call is an outbound/exfil SINK worth gating.
 * Returns { gated:boolean, label:string }. Outbound-only: internal edits / Obsidian
 * writes / local file writes are NOT gated (per the chosen low-friction posture).
 */
function classifySink(toolName, toolInput) {
  const name = typeof toolName === 'string' ? toolName : '';

  // WebFetch is both a source (taints) and a sink (outbound channel) — gated as a sink.
  if (name === 'WebFetch') return { gated: true, label: 'WebFetch (outbound request)' };

  if (name === 'Bash') {
    const cmd = toolInput && typeof toolInput.command === 'string' ? toolInput.command : '';
    if (isBashEgress(cmd)) return { gated: true, label: 'Bash (network / external-send / tamper command)' };
    return { gated: false, label: '' };
  }

  if (!name.startsWith('mcp__')) return { gated: false, label: '' };
  const n = name.toLowerCase();

  // Representative outbound MCP sinks. These are EXAMPLES — extend this list with the
  // write/send tools of whatever MCP servers you run (CRM, accounting, ticketing, etc.).
  // Pattern: match the server namespace + the action verbs that send data out or take an
  // external action. Keep these in sync with the matchers in config/settings.hooks.json.
  if (n.startsWith('mcp__claude_ai_gmail__')) return { gated: true, label: 'Gmail (send/modify)' };
  if (/^mcp__email__(send|reply|forward|draft)/.test(n)) return { gated: true, label: 'email send' };
  if (/^mcp__claude_ai_google_calendar__(create|update|delete)/.test(n)) return { gated: true, label: 'Calendar write' };
  if (/^mcp__plugin_discord_discord__(reply|edit_message)/.test(n)) return { gated: true, label: 'Discord send' };

  return { gated: false, label: '' };
}

// ── State (per-session file, atomic write) ────────────────────────────────────────

/** Load taint state for a session. A session with no file reads as untainted. */
function loadTaint(sessionId) {
  const raw = readFile(taintFile(sessionId));
  if (!raw) return { sessionId: sessionId || null, tainted: false, sources: [] };
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    return { sessionId: sessionId || null, tainted: false, sources: [] };
  }
  return {
    sessionId: state.sessionId || sessionId || null,
    tainted: !!state.tainted,
    sources: Array.isArray(state.sources) ? state.sources : [],
  };
}

function saveTaint(state) {
  ensureDir(STATE_DIR);
  const file = taintFile(state.sessionId);
  const tmp = file + '.tmp';
  writeFile(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file); // atomic on same drive
  pruneOldTaintFiles();
}

/** Best-effort cleanup of stale per-session taint files so state/ doesn't accumulate. */
function pruneOldTaintFiles() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!/^taint-gate\..*\.json$/.test(f)) continue;
      const fp = path.join(STATE_DIR, f);
      try {
        if (now - fs.statSync(fp).mtimeMs > TAINT_PRUNE_MS) fs.unlinkSync(fp);
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch {
    /* state dir may not exist yet */
  }
}

/** Mark the session tainted by a source tool (keeps the last 9 sources for the reason string). */
function setTaint(sessionId, toolName) {
  const state = loadTaint(sessionId);
  state.sessionId = sessionId || state.sessionId || null;
  state.tainted = true;
  state.sources = (state.sources || []).slice(-8); // keep last 8 + the push below = 9
  state.sources.push({ tool: toolName, at: getDateTimeString() });
  saveTaint(state);
  return state;
}

module.exports = {
  taintFile,
  isUntrustedSource,
  classifySink,
  loadTaint,
  saveTaint,
  setTaint,
};
