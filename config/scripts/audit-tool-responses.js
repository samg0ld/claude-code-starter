#!/usr/bin/env node
/**
 * audit-tool-responses.js — retrospective indirect-prompt-injection audit
 *
 * Reads Claude Code session transcripts (read-only) and scans the content that
 * UNTRUSTED-SOURCE tools returned (web fetch/search, inbound email, Discord, etc.)
 * for prompt-injection / tool-poisoning signatures. Answers: "has injection-shaped
 * content already passed through my agent's context?"
 *
 * Detection is deliberately scoped to tool_result blocks whose SOURCE tool is an
 * untrusted-content source — never the user's prose or Claude's text. So discussing
 * prompt injection (e.g. while building this feature) does not false-positive.
 *
 * It is a TRIPWIRE, not proof: a clean result means "no known-signature injection in
 * scanned external content", not "safe". See config/data/mcp-poisoning-patterns.json.
 *
 * Usage:
 *   node audit-tool-responses.js                 # scan all transcripts (untrusted sources)
 *   node audit-tool-responses.js --since 30      # only files modified in last 30 days
 *   node audit-tool-responses.js --project myapp # only project dirs matching "myapp"
 *   node audit-tool-responses.js --all-sources   # scan EVERY tool result (louder)
 *   node audit-tool-responses.js --json          # machine-readable
 *   cat content.txt | node audit-tool-responses.js --scan-stdin   # scan arbitrary text/JSON
 */

const fs = require('fs');
const path = require('path');

const mcp = require('./lib/mcp-scan');
const { getClaudeDir, getDateTimeString, ensureDir, appendFile } = require('./lib/utils');

// ── Config ─────────────────────────────────────────────────────────────────────

const PROJECTS_DIR = path.join(getClaudeDir(), 'projects');
const LOG_FILE = path.join(getClaudeDir(), 'state', 'injection-audit-log.jsonl');
const MAX_TEXT = 16384; // per tool_result text cap before scan (hostile-input guard)
const MAX_FINDINGS = 2000; // output backstop

// ── Args ───────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = {
  json: argv.includes('--json'),
  allSources: argv.includes('--all-sources'),
  scanStdin: argv.includes('--scan-stdin'),
  help: argv.includes('--help') || argv.includes('-h'),
};
const sinceDays = numFlag('--since');
const projectFilter = strFlag('--project');

function numFlag(name) {
  const i = argv.indexOf(name);
  if (i < 0 || !argv[i + 1]) return null;
  const v = parseFloat(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}
function strFlag(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

// ── Colors ─────────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' }
  : { red: '', green: '', yellow: '', cyan: '', dim: '', bold: '', reset: '' };
const SEV_COLOR = { CRITICAL: c.red, HIGH: c.red, MEDIUM: c.yellow, LOW: c.dim };

if (opt.help) {
  console.log(`audit-tool-responses.js — retrospective prompt-injection audit

  (no flags)        scan all transcripts, untrusted-source tool results only
  --since DAYS      only transcripts modified within DAYS
  --project NAME    only project dirs whose name contains NAME
  --all-sources     scan every tool result, not just untrusted-source (louder)
  --json            machine-readable output
  --scan-stdin      scan text/JSON from stdin (used by /audit-injection for live data)
  -h, --help        this help`);
  process.exit(0);
}

// Untrusted-source classifier (mcp.isUntrustedSource) is shared from lib/mcp-scan.js so
// the audit and the live taint gate agree on what counts as an external-party source
// without depending on each other.

// ── Transcript helpers ────────────────────────────────────────────────────────────

/** Extract plain text from a tool_result content field (string | array of blocks). */
function resultText(content) {
  if (typeof content === 'string') return content.slice(0, MAX_TEXT);
  if (Array.isArray(content)) {
    let out = '';
    for (const b of content) {
      if (b && b.type === 'text' && typeof b.text === 'string') {
        out += b.text.slice(0, MAX_TEXT - out.length) + '\n'; // never hold >MAX_TEXT
        if (out.length >= MAX_TEXT) break;
      }
    }
    return out.slice(0, MAX_TEXT);
  }
  return '';
}

function listTranscripts() {
  const files = [];
  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return files;
  }
  const cutoff = sinceDays != null ? Date.now() - sinceDays * 86400000 : null;
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    if (projectFilter && !d.name.toLowerCase().includes(projectFilter.toLowerCase())) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const fp = path.join(dir, e.name);
      if (cutoff != null) {
        try {
          if (fs.statSync(fp).mtimeMs < cutoff) continue;
        } catch {
          continue;
        }
      }
      files.push({ project: d.name, file: fp, session: e.name.replace(/\.jsonl$/, '') });
    }
  }
  return files;
}

