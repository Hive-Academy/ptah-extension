# Development Tasks - TASK_2025_099

**Total Tasks**: 16 | **Batches**: 5 | **Status**: 4/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- [x] `TOKENS.AGENT_SESSION_WATCHER_SERVICE` exists (vscode-core/di/tokens.ts:48-50)
- [x] `AgentSessionWatcherService` has no external callers - signature changes are safe
- [x] Cross-library dependency `agent-sdk` -> `vscode-core` already exists (sdk-agent-adapter.ts:30)
- [x] SDK hook types need to be added to claude-sdk.types.ts (verified not present)
- [x] `SDK_SUBAGENT_HOOK_HANDLER` token needs to be created (verified not in SDK_TOKENS)
- [x] `buildQueryOptions` method exists (lines 161-279) and returns options object

### Risks Identified

| Risk                                         | Severity | Mitigation                                            |
| -------------------------------------------- | -------- | ----------------------------------------------------- |
| `toolUseId` not available at `SubagentStart` | LOW      | Make optional in signature, add `setToolUseId` method |
| `agent_id` pattern mismatch with file        | LOW      | Fall back to existing `session_id` matching           |
| Race condition for file detection            | LOW      | Existing `pendingAgentFiles` cache handles this       |

### Edge Cases to Handle

- [ ] SubagentStart fires but file never created -> Task 2.2 (existing 60s timeout)
- [ ] Multiple agents start simultaneously -> Task 2.1 (Map-based tracking)
- [ ] SubagentStop fires before file matched -> Task 2.3 (`setToolUseId` late binding)

---

