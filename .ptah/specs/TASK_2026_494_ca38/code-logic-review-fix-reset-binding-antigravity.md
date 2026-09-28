# Code Logic Review: Post-Batch Bounded Fix (Reset & Stop Between `chat:start` and Session Binding)

## Summary

| Metric | Value |
|---|---|
| **Score** | 9/10 |
| **Verdict** | **APPROVED** |
| **Blocking Issues** | 0 |
| **Serious Issues** | 0 |
| **Minor / Observational Issues** | 1 (Residual sequence analyzed under Check 5) |
| **Test Suites** | 16 passed, 286 passed / 286 total |

**Score Justification**: The fix is tight, well-architected, and fully solves the target defect where reset ("New conversation") or Stop (`abort()`) between `chat:start` resolution and session binding arrival failed to abort the running agent. The solution stores `startedSessionId` cleanly in `AppsWorkspaceSlice`, clears it when the session binding arrives, on discard, and on turn completion, ensures no double-abort, maintains all B1 reset guarantees (target capture before await, notice on failure, post-await ownership re-check, `markIdle` on success), preserves late-start unowned aborts, stays strictly under the 700-line limit across all modified files, and adds 6 new red/green proven specs with no existing assertions modified or weakened.

---

## Check Table (Checks 1–6)

| # | Check Item | Status | Evidence (`file:line`) | Ruling |
|---|------------|--------|------------------------|--------|
| **1** | **Recorded start id**<br>- Successful `chat:start` id is `result.data?.sessionId ?? conversation.routingId`<br>- Stored in slice/session, never page<br>- Cleared on binding arrival, discard, dispose, turn end<br>- Nothing aborted twice | **PASS** | [`apps-session.service.ts:259-272`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts#L259-L272)<br>[`apps-workspace-slice.ts:60-70, 90-94, 195-216`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts#L60-L70)<br>[`apps-session.service.ts:205-221, 363-368, 607-611`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts#L205-L221) | `startedSessionId` is stored in `AppsWorkspaceSlice` (never on the page). It uses `result.data?.sessionId ?? (conversation.routingId as SessionId)`. Cleared when `boundSessionId !== null` via `settleAppsSlice`, on discard via `createAppsWorkspaceSlice`, on turn completion via `settleAppsSlice` when liveness reports non-live status, and on successful `abort()`. Double-abort is prevented by clearing the id and giving precedence to `sessionFor()`. |
| **2** | **`resetConversation()` before binding**<br>- Aborts with recorded id, then discards<br>- Failed abort keeps conversation & shows notice<br>- Ownership re-checked after await, `markIdle` on success<br>- In-flight `abortUnownedStart` unchanged | **PASS** | [`apps-session.service.ts:380-404, 575-588`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts#L380-L404)<br>[`apps-session-rpc.ts:39-53`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session-rpc.ts#L39-L53)<br>[`apps-session.service.spec.ts:857-887`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts#L857-L887) | Target slice and conversation captured before await; calls `runningSessionOf(slice)` which resolves `startedSessionId`. On abort failure, returns `false`, leaves slice intact, and sets `APPS_RESET_KEPT_NOTICE + " Reason: " + failure`. On success, calls `markIdle`, verifies `isAppsSliceOf` ownership post-await, and executes `discardSlice`. In-flight case delegated to `abortUnownedAppsStart` with identical behavior. |
| **3** | **Stop (`abort()`) before binding**<br>- Aborts with recorded id<br>- After binding, reset & Stop use bound session<br>- No regression | **PASS** | [`apps-session.service.ts:350-372`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts#L350-L372)<br>[`apps-session.service.spec.ts:889-921`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts#L889-L921) | `abort()` resolves `claims.sessionFor(conversation.surfaceId) ?? slice.startedSessionId`. Before binding, it aborts `startedSessionId`. On success, clears `pendingTurn` and `startedSessionId`, calling `markIdle`. After binding, `claims.sessionFor` takes precedence, and `settleAppsSlice` drops `startedSessionId`. Verified by specs 3, 4, and 5. |
| **4** | **Specs prove each case**<br>- 6 new specs prove each scenario<br>- In-flight and abort-failure specs unchanged<br>- No assertions weakened | **PASS** | [`apps-session.service.spec.ts:845-942`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts#L845-L942) | Six new unit specs prove: (1) reset aborts started session then discards; (2) abort failure preserves conversation with notice; (3) Stop aborts started session once and reset does not duplicate; (4) bound session takes over for Stop and reset; (5) reset right after binding aborts bound session; (6) turn ending via liveness drops started session without abort on reset. Existing specs are 100% untouched. |
| **5** | **RESIDUAL ruling**<br>- Exact host response shapes for running, finished/idle, unknown session<br>- Recommendation (a) vs (b)<br>- Exact frontend condition | **PASS** (with ruling below) | [`chat-rpc.handlers.ts:274-281`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts#L274-L281)<br>[`chat-session.service.ts:967-1011`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L967-L1011)<br>[`session-control.service.ts:160-171`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts#L160-L171)<br>[`session-metadata-store.ts:590-604`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L590-L604) | Full trace of backend handler reveals that the host returns `{ success: true }` for running, finished/idle, AND unknown session IDs. Recommendation **(a)** is recommended: `runningSessionOf(slice)` should return `slice.startedSessionId` unconditionally when before binding. Details below. |
| **6** | **Edge cases, silent failures, surprising user actions**<br>- File size limits (<700 lines)<br>- Lint & typecheck clean | **PASS** | [`apps-session.service.ts:658`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts)<br>[`apps-workspace-slice.ts:236`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts)<br>[`apps-session-rpc.ts:53`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session-rpc.ts)<br>[`apps-conversation-claims.ts:107`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-conversation-claims.ts) | All files remain under the 700-line ceiling (longest is 658 lines). Boundary rules respected; no innerHTML; signals and OnPush preserved. Typecheck and lint pass cleanly; spec tsc produces exactly the 8 pre-existing baseline errors. |

---

## Check 5: Residual Ruling

### Sequence Under Examination
1. User clicks Stop (`abort()`) before session binding arrives.
2. `abortAppsSession(this.rpc, sessionId)` fails (e.g. transient transport timeout).
3. The failure path invokes `this.failTurn(key, conversation.routingId, 'chat:abort', failure)`, which clears `pendingTurn` to `null`.
4. The host has not yet emitted a liveness status for that session (or status is `undefined`).
5. A later user action clicks "New conversation" (`resetConversation()`). `runningSessionOf(slice)` checks `slice.pendingTurn !== null || live`. Because `pendingTurn` is `null` and `live` is `false`, `runningSessionOf` returns `null`.
6. `resetConversation()` discards the slice without attempting an abort, potentially leaving the backend agent running orphaned.

---

### Backend `chat:abort` Handler Trace and Exact Response Shapes

The backend registration and dispatch occurs in:
- **Registration**: [`chat-rpc.handlers.ts:274-281`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts#L274-L281) parses `ChatAbortParamsSchema` and calls `ChatSessionService.abortSession(params)`.
- **Core Handler**: [`chat-session.service.ts:967-1011`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L967-L1011).

Tracing through the backend implementation reveals the exact response shapes:

#### 1. Running Session
- **Trace**: `sdkAdapter.interruptSession(sessionId)` (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1337-1343`) calls `sessionLifecycle.endSession(sessionId)`. In `SessionControlService.endSession` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:160-171`), the session record is found in `this.registry` and `endRecord` interrupts the query, aborts the controller, and deregisters the record.
- **Return Shape**:
  ```ts
  {
    success: true,
    resumableSubagents?: SubagentRecord[] // present only if subagents existed
  }
  ```
- **Error Code**: None (`errorCode` is not part of `ChatAbortResult`, defined in [`rpc-chat.types.ts:167-176`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/shared/src/lib/types/rpc/rpc-chat.types.ts#L167-L176)).

#### 2. Finished or Idle Session
- **Trace**: `sessionLifecycle.endSession(sessionId)` executes `this.registry.find(sessionId as string)`. Because the session is already finished/idle, `rec` is undefined. At [`session-control.service.ts:162-167`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts#L162-L167):
  ```ts
  if (!rec) {
    this.logger.info(`[SessionLifecycle] Session already ended, nothing to interrupt`);
    return 'already-ended';
  }
  ```
  It logs and returns `'already-ended'`. No exception is thrown.
  `ChatSessionService.abortSession` proceeds to line 996 and returns success.
- **Return Shape**:
  ```ts
  {
    success: true
  }
  ```
- **Error Code**: None. (No error field, no errorCode).

#### 3. Unknown Session ID
- **Trace**: Same as finished/idle session. `this.registry.find(sessionId)` returns undefined. `endSession` returns `'already-ended'`. In [`session-metadata-store.ts:599-604`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L599-L604), `saveResumeState` checks `if (!metadata)` and logs a warning, returning cleanly.
- **Return Shape**:
  ```ts
  {
    success: true
  }
  ```
- **Error Code**: None.

#### 4. Error Condition (Thrown Exception / Transport Failure)
- Only if an unexpected runtime error throws inside `abortSession` (e.g. database disk failure in metadata store):
  ```ts
  // chat-session.service.ts:1006-1010
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
  ```

---

### Recommendation: **Option (a)**

**Recommendation**: Adopt **(a)**. A reset with a recorded start id should ALWAYS attempt the abort before discarding.

#### Rationale
1. **Host Idempotence**: As proven above, the host's `chat:abort` implementation is completely idempotent. For running, idle, finished, and non-existent session IDs alike, it returns `{ success: true }`. There is zero danger of receiving an erroneous "not found" or "not running" failure from the host.
2. **Elimination of Orphan Risk**: In `settleAppsSlice` ([`apps-workspace-slice.ts:206-211`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts#L206-L211)), `startedSessionId` is already cleared whenever liveness reports that the session has ended (`idle` or `failed`). Thus, if `startedSessionId` is non-null on the slice, the frontend has received zero evidence that the session ended. Attempting the abort guarantees that an agent that survived a failed Stop cannot remain running as an orphan.
3. **Exact Condition the Frontend Should Test**:
   Because the host returns `{ success: true }` in all non-exceptional cases, `abortAppsSession` returns `null` on success. The exact test condition is:
   ```ts
   failure === null
   ```
   (Or in raw RPC response terms: `result.success && result.data?.success !== false`). No special error code check (e.g. `SESSION_ENDED` or `NOT_FOUND`) is needed or exists on `ChatAbortResult`.
4. **Impact on Other Behaviour**:
   Option (a) does **not** alter the failed-abort notice path. If `chat:abort` fails due to an actual transport failure or host rejection (`failure !== null`), the reset continues to preserve the conversation and present `APPS_RESET_KEPT_NOTICE + " Reason: " + failure` ([`apps-session.service.ts:387-393`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts#L387-L393)).

---

## Numbered Findings

### Finding 1: Edge-case bypass of reset abort following failed Stop before binding
- **Severity**: Minor / Edge-case (Non-blocking)
- **Location**: [`apps-session.service.ts:580-588`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts#L580-L588)
- **Description**: `runningSessionOf(slice)` computes:
  ```ts
  const live = isLiveAppsStatus(this.liveness.statuses().get(sessionId));
  return slice.pendingTurn !== null || live ? sessionId : null;
  ```
  If `abort()` failed before the session binding arrived, `failTurn` set `pendingTurn: null`. If liveness status was not yet broadcast for that session, `live` evaluates to `false`. A subsequent `resetConversation()` then evaluates `runningSessionOf(slice)` to `null` and discards the workspace slice without re-attempting `chat:abort`.
- **Mitigation / Fix**: Adopt Recommendation (a) so that unbound slices with a `startedSessionId` always attempt `chat:abort`.

---

## Exact Fix List (Recommended Refinement for Option a)

To implement Recommendation (a):

In [`libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:580-588`](file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts#L580-L588):

```typescript
  private runningSessionOf(slice: AppsWorkspaceSlice): SessionId | null {
    if (slice.conversation === null) return null;
    const bound = this.claims.sessionFor(slice.conversation.surfaceId);
    if (bound !== null) {
      const live = isLiveAppsStatus(this.liveness.statuses().get(bound));
      return slice.pendingTurn !== null || live ? bound : null;
    }
    return slice.startedSessionId;
  }
```

*Note: With this change, if `startedSessionId` is non-null, `resetConversation()` will always issue `chat:abort`. Because `settleAppsSlice` already sets `startedSessionId = null` when liveness reports `idle` or `failed`, this only triggers when the turn is still pending or was never acknowledged as ended.*

---

## One-Line Summary
**APPROVED (9/10)**: The fix robustly closes the pre-binding abort gap for reset and Stop with zero regressions; Recommendation (a) is provided as an exact refinement for the failed-Stop residual edge case.
