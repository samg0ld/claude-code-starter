#!/usr/bin/env node
/**
 * scan-mcp-tools.js — MCP tool-poisoning scanner
 *
 * Enumerates the stdio MCP servers registered in ~/.claude.json, retrieves each
 * server's tool definitions, and checks them for:
 *   1. Drift since approval (rug-pull) — SHA-256 pin comparison
 *   2. Tool-poisoning signatures in any field — see config/data/mcp-poisoning-patterns.json
 *   3. Cross-server tool-name collisions (shadowing)
 *
 * Trust-on-first-use: the first run pins every tool silently; later runs only
 * raise signature findings for NEW or CHANGED tools.
 *
 * Usage:
 *   node scan-mcp-tools.js                 # report (read-only); exit 1 if issues
 *   node scan-mcp-tools.js --json          # machine-readable
 *   node scan-mcp-tools.js --server github # scope to one server
 *   node scan-mcp-tools.js --write-state   # persist current defs as the baseline
 *   node scan-mcp-tools.js --approve       # alias for --write-state (accept changes)
 *   node scan-mcp-tools.js --reset         # re-baseline from scratch (drop old pins)
 *   node scan-mcp-tools.js --quiet         # minimal output (used by the SessionStart hook)
 */

const mcp = require('./lib/mcp-scan');
const { getDateTimeString } = require('./lib/utils');

// ── Args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = {
  json: argv.includes('--json'),
  quiet: argv.includes('--quiet'),
  writeState: argv.includes('--write-state') || argv.includes('--approve'),
  reset: argv.includes('--reset'),
  help: argv.includes('--help') || argv.includes('-h'),
};
const serverFilter = (() => {
  const i = argv.indexOf('--server');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
})();

// ── Colors ──────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' }
  : { red: '', green: '', yellow: '', cyan: '', dim: '', bold: '', reset: '' };

const SEV_COLOR = { CRITICAL: c.red, HIGH: c.red, MEDIUM: c.yellow, LOW: c.dim };

function out(line = '') {
  if (!opt.quiet) console.log(line);
}

// ── Help ─────────────────────────────────────────────────────────────────────

if (opt.help) {
  console.log(`scan-mcp-tools.js — MCP tool-poisoning scanner

  (no flags)      read-only report; exit 1 if drift / findings / shadowing
  --json          machine-readable output
  --server NAME   scope to a single server
  --write-state   pin current definitions as the trusted baseline
  --approve       alias for --write-state
  --reset         re-baseline from scratch (drop existing pins)
  --quiet         minimal output (used by the SessionStart hook)
  -h, --help      this help`);
  process.exit(0);
}

// ── Enumerate + analyze ────────────────────────────────────────────────────────

async function main() {
  const allServers = mcp.loadServers();
  const compiled = mcp.compilePatterns(mcp.loadPatterns());
  const prevState = opt.reset ? { _meta: {} } : mcp.loadState();

  const names = Object.keys(allServers).filter((n) => !serverFilter || n === serverFilter);
  if (serverFilter && names.length === 0) {
    console.error(`[mcp-scan] no server named "${serverFilter}" in ~/.claude.json`);
    process.exit(2);
  }
  const skipped = [];

  // Launch stdio enumeration in parallel; record non-stdio as skipped.
  const tasks = [];
  for (const name of names) {
    const cfg = mcp.resolveServerConfig(allServers[name]);
    if (cfg.type !== 'stdio') {
      skipped.push({ name, reason: `type ${cfg.type} (remote — out of scope for v1)` });
      continue;
    }
    tasks.push(
      mcp.listToolsViaStdio(name, allServers[name]).then((res) => ({ name, ...res }))
    );
  }
  const results = await Promise.all(tasks);

  const serverTools = {};
  for (const r of results) serverTools[r.name] = { tools: r.tools, error: r.error };

  const analysis = mcp.analyzeAll(serverTools, prevState, compiled);
  const currentConfigHash = mcp.configHash(allServers);
  const configChanged = prevState._meta.configHash && prevState._meta.configHash !== currentConfigHash;

  // ── Output ──────────────────────────────────────────────────────────────────

  if (opt.json) {
    console.log(JSON.stringify({
      scannedAt: getDateTimeString(),
      configChanged: !!configChanged,
      skipped,
      shadowed: analysis.shadowed,
      servers: analysis.servers,
      summary: analysis.summary,
    }, null, 2));
  } else {
    renderReport(analysis, skipped, configChanged);
  }

  // ── Persist ──────────────────────────────────────────────────────────────────

  if (opt.writeState || opt.reset) {
    // Make blind approvals auditable: warn (to stderr) if we're pinning over real findings.
    if (analysis.summary.nFindings > 0 || analysis.summary.nChanged > 0) {
      console.error(`[mcp-scan] warning: approving ${analysis.summary.nFindings} finding(s) and ${analysis.summary.nChanged} changed tool(s) as trusted`);
    }
    const next = mcp.buildPinState(serverTools, prevState);
    next._meta = { ...next._meta, lastScanAt: getDateTimeString(), configHash: currentConfigHash };
    // Carry forward findings/shadowing so the hook can surface them next session.
    next._meta.lastFindings = collectActiveFindings(analysis);
    mcp.saveState(next);
    out(`\n${c.dim}State written to ${mcp.STATE_FILE}${c.reset}`);
  }

  // ── Exit code ────────────────────────────────────────────────────────────────

  const issues = analysis.summary.nFindings > 0 || analysis.summary.nChanged > 0 || analysis.summary.nShadowed > 0;
  // When explicitly accepting/baselining, a clean exit is expected.
  process.exit(opt.writeState || opt.reset ? 0 : (issues ? 1 : 0));
}

