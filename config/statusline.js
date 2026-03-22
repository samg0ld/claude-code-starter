#!/usr/bin/env node
/**
 * Status Line for Claude Code
 *
 * Cross-platform (Windows, macOS, Linux) — Node.js replaces the bash version.
 *
 * Displays:
 * - Username:directory
 * - Git branch/dirty status
 * - Context remaining % (color-coded: green > 50%, yellow > 20%, red <= 20%)
 * - Model name (live from input)
 * - Vim mode (if active)
 * - Session name (if set via /rename)
 * - Time
 *
 * Also bridges context_window data to a temp file so context-guard.js
 * can enforce context % limits from PreToolUse hooks (which don't receive
 * context_window data directly).
 */

const { execSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

// ANSI colors (RGB)
const CYAN = "\x1b[38;2;23;146;153m";
const BLUE = "\x1b[38;2;30;102;245m";
const GREEN = "\x1b[38;2;64;160;43m";
const YELLOW = "\x1b[38;2;223;142;29m";
const RED = "\x1b[38;2;231;72;86m";
const MAGENTA = "\x1b[38;2;136;57;239m";
const ORANGE = "\x1b[38;2;255;153;0m";
const GRAY = "\x1b[38;2;76;79;105m";
const RESET = "\x1b[0m";

function runCommand(cmd, fallback = "") {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch {
    return fallback;
  }
}

function getUsername() {
  return os.userInfo().username;
}

function getCurrentDirectory(input) {
  const cwd = input.workspace?.current_dir || process.cwd();
  const home = os.homedir();

  // Normalize separators to forward slashes
  const normalized = cwd.replace(/\\/g, "/");
  const homeNormalized = home.replace(/\\/g, "/");

  if (normalized.startsWith(homeNormalized)) {
    return "~" + normalized.slice(homeNormalized.length);
  }

  return normalized;
}

function getGitInfo(cwd) {
  const branch = runCommand(
    `git -C "${cwd}" rev-parse --abbrev-ref HEAD`,
    "",
  );
  if (!branch) return null;

  const porcelain = runCommand(`git -C "${cwd}" status --porcelain`, "");
  const hasChanges = porcelain.length > 0;

  return { branch, hasChanges };
}

function getContextInfo(input) {
  const remaining = input.context_window?.remaining_percentage;
  const used = input.context_window?.used_percentage;
  if (remaining === undefined || remaining === null) return null;

  const remainingRounded = Math.round(remaining);
  const usedRounded =
    used !== null && used !== undefined ? Math.round(used) : null;

  // Bridge context % to temp file for context-guard hook
  try {
    const bridgeFile = path.join(os.tmpdir(), "claude-context-pct.json");
    fs.writeFileSync(
      bridgeFile,
      JSON.stringify({
        remaining: remainingRounded,
        used: usedRounded,
        timestamp: Date.now(),
      }),
    );
  } catch {
    // Non-critical — guard will just skip context % check
  }

  // Color-code by urgency
  let color;
  if (remainingRounded > 50) {
    color = GREEN;
  } else if (remainingRounded > 20) {
    color = YELLOW;
  } else {
    color = RED;
  }

  return { remaining: remainingRounded, used: usedRounded, color };
}

function getModelName(input) {
  return input.model?.display_name || null;
}

function getTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getVimMode(input) {
  return input.vim?.mode || null;
}

function getSessionName(input) {
  return input.session_name || null;
}

function main() {
  let inputData = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    inputData += chunk;
  });

  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(inputData);

      const user = getUsername();
      const cwd = input.workspace?.current_dir || process.cwd();
      const dir = getCurrentDirectory(input);
      const git = getGitInfo(cwd);
      const ctx = getContextInfo(input);
      const model = getModelName(input);
      const time = getTime();
      const vimMode = getVimMode(input);
      const sessionName = getSessionName(input);

      const parts = [];

      // username:directory
      parts.push(`${CYAN}${user}${RESET}:${BLUE}${dir}${RESET}`);

      // git branch with dirty indicator
      if (git) {
        const dirty = git.hasChanges ? `${YELLOW}*${RESET}` : "";
        parts.push(`${GREEN}${git.branch}${RESET}${dirty}`);
      }

      // context remaining (color-coded by urgency)
      if (ctx !== null) {
        parts.push(`${ctx.color}ctx:${ctx.remaining}%${RESET}`);
      }

      // model name (live from Claude Code input)
      if (model) {
        parts.push(`${GRAY}${model}${RESET}`);
      }

      // vim mode (only when vim is active)
      if (vimMode) {
        const modeColor = vimMode === "INSERT" ? GREEN : ORANGE;
        parts.push(`${modeColor}${vimMode}${RESET}`);
      }

      // session name (only when set via /rename)
      if (sessionName) {
        parts.push(`${MAGENTA}[${sessionName}]${RESET}`);
      }

      // time
      parts.push(`${YELLOW}${time}${RESET}`);

      process.stdout.write(parts.join("  ") + "\n");
    } catch {
      const user = getUsername();
      const time = getTime();
      process.stdout.write(
        `${CYAN}${user}${RESET}  ${YELLOW}${time}${RESET}\n`,
      );
    }
  });
}

main();
