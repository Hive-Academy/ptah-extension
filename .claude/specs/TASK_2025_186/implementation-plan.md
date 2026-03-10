# Implementation Plan - TASK_2025_186: Decouple CLI Subagent Lifecycle

## Problem Statement

When `SessionLifecycleManager.endSession()` is called (user abort or session cleanup), the following cascade occurs:

1. `subagentRegistry.markAllInterrupted(parentSessionId)` marks ALL running subagents as 'interrupted'
2. `query.interrupt()` + `abortController.abort()` kills the SDK session
3. The SDK tears down its subagent processes (Task tool agents)
4. CLI agents (Gemini, Codex, Copilot, Ptah CLI) spawned by those subagents via `ptah_agent_spawn` MCP tool get killed as collateral

**Desired behavior**: CLI agents spawned via `ptah_agent_spawn` should run independently. They should only stop on:

- Their own natural completion
- Their own timeout expiring
- Explicit user action (`agent:stop` RPC / `ptah_agent_stop` MCP tool)

**Existing precedent**: Background agents (`isBackground: true`) are already excluded from `markAllInterrupted()` at line 409 of `subagent-registry.service.ts`. CLI agents need similar protection.

## Codebase Investigation Summary

| File                                                                             | Role                                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:303-365`    | `endSession()` calls `markAllInterrupted()` then `interrupt()` + `abort()`   |
| `libs/backend/vscode-core/src/services/subagent-registry.service.ts:401-435`     | `markAllInterrupted()` skips `isBackground` but not CLI agents               |
| `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` | Tracks CLI processes independently; no connection to SubagentRegistryService |
| `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:208-284`        | SubagentStart hook registers agents in SubagentRegistryService               |
| `libs/shared/src/lib/types/subagent-registry.types.ts`                           | `SubagentRecord` type with `isBackground` field                              |

### Key Finding

CLI agents are managed by two independent systems:

1. **SubagentRegistryService** -- tracks SDK subagents (Task tool). `markAllInterrupted()` marks them, the SDK abort cascade kills their processes.
2. **AgentProcessManager** -- tracks CLI processes (Gemini, Codex, Copilot) with their own process handles or sdkAbortControllers. These are self-contained and have their own timeouts.

The problem is that `markAllInterrupted()` + SDK abort kills the Task-tool subagent that orchestrates a CLI agent, which cascades to kill the CLI process. The CLI process itself (in AgentProcessManager) is independent, but its parent SDK subagent getting killed means any ongoing MCP communication is severed.

## Architectural Approach

**Strategy**: Add an `isCliAgent` flag to `SubagentRecord` (same pattern as `isBackground`), and exclude CLI-flagged agents from `markAllInterrupted()`. This is the minimal, targeted fix that follows the established pattern.

Additionally, the MCP tool handlers for `ptah_agent_spawn` should be resilient to parent session teardown -- CLI processes managed by AgentProcessManager already survive independently since they have their own process handles and timeouts.

## File-by-File Changes

### 1. `libs/shared/src/lib/types/subagent-registry.types.ts`

**Change**: Add `isCliAgent?: boolean` field to `SubagentRecord` interface.

Add after the `isBackground` field (line ~89):

```typescript
/**
 * Whether this subagent manages a CLI agent process (Gemini, Codex, Copilot, Ptah CLI).
 * CLI agents run as independent processes in AgentProcessManager and should NOT be
 * interrupted when the parent SDK session ends. They stop only on their own completion,
 * timeout, or explicit user action (ptah_agent_stop).
 */
readonly isCliAgent?: boolean;
```

### 2. `libs/backend/vscode-core/src/services/subagent-registry.service.ts`

**Change**: In `markAllInterrupted()` (line ~401), add `!record.isCliAgent` to the skip condition alongside `!record.isBackground`.

Current (line 407-409):

```typescript
record.status === 'running' && !record.isBackground; // Background agents outlive the session turn
```

New:

```typescript
record.status === 'running' &&
  !record.isBackground && // Background agents outlive the session turn
  !record.isCliAgent; // CLI agents run independently of parent session