/** Scan one transcript file. Returns { toolResults, scanned, findings:[...] }. */
function scanTranscript(meta, compiled) {
  let raw;
  try {
    if (fs.statSync(meta.file).size > 50_000_000) return { toolResults: 0, scanned: 0, findings: [] }; // skip pathological files
    raw = fs.readFileSync(meta.file, 'utf8');
  } catch {
    return { toolResults: 0, scanned: 0, findings: [] };
  }
  const lines = raw.split('\n');

  // Pass 1: tool_use_id -> tool name (ids are harness-generated; use a Map to be safe).
  const idToName = new Map();
  const parsed = [];
  for (const line of lines) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      parsed.push(null);
      continue;
    }
    parsed.push(o);
    const content = o && o.message && o.message.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === 'tool_use' && b.id) idToName.set(b.id, b.name || '(unknown)');
      }
    }
  }

  // Pass 2: scan tool_result blocks.
  let toolResults = 0;
  let scanned = 0;
  const findings = [];
  for (const o of parsed) {
    const content = o && o.message && o.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || b.type !== 'tool_result') continue;
      toolResults++;
      const tool = idToName.get(b.tool_use_id) || '(unknown)';
      const untrusted = mcp.isUntrustedSource(tool);
      if (!untrusted && !opt.allSources) continue;
      const text = resultText(b.content);
      if (!text) continue;
      scanned++;
      const hits = mcp.scanText(text, compiled);
      for (const h of hits) {
        findings.push({
          project: meta.project,
          session: meta.session,
          timestamp: o.timestamp || null,
          tool,
          untrustedSource: untrusted,
          id: h.id,
          name: h.name,
          severity: h.severity,
          category: h.category,
          match: h.match,
        });
        if (findings.length >= MAX_FINDINGS) return { toolResults, scanned, findings };
      }
    }
  }
  return { toolResults, scanned, findings };
}

// ── stdin mode (live data piped from /audit-injection) ───────────────────────────

function readStdinRaw() {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(data);
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (ch) => {
      if (!done && data.length < 5_000_000) data += ch;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    timer = setTimeout(finish, 5000);
  });
}

