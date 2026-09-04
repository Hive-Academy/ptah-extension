# TASK_2026_360 Code Logic Review

**Score:** 4/10  
**Verdict:** NEEDS_CHANGES

The core `result` ordering is correct, but the implementation is not yet a safe single source of truth. A stale stream or probe can still finalize and idle a replacement turn, the backend alias reducer can collapse two records into a non-monotonic revision sequence, and legacy failure/abort paths still finalize outside the ordered chunk stream.

## Finding 1 — A stale turn state can finalize and idle a replacement session

**Severity:** critical  
**Files:** `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:63`, `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:102`, `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1128`

`TurnStateApplier` trusts the routed `tabId` before checking whether `event.sessionId` still belongs to that tab. It also finalizes the message, consumes hard-deny state, and writes liveness before/independently of the revision guard in `TabManagerService.applyTurnState`. Consequently, the guard only protects the final tab patch; it does not protect the destructive side effects that precede it.

Concrete failure scenario (inputs → wrong output):

1. Tab `T` is reset by `/clear`, slash-query replacement, or a new session. Its revision is reset and the replacement session emits `generating@1`.
2. The old broadcaster exits afterward and emits `idle@6` with old `event.sessionId = S-old` but the same captured payload `tabId = T`.
3. `resolveTabs` selects `T` solely by id. `finalizeCurrentMessage(T)` finalizes the replacement session's partial message. `applyTurnState` accepts revision 6 and changes the replacement tab to `loaded`; liveness is also marked idle under `S-old`.

The same defect occurs even when a stale event has a lower revision: a delayed `session:status` response can carry `idle@2` after live `generating@3`; the tab patch is rejected, but finalization and liveness still run.

Smallest fix:

- Reject a routed tab unless the event uses its unresolved placeholder (`event.sessionId === tab.id`) or the event session is currently bound to that tab/conversation.
- Perform one session-aware revision acceptance check before finalization, hard-deny consumption, tab mutation, and liveness. Store the session identity alongside the last revision (or keep revisions per session), because revisions from different SDK queries are not comparable.
- Apply the same revision acceptance to no-tab/surface liveness events. A practical API is a read-only `canApplyTurnState(tabId, sessionId, revision)` followed by the existing finalize-first sequence.

## Finding 2 — `rekey` loses the live record and breaks revision monotonicity when both ids exist

**Severity:** major  
**File:** `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:211`

When both the placeholder and canonical ids have records, `rekey` deletes the placeholder and keeps the canonical record unchanged. That satisfies “do not overwrite the real-id entry” literally, but it drops the placeholder's live phase, `generatingEmitted` flag, snapshots, and revision history. The next canonical commit can reuse a revision the frontend already applied under the placeholder alias.

Concrete failure scenario (inputs → wrong output):

1. A pre-init root event produces placeholder state `T: generating@1`, which the tab applies.
2. A hook resolves its payload id first and creates `S-real` with a Stop/failure snapshot while its state is still `idle@0`.
3. `rekey(T, S-real)` deletes the generating record and keeps `S-real@0`.
4. The result settles `S-real` to `idle@1`. The frontend already holds revision 1, so it drops the terminal state and the Stop button remains lit.

Smallest fix: merge the two records into the canonical entry instead of discarding one. Preserve hook snapshots/failure from the canonical record, preserve an in-flight `generating` phase and `generatingEmitted` from either record, and set the revision baseline to at least `max(from.revision, to.revision)` so the next emitted state is strictly greater. Add a collision spec that applies the placeholder revision first and asserts the post-rekey terminal revision is greater.

## Finding 3 — StopFailure and user-abort paths still finalize outside `turn_state` ordering

**Severity:** major  
**Files:** `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts:190`, `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:271`, `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:178`

`handleTurnFailed` calls `ChatLifecycleService.handleChatError`, which still finalizes the current message, writes `status: 'loaded'`, and clears the spinner. The StopFailure push is an unordered hook channel and can arrive before the final chunks/result. The user-abort flow similarly finalizes and calls `markTabIdle` as soon as the abort RPC returns rather than waiting for the broadcaster's ordered terminal event.