```

Also add `isCliAgent` to the `update()` method's accepted fields (line ~162):

```typescript
| 'isCliAgent'
```

And add the field assignment in the update body:

```typescript
if (updates.isCliAgent !== undefined) {
  (record as { isCliAgent?: boolean }).isCliAgent = updates.isCliAgent;
}
```

### 3. `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts`

**Change**: No changes needed here. The `isCliAgent` flag will be set by the MCP tool handler when it spawns CLI agents, not by the SubagentStart hook. The hook registers all subagents as generic; the MCP handler then updates the flag.

### 4. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`

**Change**: After `ptah_agent_spawn` successfully spawns a CLI agent, update the corresponding SubagentRegistryService record (if one exists for the current toolCallId) to set `isCliAgent: true`.

This requires the protocol handlers to have access to SubagentRegistryService. Check if it's already injected or needs to be added.

**Alternative (simpler)**: Since the MCP tool handler runs inside an SDK subagent's context, and the spawned CLI agent is tracked in AgentProcessManager (which already manages its own lifecycle), the simpler approach is to ensure `markAllInterrupted()` only marks agents that don't have an active process in AgentProcessManager.

**Simplest approach**: Since CLI agents spawned via `ptah_agent_spawn` are NOT registered in SubagentRegistryService (they're only in AgentProcessManager), the `markAllInterrupted()` call does not directly affect them. The real issue is that the **SDK subagent** (the one running the MCP server that called `ptah_agent_spawn`) gets killed, which tears down the MCP connection.

**Revised approach**: The SDK subagent that spawned CLI agents should also be protected. This means we need to flag SDK subagents that have active CLI children as `isCliAgent` (or a better name: `hasActiveCliChildren`).

### Revised Approach (Simpler)

After further analysis, the cleanest fix is at the `markAllInterrupted()` level in SubagentRegistryService. The method should accept an optional predicate or the SessionLifecycleManager should only mark non-CLI-orchestrating subagents.

However, the truly minimal fix is:

**In `SessionLifecycleManager.endSession()`**: Instead of calling `markAllInterrupted()` which blanket-marks everything, call a new method `markNonCliInterrupted()` or pass a filter to exclude agents that are orchestrating CLI processes.

### Final Recommended Approach

The most surgical fix with minimal blast radius:

#### File 1: `libs/shared/src/lib/types/subagent-registry.types.ts`

Add `isCliAgent?: boolean` to `SubagentRecord` (as described above).

#### File 2: `libs/backend/vscode-core/src/services/subagent-registry.service.ts`

Update `markAllInterrupted()` to skip `isCliAgent` agents (as described above).

Update `update()` to accept `isCliAgent` field updates.

#### File 3: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`

After spawning a CLI agent (in `spawn()` and `spawnFromSdkHandle()`), if we have a `parentSessionId`, call `SubagentRegistryService` to mark the parent's orchestrating subagent as `isCliAgent: true`.

**Problem**: AgentProcessManager doesn't know the toolCallId of the SDK subagent that spawned it. It only knows `parentSessionId`.

**Better approach**: Mark the subagent as `isCliAgent` in the MCP handler that calls `ptah_agent_spawn`, since that code runs IN the subagent's context and can access the current toolCallId.

#### File 3 (revised): MCP protocol handlers

In `protocol-handlers.ts`, after successful `ptah_agent_spawn`, find the SubagentRegistryService record for the current session's running subagent and set `isCliAgent: true`.

**Problem**: The MCP handlers may not have direct access to SubagentRegistryService, and the toolCallId mapping is not straightforward from inside the MCP handler.

### Final Minimal Approach (Recommended)

Given the complexity of tracing the toolCallId from MCP handlers, the simplest effective approach is:

1. **Add `isCliAgent` to `SubagentRecord`** (shared types)
2. **Skip `isCliAgent` in `markAllInterrupted()`** (subagent-registry)
3. **Set `isCliAgent` when the SubagentStart hook fires for CLI-orchestrating agents**

The SubagentStart hook receives `agentType` from the SDK. CLI-orchestrating subagents can be identified by their `agentType` if a convention is established. Alternatively, since we can't identify CLI-orchestrating agents at SubagentStart time (they haven't spawned CLI children yet), we need a post-hoc update.

