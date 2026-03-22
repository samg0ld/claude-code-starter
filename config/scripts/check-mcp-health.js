#!/usr/bin/env node
/**
 * check-mcp-health.js — Cross-platform MCP server health check
 *
 * Reads server configs from ~/.claude.json and tests each one
 * by sending an MCP initialize handshake over stdio.
 *
 * Usage:
 *   node check-mcp-health.js              # run all checks
 *   node check-mcp-health.js <name>       # run one check by name
 *   node check-mcp-health.js --json       # machine-readable output
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 8000;
const MCP_INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'health-check', version: '1.0.0' }
  }
});

const isWindows = process.platform === 'win32';
const isTTY = process.stdout.isTTY;

// ── Colors ──────────────────────────────────────────────────────────────────

const c = isTTY ? {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
} : { green: '', red: '', yellow: '', dim: '', bold: '', reset: '' };

// ── State ───────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
let skip = 0;
const jsonResults = [];

// Parse args
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const filter = args.find(a => a !== '--json') || '';

// ── Helpers ─────────────────────────────────────────────────────────────────

function report(name, status, detail = '') {
  if (jsonMode) {
    jsonResults.push({ name, status, detail });
    return;
  }

  const pad = name.padEnd(18);
  switch (status) {
    case 'up':
      console.log(`  ${c.green}\u2713${c.reset} ${pad} ${c.dim}${detail}${c.reset}`);
      break;
    case 'down':
      console.log(`  ${c.red}\u2717${c.reset} ${pad} ${c.red}${detail}${c.reset}`);
      break;
    case 'skip':
      console.log(`  ${c.yellow}\u25CB${c.reset} ${pad} ${c.yellow}${detail}${c.reset}`);
      break;
  }
}

function shouldRun(name) {
  return !filter || filter === name;
}

function commandExists(cmd) {
  try {
    const check = isWindows ? spawnSync('where', [cmd], { stdio: 'pipe' })
                            : spawnSync('which', [cmd], { stdio: 'pipe' });
    return check.status === 0;
  } catch {
    return false;
  }
}

/**
 * Send MCP initialize handshake to a server and check for valid response.
 * Returns a promise that resolves with { status, detail }.
 */
function checkMcpStdio(name, command, args, env = {}) {
  return new Promise((resolve) => {
    const mergedEnv = { ...process.env, ...env };

    let proc;
    try {
      proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: mergedEnv,
        shell: false,
        windowsHide: true
      });
    } catch (err) {
      report(name, 'down', `spawn failed: ${err.message}`);
      fail++;
      resolve();
      return;
    }

    let stdout = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        report(name, 'down', `no response (${TIMEOUT_MS / 1000}s)`);
        fail++;
        resolve();
      }
    }, TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();

      // Check if we have a complete JSON-RPC response (newline-delimited)
      const firstLine = stdout.split('\n')[0].trim();
      if (!firstLine) return;

      try {
        const response = JSON.parse(firstLine);

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          proc.kill();

          if (response.result) {
            const si = response.result.serverInfo || {};
            const serverName = si.name || '?';
            const version = si.version || '?';
            report(name, 'up', `${serverName} v${version}`);
            pass++;
          } else if (response.error) {
            report(name, 'down', response.error.message || 'error in response');
            fail++;
          } else {
            report(name, 'down', 'unexpected response');
            fail++;
          }
          resolve();
        }
      } catch {
        // Incomplete JSON, wait for more data
      }
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        report(name, 'down', `process error: ${err.message}`);
        fail++;
        resolve();
      }
    });

    proc.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        report(name, 'down', `exited with code ${code}`);
        fail++;
        resolve();
      }
    });

    // Send the initialize message
    try {
      proc.stdin.write(MCP_INIT + '\n');
    } catch {
      // stdin may already be closed
    }
  });
}

/**
 * Check that a CLI binary exists and responds to --version
 */
function checkCli(name, cmd, flag = '--version') {
  if (!commandExists(cmd)) {
    report(name, 'down', 'not installed');
    fail++;
    return;
  }

  try {
    // shell: true needed on Windows for .cmd/.bat wrappers (e.g., npm-installed CLIs)
    const result = spawnSync(cmd, [flag], {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 5000,
      shell: isWindows
    });
    if (result.status === 0 && result.stdout) {
      report(name, 'up', result.stdout.split('\n')[0].trim());
      pass++;
    } else {
      report(name, 'down', 'installed but not responding');
      fail++;
    }
  } catch {
    report(name, 'down', 'error running command');
    fail++;
  }
}

/**
 * Check required env vars for a server. Returns true if all present.
 */
function checkEnv(name, vars, serverEnv = {}) {
  const merged = { ...process.env, ...serverEnv };
  const missing = vars.filter(v => !merged[v]);

  if (missing.length > 0) {
    report(name, 'skip', `missing env: ${missing.join(', ')}`);
    skip++;
    return false;
  }
  return true;
}

// ── Load MCP configs from ~/.claude.json ────────────────────────────────────

function loadMcpServers() {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  try {
    const content = fs.readFileSync(claudeJsonPath, 'utf8');
    const config = JSON.parse(content);
    return config.mcpServers || {};
  } catch {
    return {};
  }
}

/**
 * Resolve a server config into a spawnable { command, args, env }.
 * Handles the Windows `cmd /c ...` pattern by extracting the real command.
 */
function resolveServerConfig(config) {
  const command = config.command;
  const args = config.args || [];
  const env = config.env || {};

  return { command, args, env };
}

// ── Required env vars per server ─────────────────────────────────────────────
// Add your own server env var requirements here.
// Servers listed here will be skipped (not failed) if their env vars are missing.
const REQUIRED_ENV = {
  // example: ['API_KEY', 'API_SECRET'],
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const servers = loadMcpServers();
  const serverNames = Object.keys(servers);

  if (!jsonMode) {
    console.log(`\n${c.bold}MCP Server Health Check${c.reset}\n`);
    console.log(`${c.dim}Servers from ~/.claude.json (${serverNames.length} configured)${c.reset}`);
  }

  // Check each MCP server
  for (const name of serverNames) {
    if (!shouldRun(name)) continue;

    const config = servers[name];
    const serverType = config.type || 'stdio';
    if (serverType !== 'stdio') {
      report(name, 'skip', `unsupported type: ${serverType}`);
      skip++;
      continue;
    }

    // Check required env vars if known
    const requiredVars = REQUIRED_ENV[name];
    if (requiredVars && !checkEnv(name, requiredVars, config.env || {})) {
      continue;
    }

    const { command, args, env } = resolveServerConfig(config);
    await checkMcpStdio(name, command, args, env);
  }

  // CLI tools — add your own checks here
  // Example: checkCli('gws', 'gws', 'version');

  // Summary
  if (jsonMode) {
    console.log(JSON.stringify({ pass, fail, skip, results: jsonResults }));
  } else {
    let summary = `\n${c.bold}Summary:${c.reset} `;
    summary += `${c.green}${pass} up${c.reset}  `;
    if (fail > 0) summary += `${c.red}${fail} down${c.reset}  `;
    if (skip > 0) summary += `${c.yellow}${skip} skipped${c.reset}  `;
    console.log(summary + '\n');
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`[Health] Fatal: ${err.message}`);
  process.exit(1);
});
