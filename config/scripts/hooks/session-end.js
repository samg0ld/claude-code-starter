#!/usr/bin/env node
/**
 * SessionEnd Hook - Persist session info when session ends via /exit
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Receives session data via stdin JSON including:
 * - session_id
 * - transcript_path
 * - cwd
 * - reason (e.g., "exit")
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const {
  getSessionsDir,
  getDateString,
  getTimeString,
  ensureDir,
  readFile,
  writeFile,
  replaceInFile,
  readStdinJson,
  log
} = require('../lib/utils');

// Collection limits (not parsing limits)
const MAX_USER_MESSAGES = 20;
const MAX_FILES_TRACKED = 50;
const TIMEOUT_MS = 5000; // 5 seconds - enough time to parse

/**
 * Parse transcript JSONL and extract session content
 * Parses everything but limits what we keep in memory
 */
function parseTranscript(transcriptPath) {
  const result = {
    userMessages: [],
    filesRead: new Set(),
    filesEdited: new Set(),
    toolsUsed: new Set(),
    summary: '',
    cwd: ''
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

        // Extract working directory
        if (entry.cwd && !result.cwd) {
          result.cwd = entry.cwd;
        }

        // Extract user messages (keep all, trim later to get MOST RECENT)
        if (entry.type === 'user' && entry.message?.content) {
          const msgContent = entry.message.content;
          if (typeof msgContent === 'string' && !msgContent.startsWith('<')) {
            result.userMessages.push(msgContent);
          }
        }

        // Extract tool usage from assistant messages
        if (entry.type === 'assistant' && entry.message?.content) {
          const msgContent = entry.message.content;
          if (Array.isArray(msgContent)) {
            for (const block of msgContent) {
              if (block.type === 'tool_use') {
                result.toolsUsed.add(block.name);

                // Track files read
                if (block.name === 'Read' && block.input?.file_path) {
                  result.filesRead.add(block.input.file_path);
                }

                // Track files edited/written
                if ((block.name === 'Edit' || block.name === 'Write') && block.input?.file_path) {
                  result.filesEdited.add(block.input.file_path);
                }
              }
            }
          }
        }

        // Check for summary entry
        if (entry.type === 'summary' && entry.summary) {
          result.summary = entry.summary;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    log(`[SessionEnd] Error parsing transcript: ${err.message}`);
  }

  return result;
}

/**
 * Generate session content from parsed transcript
 */
function generateSessionContent(parsed) {
  const sections = {
    context: '',
    completed: [],
    inProgress: [],
    notes: [],
    filesToLoad: []
  };

  // Build context from user messages - keep MOST RECENT (last N)
  const meaningfulMessages = parsed.userMessages
    .filter(m => m.length > 10 && m.length < 500)
    .slice(-MAX_USER_MESSAGES); // Take last N, not first N

  if (meaningfulMessages.length > 0) {
    sections.context = `User requests during session:\n${meaningfulMessages.map(m => `- ${m}`).join('\n')}`;
  } else if (parsed.summary) {
    sections.context = parsed.summary;
  } else {
    sections.context = 'No significant activity recorded.';
  }

  // Mark edited files as completed work
  if (parsed.filesEdited.size > 0) {
    sections.completed = Array.from(parsed.filesEdited).map(f => `Modified: ${f}`);
  }

  // Add tools used as context
  if (parsed.toolsUsed.size > 0) {
    const tools = Array.from(parsed.toolsUsed).join(', ');
    sections.notes.push(`Tools used: ${tools}`);
  }

  // Add working directory
  if (parsed.cwd) {
    sections.notes.push(`Working directory: ${parsed.cwd}`);
  }

  // Suggest files to load - prioritize edited files, then read files
  const relevantFiles = new Set();

  // Edited files are most important
  for (const f of parsed.filesEdited) {
    if (!f.includes('node_modules') && !f.includes('.git')) {
      relevantFiles.add(f);
    }
  }

  // Add read files
  for (const f of parsed.filesRead) {
    if (!f.includes('node_modules') && !f.includes('.git') && relevantFiles.size < MAX_FILES_TRACKED) {
      relevantFiles.add(f);
    }
  }

  sections.filesToLoad = Array.from(relevantFiles);

  return sections;
}

async function main() {
  // Read hook input from stdin
  const input = await readStdinJson();

  const sessionId = input.session_id || '';
  const transcriptPath = input.transcript_path || '';
  const reason = input.reason || 'unknown';
  const cwd = input.cwd || process.cwd();

  log(`[SessionEnd] Reason: ${reason}, Session: ${sessionId.slice(-8) || 'none'}`);

  // Use project-specific sessions dir if in a Dev project
  const sessionsDir = getSessionsDir(cwd);
  log(`[SessionEnd] Sessions dir: ${sessionsDir}`);
  const today = getDateString();

  // Use session ID if available, otherwise generate unique ID
  let shortId;
  if (sessionId && sessionId.length > 0) {
    shortId = sessionId.slice(-8);
  } else {
    const timestamp = Date.now().toString(36).slice(-4);
    const random = Math.random().toString(36).slice(2, 6);
    shortId = `${timestamp}${random}`;
  }

  const sessionFile = path.join(sessionsDir, `${today}-${shortId}-session.tmp`);

  ensureDir(sessionsDir);

  const currentTime = getTimeString();

  // Parse the transcript to extract session content
  const parsed = parseTranscript(transcriptPath);
  const content = generateSessionContent(parsed);

  // Format completed items
  const completedList = content.completed.length > 0
    ? content.completed.map(c => `- [x] ${c}`).join('\n')
    : '- [ ] (none recorded)';

  // Format in-progress items
  const inProgressList = content.inProgress.length > 0
    ? content.inProgress.map(i => `- [ ] ${i}`).join('\n')
    : '- [ ] (none)';

  // Format notes
  const notesList = content.notes.length > 0
    ? content.notes.map(n => `- ${n}`).join('\n')
    : '- (none)';

  // Format files to load
  const filesToLoad = content.filesToLoad.length > 0
    ? content.filesToLoad.join('\n')
    : '(none)';

  // If session file exists, update it
  if (fs.existsSync(sessionFile)) {
    replaceInFile(
      sessionFile,
      /\*\*Last Updated:\*\*.*/,
      `**Last Updated:** ${currentTime}`
    );

    // Update context section if it has placeholder
    replaceInFile(
      sessionFile,
      /\[Session context goes here\]/,
      content.context
    );

    log(`[SessionEnd] Updated session file: ${sessionFile}`);
  } else {
    // Create new session file with populated template
    const hostname = os.hostname();
    const platform = process.platform;

    const template = `# Session: ${today}
**Date:** ${today}
**Machine:** ${hostname} (${platform})
**Session ID:** ${shortId}
**Started:** ${currentTime}
**Last Updated:** ${currentTime}
**Exit Reason:** ${reason}
**Transcript:** ${transcriptPath || 'N/A'}

---

## Current State

${content.context}

### Completed
${completedList}

### In Progress
${inProgressList}

### Notes for Next Session
${notesList}

### Context to Load
\`\`\`
${filesToLoad}
\`\`\`
`;

    writeFile(sessionFile, template);
    log(`[SessionEnd] Created session file: ${sessionFile}`);
  }

  process.exit(0);
}

// Run with timeout to prevent blocking Claude
const timeout = setTimeout(() => {
  log('[SessionEnd] Timeout reached, exiting gracefully');
  process.exit(0);
}, TIMEOUT_MS);

main()
  .then(() => clearTimeout(timeout))
  .catch(err => {
    clearTimeout(timeout);
    console.error('[SessionEnd] Error:', err.message);
    process.exit(0);
  });
