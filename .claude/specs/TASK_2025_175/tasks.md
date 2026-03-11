# TASK_2025_175 - Fix Agent Interruption Race Condition in Yolo Mode

**Total Tasks**: 7 | **Batches**: 2 | **Status**: 0/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `endSession()` callers: Only `SdkAgentAdapter.interruptSession()` (line 651) and `SdkAgentAdapter.dispose()` (line 274) -- verified via grep
- `disposeAllSessions()` callers: Only `SdkAgentAdapter.dispose()` (line 274) and config watcher callback (line 173) -- verified via grep
- `agentSessionWatcher` is already injected in `ChatRpcHandlers` at line 82-83 -- verified by reading file
- `AgentSessionWatcherService` is already exported from `vscode-core` barrel -- no barrel change needed
- `stopAllForSession()` collects IDs first then iterates, avoiding Map mutation during iteration -- safe pattern
- Config watcher callback (line 169-177) is already `async`, so adding `await` to `disposeAllSessions()` is straightforward

### Risks Identified

| Risk                                              | Severity | Mitigation                                                                       |
| ------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Making `endSession()` async could break callers   | LOW      | Only 2 callers, both in controlled code paths updated in this task               |
| 5s interrupt timeout may feel slow to users       | LOW      | Timeout is max bound; interrupt typically completes in milliseconds              |
| `disposeAllSessions()` async affects deactivation | LOW      | VS Code deactivate supports Promise up to 10s; `.catch()` pattern in `dispose()` |

### Edge Cases to Handle

- [x] `endSession()` called with non-existent sessionId -> early return (already handled)
- [x] `interrupt()` throws -> caught and logged at WARN level (Task 1.1)
- [x] `interrupt()` hangs indefinitely -> 5s timeout via `Promise.race` (Task 1.1)
- [x] `stopAllForSession()` with no matching watches -> early return with no logging (Task 1.2)
- [x] `killProcess()` called on SDK agent with no `sdkAbortController` -> no-op (already handled)

---

## Batch 1: Independent Foundation Changes

**Status**: IMPLEMENTED
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None

These changes have no cross-dependencies and can be applied independently. They lay the groundwork for Batch 2.

### Tasks

- [x] **Task 1.1**: Add `stopAllForSession()` method to `AgentSessionWatcherService` -- Add a new public method after `stopWatching()` (after line 324) that iterates `activeWatches`, collects all agentIds matching the given sessionId, then calls `stopWatching()` for each. Must collect IDs into array first to avoid Map mutation during iteration.
- [x] **Task 1.2**: Add brief wait after SDK abort in `AgentProcessManager.killProcess()` -- In the SDK branch of `killProcess()` (lines 1129-1138), add a 500ms `setTimeout` wait after `tracked.sdkAbortController.abort()` to let the SDK event loop drain pending work before returning. Add TASK_2025_175 comment explaining rationale.
- [x] **Task 1.3**: Verify `AgentSessionWatcherService` barrel export -- Confirm that `AgentSessionWatcherService` class is already exported from `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts`. No code change expected; this is a verification step.

