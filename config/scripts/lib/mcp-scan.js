/**
 * mcp-scan.js — shared engine for MCP tool-poisoning detection
 *
 * Used by:
 *   - config/scripts/scan-mcp-tools.js          (standalone CLI)
 *   - config/scripts/hooks/session-start-mcp-scan.js (non-blocking warn hook)
 *
 * Implements the proven core of Invariant Labs' `mcp-scan scan`:
 *   1. SHA-256 description pinning + drift detection (rug-pull / CVE-2025-54136)
 *   2. Static signature scan of every tool field, with text normalization
 *   3. Cross-server tool-name collision detection (shadowing)
 *
 * Node builtins only (crypto, child_process, fs, path) — consistent with the hook stack.
 * Trust-on-first-use: the first time a tool is seen it is pinned silently; signature
 * findings are only raised for NEW or CHANGED tools.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const { getClaudeDir, ensureDir, readFile, writeFile, getDateTimeString } = require('./utils');

// ── Paths ─────────────────────────────────────────────────────────────────────

const STATE_DIR = path.join(getClaudeDir(), 'state');
const STATE_FILE = path.join(STATE_DIR, 'mcp-tool-pins.json');
const PATTERNS_FILE = path.join(__dirname, '..', '..', 'data', 'mcp-poisoning-patterns.json');

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_SCHEMA_DEPTH = 6;
const MAX_FIELDS_PER_TOOL = 500;
const MAX_FIELD_LEN = 16384; // per-string cap before scan/hash (hostile-input DoS guard)
const MAX_BUF_BYTES = 5_000_000; // cap stdout we buffer from a server
const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

function severityRank(sev) {
  return SEVERITY_RANK[String(sev).toUpperCase()] || 0;
}

/** Own-property lookup that is safe for attacker-controlled keys (constructor, __proto__, …). */
function safeGet(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

// ── Untrusted-source classifier (shared foundation) ──────────────────────────────
// Lives here (the base MCP-security lib) so both the response audit and the taint
// gate agree on what counts as an external-party content source — and so neither
// feature depends on the other.

const UNTRUSTED_BUILTINS = new Set(['WebFetch', 'WebSearch']);

/**
 * True if a tool's RESULT carries content from an EXTERNAL-PARTY source — text a
 * stranger could plant. Scoped to the real indirect-injection channels: open web,
 * inbound email, inbound chat. First-party stores you own (Obsidian/Notion/SharePoint)
 * are NOT untrusted.
 */
function isUntrustedSource(name) {
  if (!name || typeof name !== 'string') return false;
  if (UNTRUSTED_BUILTINS.has(name)) return true;
  const n = name.toLowerCase();
  if (!n.startsWith('mcp__')) return false;
  if (/(web[_-]?search|web[_-]?fetch|brave|google[_-]?search|tavily|exa)/.test(n)) return true;
  // Inbound email READS only (not sends) bring in untrusted content. Match the verb
  // after the __email__ segment so "email" in the namespace doesn't match everything.
  if (/__email__[a-z_]*?(get|list|search|read|thread|download)/.test(n)) return true;
  if (n.includes('discord') && /(fetch_messages|download_attachment)/.test(n)) return true;
  return false;
}

// ── Config / server enumeration ─────────────────────────────────────────────────

/** Read mcpServers from ~/.claude.json. Returns {} on any error. */
function loadServers() {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  try {
    const config = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
    return config.mcpServers || {};
  } catch {
    return {};
  }
}

/** Resolve a server entry into a spawnable { command, args, env }. */
function resolveServerConfig(config) {
  return {
    command: config.command,
    args: config.args || [],
    env: config.env || {},
    type: config.type || 'stdio',
  };
}

/**
 * Stable hash of the STRUCTURAL parts of the mcpServers block (command, args,
 * type) for cheap config-change detection. Deliberately excludes `env` so the
 * hash never incorporates credential values and rotating a key does not trigger
 * a spurious re-scan.
 */
function configHash(servers) {
  const structural = {};
  for (const [name, cfg] of Object.entries(servers || {})) {
    structural[name] = { command: cfg.command, args: cfg.args, type: cfg.type };
  }
  return sha256(stableStringify(structural));
}

// ── State ────────────────────────────────────────────────────────────────────

function loadState() {
  const raw = readFile(STATE_FILE);
  if (!raw) return { _meta: {} };
  try {
    const state = JSON.parse(raw);
    if (!state._meta) state._meta = {};
    return state;
  } catch {
    return { _meta: {} };
  }
}

function saveState(state) {
  ensureDir(STATE_DIR);
  // Write to a temp file then rename — atomic on the same drive, so a concurrent
  // background refresh and a manual --approve can't tear the file.
  const tmp = STATE_FILE + '.tmp';
  writeFile(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ── Hashing helpers ─────────────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** Deterministic JSON stringify with recursively sorted object keys. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/**
 * Canonical hash of a tool definition: name + description + full inputSchema
 * (with sorted keys so cosmetic reordering does not register as drift).
 */
function hashToolDef(tool) {
  const name = tool.name || '';
  const description = tool.description || '';
  const schema = tool.inputSchema || tool.input_schema || {};
  return sha256(name + ' ' + description + ' ' + stableStringify(schema));
}

function buildToolPin(tool) {
  return {
    hash: hashToolDef(tool),
    approvedAt: getDateTimeString(),
    len: (tool.description || '').length,
  };
}

// ── Text normalization (defeat zero-width / homoglyph obfuscation) ───────────────

// Invisible code points (soft hyphen, zero-width spaces, bidi controls, word
// joiners, BOM) and Unicode tag chars. Built from numeric code points so the
// source stays pure ASCII and readable.
const INVISIBLE_RE = new RegExp(
  '[' +
    '\\u00AD' + // soft hyphen
    '\\u200B-\\u200F' + // zero-width space..RLM
    '\\u202A-\\u202E' + // bidi embeddings/overrides
    '\\u2060-\\u2064' + // word joiner..invisible plus
    '\\uFEFF' + // BOM / zero-width no-break space
  ']',
  'g'
);
const TAG_CHARS_RE = /[\u{E0000}-\u{E007F}]/gu;

function normalizeText(s) {
  if (typeof s !== 'string') return '';
  let out = s.replace(INVISIBLE_RE, '').replace(TAG_CHARS_RE, '');
  try {
    out = out.normalize('NFKC');
  } catch {
    /* invalid sequences — keep as-is */
  }
  return out.replace(/\s+/g, ' ').toLowerCase();
}

// ── Pattern loading / compilation ────────────────────────────────────────────────

function loadPatterns() {
  const raw = readFile(PATTERNS_FILE);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data.patterns) ? data.patterns : [];
  } catch {
    return [];
  }
}

/** Compile patterns once (case-insensitive). Invalid patterns are skipped. */
function compilePatterns(patterns) {
  const compiled = [];
  for (const p of patterns) {
    if (!p || typeof p.pattern !== 'string') continue;
    try {
      compiled.push({ ...p, re: new RegExp(p.pattern, 'i') });
    } catch {
      /* skip invalid regex */
    }
  }
  return compiled;
}

// ── Field collection (full-schema coverage) ──────────────────────────────────────

/** Recursively collect string values and property keys from a schema fragment. */
function walkSchema(node, basePath, out, depth) {
  if (depth > MAX_SCHEMA_DEPTH || out.length >= MAX_FIELDS_PER_TOOL) return;
  if (node === null || node === undefined) return;

  if (typeof node === 'string') {
    out.push({ path: basePath, text: node.slice(0, MAX_FIELD_LEN) });
    return;
  }
  if (typeof node === 'number' || typeof node === 'boolean') return;

  if (Array.isArray(node)) {
    node.forEach((item, i) => walkSchema(item, `${basePath}[${i}]`, out, depth + 1));
    return;
  }

  for (const key of Object.keys(node)) {
    if (out.length >= MAX_FIELDS_PER_TOOL) return;
    // A property KEY can itself be the payload (e.g. content_from_reading_ssh_id_rsa).
    out.push({ path: `${basePath}.${key}<key>`, text: key });
    walkSchema(node[key], `${basePath}.${key}`, out, depth + 1);
  }
}

/** Collect every scannable field of a tool: name, description, all schema strings/keys. */
function collectToolFields(tool) {
  const out = [];
  if (tool.name) out.push({ path: 'name', text: String(tool.name).slice(0, MAX_FIELD_LEN) });
  if (tool.description) out.push({ path: 'description', text: String(tool.description).slice(0, MAX_FIELD_LEN) });
  const schema = tool.inputSchema || tool.input_schema;
  if (schema) walkSchema(schema, 'inputSchema', out, 0);
  return out;
}

// ── Scanning ─────────────────────────────────────────────────────────────────

function snippet(str, max = 120) {
  const s = str.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Run compiled patterns over one text (raw + normalized). Returns matched patterns. */
function scanText(text, compiledPatterns) {
  if (!text) return [];
  const normalized = normalizeText(text);
  const hits = [];
  for (const p of compiledPatterns) {
    let m = p.re.exec(text);
    if (!m && normalized !== text) m = p.re.exec(normalized);
    if (m) {
      hits.push({
        id: p.id,
        name: p.name,
        severity: p.severity,
        category: p.category,
        match: snippet(m[0]),
      });
    }
  }
  return hits;
}

/** Scan all fields of a tool; returns findings tagged with the field path. */
function scanTool(tool, compiledPatterns) {
  const findings = [];
  const seen = new Set();
  for (const field of collectToolFields(tool)) {
    for (const hit of scanText(field.text, compiledPatterns)) {
      const key = `${hit.id}:${field.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ ...hit, field: field.path });
    }
  }
  return findings;
}

// ── MCP stdio handshake: initialize → initialized → tools/list ───────────────────

const INIT_MSG = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-tool-scan', version: '1.0.0' },
  },
};

function safeWrite(proc, obj) {
  try {
    proc.stdin.write(JSON.stringify(obj) + '\n');
  } catch {
    /* stdin may be closed */
  }
}

/**
 * Launch a stdio MCP server and retrieve its tool list.
 * Resolves { ok, tools, error } — never rejects.
 */
function listToolsViaStdio(name, config, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const { command, args, env } = resolveServerConfig(config);
    if (!command) {
      resolve({ ok: false, tools: [], error: 'no command in server config' });
      return;
    }

    let proc;
    try {
      proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, tools: [], error: `spawn failed: ${err.message}` });
      return;
    }

    let buf = '';
    let settled = false;
    let initialized = false;

    const done = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      resolve(res);
    };

    const timer = setTimeout(() => done({ ok: false, tools: [], error: `timeout after ${timeoutMs}ms` }), timeoutMs);

    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      if (buf.length > MAX_BUF_BYTES) {
        done({ ok: false, tools: [], error: 'response exceeded size cap' });
        return;
      }
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // non-JSON server chatter
        }
        if (msg.id === 1 && msg.result && !initialized) {
          initialized = true;
          safeWrite(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
          safeWrite(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (msg.id === 1 && msg.error) {
          done({ ok: false, tools: [], error: msg.error.message || 'initialize error' });
        } else if (msg.id === 2 && msg.result) {
          const tools = Array.isArray(msg.result.tools) ? msg.result.tools : [];
          done({ ok: true, tools, error: null });
        } else if (msg.id === 2 && msg.error) {
          done({ ok: false, tools: [], error: msg.error.message || 'tools/list error' });
        }
      }
    });

    proc.on('error', (err) => done({ ok: false, tools: [], error: `process error: ${err.message}` }));
    // Fast servers (e.g. Node) may emit their tools/list response and exit in the
    // same tick. Defer the exit verdict one tick so a trailing stdout 'data' event
    // can settle with the real result before we treat the exit as a failure.
    proc.on('exit', (code) => {
      if (settled) return;
      setImmediate(() => done({ ok: false, tools: [], error: `exited with code ${code} before tools/list completed` }));
    });

    safeWrite(proc, INIT_MSG);
  });
}

// ── Analysis: pin diff + signature scan + shadowing ──────────────────────────────

/**
 * Compare current tools against pinned baseline and run signature scans.
 *
 * @param {Object} serverTools  { [serverName]: { tools: [...], error: string|null } }
 * @param {Object} state        loaded pin state (NOT mutated)
 * @param {Array}  compiledPatterns
 * @returns {Object} { servers, shadowed, summary }
 */
function analyzeAll(serverTools, state, compiledPatterns) {
  // Null-prototype maps: tool names come from (potentially hostile) servers, so a
  // tool named `constructor`/`__proto__`/`toString` must not hit Object.prototype.
  const servers = Object.create(null);
  const nameToServers = Object.create(null); // toolName -> Set(serverName)

  for (const [serverName, info] of Object.entries(serverTools)) {
    const prevRaw = safeGet(state, serverName);
    const prevTools = (prevRaw && typeof prevRaw === 'object') ? prevRaw : {};
    const toolResults = [];

    for (const tool of info.tools || []) {
      if (!tool || typeof tool !== 'object') continue;
      const toolName = tool.name || '(unnamed)';
      const hash = hashToolDef(tool);
      const prev = safeGet(prevTools, toolName);

      let status;
      if (!prev) status = 'new';
      else if (prev.hash === hash) status = 'unchanged';
      else status = 'changed';

      // Trust-on-first-use: only scan new / changed tools for signatures.
      const findings = status === 'unchanged' ? [] : scanTool(tool, compiledPatterns);

      toolResults.push({
        name: toolName,
        status,
        hash,
        prevHash: prev ? prev.hash : null,
        prevLen: prev ? prev.len : null,
        len: (tool.description || '').length,
        findings,
      });

      if (!nameToServers[toolName]) nameToServers[toolName] = new Set();
      nameToServers[toolName].add(serverName);
    }

    servers[serverName] = { error: info.error || null, tools: toolResults };
  }

  // Shadowing: same underlying tool name exposed by more than one server.
  const shadowed = [];
  for (const [toolName, set] of Object.entries(nameToServers)) {
    if (set.size > 1) shadowed.push({ tool: toolName, servers: [...set] });
  }

  const summary = summarize(servers, shadowed);
  return { servers, shadowed, summary };
}

function summarize(servers, shadowed) {
  let nNew = 0, nChanged = 0, nUnchanged = 0, nFindings = 0, maxSeverity = 0;
  for (const info of Object.values(servers)) {
    for (const t of info.tools) {
      if (t.status === 'new') nNew++;
      else if (t.status === 'changed') nChanged++;
      else nUnchanged++;
      for (const f of t.findings) {
        nFindings++;
        maxSeverity = Math.max(maxSeverity, severityRank(f.severity));
      }
    }
  }
  return { nNew, nChanged, nUnchanged, nFindings, nShadowed: shadowed.length, maxSeverity };
}

/** Build a fresh pin map (server -> tool -> pin) from analysis, preserving approvedAt for unchanged tools. */
function buildPinState(serverTools, prevState) {
  const next = Object.create(null);
  next._meta = { ...(prevState._meta || {}) };
  for (const [serverName, info] of Object.entries(serverTools)) {
    if (info.error) {
      // Preserve existing pins for a server we couldn't reach this run.
      const prevServer = safeGet(prevState, serverName);
      if (prevServer) next[serverName] = prevServer;
      continue;
    }
    const prevRaw = safeGet(prevState, serverName);
    const prevTools = (prevRaw && typeof prevRaw === 'object') ? prevRaw : {};
    const pins = Object.create(null);
    for (const tool of info.tools || []) {
      if (!tool || typeof tool !== 'object') continue;
      const toolName = tool.name || '(unnamed)';
      const hash = hashToolDef(tool);
      const prev = safeGet(prevTools, toolName);
      pins[toolName] = (prev && prev.hash === hash)
        ? prev // unchanged: keep original approvedAt
        : buildToolPin(tool);
    }
    next[serverName] = pins;
  }
  return next;
}

module.exports = {
  // paths
  STATE_FILE,
  PATTERNS_FILE,
  // config
  loadServers,
  resolveServerConfig,
  configHash,
  // state
  loadState,
  saveState,
  buildPinState,
  // hashing
  sha256,
  stableStringify,
  hashToolDef,
  buildToolPin,
  // text + patterns
  isUntrustedSource,
  normalizeText,
  loadPatterns,
  compilePatterns,
  collectToolFields,
  scanText,
  scanTool,
  // mcp
  listToolsViaStdio,
  // analysis
  analyzeAll,
  summarize,
  severityRank,
};
