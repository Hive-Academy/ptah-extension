# Code Logic Review — `TASK_2026_391`

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 3        |

The scoped Batch 4 fix is behaviorally sound and now has the required non-speculative regression. A pre-reload state can remain in `deferredTabUpdates`; during finalization, `flushSync()` promotes deferred entries into `pendingTabUpdates` after newer replay entries are already there, so the stale state wins for the same tab (`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:181-196`). The targeted loader now deletes that tab from pending, deferred, and pending-flush storage before installing the fresh resume state (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:584-596`; `libs/frontend/chat-streaming/src/lib/batched-update.service.ts:205-209`).

The revised regression composes the real `SessionLoaderService`, `TabManagerService`, `BatchedUpdateService`, `StreamingHandlerService`, `StreamingAccumulatorCore`, `EventDeduplicationService`, `MessageFinalizationService`, and `SessionManager` (`session-loader.service.spec.ts:1293-1326`). It queues the exact two stale stub users through the real streaming path while hidden (`session-loader.service.spec.ts:1333-1358`), performs the real targeted reload (`session-loader.service.spec.ts:1360-1370`), and asserts the real target tab contains restored user/assistant history and neither stale stub (`session-loader.service.spec.ts:1372-1381`). The execution-tree builder remains a deterministic double, which is appropriate: the race under test is the real queue/state/finalization ordering, while the builder only converts the surviving state into a stable assertion shape.

The report's red evidence is credible: removing only the production cleanup leaves the real target with roles `['user', 'user']` instead of `['user', 'assistant']` (`.ptah/specs/TASK_2026_391/agent-output-frontend-developer.md:86-127`). Restoring cleanup produces 34 passing tests in the file (`agent-output-frontend-developer.md:129-147`). I independently reran the focused composed test with `--skipNxCache`; it passed with 1 test run and 35 skipped.

This earns 8 rather than 9–10 because the real Electron reproduction still remains the final environment-level confirmation, and two pre-existing adjacent failure paths remain. Neither was introduced or worsened by this target-only queue cleanup.

## Five logic questions

### 1. How does this fail silently?

- Fixed in scope: a stale deferred state previously replaced replay state during `finalizeSessionHistory` because the unscoped flush promoted the older deferred entry over the newer pending entry (`batched-update.service.ts:181-196`; `message-finalization.service.ts:206-216`). The user saw a successful-looking reload containing only the two compaction stubs.
- Pre-existing: a null-session fan-out tile can be cleared and then rejected by loader ownership validation; lifecycle catches the rejection and only logs it (`libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:381-421`; `session-loader.service.ts:740-747`).
- Pre-existing: `session:load` or `chat:resume` failure after lifecycle clearing is logged without transcript rollback (`compaction-lifecycle.service.ts:381-421`; `session-loader.service.ts:551-557`, `session-loader.service.ts:720-734`).

### 2. What user action produces unexpected behaviour?

- Before this fix, compacting an open Electron tile while a live `/compact` snapshot was visibility-deferred could leave only “Continued from previous conversation (compacted)” and “/compact compact”. The composed test reproduces that exact queue shape and content (`session-loader.service.spec.ts:1333-1362`).
- After this fix, the targeted in-place reload removes only the explicit target's stale queue state (`session-loader.service.ts:584-590`) and restores assistant history on that target (`session-loader.service.spec.ts:1367-1381`).
- A separate, pre-existing conversation-expanded tile with `claudeSessionId === null` can still be cleared without a successful fallback reload (`compaction-lifecycle.service.ts:388-421`; `session-loader.service.ts:740-747`).

### 3. What input data produces a wrong answer?

- The fixed input shape is one stale state in `deferredTabUpdates` plus a newer replay state in `pendingTabUpdates`, both keyed by the same `TabId`. The deferred loop overwrites the newer map value without cleanup (`batched-update.service.ts:186-196`).
- The cleanup handles all queue representations for exactly that target: pending update, deferred update, and pending-flush marker (`batched-update.service.ts:205-209`).
- Pre-existing wrong-contract input: a lifecycle reload target with a null current `claudeSessionId` and a fallback `compactionSessionId`; lifecycle produces this pair (`compaction-lifecycle.service.ts:388-415`) but loader requires exact existing ownership (`session-loader.service.ts:740-747`).

### 4. What happens when a dependency fails?

- `session:load` and `chat:resume` failures reject from the loader (`session-loader.service.ts:551-557`, `session-loader.service.ts:720-734`). Lifecycle observes them via `.catch`, logs, and settles the fan-out (`compaction-lifecycle.service.ts:404-422`). This is pre-existing and unchanged by Batch 4.
- If the target disappears during either await, the loader revalidates before subsequent writes (`session-loader.service.ts:566-568`, `session-loader.service.ts:627-629`), and Batch 1 tests retain those guards (`session-loader.service.spec.ts:1027-1088`).
- Queue cleanup itself is synchronous and tab-scoped; it does not introduce a new async failure boundary (`batched-update.service.ts:205-209`).

### 5. What is missing that the requirements never mentioned?

- The secondary CTX gauge remains a distinct stats-ordering defect. The queue stores only `StreamingState`; the report correctly does not reintroduce blanket zeroing of lifetime tokens (`agent-output-frontend-developer.md:164-171`).
- There is still no unified lifecycle/loader contract for a conversation-bound target whose session id is null.
- There is no transcript rollback or visible retry state when the reload RPC fails after destructive clearing.

## Failure modes

### Stale deferred write overwrites replayed assistant history — fixed

- Trigger: A hidden/non-visible target accumulates a live `/compact` state in `deferredTabUpdates`; the window becomes visible without the normal drain firing; replay queues newer state for the same tab; history finalization calls unscoped `flushSync()`.
- Symptom: The final target contains the two stale user stubs and no restored assistant.
- Evidence: Queue overwrite ordering at `batched-update.service.ts:181-196`; composed setup and assertion at `session-loader.service.spec.ts:1333-1381`; real red output at `agent-output-frontend-developer.md:86-127`.
- Current handling: `switchSession` clears the explicit target before `applyResumingSession` (`session-loader.service.ts:584-596`), deleting all three queue records (`batched-update.service.ts:205-209`).
- Recommendation: Keep the composed regression and retain `[compaction-diag]` until the next real Electron confirmation.

### Null-session fallback fails ownership validation — pre-existing, out of scope

- Trigger: Conversation expansion includes a target whose `claudeSessionId` is null.
- Symptom: Lifecycle clears the tile, fallback reload rejects, and only a console warning remains.
- Evidence: Fallback selection at `compaction-lifecycle.service.ts:388-415`; strict ownership rejection at `session-loader.service.ts:740-747`; mock-only lifecycle expectation at `compaction-lifecycle.service.spec.ts:695-724`.
- Current handling: Catch and warning at `compaction-lifecycle.service.ts:416-421`.
- Recommendation: In a separate task, either bind the target before reload or exclude null-session targets from destructive fan-out, then cover the lifecycle-to-loader contract.

### Reload failure leaves a cleared transcript — pre-existing, out of scope

- Trigger: `session:load` or `chat:resume` fails after `applyCompactionComplete` clears messages.
- Symptom: Lifetime stats survive, but the transcript remains empty with no in-UI recovery.
- Evidence: Clear at `compaction-lifecycle.service.ts:381-385`; loader failures at `session-loader.service.ts:551-557` and `session-loader.service.ts:720-734`; warning-only catch at `compaction-lifecycle.service.ts:416-421`.
- Current handling: Console warning and compaction-state settlement.
- Recommendation: In a separate task, preserve a pre-clear snapshot until success or expose retry/error state.

## Blocking issues

None.

## Serious issues

None in the scoped Batch 4 change. The two adjacent concerns above predate Batch 4 and are not worsened by target-only queue cleanup.

## Moderate and minor issues

No in-scope issue. Residual environment-level uncertainty remains until the fix is confirmed in the real Electron reproduction.

## Data flow

1. OK — In-stream `compaction_complete` yields the originating tab/session result. The separate `session:compactionComplete` push stamps marker metadata and does not invoke a second reload (`libs/frontend/chat/src/lib/services/chat.store.ts:350-369`; `compaction-lifecycle.service.ts:444-479`).
2. OK — Lifecycle fans out and reloads every cleared tab by explicit tab id (`compaction-lifecycle.service.ts:347-415`). Batch 1 tab targeting is preserved.
3. OK — The loader validates the explicit target after `session:load`, then clears only that target's queued state immediately before atomic resume initialization (`session-loader.service.ts:566-596`). Ordinary untargeted reopen is unaffected by the `if (targetTabId)` guard (`session-loader.service.ts:588-590`).
4. OK — `applyResumingSession` atomically installs an empty `StreamingState`, clears messages, and resets turn-state revisions (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1990-2018`).
5. OK — Replay supplies the explicit target and disables fan-out (`session-loader.service.ts:690-702`). `processStreamEvent` still resolves `primaryTab` directly when `tabId` is present and writes it regardless of `fanOut: false` (`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:130-145`, `streaming-handler.service.ts:184-205`).
6. OK — Real accumulator processing schedules replay updates into the queue (`streaming-handler.service.ts:283-329`).
7. OK — Finalization flushes the queue, builds history, and atomically installs messages (`message-finalization.service.ts:206-220`, `message-finalization.service.ts:305-322`; `tab-manager.service.ts:1582-1587`).
8. PROVEN — The composed regression performs steps 3–7 against real state/queue services and asserts the target's resulting `messages` (`session-loader.service.spec.ts:1293-1381`).
9. OK for observed stream-exit ordering — Once history is finalized, `streamingState` is null (`tab-manager.service.ts:1582-1587`), so a later terminal turn-state finalizer returns before modifying messages (`message-finalization.service.ts:55-67`). `markTabIdle` only changes liveness controls, not transcript content.

