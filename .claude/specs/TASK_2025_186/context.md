# TASK_2025_186: Decouple CLI Subagent Lifecycle + Codex SDK Webpack Fix

## Strategy: BUGFIX

## Workflow: Partial (Architect -> Team-Leader -> Developers -> QA)

## Complexity: Medium

## User Request

CLI subagent sessions (Gemini, Ptah CLI, Copilot, Codex) are being force-terminated when the main Claude SDK agent finishes its turn. The user requires that CLI subagents run INDEPENDENTLY and are NEVER auto-killed when the parent session ends. The main agent finishing should not affect running subagents.

Additionally, the Codex SDK (`@openai/codex-sdk`) fails to load at runtime because webpack externalizes it (ESM-only package with no CJS export).

## Root Cause Analysis

### Issue 1: Subagent Force Termination

When `endSession()` is called (from `chat:abort` or session cleanup):

1. `SessionLifecycleManager.endSession()` calls `subagentRegistry.markAllInterrupted(parentSessionId)`
2. Then calls `query.interrupt()` and `abortController.abort()`
3. `markAllInterrupted()` marks ALL running subagents for this session as 'interrupted'
4. The abort cascade may affect subagent processes

The fix: `markAllInterrupted()` should NOT touch CLI subagents that are still doing work. CLI subagents should only be stopped by:

- User explicitly calling `ptah_agent_stop`
- The subagent's own timeout expiring
- The subagent completing on its own

### Issue 2: Codex SDK Webpack Externalization

`webpack.config.js` has a catch-all rule: `if (request.startsWith('@'))` → externalize as CJS.
`@openai/codex-sdk` is ESM-only (`"type": "module"`, exports only `"import"`), so CJS loading fails.

The fix: Add `@openai/codex-sdk` to the explicit bundle list (same pattern as `@anthropic-ai/claude-agent-sdk` and `@github/copilot-sdk`). **Already implemented** in this branch.

## Key Files

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` — `endSession()` calls `markAllInterrupted()`
- `libs/backend/vscode-core/src/services/subagent-registry.service.ts` — `markAllInterrupted()` method
- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` — CLI process lifecycle
- `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` — SubagentStop/Start hooks
- `apps/ptah-extension-vscode/webpack.config.js` — Webpack externals config (already fixed)
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` — Codex import (reverted to simple)
