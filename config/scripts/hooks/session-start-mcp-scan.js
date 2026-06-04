#!/usr/bin/env node
/**
 * session-start-mcp-scan.js — non-blocking MCP tool-poisoning warn hook
 *
 * Runs at SessionStart alongside session-start.js. Never blocks the session.
 *
 * Two parts:
 *   1. Cheap synchronous warning: replay any unresolved findings from the last
 *      scan (drift / poisoning signatures / shadowing) to stderr, and note if the
 *      MCP server config changed since the last scan.
 *   2. Non-blocking refresh: if the config changed or the last scan is older than
 *      the throttle, spawn `scan-mcp-tools.js --write-state --quiet` DETACHED so it
 *      refreshes the pin baseline for the NEXT session without delaying this one.
 *
 * Fail-open everywhere: a scanner problem must never break session start.
 *
 * Env:
 *   MCP_SCAN_THROTTLE_HOURS  hours between background refreshes (default 12)
 *   MCP_SCAN_DISABLE         set to "1" to disable this hook entirely
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Sanitize server-supplied strings before logging: drop control chars (incl. ANSI
 * escapes and newlines) so a malicious tool name can't spoof or garble the warning.
 */
function clean(s) {
  let out = '';
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length && out.length < 200; i++) {
    const code = str.charCodeAt(i);
    out += code < 32 || code === 127 ? ' ' : str[i];
  }
  return out;
}

function main() {
  if (process.env.MCP_SCAN_DISABLE === '1') return;

  // Lazy require so a broken lib can't crash the hook before the try/catch.
  const mcp = require('../lib/mcp-scan');
  const { log } = require('../lib/utils');

  const state = mcp.loadState();
  const meta = state._meta || {};

  // ── Part 1: replay unresolved findings + detect config change ──────────────────
  const findings = Array.isArray(meta.lastFindings) ? meta.lastFindings : [];
  const high = findings.filter((f) => mcp.severityRank(f.severity) >= 3);
  const lowerCount = findings.length - high.length;

  if (high.length) {
    log(`[mcp-scan] ⚠ ${high.length} unresolved MCP tool-security warning(s) from last scan:`);
    for (const f of high.slice(0, 12)) {
      if (f.kind === 'drift') {
        log(`  ⚠ rug-pull: ${clean(f.server)}/${clean(f.tool)} — tool definition changed since you approved it`);
      } else if (f.kind === 'signature') {
        log(`  ⚠ ${clean(f.severity)} poisoning signature: ${clean(f.server)}/${clean(f.tool)} — ${clean(f.name)} (${clean(f.id)} @ ${clean(f.field)})`);
      } else if (f.kind === 'shadow') {
        log(`  ⚠ shadowing: tool "${clean(f.tool)}" exposed by ${(f.servers || []).map(clean).join(', ')}`);
      }
    }
    if (lowerCount > 0) log(`  (+${lowerCount} lower-severity note(s))`);
    log(`  Review: node ~/.claude/scripts/scan-mcp-tools.js  — accept current defs with --approve`);
  }

  // Cheap config-change check (catches new/changed server registrations in real time).
  let configChanged = false;
  try {
    const currentHash = mcp.configHash(mcp.loadServers());
    configChanged = !!meta.configHash && meta.configHash !== currentHash;
    if (configChanged) {
      log(`[mcp-scan] MCP server config changed since last scan — re-verifying tool definitions in the background.`);
    }
  } catch {
    /* ignore */
  }

  // ── Part 2: non-blocking background refresh (throttled) ────────────────────────
  const throttleHours = parseFloat(process.env.MCP_SCAN_THROTTLE_HOURS || '12');
  const ageHours = hoursSince(meta.lastScanAt);
  const needsRefresh = configChanged || ageHours === null || ageHours >= throttleHours;

  if (needsRefresh) {
    try {
      const scanner = path.join(__dirname, '..', 'scan-mcp-tools.js');
      if (!fs.existsSync(scanner)) return; // partial install — nothing to run
      const child = spawn(process.execPath, [scanner, '--write-state', '--quiet'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } catch {
      /* never block on a refresh failure */
    }
  }
}

/** Hours since a "YYYY-MM-DD HH:MM:SS" timestamp, or null if unparseable. */
function hoursSince(ts) {
  if (!ts || typeof ts !== 'string') return null;
  const d = new Date(ts.replace(' ', 'T'));
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3600000;
}

try {
  main();
} catch {
  /* fail-open: session start must never break */
}
process.exit(0);