## Requirements fulfilment

| Requirement                                  | Status   | Gap                                                                                                                                                                                           |
| -------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identify root cause with file:line evidence  | COMPLETE | Deferred-over-pending overwrite is traced through `batched-update.service.ts:181-209`.                                                                                                        |
| Prove a targeted replay red before the fix   | COMPLETE | Real services leave `['user', 'user']` without cleanup (`agent-output-frontend-developer.md:86-127`).                                                                                         |
| Prove restored assistant history green       | COMPLETE | Composed test asserts real target `TabState.messages` and passes independently (`session-loader.service.spec.ts:1367-1381`).                                                                  |
| Make minimal target-only fix                 | COMPLETE | One target-scoped facade call before resume reset (`session-loader.service.ts:584-596`; `streaming-handler.service.ts:75-78`).                                                                |
| Preserve Batch 1 behavior/tests              | COMPLETE | Explicit target, pair-keyed in-flight guard, ownership checks, and prior assertions remain. The removed mock-only test was Batch 4, not Batch 1 (`agent-output-frontend-developer.md:82-84`). |
| Retain `[compaction-diag]` logging           | COMPLETE | Diagnostics remain at `compaction-lifecycle.service.ts:331`, `compaction-lifecycle.service.ts:395`, and `session-loader.service.ts:574`.                                                      |
| Run exact three-project gates                | COMPLETE | Report records successful three-project test/typecheck/lint headers (`agent-output-frontend-developer.md:197-271`).                                                                           |
| Handle secondary CTX only if same root cause | COMPLETE | Correctly reported as separate and unchanged; lifetime stats were not zeroed (`agent-output-frontend-developer.md:164-171`).                                                                  |