Concrete failure scenario (inputs → wrong output):

1. A StopFailure hook or abort RPC response reaches the frontend while the last delta remains in `StreamBatchBuffer`.
2. The legacy path finalizes the current tree and schedules `streamingState` removal before that delta is delivered.
3. The late delta/result then arrives after finalization. It can be omitted from the finalized assistant message or rebuild a detached partial streaming state; meanwhile the tab was already shown as loaded/idle before the backend terminal state.

Smallest fix: split error presentation from lifecycle reset. `SESSION_TURN_FAILED` should only stamp/display the error; the ordered `failed` state must own finalization, status, and spinner changes. After a successful user abort, retain queue/resumable-subagent bookkeeping but wait for the ordered abort `turn_state` to finalize and idle the tab. If a fallback is required for a backend that cannot emit a terminal event, make it explicit and session-token-scoped so it cannot act on a replacement query.

## Finding 4 — Hard-deny state is global and can be consumed by another session's terminal event

**Severity:** minor  
**Files:** `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:66`, `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:96`, `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:430`

The hard-deny tool ids are one global set. Every terminal `turn_state` drains it before applying the ids to that event's target tabs.

Concrete failure scenario (inputs → wrong output):

1. Session A records a hard deny for tool call `tool-A`.
2. Concurrent session B reaches its terminal state first.
3. B drains the global set; `tool-A` is not present in B's tree, so nothing is marked. When A ends, the set is empty and A's denied agent is rendered as complete instead of interrupted.

Smallest fix: key hard-deny ids by session/conversation (the permission request already carries routing identity) and consume only the bucket matching `event.sessionId`/the resolved tab. Consume it only after the event passes the session/revision acceptance check from Finding 1.

## Focus areas checked with no additional finding

- **Result ordering and terminal emission:** `StreamTransformer` processes a `result` after all preceding SDK messages, then `ResultMessageTransformer` yields its state event through the same per-stream `StreamBatchBuffer`. The error path flushes preceding chunks, pushes one idle state, flushes again, and the `finally` guard emits only when the registry is still `generating`; it therefore does not duplicate the catch terminal state.
- **Registry snapshot behavior:** `settleTurn` and `forceIdle` clear Stop/failure snapshots and re-arm generating. `applySnapshot` returns without mutation while the phase is `generating`. I found no normal Stop snapshot leak into the next settled turn apart from the rekey collision in Finding 2.
- **Normal session identity and multi-workspace routing:** before init, a routed placeholder event resolves by tab id; after init, `SESSION_ID_RESOLVED` rekeys liveness and events carry the canonical id. Background tabs resolve through `findTabByIdAcrossWorkspaces`/`findTabBySessionIdAcrossWorkspaces`; `applyFinalizedTurn` and `applyTurnState` use workspace-aware writes, and liveness receives the owning workspace path. Two concurrently running broadcasters have separate buffers and captured tab ids, so their normal events do not cross; the stale/reused-tab exception is Finding 1.
- **Stats:** when `SESSION_STATS` arrives first, `handleSessionStats` stores `pendingStats` on the tab's streaming state. `finalizeCurrentMessage` flushes pending state, copies `pendingStats`, and writes it to the finalized assistant message. When stats arrive after the finalization microtask, they merge onto the last assistant message. I found no loss in the requested “stats before terminal state” ordering.
- **Finalization microtask:** for a current accepted terminal event, the microtask preserves `awaiting-background`/`sleeping` and skips cleanup if a new `generating` state re-added the spinner in the same batch. Its unsafe behavior is limited to stale/foreign events reaching finalization, covered by Finding 1.
- **Requested deletions:** content/background event paths no longer re-mark streaming, and ordinary `CHAT_COMPLETE` is ignored. The remaining harmful live-turn writers are the failure and abort paths in Finding 3; other `loaded` writes found by grep are setup, history, compaction, duplication, or explicit local-reset transitions rather than chunk/turn-ended/stats derivations.

**VERDICT: NEEDS_CHANGES**
