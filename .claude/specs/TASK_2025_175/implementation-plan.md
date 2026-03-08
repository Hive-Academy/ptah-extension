# Implementation Plan - TASK_2025_175

## Fix Agent Interruption Race Condition in Yolo Mode

**Task Type**: BUGFIX (P0 - Critical)
**Recommended Developer**: backend-developer
**Complexity**: MEDIUM
**Estimated Effort**: 3-5 hours

---

## Codebase Investigation Summary

### Files Analyzed

| File                       | Path                                                                             | Lines | Role                                                             |
| -------------------------- | -------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| SessionLifecycleManager    | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`            | 723   | SDK session tracking, abort/interrupt orchestration              |
| AgentProcessManager        | `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` | ~1200 | CLI agent process lifecycle (spawn, stop, kill)                  |
| AgentSessionWatcherService | `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`         | 1211  | Background agent JSONL file tailing                              |
| ChatRpcHandlers            | `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`      | ~1200 | RPC endpoints for chat:start, chat:continue, chat:abort          |
| SdkAgentAdapter            | `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                            | 679   | IAIProvider implementation, delegates to SessionLifecycleManager |

### Root Cause Analysis

The bug manifests as: user clicks abort in yolo mode, UI shows session closed, but agent continues running in the background, potentially creating new sessions.

Five root causes contribute to this behavior. They interact as a cascade:

1. `interrupt()` is fire-and-forget, so the SDK process never receives the graceful stop signal before being force-killed
2. Errors from interrupt are silently swallowed at DEBUG level, making failures invisible
3. Background agent watchers are never told to stop when a session is aborted
4. `stop()` in AgentProcessManager returns before the SDK process actually dies
5. There is no integration between session abort and the watcher cleanup

---

## Component Specifications

### Component 1: Fix interrupt() sequencing in SessionLifecycleManager.endSession()

**Purpose**: Ensure `interrupt()` is properly awaited with a timeout before `abort()` is called, following SDK best practices.

**Root Causes Addressed**: RC1, RC2

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`

**Pattern**: The SDK requires a specific termination sequence: `interrupt()` (graceful) -> `abort()` (forceful). Currently `interrupt()` is fire-and-forget, meaning `abort()` is called immediately and kills the process before the interrupt signal can be processed by the SDK.

**Evidence**:

- `session-lifecycle-manager.ts:307-320` - Current fire-and-forget pattern
- `session-lifecycle-manager.ts:311` - Error logged at DEBUG level only
- SDK docs specify: "interrupt() MUST be awaited before abort()"

#### Change 1a: Make endSession() async and await interrupt() with timeout

**Location**: `session-lifecycle-manager.ts:283-327` (endSession method)

**Current code** (lines 283-327):

```typescript
endSession(sessionId: SessionId): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.warn(
        `[SessionLifecycle] Cannot end session - not found: ${sessionId}`
      );
      return;
    }

    this.logger.info(`[SessionLifecycle] Ending session: ${sessionId}`);

    // TASK_2025_102: Cleanup pending permissions FIRST
    this.permissionHandler.cleanupPendingPermissions(sessionId as string);

    // TASK_2025_103: Mark all running subagents as interrupted BEFORE aborting
    this.subagentRegistry.markAllInterrupted(sessionId as string);

    this.logger.info(
      `[SessionLifecycle] Marked running subagents as interrupted for session: ${sessionId}`
    );

    // Interrupt the SDK query BEFORE aborting (if initialized)
    if (session.query) {
      session.query.interrupt().catch((err) => {
        this.logger.debug(
          `[SessionLifecycle] Interrupt cleanup for session ${sessionId}`,
          err
        );
      });
    }

    // Abort the session (kills the process after interrupt signal sent)
    session.abortController.abort();

    // Remove from active sessions and clean up tab-to-real mapping
    this.activeSessions.delete(sessionId as string);
    this.tabIdToRealId.delete(sessionId as string);

    this.logger.info(`[SessionLifecycle] Session ended: ${sessionId}`);
  }