Implicit requirements not addressed: null-session fan-out ownership and visible recovery/rollback for reload dependency failure. Both are pre-existing and suitable for separate work.

## Edge cases

| Case                             | Handled                        | How                                                                               | Concern                                           |
| -------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| Stale pending update on target   | YES                            | Target-specific deletion                                                          | All queue storage cleared.                        |
| Stale deferred update on target  | YES                            | Target-specific deletion                                                          | Composed red/green regression proves it.          |
| Sibling target sharing session   | YES                            | Explicit target plus pair-keyed in-flight guard                                   | Batch 1 behavior preserved.                       |
| Untargeted close/reopen          | YES                            | Cleanup guarded by `targetTabId`                                                  | Existing teardown semantics unchanged.            |
| Push plus in-stream completion   | YES                            | Push stamps metadata; stream completion reloads                                   | No duplicate reload from the two signal types.    |
| Live stream exits after replay   | YES for observed terminal path | Finalized history has null streaming state; terminal finalizer no-ops on messages | Real-app confirmation still prudent.              |
| Target disappears during await   | YES                            | Ownership revalidated after both async boundaries                                 | Error remains console-only after lifecycle clear. |
| Null-session conversation target | NO, pre-existing               | Fallback conflicts with loader ownership guard                                    | Separate defect; not worsened here.               |
| Reload RPC failure               | NO, pre-existing               | Warning only                                                                      | Separate recovery defect.                         |
| Post-compaction CTX gauge        | NO, reported                   | Deferred as distinct stats issue                                                  | Correctly not conflated with lifetime totals.     |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: The scoped queue fix is proven, but real Electron confirmation should verify no host-specific event ordering falls outside the composed service regression.
- What a robust implementation would add: separate fixes for null-session lifecycle ownership and reload rollback/retry, plus a dedicated regression for post-compaction context-gauge ordering.