### Files

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts` (MODIFY - Task 1.1)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` (MODIFY - Task 1.2)
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts` (VERIFY ONLY - Task 1.3)

### Implementation Details

**Task 1.1 - stopAllForSession():**

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

**Task 1.2 - killProcess SDK wait:**

```typescript
// In killProcess(), SDK branch (lines 1133-1137):
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
```

### Acceptance Criteria

- `stopAllForSession()` method exists on `AgentSessionWatcherService` and correctly stops all watches for a given sessionId
- `stopAllForSession()` with no matching watches returns silently (no error, no log)
- `stopAllForSession()` logs agentCount and agentIds when watches are found
- `killProcess()` SDK branch waits 500ms after abort before returning
- `AgentSessionWatcherService` is confirmed exported from `vscode-core` barrel

---

## Batch 2: Async Interrupt Sequencing and Wiring

**Status**: IMPLEMENTED
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

These changes make `endSession()` and `disposeAllSessions()` async, update their callers in `SdkAgentAdapter`, and wire `stopAllForSession()` into the abort RPC handler. Depends on Batch 1 because Component 3 calls `stopAllForSession()`.

### Tasks

- [x] **Task 2.1**: Make `endSession()` async with interrupt timeout in `SessionLifecycleManager` -- Change signature from `endSession(sessionId: SessionId): void` to `async endSession(sessionId: SessionId): Promise<void>`. Replace the fire-and-forget `interrupt().catch()` (lines 310-316) with `await Promise.race([interrupt(), timeout(5000)])`. Wrap in try/catch, log errors at WARN level (not DEBUG). Call `abort()` only AFTER interrupt completes or times out.
- [x] **Task 2.2**: Make `disposeAllSessions()` async with correct ordering in `SessionLifecycleManager` -- Change signature to `async disposeAllSessions(): Promise<void>`. Reorder: interrupt ALL sessions first (with 5s timeout each via `Promise.race`), collect promises, `await Promise.allSettled()`, THEN abort all sessions. Log interrupt failures at WARN level.
- [x] **Task 2.3**: Update `SdkAgentAdapter` callers to handle async lifecycle methods -- (a) In `interruptSession()` (line 651): add `await` before `this.sessionLifecycle.endSession(sessionId)`. (b) In `dispose()` (lines 271-278): change `this.sessionLifecycle.disposeAllSessions()` to `this.sessionLifecycle.disposeAllSessions().catch(...)` with WARN-level logging. (c) In config watcher callback (line 173): add `await` before `this.sessionLifecycle.disposeAllSessions()` (callback is already async).
- [x] **Task 2.4**: Wire `stopAllForSession()` into `chat:abort` RPC handler in `ChatRpcHandlers` -- After `await this.sdkAdapter.interruptSession(sessionId)` (line 954), add `this.agentSessionWatcher.stopAllForSession(sessionId as string)` with a TASK_2025_175 comment explaining why.

### Files

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts` (MODIFY - Tasks 2.1, 2.2)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (MODIFY - Task 2.3)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts` (MODIFY - Task 2.4)

### Implementation Details

**Task 2.1 - async endSession():**

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

**Task 2.2 - async disposeAllSessions():**

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

**Task 2.3a - interruptSession await:**

```typescript
async interruptSession(sessionId: SessionId): Promise<void> {
    this.logger.info(`[SdkAgentAdapter] Interrupting session: ${sessionId}`);
    await this.sessionLifecycle.endSession(sessionId);
  }
```

**Task 2.3b - dispose .catch() pattern:**

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

**Task 2.3c - config watcher await:**

```typescript
// Line 173 change:
await this.sessionLifecycle.disposeAllSessions();
```

**Task 2.4 - Wire stopAllForSession into chat:abort:**

```typescript
// After line 954 (await this.sdkAdapter.interruptSession(sessionId)):
// TASK_2025_175: Stop all agent session watchers for this session.
// This ensures background agent watchers don't continue emitting
// events to a dead session after abort.
this.agentSessionWatcher.stopAllForSession(sessionId as string);
```

### Acceptance Criteria

- `endSession()` is async and returns `Promise<void>`
- `interrupt()` is awaited with 5-second timeout before `abort()` is called
- Interrupt failures are logged at WARN level, not DEBUG
- `disposeAllSessions()` is async and interrupts ALL sessions before aborting ANY
- `SdkAgentAdapter.interruptSession()` awaits `endSession()`
- `SdkAgentAdapter.dispose()` handles async `disposeAllSessions()` with `.catch()`
- Config watcher callback awaits `disposeAllSessions()`
- `chat:abort` RPC handler calls `agentSessionWatcher.stopAllForSession()` after interrupt
- No zombie processes remain after abort in yolo mode
- Build passes: `npx nx build agent-sdk` and `npx nx build ptah-extension-vscode`

---

## Verification Checklist (All Batches)

- [ ] All 5 files modified as specified
- [ ] `interrupt()` properly awaited with timeout before `abort()` in both `endSession` and `disposeAllSessions`
- [ ] Background agent watchers cleaned up on session abort
- [ ] `stop()` in AgentProcessManager waits for SDK process exit
- [ ] Proper error logging (WARN level, not DEBUG) for interrupt failures
- [ ] Build passes for affected libraries
- [ ] code-logic-reviewer approved all batches
