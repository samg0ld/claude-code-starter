#!/usr/bin/env node
/**
 * SessionStart Hook - Load previous session context from Obsidian vault
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Reads Development/<project>/Status.md from the Obsidian vault and
 * outputs it to stdout so Claude receives prior session context.
 *
 * Vault path: OBSIDIAN_VAULT env var (see ../lib/obsidian.js)
 */

const os = require('os');
const path = require('path');
const {
  getProjectRoot,
  getLearnedSkillsDir,
  findFiles,
  ensureDir,
  readFile,
  log,
  output
} = require('../lib/utils');
const { getObsidianStatusPath } = require('../lib/obsidian');
const { getPackageManager, getSelectionPrompt } = require('../lib/package-manager');

async function main() {
  const cwd = process.cwd();
  const projectRoot = getProjectRoot(cwd);
  const learnedDir = getLearnedSkillsDir();

  if (projectRoot) {
    log(`[SessionStart] Project: ${path.basename(projectRoot)}`);
  }

  ensureDir(learnedDir);

  let contextOutput = '';

  // Load session context from Obsidian vault
  const statusPath = getObsidianStatusPath(cwd);

  if (statusPath) {
    log(`[SessionStart] Loading context from: ${statusPath}`);

    const statusContent = readFile(statusPath);

    if (statusContent) {
      // Strip frontmatter (between --- delimiters) for cleaner context injection
      const stripped = statusContent.replace(/^---[\s\S]*?---\n*/, '');

      contextOutput += `\n## Previous Session Context\n\n`;
      contextOutput += stripped.trim();
      contextOutput += `\n\n---\n`;
    }
  } else if (projectRoot) {
    log(`[SessionStart] No Obsidian status found for: ${path.basename(projectRoot)}`);
  }

  // Check for learned skills and list them
  const learnedSkills = findFiles(learnedDir, '*.md');

  if (learnedSkills.length > 0) {
    contextOutput += `\n## Available Learned Skills (${learnedSkills.length})\n\n`;
    for (const skill of learnedSkills.slice(0, 10)) {
      const name = path.basename(skill.path, '.md');
      contextOutput += `- ${name}\n`;
    }
    if (learnedSkills.length > 10) {
      contextOutput += `- ... and ${learnedSkills.length - 10} more\n`;
    }
    contextOutput += `\n`;
  }

  // Output context to stdout - this is what Claude receives
  if (contextOutput) {
    output(contextOutput);
  }

  // Report machine identity
  const hostname = os.hostname();
  const platform = process.platform;
  log(`[SessionStart] Machine: ${hostname} (${platform})`);

  // Log package manager info (to stderr for user visibility)
  const pm = getPackageManager();
  log(`[SessionStart] Package manager: ${pm.name}`);

  if (pm.source === 'fallback' || pm.source === 'default') {
    log(getSelectionPrompt());
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[SessionStart] Error:', err.message);
  process.exit(0);
});
