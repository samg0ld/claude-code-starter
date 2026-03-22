/**
 * Obsidian Vault Integration — Optional
 *
 * Provides vault path resolution, project-to-folder mapping, and
 * log/status file paths for Obsidian-based session tracking.
 *
 * Enable by setting OBSIDIAN_VAULT env var to your vault path.
 * Without it, all functions return null and hooks silently no-op.
 *
 * Used by: session-start.js, session-end-obsidian.js
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getHomeDir, getTimezone, isWindows } = require('./utils');

/**
 * Get the Obsidian vault path.
 * Returns null if OBSIDIAN_VAULT is not set and no default exists.
 */
function getVaultPath() {
  if (process.env.OBSIDIAN_VAULT) {
    return process.env.OBSIDIAN_VAULT;
  }
  // Default path — override via OBSIDIAN_VAULT env var
  const defaultPath = path.join(getHomeDir(), 'Obsidian', 'Life');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  return null;
}

/**
 * Optional overrides: map a Dev directory name (lowercase) to a
 * different Obsidian folder name under Development/.
 * If a project is NOT listed here, it auto-maps using its directory name.
 */
const PROJECT_MAP = {
  // 'my-repo': 'Different Obsidian Folder'
};

/**
 * Resolve the Obsidian folder name for a project.
 * Uses PROJECT_MAP override if present, otherwise the directory name as-is.
 */
function getObsidianFolder(cwd) {
  const projectRoot = getProjectRoot(cwd);
  if (!projectRoot) return null;

  const dirName = path.basename(projectRoot).toLowerCase();
  return PROJECT_MAP[dirName] || dirName;
}

/**
 * Get the Obsidian status file path for a project.
 * Auto-maps any Dev project to Development/<project>/Status.md.
 * Returns null if not in a Dev project or vault path is missing.
 */
function getObsidianStatusPath(cwd) {
  const folder = getObsidianFolder(cwd);
  if (!folder) return null;

  const vaultPath = getVaultPath();
  if (!vaultPath || !fs.existsSync(vaultPath)) return null;

  return path.join(vaultPath, 'Development', folder, 'Status.md');
}

/**
 * Get the Obsidian monthly session log path.
 * Returns Development/Logs/YYYY-MM.md for the current month.
 * Returns null if vault path is missing.
 */
function getObsidianLogPath() {
  const vaultPath = getVaultPath();
  if (!vaultPath || !fs.existsSync(vaultPath)) return null;

  const tz = getTimezone();
  const now = new Date();
  const central = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const year = central.getFullYear();
  const month = String(central.getMonth() + 1).padStart(2, '0');

  return path.join(vaultPath, 'Development', 'Logs', `${year}-${month}.md`);
}

/**
 * Get the display name for the current month (e.g., "March 2026")
 */
function getMonthDisplayName() {
  const tz = getTimezone();
  const now = new Date();
  const central = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return central.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: tz });
}

module.exports = {
  getVaultPath,
  getObsidianFolder,
  getObsidianStatusPath,
  getObsidianLogPath,
  getMonthDisplayName,
  PROJECT_MAP,
};