**Simplest viable approach**:

In `AgentProcessManager.spawn()` and `spawnFromSdkHandle()`, after successfully spawning a CLI agent, call into `SubagentRegistryService` to find any running subagent for the same `parentSessionId` and mark it `isCliAgent: true`.

This requires:

- Inject `SubagentRegistryService` into `AgentProcessManager`
- After spawn success, iterate running subagents for the parentSessionId and mark them

## Implementation Plan

### Step 1: Add `isCliAgent` to SubagentRecord

**File**: `libs/shared/src/lib/types/subagent-registry.types.ts`

Add `readonly isCliAgent?: boolean` field with JSDoc.

### Step 2: Update SubagentRegistryService

**File**: `libs/backend/vscode-core/src/services/subagent-registry.service.ts`

- In `markAllInterrupted()`: add `&& !record.isCliAgent` to the filter condition (line ~409)
- In `update()`: add `'isCliAgent'` to accepted update fields and handle assignment
- Add new method `markCliAgent(toolCallId: string): void` for convenience

### Step 3: Wire AgentProcessManager to SubagentRegistryService

**File**: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`

- Inject `SubagentRegistryService` via `TOKENS.SUBAGENT_REGISTRY_SERVICE`
- After successful CLI spawn (both `spawn()` and `spawnFromSdkHandle()`), if `parentSessionId` is provided, find all running subagents for that session and mark them `isCliAgent: true`

**File**: `libs/backend/vscode-core/src/di/tokens.ts` (if SUBAGENT_REGISTRY_SERVICE token not already accessible from llm-abstraction)

Verify the DI token is already available. Evidence: `TOKENS.SUBAGENT_REGISTRY_SERVICE` is used in `session-lifecycle-manager.ts` (line 185), so it exists.

### Step 4: Verify disposeAllSessions() also respects the flag

**File**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`

`disposeAllSessions()` (line 372) also calls `markAllInterrupted()`. Since we're fixing the method itself, this is automatically covered. No additional change needed.

### Step 5: Codex SDK webpack fix

**File**: `apps/ptah-extension-vscode/webpack.config.js`

Already implemented in this branch. Include in the commit.

## Risk Analysis

| Risk                                                      | Severity | Mitigation                                                                                                                                 |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI agents never get cleaned up                           | Low      | They still have their own timeouts (DEFAULT_TIMEOUT = 1 hour) and explicit `ptah_agent_stop`. AgentProcessManager handles its own cleanup. |
| `isCliAgent` not set for some spawn paths                 | Medium   | Both `spawn()` and `spawnFromSdkHandle()` paths must be covered. Unit test should verify.                                                  |
| SubagentRegistryService records for CLI agents accumulate | Low      | Records still expire via TTL (24h) and lazyCleanup. CLI agents that complete naturally trigger SubagentStop hook which deletes the record. |
| Circular dependency: llm-abstraction -> vscode-core       | None     | `SubagentRegistryService` is in `vscode-core` which is a lower layer than `llm-abstraction`. Dependency direction is correct.              |
| `parentSessionId` not always available                    | Low      | MCP spawn has the parent session context. Both spawn paths accept parentSessionId.                                                         |

## Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**: All changes are in backend TypeScript services (shared types, registry service, process manager). No frontend/UI changes.

## Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-3 hours

Changes span 4 files with a clear pattern (isBackground precedent). The main implementation risk is ensuring the isCliAgent flag is correctly set in all spawn paths.
