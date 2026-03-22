#!/usr/bin/env node
/**
 * SessionEnd Hook — Update Obsidian project status on session end
 *
 * Parses the session transcript and writes/updates:
 *   Development/<project>/Status.md
 *
 * Project is determined from cwd → ~/Dev/<project-name>
 * Auto-maps any Dev project; override names via PROJECT_MAP in ../lib/obsidian.js
 * Vault path: OBSIDIAN_VAULT env var (strictly opt-in; no default)
 *
 * Also appends a lean entry to Development/Logs/YYYY-MM.md (monthly session log).
 *
 * Skips gracefully if:
 *   - cwd is not under ~/Dev
 *   - No transcript available
 *   - Vault path doesn't exist
 */

const path = require('path');
const fs = require('fs');
const {
  getProjectRoot,
  getDateString,
  getTimeString,
  readStdinJson,
  ensureDir,
  readFile,
  log
} = require('../lib/utils');
const {
  getVaultPath,
  getObsidianFolder,
  getObsidianLogPath,
  getMonthDisplayName,
} = require('../lib/obsidian');

const DEV_DIR = 'Development';
const TIMEOUT_MS = 8000;

/**
 * Extract meaningful session data from transcript
 */
function parseTranscript(transcriptPath) {
  const result = {
    userMessages: [],
    filesEdited: new Set(),
    filesCreated: new Set(),
    toolsUsed: new Set(),
    gitCommits: [],
    gitPushes: []
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // User messages
        if (entry.type === 'user' && entry.message?.content) {
          const msg = entry.message.content;
          if (typeof msg === 'string' && !msg.startsWith('<') && msg.length > 10 && msg.length < 500) {
            result.userMessages.push(msg);
          }
        }

        // Tool usage from assistant messages
        if (entry.type === 'assistant' && entry.message?.content && Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type !== 'tool_use') continue;

            result.toolsUsed.add(block.name);

            if (block.name === 'Edit' && block.input?.file_path) {
              result.filesEdited.add(block.input.file_path);
            }
            if (block.name === 'Write' && block.input?.file_path) {
              result.filesCreated.add(block.input.file_path);
            }
          }
        }

        // Detect git commits and pushes from tool results
        if (entry.type === 'tool_result') {
          const toolOutput = entry.tool_result?.output || '';
          const commitMatch = toolOutput.match(/^\[[\w-]+ ([a-f0-9]{7,})\] (.+)$/m);
          if (commitMatch) {
            result.gitCommits.push({ hash: commitMatch[1], message: commitMatch[2] });
          }
          if (/-> (main|master|origin)/.test(toolOutput)) {
            result.gitPushes.push(toolOutput.match(/([a-f0-9]{7,})\.\.([a-f0-9]{7,})/)?.[2] || 'pushed');
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    log(`[Obsidian] Error parsing transcript: ${err.message}`);
  }

  return result;
}

/**
 * Build status markdown from parsed transcript
 */