/** Flatten findings + drift + shadowing into a compact list for the hook to replay. */
function collectActiveFindings(analysis) {
  const items = [];
  for (const [server, info] of Object.entries(analysis.servers)) {
    for (const t of info.tools) {
      if (t.status === 'changed') {
        items.push({ kind: 'drift', server, tool: t.name, severity: 'HIGH' });
      }
      for (const f of t.findings) {
        items.push({ kind: 'signature', server, tool: t.name, id: f.id, name: f.name, severity: f.severity, field: f.field });
      }
    }
  }
  for (const s of analysis.shadowed) {
    items.push({ kind: 'shadow', tool: s.tool, servers: s.servers, severity: 'MEDIUM' });
  }
  return items;
}

// ── Human report ───────────────────────────────────────────────────────────────

function renderReport(analysis, skipped, configChanged) {
  out(`\n${c.bold}MCP Tool-Poisoning Scan${c.reset}`);
  if (configChanged) out(`${c.yellow}⚠ MCP server config changed since last scan${c.reset}`);
  out('');

  const serverNames = Object.keys(analysis.servers);
  if (serverNames.length === 0) out(`${c.dim}No stdio MCP servers found in ~/.claude.json${c.reset}`);

  for (const name of serverNames) {
    const info = analysis.servers[name];
    if (info.error) {
      out(`  ${c.red}✗${c.reset} ${c.bold}${name}${c.reset} ${c.red}(${info.error})${c.reset}`);
      continue;
    }
    const counts = { new: 0, changed: 0, unchanged: 0 };
    for (const t of info.tools) counts[t.status]++;
    const flagged = info.tools.filter((t) => t.findings.length > 0 || t.status === 'changed');

    const summary = `${counts.unchanged} ok, ${counts.new} new, ${counts.changed} changed`;
    const mark = flagged.length ? `${c.yellow}⚠${c.reset}` : `${c.green}✓${c.reset}`;
    out(`  ${mark} ${c.bold}${name}${c.reset} ${c.dim}(${info.tools.length} tools: ${summary})${c.reset}`);

    for (const t of flagged) {
      if (t.status === 'changed') {
        const delta = t.prevLen != null ? ` ${c.dim}(desc len ${t.prevLen} → ${t.len})${c.reset}` : '';
        out(`      ${c.yellow}CHANGED${c.reset} ${t.name} ${c.dim}— definition drifted since approval${c.reset}${delta}`);
      }
      for (const f of t.findings) {
        const col = SEV_COLOR[f.severity] || '';
        out(`      ${col}${f.severity}${c.reset} ${t.name} ${c.dim}[${t.status}]${c.reset} ${f.name} ${c.dim}(${f.id} @ ${f.field}: "${f.match}")${c.reset}`);
      }
    }
  }

  if (analysis.shadowed.length) {
    out(`\n  ${c.yellow}Tool-name collisions (shadowing):${c.reset}`);
    for (const s of analysis.shadowed) {
      out(`      ${c.yellow}MEDIUM${c.reset} "${s.tool}" exposed by: ${s.servers.join(', ')} ${c.dim}(Claude Code namespaces tools per server, so this is informational unless unexpected)${c.reset}`);
    }
  }

  if (skipped.length) {
    out(`\n  ${c.dim}Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}${c.reset}`);
  }

  const s = analysis.summary;
  const issue = s.nFindings > 0 || s.nChanged > 0 || s.nShadowed > 0;
  out('');
  out(`${c.bold}Summary:${c.reset} ${s.nUnchanged} ok, ${s.nNew} new, ${c.yellow}${s.nChanged} changed${c.reset}, ${s.nFindings} findings, ${s.nShadowed} collisions`);
  if (issue && !opt.writeState) {
    out(`${c.dim}Review the above. If expected, run with --approve to pin the current definitions.${c.reset}`);
  }
}

main().catch((err) => {
  console.error(`[mcp-scan] fatal: ${err.message}`);
  process.exit(2);
});