```

**Required changes**:

1. Change method signature from `endSession(sessionId: SessionId): void` to `async endSession(sessionId: SessionId): Promise<void>`
2. Await `interrupt()` with a 5-second timeout before calling `abort()`
3. Log interrupt errors at WARN level, not DEBUG
4. Only call `abort()` after interrupt completes or times out

**New code**:

```typescript
async endSession(sessionId: SessionId): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.warn(
        `[SessionLifecycle] Cannot end session - not found: ${sessionId}`
      );
      return;
    }

    this.logger.info(`[SessionLifecycle] Ending session: ${sessionId}`);

    // TASK_2025_102: Cleanup pending permissions FIRST
    this.permissionHandler.cleanupPendingPermissions(sessionId as string);

    // TASK_2025_103: Mark all running subagents as interrupted BEFORE aborting
    this.subagentRegistry.markAllInterrupted(sessionId as string);

    this.logger.info(
      `[SessionLifecycle] Marked running subagents as interrupted for session: ${sessionId}`
    );

    // TASK_2025_175: Await interrupt() with timeout BEFORE abort()
    // SDK best practice: interrupt() must complete before abort() is called.
    // abort() kills the underlying process, so calling it before interrupt()
    // means the graceful stop signal is never processed.
    if (session.query) {
      try {
        await Promise.race([
          session.query.interrupt(),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);
        this.logger.info(
          `[SessionLifecycle] Interrupt completed for session: ${sessionId}`
        );
      } catch (err) {
        // TASK_2025_175: Log at WARN level so failures are visible
        this.logger.warn(
          `[SessionLifecycle] Interrupt failed for session ${sessionId}`,
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }

    // Abort the session AFTER interrupt completes or times out
    session.abortController.abort();

    // Remove from active sessions and clean up tab-to-real mapping
    this.activeSessions.delete(sessionId as string);
    this.tabIdToRealId.delete(sessionId as string);

    this.logger.info(`[SessionLifecycle] Session ended: ${sessionId}`);
  }
```

**Key design decisions**:

- 5-second timeout: Long enough for graceful shutdown, short enough not to frustrate users. Matches `KILL_GRACE_PERIOD` constant in `agent-process-manager.service.ts:48`.
- `Promise.race()` pattern: If interrupt hangs, the timeout resolves and we proceed to abort. If interrupt completes first, we proceed immediately.
- WARN level logging: Interrupt failures are actionable - they indicate the SDK process is in a bad state.

#### Change 1b: Fix ordering in disposeAllSessions()

**Location**: `session-lifecycle-manager.ts:334-360` (disposeAllSessions method)

**Current code** (lines 334-360):

```typescript
disposeAllSessions(): void {
    // ...
    for (const [sessionId, session] of this.activeSessions.entries()) {
      // ...
      this.subagentRegistry.markAllInterrupted(sessionId);

      session.abortController.abort();       // <-- abort() BEFORE interrupt()!
      if (session.query) {
        session.query.interrupt().catch(...); // <-- interrupt() AFTER abort()!
      }
    }
    // ...
  }
```

**Required changes**:

1. Change method signature to `async disposeAllSessions(): Promise<void>`
2. Reorder: call `interrupt()` first, then `abort()`
3. Await all interrupts with timeout (use `Promise.allSettled` to not block on one failure)

**New code**:

```typescript
async disposeAllSessions(): Promise<void> {
    this.logger.info('[SessionLifecycle] Disposing all active sessions...');

    // TASK_2025_102: Cleanup all pending permissions FIRST
    this.permissionHandler.cleanupPendingPermissions();

    // TASK_2025_175: Interrupt all sessions first, then abort
    const interruptPromises: Promise<void>[] = [];

    for (const [sessionId, session] of this.activeSessions.entries()) {
      this.logger.debug(`[SessionLifecycle] Ending session: ${sessionId}`);

      // TASK_2025_103: Mark all running subagents as interrupted
      this.subagentRegistry.markAllInterrupted(sessionId);

      // TASK_2025_175: Interrupt BEFORE abort, with timeout
      if (session.query) {
        interruptPromises.push(
          Promise.race([
            session.query.interrupt(),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)),
          ]).catch((err) => {
            this.logger.warn(
              `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
              err instanceof Error ? err : new Error(String(err))
            );
          })
        );
      }
    }

    // Wait for all interrupts to complete or time out
    await Promise.allSettled(interruptPromises);

    // Now abort all sessions
    for (const [, session] of this.activeSessions.entries()) {
      session.abortController.abort();
    }

    this.activeSessions.clear();
    this.tabIdToRealId.clear();
    this.logger.info('[SessionLifecycle] All sessions disposed');
  }
```

#### Change 1c: Update SdkAgentAdapter.interruptSession() to await

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Location**: Lines 649-652

**Current code**:

```typescript
async interruptSession(sessionId: SessionId): Promise<void> {
    this.logger.info(`[SdkAgentAdapter] Interrupting session: ${sessionId}`);
    this.sessionLifecycle.endSession(sessionId);
  }
```

**New code**:

```typescript
async interruptSession(sessionId: SessionId): Promise<void> {
    this.logger.info(`[SdkAgentAdapter] Interrupting session: ${sessionId}`);
    await this.sessionLifecycle.endSession(sessionId);
  }
```

#### Change 1d: Update SdkAgentAdapter.dispose() to handle async

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Location**: Lines 271-278

**Current code**:

```typescript
dispose(): void {
    this.logger.info('[SdkAgentAdapter] Disposing adapter...');
    this.configWatcher.dispose();
    this.sessionLifecycle.disposeAllSessions();
    this.authManager.clearAuthentication();
    this.initialized = false;
    this.logger.info('[SdkAgentAdapter] Disposed successfully');
  }
```

**Note**: The `dispose()` method is called during extension deactivation. Since VS Code's `deactivate()` can return a Promise, we can make this async. However, because `dispose()` is part of a synchronous cleanup pattern in many callers, we should fire the async disposal and not block:

**New code**:

```typescript
dispose(): void {
    this.logger.info('[SdkAgentAdapter] Disposing adapter...');
    this.configWatcher.dispose();
    // TASK_2025_175: disposeAllSessions is now async, fire and log errors
    this.sessionLifecycle.disposeAllSessions().catch((err) => {
      this.logger.warn(
        '[SdkAgentAdapter] Error during session disposal',
        err instanceof Error ? err : new Error(String(err))
      );
    });
    this.authManager.clearAuthentication();
    this.initialized = false;
    this.logger.info('[SdkAgentAdapter] Disposed successfully');
  }
```

---

### Component 2: Add stopAllForSession() to AgentSessionWatcherService

**Purpose**: Provide a method to forcefully stop all watches associated with a given session, ensuring background agent watchers are cleaned up on abort.

**Root Causes Addressed**: RC3, RC5

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts`

**Pattern**: The `stopWatching()` method stops a single watch by agentId, but there is no method to stop all watches for a session. When a session is aborted, background agent watchers (`isBackground: true`) continue tailing files and emitting events indefinitely.

**Evidence**:

- `agent-session-watcher.service.ts:301-324` - `stopWatching()` only works per-agent
- `agent-session-watcher.service.ts:335-350` - `markAsBackground()` sets flag but no cleanup path on abort
- No method exists to clean up all watches for a given sessionId

#### Change 2a: Add stopAllForSession() method

**Location**: After the `stopWatching()` method (after line 324)

**New method** to add:

```typescript
/**
 * Stop all watches associated with a given session ID.
 *
 * TASK_2025_175: Called when a session is aborted to ensure all agent
 * watchers (including background agents) are cleaned up. Without this,
 * background agent watchers continue tailing files and emitting events
 * to a dead session indefinitely.
 *
 * @param sessionId - The session ID whose watches should be stopped
 */
stopAllForSession(sessionId: string): void {
    const agentIdsToStop: string[] = [];

    for (const [agentId, watch] of this.activeWatches) {
      if (watch.sessionId === sessionId) {
        agentIdsToStop.push(agentId);
      }
    }

    if (agentIdsToStop.length === 0) {
      return;
    }

    this.logger.info(
      '[AgentSessionWatcher] Stopping all watches for session',
      {
        sessionId,
        agentCount: agentIdsToStop.length,
        agentIds: agentIdsToStop,
      }
    );

    for (const agentId of agentIdsToStop) {
      this.stopWatching(agentId);
    }
  }
```

#### Change 2b: Export stopAllForSession from vscode-core barrel

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts`

No changes needed here -- `AgentSessionWatcherService` is already exported as a class, and the new method will be available on the class instance. Verify this is the case.

---

### Component 3: Wire session abort into watcher cleanup in ChatRpcHandlers

**Purpose**: When `chat:abort` is called, also clean up all agent session watchers for that session.

**Root Causes Addressed**: RC5

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`

**Pattern**: The `chat:abort` RPC handler calls `sdkAdapter.interruptSession()` but does not tell the `AgentSessionWatcherService` to stop watching. Background watchers continue emitting events.

**Evidence**:

- `chat-rpc.handlers.ts:940-968` - `registerChatAbort()` only calls `sdkAdapter.interruptSession()`
- `chat-rpc.handlers.ts:83` - `agentSessionWatcher` is injected but not used during abort

#### Change 3a: Add watcher cleanup to chat:abort handler

**Location**: `chat-rpc.handlers.ts:940-968` (registerChatAbort method)

**Current code** (lines 940-968):

```typescript
private registerChatAbort(): void {
    this.rpcHandler.registerMethod<ChatAbortParams, ChatAbortResult>(
      'chat:abort',
      async (params) => {
        try {
          const { sessionId } = params;
          this.logger.debug('RPC: chat:abort called', { sessionId });

          // TASK_2025_167: Check if this is a Ptah CLI session
          const customAbortResult = await this.handlePtahCliAbort(params);
          if (customAbortResult.error !== '__NOT_PTAH_CLI__') {
            return customAbortResult;
          }

          await this.sdkAdapter.interruptSession(sessionId);

          return { success: true };
        } catch (error) {
          // ...
        }
      }
    );
  }
```

**New code**:

```typescript
private registerChatAbort(): void {
    this.rpcHandler.registerMethod<ChatAbortParams, ChatAbortResult>(
      'chat:abort',
      async (params) => {
        try {
          const { sessionId } = params;
          this.logger.debug('RPC: chat:abort called', { sessionId });

          // TASK_2025_167: Check if this is a Ptah CLI session
          const customAbortResult = await this.handlePtahCliAbort(params);
          if (customAbortResult.error !== '__NOT_PTAH_CLI__') {
            return customAbortResult;
          }

          await this.sdkAdapter.interruptSession(sessionId);

          // TASK_2025_175: Stop all agent session watchers for this session
          // This ensures background agent watchers don't continue emitting
          // events to a dead session after abort.
          this.agentSessionWatcher.stopAllForSession(sessionId as string);

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: chat:abort failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }
```

---

### Component 4: Make AgentProcessManager.stop() wait for SDK process exit

**Purpose**: Ensure `stop()` does not return until the SDK process has actually exited, preventing race conditions where the caller assumes the process is dead.

**Root Causes Addressed**: RC4

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`

**Pattern**: For SDK-based agents (no child process), `killProcess()` calls `abort()` and returns immediately. There is no confirmation that the process actually stopped. The `stop()` method then emits `agent:exited` optimistically.

**Evidence**:

- `agent-process-manager.service.ts:1129-1138` - `killProcess()` for SDK agents returns immediately after abort
- `agent-process-manager.service.ts:786-811` - `stop()` sets status to 'stopped' and emits 'agent:exited' without waiting

**Note**: This component addresses CLI-based background agents (Gemini, Codex, Copilot) managed by AgentProcessManager, not the main SDK sessions which are managed by SessionLifecycleManager. The fix here is focused on ensuring the `stop()` method for SDK-based CLI agents properly waits.

#### Change 4a: Add brief wait after SDK abort in killProcess()

**Location**: `agent-process-manager.service.ts:1129-1138` (killProcess, SDK branch)

**Current code**:

```typescript
private async killProcess(tracked: TrackedAgent): Promise<void> {
    const child = tracked.process;

    // SDK-based agent: abort via AbortController instead of process signals
    if (!child) {
      if (tracked.sdkAbortController) {
        tracked.sdkAbortController.abort();
      }
      return;
    }
    // ...
```

**New code**:

```typescript
private async killProcess(tracked: TrackedAgent): Promise<void> {
    const child = tracked.process;

    // SDK-based agent: abort via AbortController instead of process signals
    if (!child) {
      if (tracked.sdkAbortController) {
        tracked.sdkAbortController.abort();
        // TASK_2025_175: Wait briefly for SDK process to respond to abort.
        // AbortController.abort() is synchronous but the SDK needs a tick
        // to process the signal and tear down resources.
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      return;
    }
    // ...
```

**Design rationale**: A 500ms wait is a pragmatic compromise. SDK abort is fundamentally synchronous (it sets a flag), but the SDK's internal cleanup happens asynchronously. A short delay lets the event loop drain pending work. This is less critical than the SessionLifecycleManager fix (Component 1), since AgentProcessManager manages CLI-based agents where abort is the only option.

---

## Integration Architecture

### Abort flow BEFORE this fix

```
User clicks "Stop" in UI
    |
    v
chat:abort RPC handler
    |
    v
sdkAdapter.interruptSession(sessionId)
    |
    v
sessionLifecycle.endSession(sessionId)       [synchronous, void return]
    |
    +-- permissionHandler.cleanupPendingPermissions()
    +-- subagentRegistry.markAllInterrupted()
    +-- query.interrupt().catch()              [FIRE AND FORGET - RC1]
    +--   logged at DEBUG level               [ERRORS INVISIBLE - RC2]
    +-- abortController.abort()               [CALLED IMMEDIATELY - RC1]
    +-- delete from activeSessions
    |
    v
Return { success: true } to UI               [UI thinks session is dead]
                                              [But agent may still be running]

Background watchers:                          [NEVER CLEANED UP - RC3, RC5]
    +-- AgentSessionWatcher continues tailing
    +-- Emits events to dead session
```

### Abort flow AFTER this fix

```
User clicks "Stop" in UI
    |
    v
chat:abort RPC handler
    |
    v
await sdkAdapter.interruptSession(sessionId)
    |
    v
await sessionLifecycle.endSession(sessionId)  [NOW ASYNC - waits for interrupt]
    |
    +-- permissionHandler.cleanupPendingPermissions()
    +-- subagentRegistry.markAllInterrupted()
    +-- await interrupt() with 5s timeout     [PROPERLY AWAITED - fixes RC1]
    +--   logged at WARN level                [FAILURES VISIBLE - fixes RC2]
    +-- abortController.abort()               [ONLY after interrupt done/timed out]
    +-- delete from activeSessions
    |
    v
agentSessionWatcher.stopAllForSession()       [WATCHER CLEANUP - fixes RC3, RC5]
    |
    +-- Finds all watches for this session
    +-- Stops each one (including background agents)
    +-- Clears tail intervals
    |
    v
Return { success: true } to UI               [Session is actually dead]
```

---

## Files Affected Summary

### MODIFY

| File                                                                             | Changes                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`            | Make `endSession()` async with interrupt timeout; fix `disposeAllSessions()` ordering |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                            | Await `endSession()` in `interruptSession()`; handle async `disposeAllSessions()`     |
| `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`         | Add `stopAllForSession()` method                                                      |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`      | Call `stopAllForSession()` after abort                                                |
| `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` | Add brief wait after SDK abort                                                        |

### NO CHANGES NEEDED

| File                                    | Reason                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `libs/backend/vscode-core/src/index.ts` | `AgentSessionWatcherService` already exported as class; new method auto-available |
| `libs/shared/`                          | No type changes needed                                                            |

---

## Change Ordering

Changes must be applied in this order due to dependencies:

1. **Component 2** (AgentSessionWatcherService) - Add `stopAllForSession()`. No dependencies on other changes.
2. **Component 1** (SessionLifecycleManager) - Make `endSession()` async. No runtime dependency on Component 2.
3. **Component 1c/1d** (SdkAgentAdapter) - Update to await async `endSession()`. Depends on Component 1.
4. **Component 3** (ChatRpcHandlers) - Wire watcher cleanup. Depends on Component 2.
5. **Component 4** (AgentProcessManager) - Add wait after SDK abort. Independent, can be done in any order.

---

## Risk Considerations

### Risk 1: Making endSession() async may break callers

**Assessment**: LOW risk.

The method is called from:

- `SdkAgentAdapter.interruptSession()` - already async, just needs `await` added
- `SdkAgentAdapter.dispose()` - synchronous caller; handle with `.catch()` pattern
- `ChatRpcHandlers.registerChatAbort()` - already async, already awaits `interruptSession()`

All callers are in controlled code paths we can update.

### Risk 2: 5-second timeout may be too long for user experience

**Assessment**: LOW risk.

The 5-second timeout is a maximum. In practice, `interrupt()` should complete within milliseconds for a responsive agent. The timeout only triggers if the agent is truly stuck. Users already wait for the abort UI transition, so 5 seconds is acceptable as a worst case.

### Risk 3: disposeAllSessions() becoming async affects extension deactivation

**Assessment**: LOW risk.

VS Code's `deactivate()` function supports returning a Promise (up to 10 seconds). The `SdkAgentAdapter.dispose()` method handles this by using `.catch()` to not block on errors, and the individual interrupt timeouts are 5 seconds which is well within the deactivation window.

### Risk 4: stopAllForSession() iterating while modifying activeWatches

**Assessment**: NO risk.

The implementation collects agentIds into an array first, then calls `stopWatching()` for each. This avoids modifying the Map during iteration.

### Risk 5: Existing tests may break

**Assessment**: LOW risk.

Changes are behavioral (timing/ordering), not structural. The method signatures only add `async`/`Promise<void>` which is backward compatible in TypeScript. Existing test mocks may need updating if they assert on synchronous behavior, but the changes are straightforward.

---

## Acceptance Criteria Verification

| Criterion                                                         | Component       | How It's Verified                                             |
| ----------------------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| `interrupt()` is properly awaited with timeout before `abort()`   | Component 1a    | `Promise.race([interrupt(), timeout(5000)])` before `abort()` |
| `abort()` only called after interrupt completes or times out      | Component 1a    | Sequential code: await interrupt, then abort                  |
| Background agents properly terminated when parent session aborted | Component 2 + 3 | `stopAllForSession()` finds and stops all watches for session |
| `stop()` waits for actual process exit before returning           | Component 4     | 500ms wait after `abort()` for SDK agents                     |
| Session watcher cleaned up for all agent types on abort           | Component 3     | `stopAllForSession()` called in `chat:abort` handler          |
| No zombie processes after interruption                            | All components  | interrupt() awaited -> abort() called -> watchers stopped     |
| Proper error logging (WARN/ERROR, not DEBUG)                      | Component 1a    | Changed from `logger.debug()` to `logger.warn()`              |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in backend TypeScript (Node.js process)
- Involves async/await patterns and process lifecycle management
- No UI/frontend changes needed
- SDK integration knowledge required

### Complexity Assessment

**Complexity**: MEDIUM

- The changes are focused and surgical (5 files, specific methods)
- Patterns are well-established (Promise.race for timeouts, iterate-then-modify for safe Map cleanup)
- Risk is low due to backward-compatible signature changes
- No new dependencies or architectural shifts

### Critical Verification Points

**Before implementation, developer must verify**:

1. **All callers of `endSession()`** handle the async return:

   - `SdkAgentAdapter.interruptSession()` (line 651) - needs await
   - `SdkAgentAdapter.dispose()` (line 273) - needs .catch() pattern
   - No other callers exist (verified via grep)

2. **All callers of `disposeAllSessions()`** handle the async return:

   - `SdkAgentAdapter.dispose()` (line 273) - needs .catch() pattern
   - Config watcher callback (line 173) - needs await
   - No other callers exist (verified via grep)

3. **`stopAllForSession()` does not break existing `stopWatching()`** behavior:

   - Collects IDs first, then iterates (no Map mutation during iteration)
   - Delegates to existing `stopWatching()` method

4. **Test the fix manually**:
   - Start agent in yolo mode
   - Click abort
   - Verify no zombie process via task manager
   - Verify no new sessions created after abort
   - Check logs for WARN-level interrupt messages
