# Code Logic Review — `TASK_2026_400`

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

The report's red evidence is credible: removing only the production cleanup leaves the real target with roles `['user', 'user']` instead of `['user', 'assistant']` (`.ptah/specs/TASK_2026_400/agent-output-frontend-developer.md:86-127`). Restoring cleanup produces 34 passing tests in the file (`agent-output-frontend-developer.md:129-147`). I independently reran the focused composed test with `--skipNxCache`; it passed with 1 test run and 35 skipped.

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

---

# Batch 5 Addendum — Context-Usage Gauge

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

The remediated Batch 5 logic satisfies the requested context-gauge behavior. The backend emits a dedicated `contextSnapshot` from the globally latest valid post-boundary main-session assistant frame (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:741-800`). Agent usage remains in lifetime totals and the per-model breakdown but cannot overwrite that snapshot (`session-history-reader.service.ts:801-827`). The snapshot formula matches the live path—input + cache-read + cache-creation, excluding output (`session-history-reader.service.ts:785-792`; `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:284-295`).

The frontend applies the same snapshot policy on both full session switches and restored-tab resumes (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:645-657,720-750,904-911`). A missing snapshot renders CTX unknown, a successful restored response with no stats clears stale persisted stats, and a delayed restore response is discarded when the captured tab no longer owns the captured session (`session-loader.service.ts:734-738,898-911`). Aggregate stats are still passed unchanged to `applyLoadedSessionStats`, so the TOKENS chip is not derived from or replaced by the context snapshot (`session-loader.service.ts:721-732`).

The score is 8 rather than 9–10 because verification is service-level rather than a fresh real Electron reproduction, and the existing JSONL reader still trusts malformed numeric shapes after parsing. Neither limitation is introduced by this batch or leaves a demonstrated gap in its normal contract.

## Five logic questions

### 1. How does this fail silently?

No silent failure remains in the scoped implementation for valid resume data. The prior success-looking failures are closed:

- Lifetime cumulative totals can no longer be published as CTX because `applyResumeStats` reads only `stats.contextSnapshot` (`session-loader.service.ts:734-749`).
- A restored tab cannot retain stale local stats after a successful no-stats response; all three stat fields are cleared (`session-loader.service.ts:904-911`).
- A delayed response cannot write into a tab rebound to another session because ownership is checked after the RPC resolves and before any tab-scoped write (`session-loader.service.ts:898-902`).

Residual uncertainty is limited to pre-existing malformed JSONL handling: syntactically valid lines are cast rather than schema-validated (`libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:625-627,645-661`), and numeric extraction checks primitive type but not finiteness/non-negativity (`libs/backend/agent-sdk/src/lib/helpers/usage-extraction.utils.ts:35-48`).

### 2. What user action produces unexpected behaviour?

No scoped user action found after remediation:

- Manual compaction followed by targeted reload uses the post-boundary snapshot, not lifetime totals (`session-history-reader.service.ts:741-792`; `session-loader.service.spec.ts:1133-1180`).
- Ordinary full resume uses the same helper (`session-loader.service.ts:645-648`).
- Renderer/webview restore refreshes stale persisted stats when available and clears them when unavailable (`session-loader.service.ts:898-911`; `session-loader.service.spec.ts:238-314`).
- Rebinding the restored tab while the resume RPC is pending leaves the new session untouched (`session-loader.service.spec.ts:316-354`).

### 3. What input data produces a wrong answer?

No valid input shape found:

- Multiple main models: the last main frame carries its own model independently of aggregate cost (`session-history-reader.service.ts:764-795`; `session-history-reader.service.spec.ts:332-400`).
- Expensive agent/subagent activity: agent data affects lifetime totals only and cannot select CTX (`session-history-reader.service.ts:801-827`; `session-history-reader.service.spec.ts:402-471`).
- Large assistant output: output is excluded from both resumed and live context calculations (`session-history-reader.service.ts:785-792`; `helpers/stream-transformer.ts:290-295`).
- Missing context snapshot: CTX is set to null rather than inferred from cumulative inputs (`session-loader.service.ts:734-738`).
- Unknown context window: the payload carries `contextWindow: 0`, which the existing component treats as unknown (`session-loader.service.ts:740-749`).

