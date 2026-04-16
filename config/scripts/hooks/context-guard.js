#!/usr/bin/env node
/**
 * Context Guard - Devloop-inspired context freshness system
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Replaces suggest-compact.js with enforced guardrails:
 * 1. Task-based counting (Edit/Write/Bash = work units)
 * 2. Configurable fresh threshold (default 20 for 1M context models)
 * 3. Hard context % guard — reads context_window data written by statusline
 * 4. Persistent state file (survives reboots, resets per session)
 *
 * Inspired by Zate/cc-plugins devloop context freshness system.
 */

const fs = require("fs");
const path = require("path");
const {
  getClaudeDir,
  getTempDir,
  getDateTimeString,
  readFile,
  writeFile,
  ensureDir,
  log,
} = require("../lib/utils");

// --- Configuration (override via env vars) ---
// Thresholds tuned per https://claude.com/blog/using-claude-code-session-management-and-1m-context
// Context rot is real but 30% remaining (700K tokens) was too early; 20%/10% is more reasonable
const FRESH_THRESHOLD = parseInt(
  process.env.CONTEXT_FRESH_THRESHOLD || "25",
  10,
);
const CONTEXT_WARN_PCT = parseInt(process.env.CONTEXT_WARN_PCT || "20", 10);
const CONTEXT_HARD_PCT = parseInt(process.env.CONTEXT_HARD_PCT || "10", 10);
const REMINDER_INTERVAL = 10; // re-warn every N tool calls after threshold

// --- State file ---
const STATE_DIR = path.join(getClaudeDir(), "state");
const STATE_FILE = path.join(STATE_DIR, "context-guard.json");
const CONTEXT_PCT_FILE = path.join(getTempDir(), "claude-context-pct.json");

function getState() {
  const raw = readFile(STATE_FILE);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  ensureDir(STATE_DIR);
  writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function getContextPct() {
  const raw = readFile(CONTEXT_PCT_FILE);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    // Only trust data less than 2 minutes old
    if (data.timestamp && Date.now() - data.timestamp < 120000) {
      return data.remaining;
    }
  } catch {}
  return null;
}

function main() {
  const sessionId = process.env.CLAUDE_SESSION_ID || "default";

  // Load or initialize state
  let state = getState();
  if (!state || state.sessionId !== sessionId) {
    state = {
      sessionId,
      toolCalls: 0,
      warnings: 0,
      hardWarnings: 0,
      startedAt: getDateTimeString(),
      lastWarning: null,
    };
  }

  // Increment tool call count
  state.toolCalls++;

  // --- Check 1: Context % guard (from statusline bridge) ---
  const remaining = getContextPct();
  if (remaining !== null) {
    if (remaining <= CONTEXT_HARD_PCT) {
      state.hardWarnings++;
      state.lastWarning = getDateTimeString();
      saveState(state);
      log(
        `[ContextGuard] CRITICAL: Only ${remaining}% context remaining. Run /compact NOW to avoid degraded responses.`,
      );
      log(
        `[ContextGuard] ${state.toolCalls} operations this session. Context is stale.`,
      );
      process.exit(0);
      return;
    }

    if (remaining <= CONTEXT_WARN_PCT && state.warnings === 0) {
      state.warnings++;
      state.lastWarning = getDateTimeString();
      saveState(state);
      log(
        `[ContextGuard] WARNING: ${remaining}% context remaining. Consider /compact at next logical breakpoint.`,
      );
      process.exit(0);
      return;
    }
  }

  // --- Check 2: Fresh threshold (task-based) ---
  if (state.toolCalls === FRESH_THRESHOLD) {
    state.lastWarning = getDateTimeString();
    saveState(state);
    log(
      `[ContextGuard] ${FRESH_THRESHOLD} operations reached. Context may be getting stale.`,
    );
    log(`[ContextGuard] Consider /compact if transitioning between tasks.`);
    process.exit(0);
    return;
  }

  // Periodic reminders after threshold
  if (
    state.toolCalls > FRESH_THRESHOLD &&
    (state.toolCalls - FRESH_THRESHOLD) % REMINDER_INTERVAL === 0
  ) {
    const contextStr =
      remaining !== null ? ` (${remaining}% context remaining)` : "";
    state.lastWarning = getDateTimeString();
    saveState(state);
    log(
      `[ContextGuard] ${state.toolCalls} operations${contextStr}. /compact recommended.`,
    );
    process.exit(0);
    return;
  }

  // Save state silently
  saveState(state);
  process.exit(0);
}

main();