## Batch 1: Foundation Types & Token Setup (IMPLEMENTED)

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Add SDK Hook Types to claude-sdk.types.ts (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\types\sdk-types\claude-sdk.types.ts`
**Spec Reference**: implementation-plan.md lines 17-56
**Pattern to Follow**: Existing type definitions in same file (lines 436-463)

**Quality Requirements**:

- Types must match SDK v0.1.69 exactly (from `node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts`)
- Add type guards for new types
- Follow existing naming conventions (SDKxxxxMessage pattern)

**Validation Notes**:

- Verify types against SDK documentation at lines 234-244 of agentSdkTypes.d.ts
- Hook callback must return `HookJSONOutput` (`{ continue: true }`)

**Implementation Details**:

- Add `BaseHookInput` interface (session_id, transcript_path, cwd, permission_mode?)
- Add `SubagentStartHookInput` extending `BaseHookInput` (hook_event_name: 'SubagentStart', agent_id, agent_type)
- Add `SubagentStopHookInput` extending `BaseHookInput` (hook_event_name: 'SubagentStop', stop_hook_active, agent_id, agent_transcript_path)
- Add `HookEvent` type union ('SubagentStart' | 'SubagentStop' | ...)
- Add `HookCallback` type (function signature)
- Add `HookCallbackMatcher` interface (matcher?, hooks, timeout?)
- Add `HookJSONOutput` type (contains `continue` boolean)
- Add type guards: `isSubagentStartHook`, `isSubagentStopHook`

---

### Task 1.2: Add SDK_SUBAGENT_HOOK_HANDLER Token (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
**Spec Reference**: implementation-plan.md lines 288-291, 344-350
**Pattern to Follow**: Existing tokens in same file (lines 10-29)

**Quality Requirements**:

- Use string token (not Symbol) to match existing pattern
- Follow naming convention: `SDK_xxxx`

**Implementation Details**:

- Add `SDK_SUBAGENT_HOOK_HANDLER: 'SdkSubagentHookHandler'` to `SDK_TOKENS` object
- Place after `SDK_ATTACHMENT_PROCESSOR` (line 25)

---

### Task 1.3: Export New Types from index.ts (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`
**Spec Reference**: implementation-plan.md lines 172-174, 428
**Pattern to Follow**: Existing exports (line 34: `export * from './lib/types/sdk-types/claude-sdk.types'`)

**Quality Requirements**:

- All new hook types must be accessible from package root
- No duplicate exports

**Validation Notes**:

- Types are already re-exported via `export *` on line 34
- Verify types appear in IntelliSense after build

**Implementation Details**:

- Verify the wildcard export covers new types (it should)
- NO FILE CHANGES NEEDED - the existing `export *` handles this
- Mark as complete after verification

---

**Batch 1 Verification**:

- [x] All new types compile without errors
- [x] Build passes: `npx nx build agent-sdk`
- [x] Types accessible from `@ptah-extension/agent-sdk` (via wildcard export on line 34)
- [ ] code-logic-reviewer approved

---

## Batch 2: AgentSessionWatcherService Modifications (IMPLEMENTED)

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Update ActiveWatch Interface (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts`
**Spec Reference**: implementation-plan.md lines 211-224
**Pattern to Follow**: Existing interface at lines 37-50

**Quality Requirements**:

- `agentId` becomes the primary identifier
- `toolUseId` is nullable (may not be known at start)
- Backward compatible with existing file matching logic

**Validation Notes**:

- ActiveWatch currently has NO agentId field
- toolUseId is currently the Map KEY, not a field
- Change Map key from toolUseId to agentId

**Implementation Details**:

- Add `agentId: string` field (primary identifier)
- Add `toolUseId: string | null` field (set later via `setToolUseId`)
- Keep existing fields: `sessionId`, `startTime`, `agentFilePath`, `fileOffset`, `summaryContent`, `tailInterval`
- Change `activeWatches` Map type from `Map<string, ActiveWatch>` (toolUseId key) to `Map<string, ActiveWatch>` (agentId key)
- Update JSDoc comments to reflect agentId as primary key

---

### Task 2.2: Update startWatching Signature (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts`
**Spec Reference**: implementation-plan.md lines 186-209
**Pattern to Follow**: Existing method at lines 83-109

**Quality Requirements**:

- `agentId` is required (primary key)
- `toolUseId` is optional (may be provided later)
- Pattern matching uses `agent-{agent_id}.jsonl`
- Maintains existing file detection logic

**Validation Notes**:

- No external callers exist - signature change is safe
- Must handle case where toolUseId is not yet known

**Implementation Details**:

- New signature: `startWatching(agentId: string, sessionId: string, workspacePath: string, toolUseId?: string): Promise<void>`
- Change Map key from `toolUseId` to `agentId` in `this.activeWatches.set()`
- Store `toolUseId` in ActiveWatch (may be null/undefined)
- Update `matchPendingFiles` call to use `agentId`
- Add pattern matching for `agent-{agent_id}.jsonl` in file detection
- Update logging to include `agentId`

---

### Task 2.3: Add setToolUseId Method and Update stopWatching (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts`
**Spec Reference**: implementation-plan.md lines 201-203, 272-278
**Pattern to Follow**: Existing `stopWatching` at lines 119-141

**Quality Requirements**:

- `setToolUseId` enables late binding of toolUseId
- `stopWatching` uses `agentId` as key
- Summary chunks include `toolUseId` when available

**Validation Notes**:

- setToolUseId called from SubagentStop hook when toolUseId becomes available
- Summary chunks already include toolUseId in emit (line 391-394)

**Implementation Details**:

- Add new method: `setToolUseId(agentId: string, toolUseId: string): void`
  - Finds watch by agentId
  - Sets `watch.toolUseId = toolUseId`
  - Logs the association
- Update `stopWatching` signature: `stopWatching(agentId: string): void`
- Change `this.activeWatches.get(toolUseId)` to `this.activeWatches.get(agentId)`
- Change `this.activeWatches.delete(toolUseId)` to `this.activeWatches.delete(agentId)`
- In `readNewContent`, use `watch.toolUseId` in emitted chunk (handle null case)
- Update all internal references from toolUseId key to agentId key

---

**Batch 2 Verification**:

- [x] All methods compile without errors
- [x] Build passes: `npx nx build vscode-core`
- [ ] Unit tests pass (if exist)
- [ ] code-logic-reviewer approved
- [x] Edge cases from validation handled

---

## Batch 3: SubagentHookHandler Service (IMPLEMENTED)

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 2

### Task 3.1: Create SubagentHookHandler Service (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts` (CREATE)
**Spec Reference**: implementation-plan.md lines 236-284
**Pattern to Follow**: `sdk-permission-handler.ts` (similar service injection pattern)

**Quality Requirements**:

- Hooks must never throw (would break SDK)
- Always return `{ continue: true }` for non-blocking
- Logging for all lifecycle events (debug level)
- Unit testable without file system access

**Validation Notes**:

- Hook callback receives `toolUseID` parameter (may be undefined at SubagentStart)
- Must handle errors gracefully (log, don't throw)

**Implementation Details**:

```typescript
/**
 * SubagentHookHandler - Encapsulates SDK subagent hook callbacks
 *
 * Connects SDK lifecycle hooks to AgentSessionWatcherService for
 * real-time subagent text streaming.
 */
import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { AgentSessionWatcherService } from '@ptah-extension/vscode-core';
import type { SubagentStartHookInput, SubagentStopHookInput, HookCallbackMatcher, HookEvent, HookJSONOutput } from '../types/sdk-types/claude-sdk.types';

@injectable()
export class SubagentHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private readonly agentWatcher: AgentSessionWatcherService
  ) {}

  /**
   * Create hooks configuration for SDK query options
   * @param workspacePath - Workspace path for agent file detection
   */
  createHooks(workspacePath: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      SubagentStart: [
        {
          hooks: [async (input, toolUseId, options) => this.handleSubagentStart(input as SubagentStartHookInput, toolUseId, workspacePath)],
        },
      ],
      SubagentStop: [
        {
          hooks: [async (input, toolUseId, options) => this.handleSubagentStop(input as SubagentStopHookInput, toolUseId)],
        },
      ],
    };
  }

  private async handleSubagentStart(input: SubagentStartHookInput, toolUseId: string | undefined, workspacePath: string): Promise<HookJSONOutput> {
    try {
      this.logger.debug('[SubagentHookHandler] SubagentStart received', {
        agentId: input.agent_id,
        agentType: input.agent_type,
        sessionId: input.session_id,
        toolUseId,
      });

      await this.agentWatcher.startWatching(input.agent_id, input.session_id, workspacePath, toolUseId);
    } catch (error) {
      this.logger.error('[SubagentHookHandler] Error in SubagentStart hook', error instanceof Error ? error : new Error(String(error)));
      // Never throw - return continue to not block SDK
    }
    return { continue: true };
  }

  private async handleSubagentStop(input: SubagentStopHookInput, toolUseId: string | undefined): Promise<HookJSONOutput> {
    try {
      this.logger.debug('[SubagentHookHandler] SubagentStop received', {
        agentId: input.agent_id,
        transcriptPath: input.agent_transcript_path,
        toolUseId,
      });

      // Set toolUseId if available (for UI routing)
      if (toolUseId) {
        this.agentWatcher.setToolUseId(input.agent_id, toolUseId);
      }

      // Stop watching this agent
      this.agentWatcher.stopWatching(input.agent_id);
    } catch (error) {
      this.logger.error('[SubagentHookHandler] Error in SubagentStop hook', error instanceof Error ? error : new Error(String(error)));
      // Never throw - return continue to not block SDK
    }
    return { continue: true };
  }
}
```

---

### Task 3.2: Export SubagentHookHandler from helpers/index.ts (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts`
**Spec Reference**: implementation-plan.md lines 288-289
**Pattern to Follow**: Existing exports at lines 10-27

**Quality Requirements**:

- Export class and relevant types
- Follow existing export pattern

**Implementation Details**:

- Add export: `export { SubagentHookHandler } from './subagent-hook-handler';`
- Place after existing exports

---

### Task 3.3: Register SubagentHookHandler in DI Container (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
**Spec Reference**: implementation-plan.md lines 337-350
**Pattern to Follow**: Existing registrations at lines 82-143

**Quality Requirements**:

- Register as singleton
- Register BEFORE SdkAgentAdapter (dependency ordering)
- Uses @injectable() decorator (auto-wiring)

**Implementation Details**:

- Add import: `import { SubagentHookHandler } from '../helpers';`
- Add registration after AttachmentProcessorService (around line 136):

```typescript
// Subagent hook handler - depends on Logger, AgentSessionWatcherService
container.register(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER, { useClass: SubagentHookHandler }, { lifecycle: Lifecycle.Singleton });
```

---

**Batch 3 Verification**:

- [x] SubagentHookHandler compiles without errors
- [x] Build passes: `npx nx build agent-sdk`
- [x] DI registration resolves correctly
- [ ] code-logic-reviewer approved
- [x] Hooks return `{ continue: true }` in all paths

---

## Batch 4: SdkAgentAdapter Integration (IMPLEMENTED)

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 3

### Task 4.1: Inject SubagentHookHandler via DI (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Spec Reference**: implementation-plan.md lines 300-317
**Pattern to Follow**: Existing injections at lines 136-155

**Quality Requirements**:

- Uses `@inject()` decorator
- Type-safe injection via SDK_TOKENS

**Implementation Details**:

- Add import: `import { SubagentHookHandler } from './helpers';`
- Add import for SDK_TOKENS if not present
- Add constructor parameter (after permissionHandler at line 154):

```typescript
@inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
private readonly subagentHookHandler: SubagentHookHandler
```

---

### Task 4.2: Add Hooks to buildQueryOptions Return Value (IMPLEMENTED)

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Spec Reference**: implementation-plan.md lines 311-326
**Pattern to Follow**: Existing options return at lines 240-278

**Quality Requirements**:

- Hooks are optional (SDK works without them)
- No breaking changes to existing buildQueryOptions callers
- Workspace path correctly passed to createHooks

**Validation Notes**:

- cwd is available in buildQueryOptions (line 205)
- hooks property accepted by SDK query options

**Implementation Details**:

- In `buildQueryOptions` method, add hooks to the return object's options:

```typescript
return {
  prompt: userMessageStream,
  options: {
    // ... existing options (abortController, cwd, model, etc.)

    // TASK_2025_099: Add subagent lifecycle hooks for real-time streaming
    hooks: this.subagentHookHandler.createHooks(cwd),
  },
};
```

- Add after `env` option (around line 272)
- Type assertion may be needed for SDK compatibility (see canUseToolCallback pattern at line 223)

---

**Batch 4 Verification**:

- [x] SdkAgentAdapter compiles without errors
- [x] Build passes: `npx nx build agent-sdk`
- [x] Hooks passed to SDK query
- [ ] code-logic-reviewer approved
- [ ] No regressions in existing functionality

---

## Final Verification Checklist

- [ ] All 4 batches marked complete
- [ ] All files compile: `npx nx build agent-sdk && npx nx build vscode-core`
- [ ] Type checking passes: `npx nx typecheck:all`
- [ ] All git commits created with proper messages
- [ ] Manual test: Run `/orchestrate` command with Task tool to verify streaming

---

## Batch 5: Code Review Fixes - IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 4
**Triggered By**: Logic Review (6/10) + Style Review (6/10)

### Task 5.1: Use Type Guards Instead of Type Assertions (SERIOUS) - IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts`
**Issue**: Lines 80, 96 use `input as SubagentStartHookInput` type assertions without validation.
**Spec Reference**: code-review.md - Type Safety findings

**Quality Requirements**:

- Use `isSubagentStartHook(input)` before accessing SubagentStart-specific fields
- Use `isSubagentStopHook(input)` before accessing SubagentStop-specific fields
- Remove unsafe type assertions
- Add early return with logging if type guard fails

**Implementation Details**:

```typescript
// BEFORE (unsafe):
async (input: HookInput, ...): Promise<HookJSONOutput> =>
  this.handleSubagentStart(input as SubagentStartHookInput, ...)

// AFTER (safe):
async (input: HookInput, ...): Promise<HookJSONOutput> => {
  if (!isSubagentStartHook(input)) {
    this.logger.warn('[SubagentHookHandler] Unexpected hook input type', {
      expected: 'SubagentStart',
      received: input.hook_event_name
    });
    return { continue: true };
  }
  return this.handleSubagentStart(input, ...)
}
```

**Validation Notes**:

- Type guards `isSubagentStartHook` and `isSubagentStopHook` already exist in `claude-sdk.types.ts` (lines 1074-1087)
- Import the type guards from '../types/sdk-types/claude-sdk.types'

---

### Task 5.2: Extract Magic Numbers to Named Constants (MINOR) - IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts`
**Issue**: 30000, 60000, 200, 4096 scattered throughout the file.
**Spec Reference**: code-review.md - Style findings

**Quality Requirements**:

- Create a constants block at top of file (after imports, before interfaces)
- Use descriptive names that explain purpose
- Update all usages to reference constants

**Implementation Details**:

```typescript
// Add after imports, before interfaces:
/**
 * Configuration constants for agent session watching
 */
const AGENT_WATCHER_CONSTANTS = {
  /** Time window (ms) for matching agent files to active watches */
  MATCH_WINDOW_MS: 30_000,
  /** Cleanup timeout (ms) for pending agent files */
  PENDING_CLEANUP_MS: 60_000,
  /** Interval (ms) between file tail reads */
  TAIL_INTERVAL_MS: 200,
  /** Buffer size (bytes) for reading first line of agent file */
  FIRST_LINE_BUFFER_SIZE: 4096,
  /** Delay (ms) after file detection before reading */
  FILE_DETECTION_DELAY_MS: 100,
} as const;
```

Locations to update:

- Line 261: `await this.delay(100)` -> `await this.delay(AGENT_WATCHER_CONSTANTS.FILE_DETECTION_DELAY_MS)`
- Line 280: `if (timeDiff < 30000)` -> `if (timeDiff < AGENT_WATCHER_CONSTANTS.MATCH_WINDOW_MS)`
- Line 305: `}, 60000)` -> `}, AGENT_WATCHER_CONSTANTS.PENDING_CLEANUP_MS)`
- Line 324: `if (now - stats.mtimeMs < 30000)` -> `if (now - stats.mtimeMs < AGENT_WATCHER_CONSTANTS.MATCH_WINDOW_MS)`
- Line 351: `if (timeDiff < 30000)` -> `if (timeDiff < AGENT_WATCHER_CONSTANTS.MATCH_WINDOW_MS)`
- Line 383: `}, 200)` -> `}, AGENT_WATCHER_CONSTANTS.TAIL_INTERVAL_MS)`
- Line 490: `Buffer.alloc(4096)` -> `Buffer.alloc(AGENT_WATCHER_CONSTANTS.FIRST_LINE_BUFFER_SIZE)`

---

### Task 5.3: Add dispose() Method to SubagentHookHandler (MINOR) - IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts`
**Issue**: Missing dispose() method for consistency with SdkPermissionHandler pattern.
**Spec Reference**: code-review.md - Consistency findings

**Quality Requirements**:

- Add dispose() method for cleanup
- Log disposal for debugging
- Follow pattern from SdkPermissionHandler

**Implementation Details**:

```typescript
/**
 * Dispose of the hook handler
 *
 * Called during extension deactivation to clean up resources.
 * Currently no-op but maintains consistency with other handlers.
 */
dispose(): void {
  this.logger.debug('[SubagentHookHandler] Disposed');
}
```

Add after the `handleSubagentStop` method (before closing brace of class).

---

### Task 5.4: Track and Clear Pending File Cleanup Timeouts (MINOR) - IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts`
**Issue**: Line 303 creates untracked setTimeout that can cause memory leaks.
**Spec Reference**: code-review.md - Memory Leak findings

**Quality Requirements**:

- Track timeout IDs in a Set or Map
- Clear all tracked timeouts in dispose()
- Prevent memory leaks from orphaned timeouts

**Implementation Details**:

1. Add tracking Set after `pendingAgentFiles` declaration:

```typescript
/** Tracked timeout IDs for cleanup on dispose */
private readonly pendingCleanupTimeouts = new Set<NodeJS.Timeout>();
```

2. Update the setTimeout call (around line 303):

```typescript
// Clean up old pending files after configured timeout
const timeoutId = setTimeout(() => {
  this.pendingAgentFiles.delete(filePath);
  this.pendingCleanupTimeouts.delete(timeoutId);
}, AGENT_WATCHER_CONSTANTS.PENDING_CLEANUP_MS);
this.pendingCleanupTimeouts.add(timeoutId);
```

3. Update dispose() method to clear tracked timeouts:

```typescript
dispose(): void {
  // Stop all tail intervals
  for (const [agentId, watch] of this.activeWatches) {
    if (watch.tailInterval) {
      clearInterval(watch.tailInterval);
    }
  }
  this.activeWatches.clear();

  // Stop directory watcher
  this.stopDirectoryWatcher();

  // Clear pending files and their cleanup timeouts
  this.pendingAgentFiles.clear();
  for (const timeoutId of this.pendingCleanupTimeouts) {
    clearTimeout(timeoutId);
  }
  this.pendingCleanupTimeouts.clear();
}
```

---

### Task 5.5: Document Intentional AbortSignal Non-Usage (MINOR) - IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts`
**Issue**: Lines 77, 93 have unused `_options: { signal: AbortSignal }` parameter.
**Spec Reference**: code-review.md - Unused Parameter findings

**Quality Requirements**:

- Document why AbortSignal is intentionally not used
- Keep parameter for SDK API compliance
- Consider future use case documentation

**Implementation Details**:
Update the createHooks method with JSDoc explaining the design decision:

```typescript
/**
 * Create hooks configuration for SDK query options
 *
 * Returns a hooks object that can be spread into SDK query options.
 * Each hook callback is wrapped with error handling to ensure
 * the SDK is never blocked by hook failures.
 *
 * Note: The AbortSignal parameter is part of the SDK hook callback signature
 * but is intentionally not used in subagent hooks. Subagent lifecycle events
 * (start/stop) are informational and complete instantly - there's no long-running
 * operation to abort. The signal is preserved for SDK API compliance.
 *
 * @param workspacePath - Workspace path for agent file detection
 * @returns Hooks configuration for SDK query options
 */
```

---

**Batch 5 Verification**:

- [x] All type assertions replaced with type guards
- [x] All magic numbers replaced with named constants
- [x] dispose() method added to SubagentHookHandler
- [x] Timeout tracking prevents memory leaks
- [x] AbortSignal non-usage documented
- [x] Build passes: `npx nx build agent-sdk && npx nx build vscode-core`
- [ ] code-logic-reviewer re-approved

---

## Files Summary

### CREATE (1 file)

| File                                                              | Purpose             |
| ----------------------------------------------------------------- | ------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` | Hook callback logic |

### MODIFY (6 files)

| File                                                                     | Changes                                |
| ------------------------------------------------------------------------ | -------------------------------------- |
| `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`     | Add hook types                         |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                            | Add hook handler token                 |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                          | Register hook handler                  |
| `libs/backend/agent-sdk/src/lib/helpers/index.ts`                        | Export hook handler                    |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                    | Inject handler, add to options         |
| `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` | Update signature, add agentId tracking |

### NO CHANGE (1 file)

| File                                  | Reason                                   |
| ------------------------------------- | ---------------------------------------- |
| `libs/backend/agent-sdk/src/index.ts` | Wildcard export already covers new types |
