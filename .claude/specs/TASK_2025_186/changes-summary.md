# TASK_2025_186: Changes Summary

## Status: Implementation complete, pending manual testing

## Bug 1: Codex SDK Webpack Fix

**Root cause**: `@openai/codex-sdk` is ESM-only (`"type": "module"`, exports only `"import"`). Webpack's catch-all rule externalizes all `@`-scoped packages as CJS, causing runtime failure.

**Fix**: Added `@openai/codex-sdk` to the explicit bundle list in webpack config (same pattern as `@anthropic-ai/claude-agent-sdk` and `@github/copilot-sdk`).

## Bug 2: CLI Subagent Lifecycle Decoupling

**Root cause**: When `endSession()` is called, `markAllInterrupted()` marks ALL running subagents as 'interrupted', and the SDK abort cascade kills their processes. CLI subagents should run independently.

**Fix**: Added `isCliAgent` flag (following existing `isBackground` pattern) that protects CLI-orchestrating subagents from being interrupted on session end.

### Critical secondary fix: Session ID mismatch

Code reviewers found that the feature would be a **no-op** without fixing the session ID mismatch:

- SubagentRegistryService records used **tab ID** as `parentSessionId`
- CLI spawn flow used **real UUID** as `parentSessionId` (from `getActiveSessionIds()`)
- `markParentSubagentsAsCliAgent(realUUID)` found 0 records

Fixed by adding `SubagentRegistryService.resolveParentSessionId(tabId, realUUID)` called alongside the existing `AgentProcessManager.resolveParentSessionId()`.

## Files Changed (8)

### 1. `libs/shared/src/lib/types/subagent-registry.types.ts`

- Added `isCliAgent?: boolean` to `SubagentRecord` interface (after `isBackground`)

### 2. `libs/backend/vscode-core/src/services/subagent-registry.service.ts`

- `markAllInterrupted()`: Added `&& !record.isCliAgent` to skip CLI agents
- `update()`: Added `'isCliAgent'` to accepted fields, added field assignment
- Added `resolveParentSessionId(tabId, realSessionId)` method to update records from tab ID to real UUID

### 3. `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`

- Injected `SubagentRegistryService` via `TOKENS.SUBAGENT_REGISTRY_SERVICE`
- Added `markParentSubagentsAsCliAgent(parentSessionId)` private method
- Called after `agent:spawned` in both `doSpawn()` (line ~405) and `trackSdkHandle()` (line ~700)

### 4. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`

- `createHooks()` now passes `sessionId` to `subagentHookHandler.createHooks(cwd, sessionId)`
- Without this, SubagentStart hook never registered subagents (parentSessionId was undefined)

### 5. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`

- `endSession()`: Resolves tab ID → real UUID before calling `markAllInterrupted()`
- `disposeAllSessions()`: Same resolution before `markAllInterrupted()`

### 6. `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`

- Added `SubagentRegistryService` import
- In `sessionIdResolvedCallback`: calls `subagentRegistry.resolveParentSessionId(tabId, realSessionId)` alongside the existing `AgentProcessManager.resolveParentSessionId()`

### 7. `apps/ptah-extension-vscode/webpack.config.js`

- Added `@openai/codex-sdk` to explicit bundle list (ESM-only package)

### 8. `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`

- Updated JSDoc on `getCodexSdk()` to document webpack bundling strategy

## Data Flow (After Fix)

```
1. SDK session starts with tab ID ("tab_xxx")
2. executeQuery(sessionId=tab_xxx) → createHooks(cwd, tab_xxx)
   → SubagentHookHandler captures parentSessionId=tab_xxx
3. SDK init message resolves real UUID ("a1b2c3d4-...")
   → SessionLifecycleManager.resolveRealSessionId(tab_xxx, real-uuid)
   → AgentProcessManager.resolveParentSessionId(tab_xxx, real-uuid)
   → SubagentRegistryService.resolveParentSessionId(tab_xxx, real-uuid)  [NEW]
4. SDK spawns Task tool subagent → SubagentStart hook fires
   → SubagentRegistryService registers with parentSessionId=real-uuid (already resolved)
5. Inside subagent, MCP tool ptah_agent_spawn called
   → getActiveSessionIds() returns [real-uuid]
   → AgentProcessManager.spawn({parentSessionId: real-uuid})
   → markParentSubagentsAsCliAgent(real-uuid) finds records, sets isCliAgent=true
6. When session ends:
   → endSession(tab_xxx) resolves to real-uuid via tabIdToRealId
   → markAllInterrupted(real-uuid) skips isCliAgent records
   → CLI processes continue independently in AgentProcessManager
```

## Accepted Tradeoffs (from code review)

| Finding                                             | Decision                                               |
| --------------------------------------------------- | ------------------------------------------------------ |
| All running subagents marked, not just orchestrator | Accepted — single subagent per session in practice     |
| `isCliAgent` naming                                 | Kept — follows `isBackground` pattern, JSDoc clarifies |
| `readonly` cast-away pattern                        | Pre-existing pattern, out of scope                     |
| Orphaned isCliAgent records                         | 24h TTL cleanup handles this                           |

## Typechecks Verified

- `shared:typecheck` ✅
- `vscode-core:typecheck` ✅
- `agent-sdk:typecheck` ✅
- `llm-abstraction:typecheck` ✅
- `ptah-extension-vscode:typecheck` ✅