### 4. What happens when a dependency fails?

- A failed restored-session RPC logs and returns without destroying the cached transcript or stats (`session-loader.service.ts:890-896,931-938`). This is appropriate because failure supplies no replacement truth.
- A successful response that explicitly has no stats clears stale values to unknown (`session-loader.service.ts:898-911`). This correctly differs from an RPC failure.
- If the tab disappears or is rebound during the await, the response is ignored before stats, resumable subagents, or CLI-session restoration are applied (`session-loader.service.ts:898-902`).
- A missing/unreadable backend session history returns null stats and empty events after logging (`session-history-reader.service.ts:165-181,207-213`); the full switch follows its existing failure path rather than presenting a fabricated gauge (`session-loader.service.ts:655-703`).

### 5. What is missing that the requirements never mentioned?

No additional in-scope behavior is missing. Useful future hardening, outside this batch, would validate finite non-negative historical usage at the JSONL boundary and add a browser-level Electron assertion for the rendered chip.

## Failure modes

No current scoped failure mode was found after reading the complete changed production files, their focused specs, the shared RPC contract, the live context producer, the tab persistence behavior, and the resume RPC assembly path.

The following previously identified modes are now pinned as resolved:

- Aggregate model wins over latest main model — resolved by the dedicated snapshot and multi-model regression (`session-history-reader.service.spec.ts:332-400`).
- Agent model suppresses root context — resolved by snapshot isolation and agent regression (`session-history-reader.service.spec.ts:402-471`).
- Resume includes output while live does not — resolved by matching formulas and post-compaction regression (`session-history-reader.service.spec.ts:473-561`).
- Restored resume discards valid stats — resolved through `applyResumeStats` and restore regression (`session-loader.service.spec.ts:238-297`).
- Successful restored resume with null stats retains stale gauge — resolved by explicit clearing and regression (`session-loader.service.spec.ts:299-314`).
- Delayed restored response writes into rebound tab — resolved by post-await ownership check and deferred-response regression (`session-loader.service.spec.ts:316-354`).

Residual uncertainty: malformed-but-parseable JSONL numeric fields are existing boundary debt; focused service tests do not exercise actual Electron DOM rendering.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

No in-scope material issue.

Pre-existing hardening opportunity: validate JSONL usage values as finite and non-negative before aggregation (`jsonl-reader.service.ts:625-627`; `usage-extraction.utils.ts:35-48`). This was already true for historical aggregate stats and is not introduced or worsened by the dedicated snapshot.

## Data flow