/** Coerce a stdin field to scannable text (objects -> JSON, not "[object Object]"). */
function toText(v) {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Scan stdin: accepts a JSON array of {label,text}, a {text} object, or plain text. */
async function runScanStdin(compiled) {
  const raw = await readStdinRaw();
  const items = [];
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  if (Array.isArray(json)) {
    for (const it of json) items.push({ label: (it && it.label) || 'item', text: toText(it && (it.text ?? it.body ?? it.content)) });
  } else if (json && typeof json === 'object') {
    items.push({ label: json.label || 'item', text: toText(json.text ?? json.body ?? json.content) });
  } else {
    items.push({ label: 'stdin', text: raw });
  }

  const findings = [];
  for (const it of items) {
    for (const h of mcp.scanText(it.text.slice(0, MAX_TEXT), compiled)) {
      findings.push({ label: it.label, id: h.id, name: h.name, severity: h.severity, category: h.category, match: h.match });
      if (findings.length >= MAX_FINDINGS) break;
    }
  }
  console.log(JSON.stringify({ scannedAt: getDateTimeString(), items: items.length, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

// ── Reporting ─────────────────────────────────────────────────────────────────────

function bySeverityDesc(a, b) {
  return mcp.severityRank(b.severity) - mcp.severityRank(a.severity);
}

function renderReport(all, stats) {
  console.log(`\n${c.bold}Indirect-Prompt-Injection Audit${c.reset}`);
  console.log(`${c.dim}Scanned ${stats.files} transcripts, ${stats.toolResults} tool results (${stats.scanned} from ${opt.allSources ? 'all' : 'untrusted'} sources)${c.reset}`);
  if (stats.truncated) console.log(`${c.yellow}⚠ Output capped at ${MAX_FINDINGS} findings — scan stopped early; narrow with --since/--project.${c.reset}`);
  console.log('');

  // LOW findings (e.g. base64 in email attachments) are informational noise — hide them
  // unless --all-sources. They are still recorded in --json and the log.
  const threshold = opt.allSources ? 1 : 2;
  const shown = all.filter((f) => mcp.severityRank(f.severity) >= threshold);
  const hiddenLow = all.length - shown.length;
  const lowNote = hiddenLow ? `  ${c.dim}(${hiddenLow} LOW informational hit(s) hidden — use --all-sources or --json to see)${c.reset}` : '';

  if (!shown.length) {
    console.log(`  ${c.green}✓ No MEDIUM+ injection signatures in scanned external tool output.${c.reset}`);
    if (lowNote) console.log(lowNote);
    console.log(`  ${c.dim}Tripwire only — not proof of safety. Re-run after new research/email activity.${c.reset}\n`);
    return;
  }

  console.log(`  ${c.yellow}${shown.length} finding(s):${c.reset}`);
  for (const f of [...shown].sort(bySeverityDesc)) {
    const col = SEV_COLOR[f.severity] || '';
    const when = f.timestamp ? f.timestamp.replace('T', ' ').slice(0, 19) : '?';
    console.log(`    ${col}${f.severity}${c.reset} ${f.tool} ${c.dim}[${f.project} ${f.session.slice(0, 8)} ${when}]${c.reset}`);
    console.log(`        ${f.name} ${c.dim}(${f.id}: "${f.match}")${c.reset}`);
  }
  if (lowNote) console.log(lowNote);
  console.log(`\n  ${c.dim}Review each: is this attacker-planted, or benign content that happens to match?${c.reset}`);
  console.log(`  ${c.dim}Signatures are a tripwire, not proof. Your own security writing is out of scope by design.${c.reset}\n`);
}

function writeLog(stats, all) {
  try {
    ensureDir(path.dirname(LOG_FILE));
    const record = {
      scannedAt: getDateTimeString(),
      sources: { transcripts: true, email: false, notes: false },
      files: stats.files,
      toolResultsScanned: stats.scanned,
      mode: opt.allSources ? 'all-sources' : 'untrusted-sources',
      findingCount: all.length,
      findings: all.slice(0, 200),
    };
    appendFile(LOG_FILE, JSON.stringify(record) + '\n');
  } catch {
    /* logging must not fail the audit */
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const compiled = mcp.compilePatterns(mcp.loadPatterns());

  if (opt.scanStdin) {
    await runScanStdin(compiled);
    return;
  }

  const files = listTranscripts();
  const all = [];
  const stats = { files: files.length, toolResults: 0, scanned: 0 };

  for (const meta of files) {
    const r = scanTranscript(meta, compiled);
    stats.toolResults += r.toolResults;
    stats.scanned += r.scanned;
    for (const f of r.findings) {
      all.push(f);
      if (all.length >= MAX_FINDINGS) break;
    }
    if (all.length >= MAX_FINDINGS) break;
  }
  stats.truncated = all.length >= MAX_FINDINGS;

  if (opt.json) {
    console.log(JSON.stringify({ scannedAt: getDateTimeString(), stats, findings: all }, null, 2));
  } else {
    renderReport(all, stats);
  }
  writeLog(stats, all);

  // Exit non-zero only on MEDIUM+ findings; LOW (e.g. base64 in attachments) is informational.
  const significant = all.filter((f) => mcp.severityRank(f.severity) >= 2);
  process.exit(significant.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`[audit] fatal: ${err.message}`);
  process.exit(2);
});