function buildStatusContent(parsed, sessionId, projectName) {
  const today = getDateString();
  const shortId = sessionId ? sessionId.slice(-8) : 'unknown';

  // Build completed list from concrete actions
  const completed = [];

  for (const commit of parsed.gitCommits) {
    completed.push(`${commit.message} (\`${commit.hash}\`)`);
  }

  if (parsed.gitPushes.length > 0) {
    completed.push('Pushed to remote');
  }

  // Group file changes
  if (parsed.filesCreated.size > 0) {
    const created = Array.from(parsed.filesCreated)
      .filter(f => !f.includes('node_modules') && !f.includes('.git'))
      .map(f => path.basename(f));
    if (created.length > 0) {
      completed.push(`Created: ${created.join(', ')}`);
    }
  }

  if (parsed.filesEdited.size > 0) {
    const edited = Array.from(parsed.filesEdited)
      .filter(f => !f.includes('node_modules') && !f.includes('.git'))
      .map(f => path.basename(f));
    if (edited.length > 0) {
      completed.push(`Edited: ${edited.join(', ')}`);
    }
  }

  // Build user request summary for context
  const requests = parsed.userMessages.slice(-10);

  // Format the status note
  const completedList = completed.length > 0
    ? completed.map(c => `- ${c}`).join('\n')
    : '- (auto-detected — check session transcript for details)';

  const requestList = requests.length > 0
    ? requests.map(r => `- ${r.length > 120 ? r.slice(0, 120) + '...' : r}`).join('\n')
    : '- (none captured)';

  const frontmatter = [
    '---',
    `tags: [development, status, ${projectName}]`,
    `project: ${projectName}`,
    `updated: "${today}"`,
    `session: "${shortId}"`,
    '---'
  ].join('\n');

  const body = [
    '# Status',
    '',
    '## Last Session',
    `- **Date:** ${today}`,
    `- **Session ID:** ${shortId}`,
    '',
    '### Completed',
    completedList,
    '',
    '### In Progress',
    '- (update manually or in next session)',
    '',
    '### Next Up',
    '- (update manually or in next session)',
    '',
    '### Gotchas',
    '- (update manually or in next session)',
    '',
    '### Session Requests',
    requestList
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Append a lean entry to the global monthly session log
 */
function appendToSessionLog(parsed, sessionId, projectName) {
  const logPath = getObsidianLogPath();
  if (!logPath) return;

  const today = getDateString();
  const time = getTimeString();
  const shortId = sessionId ? sessionId.slice(-8) : 'unknown';

  // Build lean entry lines
  const details = [];

  for (const commit of parsed.gitCommits) {
    details.push(`- ${commit.message} (\`${commit.hash}\`)`);
  }

  if (parsed.gitPushes.length > 0) {
    details.push('- Pushed to remote');
  }

  const created = Array.from(parsed.filesCreated)
    .filter(f => !f.includes('node_modules') && !f.includes('.git'))
    .map(f => path.basename(f));
  if (created.length > 0) {
    details.push(`- Created: ${created.join(', ')}`);
  }

  const edited = Array.from(parsed.filesEdited)
    .filter(f => !f.includes('node_modules') && !f.includes('.git'))
    .map(f => path.basename(f));
  if (edited.length > 0) {
    details.push(`- Edited: ${edited.join(', ')}`);
  }

  // Condense user requests to 3 most recent, short
  const requests = parsed.userMessages.slice(-3).map(r =>
    r.length > 80 ? r.slice(0, 80) + '...' : r
  );
  if (requests.length > 0) {
    details.push(`- Requests: ${requests.map(r => `"${r}"`).join(', ')}`);
  }

  // If somehow no details, skip
  if (details.length === 0) return;

  // Check if log file exists and if today's date header is already present
  ensureDir(path.dirname(logPath));
  const existing = readFile(logPath) || '';
  const dateHeader = `## ${today}`;

  let entry = '';

  if (existing.length === 0) {
    // New monthly log — add frontmatter and month header
    const monthName = getMonthDisplayName();
    entry += `---\ntags: [development, log]\n---\n\n# Session Log — ${monthName}\n\n`;
    entry += `${dateHeader}\n\n`;
  } else if (!existing.includes(dateHeader)) {
    // Existing log but new day — add date header
    entry += `\n${dateHeader}\n\n`;
  } else {
    // Same day — just append
    entry += '\n';
  }

  entry += `### ${time} — ${projectName} \`${shortId}\`\n`;
  entry += details.join('\n') + '\n';

  fs.appendFileSync(logPath, entry, 'utf8');
  log(`[Obsidian] Appended to session log: Development/Logs/${path.basename(logPath)}`);
}

async function main() {
  const input = await readStdinJson();

  const sessionId = input.session_id || '';
  const transcriptPath = input.transcript_path || '';
  const cwd = input.cwd || process.cwd();

  // Determine project from cwd (auto-maps any Dev project)
  const projectRoot = getProjectRoot(cwd);
  if (!projectRoot) {
    log('[Obsidian] Not in a ~/Dev project, skipping status update');
    process.exit(0);
  }

  const obsidianFolder = getObsidianFolder(cwd);
  if (!obsidianFolder) {
    log('[Obsidian] Could not resolve Obsidian folder');
    process.exit(0);
  }

  // Check vault exists
  const vaultPath = getVaultPath();
  if (!fs.existsSync(vaultPath)) {
    log(`[Obsidian] Vault not found at: ${vaultPath}`);
    process.exit(0);
  }

  const statusDir = path.join(vaultPath, DEV_DIR, obsidianFolder);
  const statusFile = path.join(statusDir, 'Status.md');

  // Parse transcript
  const parsed = parseTranscript(transcriptPath);

  // Only update if there was meaningful activity
  const hasActivity = parsed.filesEdited.size > 0
    || parsed.filesCreated.size > 0
    || parsed.gitCommits.length > 0
    || parsed.userMessages.length > 2;

  if (!hasActivity) {
    log('[Obsidian] No meaningful activity detected, skipping status update');
    process.exit(0);
  }

  // Write status
  ensureDir(statusDir);
  const content = buildStatusContent(parsed, sessionId, obsidianFolder);
  fs.writeFileSync(statusFile, content, 'utf8');
  log(`[Obsidian] Updated ${DEV_DIR}/${obsidianFolder}/Status.md`);

  // Append to global monthly session log
  appendToSessionLog(parsed, sessionId, obsidianFolder);

  process.exit(0);
}

const timeout = setTimeout(() => {
  log('[Obsidian] Timeout reached, exiting gracefully');
  process.exit(0);
}, TIMEOUT_MS);

main()
  .then(() => clearTimeout(timeout))
  .catch(err => {
    clearTimeout(timeout);
    log(`[Obsidian] Error: ${err.message}`);
    process.exit(0);
  });