1. OK — `chat:resume` reads main history and agent sessions, then assembles stats (`session-history-reader.service.ts:165-206`).
2. OK — The last compact boundary determines the main-message slice used for current stats (`session-history-reader.service.ts:741-752`).
3. OK — Ordered main-message traversal overwrites one context snapshot on each valid assistant frame, leaving the globally latest frame and its resolved model (`session-history-reader.service.ts:764-795`).
4. OK — Agent traversal updates aggregate totals/model usage but has no path to `contextSnapshot` (`session-history-reader.service.ts:801-827`).
5. OK — The shared RPC contract carries the optional snapshot independently of lifetime tokens/model usage (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:257-280`).
6. OK — Full switch passes non-null stats into the shared application method; successful no-stats ordinary switches clear stats through the existing branch (`session-loader.service.ts:645-657`).
7. OK — `applyResumeStats` installs aggregate stats/list unchanged and derives CTX solely from the dedicated snapshot (`session-loader.service.ts:720-750`).
8. OK — Restored-tab resume revalidates `(tabId, sessionId)` after the RPC (`session-loader.service.ts:898-902`).
9. OK — Restored-tab resume applies non-null stats or clears all stale stats on successful null (`session-loader.service.ts:904-911`).
10. OK — Resumable subagents and CLI sessions are processed only after the same ownership check (`session-loader.service.ts:913-930`).

## Requirements fulfilment

| Requirement                                         | Status   | Gap                                                                                                                                  |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Post-compaction CTX uses post-compaction context    | COMPLETE | Last valid main frame after final boundary (`session-history-reader.service.ts:741-795`).                                            |
| Ordinary resume uses current context                | COMPLETE | Full switch and restored-tab paths both use `applyResumeStats` (`session-loader.service.ts:645-648,904-906`).                        |
| TOKENS chip remains intended aggregate              | COMPLETE | Aggregate stats are passed unchanged; context snapshot is separate (`session-loader.service.ts:721-732`).                            |
| Unknown when correct context unavailable            | COMPLETE | Missing snapshot clears CTX; successful null stats clears persisted stat state (`session-loader.service.ts:734-738,904-911`).        |
| Multi-model session uses globally latest main model | COMPLETE | Snapshot identity is independent of aggregate rank (`session-history-reader.service.spec.ts:332-400`).                               |
| Agent usage cannot contaminate CTX                  | COMPLETE | Agent loop cannot assign snapshot (`session-history-reader.service.ts:801-827`).                                                     |
| Same notion as live path                            | COMPLETE | Both use input + cache-read + cache-creation (`session-history-reader.service.ts:785-792`; `helpers/stream-transformer.ts:290-295`). |
| Old cumulative guard removed only when dead         | COMPLETE | No cumulative total feeds CTX in `applyResumeStats` (`session-loader.service.ts:720-750`).                                           |
| No stale post-await restored-tab write              | COMPLETE | Ownership rechecked before any application (`session-loader.service.ts:898-902`).                                                    |
| Preserve `[compaction-diag]` logging                | COMPLETE | Loader diagnostic remains at `session-loader.service.ts:574-587`; scoped diff removes no lifecycle diagnostics.                      |
| Failing regression proved red then green            | COMPLETE | Original red evidence remains in `test-report.md`; remediated focused specs pass.                                                    |

Implicit requirements not addressed: none in scope.

## Edge cases

| Case                                   | Handled          | How                                          | Concern                                        |
| -------------------------------------- | ---------------- | -------------------------------------------- | ---------------------------------------------- |
| Single model after compaction          | YES              | Last post-boundary snapshot                  | None found.                                    |
| Multiple main models                   | YES              | Globally latest frame carries model          | Aggregate rank remains display-only.           |
| Agent model dominates cost             | YES              | Agents isolated from snapshot                | Lifetime breakdown still includes agent costs. |
| Large assistant output                 | YES              | Excluded to match live formula               | None found.                                    |
| Non-null stats, no snapshot            | YES              | CTX null                                     | Honest unknown.                                |
| Successful restored resume, null stats | YES              | Clears preloaded/live/model list             | No stale persisted gauge.                      |
| Failed restored resume                 | YES              | Logs and preserves cached state              | Failure does not masquerade as new truth.      |
| Restored tab closed during RPC         | YES              | Ownership lookup fails; response dropped     | No write.                                      |
| Restored tab rebound during RPC        | YES              | Session ownership mismatch; response dropped | Regression included.                           |
| Sibling targeted compaction reloads    | YES              | Existing pair-keyed in-flight identity       | Existing tests retained.                       |
| Unknown model context window           | YES              | Window 0 renders unknown                     | No fabricated percentage.                      |
| Malformed numeric JSONL                | Pre-existing gap | Type-only parsing/extraction                 | Future boundary hardening.                     |

Verification evidence from this final review:

- `npx nx test @ptah-extension/chat --testPathPatterns=session-loader.service.spec.ts --runInBand --skipNxCache` — 38 passed, 2 skipped.
- `npx nx test @ptah-extension/agent-sdk --testPathPatterns=session-history-reader.service.spec.ts --runInBand --skipNxCache` — 30/30 passed.
- `npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/agent-sdk @ptah-extension/shared --parallel=3 --skipNxCache` — header named all 3 requested projects; all 3 passed.
- `git diff --check` — passed.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Only pre-existing malformed-history validation and the absence of a fresh browser-level Electron assertion remain; neither undermines the verified Batch 5 logic.
- What a robust implementation would add: finite/non-negative JSONL usage validation and an Electron-level rendered-header regression, without changing the approved snapshot contract.
