#!/usr/bin/env node
/**
 * merge-hooks-settings.js
 *
 * Surgical merge of canonical hooks + statusLine config into the user's
 * ~/.claude/settings.json, preserving all other keys (model, enabledPlugins,
 * voiceEnabled, extraKnownMarketplaces, etc. -- per-machine preferences).
 *
 * Invoked by setup.sh and setup.ps1. Cross-platform via Node.js.
 *
 * Usage:
 *   node config/scripts/merge-hooks-settings.js <repo-root>
 *   node config/scripts/merge-hooks-settings.js <repo-root> --dry-run
 *
 * --dry-run prints the merged JSON to stdout and a diff summary to stderr;
 * does NOT modify settings.json. Use to preview changes safely.
 *
 * If <repo-root> is omitted, it's derived from this script's location
 * (parent of parent of parent).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DRY_RUN = process.argv.includes('--dry-run');
const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));

const HOME = os.homedir();
const homeForwardSlash = HOME.replace(/\\/g, '/');

// Detect Python: prefer python3 on mac/linux (where `python` often doesn't exist
// on modern macOS), prefer python on Windows (where `python` is the Microsoft Store
// / python.org default). Fall back to platform default if `which`/`where` fails.
function detectPython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  for (const candidate of candidates) {
    try {
      execSync(`${cmd} ${candidate}`, { stdio: 'ignore' });
      return candidate;
    } catch { /* not found, try next */ }
  }
  return candidates[0]; // fallback: hook will fail to launch but error will be clear
}

const PYTHON = detectPython();

const repoRoot = positionalArgs[0]
  ? path.resolve(positionalArgs[0])
  : path.resolve(__dirname, '..', '..');

const hooksConfigPath = path.join(repoRoot, 'config', 'settings.hooks.json');
const settingsPath = path.join(HOME, '.claude', 'settings.json');

if (!fs.existsSync(hooksConfigPath)) {
  console.error(`[merge-hooks-settings] ERROR: missing ${hooksConfigPath}`);
  process.exit(1);
}

const hooksRaw = fs.readFileSync(hooksConfigPath, 'utf8');
const hooksResolved = hooksRaw
  .replace(/\$HOME/g, homeForwardSlash)
  .replace(/\$PYTHON/g, PYTHON);
const hooksConfig = JSON.parse(hooksResolved);

let settings;
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    console.error(`[merge-hooks-settings] ERROR: ${settingsPath} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
} else {
  settings = { '$schema': 'https://json.schemastore.org/claude-code-settings.json' };
}

const oldHooksJson = JSON.stringify(settings.hooks || null);
const oldStatusLineJson = JSON.stringify(settings.statusLine || null);
const oldEnvJson = JSON.stringify(settings.env || null);

settings.hooks = hooksConfig.hooks;
if (hooksConfig.statusLine) {
  settings.statusLine = hooksConfig.statusLine;
}
// Shallow-merge repo-declared env into the installed env: repo-declared keys
// override, local-only keys survive. Unlike model/enabledPlugins/etc., env is
// NOT fully preserved per-machine once the repo declares keys in settings.hooks.json.
if (hooksConfig.env) {
  settings.env = Object.assign({}, settings.env || {}, hooksConfig.env);
}

const newHooksJson = JSON.stringify(settings.hooks);
const newStatusLineJson = JSON.stringify(settings.statusLine || null);
const newEnvJson = JSON.stringify(settings.env || null);

const hooksChanged = oldHooksJson !== newHooksJson;
const statusLineChanged = oldStatusLineJson !== newStatusLineJson;
const envChanged = oldEnvJson !== newEnvJson;
const preservedKeys = Object.keys(settings).filter(k => !['hooks', 'statusLine', 'env', '$schema'].includes(k));

if (DRY_RUN) {
  console.log(`[merge-hooks-settings] DRY-RUN: no files written`);
  console.log(`  target: ${settingsPath}`);
  console.log(`  exists: ${fs.existsSync(settingsPath)}`);
  console.log(`  python detected: ${PYTHON}`);
  console.log(`  hooks block: ${hooksChanged ? 'WOULD CHANGE' : 'unchanged'}`);
  console.log(`  statusLine:  ${statusLineChanged ? 'WOULD CHANGE' : 'unchanged'}`);
  console.log(`  env block:   ${envChanged ? 'WOULD CHANGE' : 'unchanged'}`);
  console.log(`  preserved keys (untouched): ${preservedKeys.join(', ') || '(none)'}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

// Backup existing settings.json before overwrite so per-machine keys
// (model, enabledPlugins, voiceEnabled, permissions, env) are recoverable.
let backupPath = null;
if (fs.existsSync(settingsPath)) {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  backupPath = `${settingsPath}.backup-${ts}`;
  fs.copyFileSync(settingsPath, backupPath);
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

const backupNote = backupPath ? `, backup -> ${path.basename(backupPath)}` : '';
console.log(`  Merged hooks + statusLine + env into ${settingsPath} (python=${PYTHON}, hooks ${hooksChanged ? 'changed' : 'unchanged'}, statusLine ${statusLineChanged ? 'changed' : 'unchanged'}, env ${envChanged ? 'changed' : 'unchanged'}${backupNote})`);
