# Orchestrate Command

Sequential agent workflow with quality gates for complex tasks.

## Usage

```
/orchestrate <agents> "<task>"           # Custom chain (primary)
/orchestrate <preset> "<task>"           # Preset shortcut
```

## Custom Chains (Primary Interface)

Chain any agents by name, comma-separated:

```
/orchestrate planner,tdd-guide,code-reviewer "Add user authentication"
/orchestrate architect,code-reviewer "Redesign caching layer"
/orchestrate security-reviewer,code-reviewer "Audit payment flow"
```

## Presets

| Preset     | Expands To                                              |
|------------|---------------------------------------------------------|
| `feature`  | `planner -> tdd-guide -> code-reviewer -> security-reviewer` |
| `bugfix`   | `build-error-resolver -> tdd-guide -> code-reviewer`    |
| `refactor` | `architect -> code-reviewer -> tdd-guide`               |
| `security` | `security-reviewer -> code-reviewer -> architect`       |

## Model Routing

Only two agents use Opus (deep reasoning); all others use default Sonnet:
- **planner** — Opus (complex architectural planning)
- **security-reviewer** — Opus (thorough vulnerability analysis)
- architect, build-error-resolver, code-reviewer, tdd-guide, etc. — Sonnet

## Execution Protocol

For each agent in the chain:

### 1. Phase Banner
```
══════════════════════════════════════════
PHASE [N/total]: [agent-name]
══════════════════════════════════════════
```

### 2. Invoke Agent
Pass the task description plus handoff context from the previous agent.

### 3. Collect Handoff
Each agent produces a structured handoff:

```markdown
## HANDOFF: [agent-name] -> [next-agent]

### Summary
[What was done]

### Findings
- CRITICAL: [blocking issues]
- HIGH: [important issues]
- MEDIUM: [suggestions]
- LOW: [nice-to-haves]

### Files Modified
[List of files touched]

### Open Questions
[Unresolved items for next agent]
```

### 4. Quality Gate
After each agent, check the handoff for blockers:

- **CRITICAL or HIGH findings?** → Enter fix loop
- **No blockers?** → Proceed to next agent

### 5. Fix Loop (if blockers found)
1. Fix the CRITICAL/HIGH issues
2. Re-run the same agent to verify fixes (max 2 iterations)
3. If still unresolved after 2 iterations → **HALT**

```
[QUALITY GATE] CRITICAL issues found after planner phase
  → Fixing: missing auth middleware dependency
  → Re-running code-reviewer (iteration 1/2)
```

### 6. Halt Mechanism
If fix loops are exhausted:
```
══════════════════════════════════════════
HALTED at PHASE [N/total]: [agent-name]
══════════════════════════════════════════
Remaining issues:
- CRITICAL: [description]
- HIGH: [description]

Remaining agents not run: [list]
Action required: resolve issues manually, then re-run from this phase.
```

## Final Report

After all agents complete (or halt):

```
ORCHESTRATION REPORT
====================
Workflow: [preset or custom chain]
Task: [description]
Agents: [chain with status markers]

PHASE SUMMARIES
---------------
Phase 1 (planner): [summary] ✓
Phase 2 (tdd-guide): [summary] ✓
Phase 3 (code-reviewer): [summary] ✓ (1 fix iteration)
Phase 4 (security-reviewer): [summary] ✓

QUALITY GATE HISTORY
--------------------
Phase 1 → Phase 2: PASS (no blockers)
Phase 2 → Phase 3: PASS (no blockers)
Phase 3 → Phase 4: FIX (1 iteration, resolved)

FILES CHANGED
-------------
[List all files modified across all phases]

RECOMMENDATION
--------------
SHIP | NEEDS WORK | BLOCKED
[Rationale]
```

## Arguments

$ARGUMENTS:
- `feature <description>` - Full feature workflow
- `bugfix <description>` - Bug fix workflow
- `refactor <description>` - Refactoring workflow
- `security <description>` - Security review workflow
- `<agent1,agent2,...> <description>` - Custom agent chain

## Tips

1. **Custom chains first** — presets are just shortcuts
2. **Always include code-reviewer** before merge
3. **Use security-reviewer** for auth/payment/PII
4. **Quality gates catch regressions** — don't skip them
5. **Fix loops prevent cascading failures** — better to halt than ship broken code
