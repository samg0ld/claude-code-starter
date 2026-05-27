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

const fs = require("fs");
const path = require("path");
const {
  getProjectRoot,
  getHomeDir,
  getTimezone,
  isWindows,
  DEV_ROOTS,
} = require("./utils");

/**
 * Get the Obsidian vault path.
 * Returns null if OBSIDIAN_VAULT is not set.
 *
 * Vault path is strictly opt-in via the OBSIDIAN_VAULT environment variable.
 * Without it, all Obsidian integration silently no-ops.
 */
function getVaultPath() {
  if (process.env.OBSIDIAN_VAULT && fs.existsSync(process.env.OBSIDIAN_VAULT)) {
    return process.env.OBSIDIAN_VAULT;
  }
  return null;
}

/**
 * Optional overrides: map an auto-derived project slug (lowercase) to a
 * different Obsidian folder name under Development/.
 *
 * For top-level projects (~/Dev/<name>/), the slug is just <name>.
 * For parent-dir projects (~/Dev/<parent>/<child>/, where <parent> is in
 * PARENT_DIRS), the slug is <parent>-<child>.
 *
 * Add an entry here only when the auto-derived slug doesn't match an
 * existing Obsidian folder name.
 */
const PROJECT_MAP = {
  // 'parent-child': 'Different Obsidian Folder Name',
};

/**
 * Resolve the Obsidian folder name for a project.
 *
 * Builds the folder name from the project root's path relative to DEV_ROOT,
 * joining segments with `-`. So a 2-level project under a parent dir gets
 * a hyphenated name (parent-child) while a top-level project keeps its
 * single-segment name.
 *
 * PROJECT_MAP overrides take precedence for legacy folder names.
 */
function getObsidianFolder(cwd) {
  const projectRoot = getProjectRoot(cwd);
  if (!projectRoot) return null;

  const normalizedRoot = path.resolve(projectRoot);

  for (const devRoot of DEV_ROOTS) {
    const normalizedDevRoot = path.resolve(devRoot);
    if (
      !normalizedRoot.startsWith(normalizedDevRoot + path.sep) &&
      normalizedRoot !== normalizedDevRoot
    ) {
      continue;
    }

    const relative = path.relative(normalizedDevRoot, normalizedRoot);
    if (!relative || relative === ".") continue;

    const dirName = relative.split(path.sep).join("-").toLowerCase();
    return PROJECT_MAP[dirName] || dirName;
  }

  // Fallback: bare basename (preserves prior behavior if path lookup fails)
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

  return path.join(vaultPath, "Development", folder, "Status.md");
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
  const central = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const year = central.getFullYear();
  const month = String(central.getMonth() + 1).padStart(2, "0");

  return path.join(vaultPath, "Development", "Logs", `${year}-${month}.md`);
}

/**
 * Get the Obsidian project directory path.
 * Returns the full path to Development/<project>/ in the vault,
 * or null if not in a Dev project, vault is missing, or dir doesn't exist.
 */
function getObsidianProjectDir(cwd) {
  const folder = getObsidianFolder(cwd);
  if (!folder) return null;

  const vaultPath = getVaultPath();
  if (!vaultPath || !fs.existsSync(vaultPath)) return null;

  const dir = path.join(vaultPath, "Development", folder);
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Get the display name for the current month (e.g., "March 2026")
 */
function getMonthDisplayName() {
  const tz = getTimezone();
  const now = new Date();
  const central = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return central.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: tz,
  });
}

module.exports = {
  getVaultPath,
  getObsidianFolder,
  getObsidianProjectDir,
  getObsidianStatusPath,
  getObsidianLogPath,
  getMonthDisplayName,
  PROJECT_MAP,
};
