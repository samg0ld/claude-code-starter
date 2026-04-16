#!/usr/bin/env node
/**
 * Continuous Learning - Session Evaluator
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs on Stop hook to extract reusable patterns from Claude Code sessions.
 * Reads transcript_path from stdin JSON (Claude Code hook input).
 *
 * Why Stop hook instead of UserPromptSubmit:
 * - Stop runs once at session end (lightweight)
 * - UserPromptSubmit runs every message (heavy, adds latency)
 */

const path = require("path");
const fs = require("fs");
const {
  getLearnedSkillsDir,
  ensureDir,
  readFile,
  readStdinJson,
  countInFile,
  log,
} = require("../lib/utils");

const TIMEOUT_MS = 8000;

async function main() {
  const input = await readStdinJson();
  const transcriptPath =
    input.transcript_path || process.env.CLAUDE_TRANSCRIPT_PATH || null;

  // Get script directory to find config
  const scriptDir = __dirname;
  const configFile = path.join(
    scriptDir,
    "..",
    "..",
    "skills",
    "continuous-learning",
    "config.json",
  );

  // Default configuration
  let minSessionLength = 10;
  let learnedSkillsPath = getLearnedSkillsDir();

  // Load config if exists
  const configContent = readFile(configFile);
  if (configContent) {
    try {
      const config = JSON.parse(configContent);
      minSessionLength = config.min_session_length || 10;

      if (config.learned_skills_path) {
        // Handle ~ in path
        learnedSkillsPath = config.learned_skills_path.replace(
          /^~/,
          require("os").homedir(),
        );
      }
    } catch (err) {
      log(
        `[ContinuousLearning] Failed to parse config: ${err.message}, using defaults`,
      );
    }
  }

  // Ensure learned skills directory exists
  ensureDir(learnedSkillsPath);

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    process.exit(0);
  }

  // Count user messages in session (allow optional whitespace around colon)
  const messageCount = countInFile(transcriptPath, /"type"\s*:\s*"user"/g);

  // Skip short sessions
  if (messageCount < minSessionLength) {
    log(
      `[ContinuousLearning] Session too short (${messageCount} messages), skipping`,
    );
    process.exit(0);
  }

  // Signal to Claude that session should be evaluated for extractable patterns
  log(
    `[ContinuousLearning] Session has ${messageCount} messages - evaluate for extractable patterns`,
  );
  log(`[ContinuousLearning] Save learned skills to: ${learnedSkillsPath}`);

  process.exit(0);
}

const timeout = setTimeout(() => {
  log("[ContinuousLearning] Timeout reached, exiting gracefully");
  process.exit(0);
}, TIMEOUT_MS);

main()
  .then(() => clearTimeout(timeout))
  .catch((err) => {
    clearTimeout(timeout);
    log(`[ContinuousLearning] Error: ${err.message}`);
    process.exit(0);
  });
