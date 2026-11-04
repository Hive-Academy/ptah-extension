# Code Logic Review — `TASK_2026_863_26b1`

## Summary

| Metric              | Value                          |
| ------------------- | ------------------------------ |
| Overall score       | 6/10                           |
| Assessment          | NEEDS_REVISION                 |
| Verdict             | CHANGES REQUESTED              |
| Blocking issues     | 0                              |
| Serious issues      | 1                              |
| Moderate issues     | 1                              |
| Failure modes found | 1                              |

Score 6, not 7: while a background subagent is still running, admitting `awaiting-background` matches a user send the product already allows, and subagent frames cannot cancel the parent's timer. The send path can still yield `/compact` after a root `message_start` has flipped the phase to `generating`, because admission looks only at `turnInFlight`. That send is recorded as `fire-sent`, and the notification turn's `result` then closes the idle period. Score 6, not 5: the steady state is the streamed slash path that keeps the query open (`TASK_2026_472`), every other non-idle phase still returns `not-idle`, and the removed reason has no remaining consumer.

`ptah_get_diagnostics` on the four changed files: 0 errors, coverage clean. `npm run verify -- -p @ptah-extension/agent-sdk` was not re-run here. The implementation report says that command died in Nx plugin load (`spawn EPERM`) before any target ran. Behaviour of the new spec is unread by a runner in this review.

No `code-style-review.md`, `task-description.md`, or `implementation-plan.md` in the task folder. Intent is `context.md`, `field-log-analysis.md`, and `impl-report.md`.

## Five logic questions

### 1. How does this fail silently?

A root assistant `message_start` that the SDK starts itself (the task-notification continuation) sets phase `generating` and does not set `turnInFlight`. `evaluateFireGate` has already returned null. `sendIdleCompact` then queues `/compact`, the pump yields it, and `sendMessage` resolves. The service emits `fire-sent`. The SDK, per the pump's own contract, records a mid-turn prompt as a `queued_command` and does not run it. No `pre-compact` arrives. The notification turn's `result` hits the in-flight `enqueued` branch and closes the idle period, so that turn's context cannot arm a replacement timer. The caller sees a normal send. Evidence: `session-stream-pump.service.ts:14-19`, `session-stream-pump.service.ts:269-279`, `idle-compaction.service.ts:443-451`, `idle-session.reducer.ts:138-147`.

### 2. What user action produces unexpected behaviour?

None on the steady path. The parent turn has already ended, `onTurnTerminal` has cleared `turnInFlight` (`sdk-agent-adapter.ts:2284-2292`, `session-lifecycle-manager.ts:575-579`), and the chat input is already enabled in `awaiting-background` (`message-dispatch.service.ts:66-76`). A person can send text in that phase today. Idle `/compact` uses the same `require-idle` admission (`session-lifecycle-manager.ts:866-873`).

The unexpected case is not a click. It is the subagent finishing in the window after the gate and before the second admission check. See the failure mode below.

### 3. What input data produces a wrong answer?

Subagent frames do not. `SessionQueryExecutor.handle` returns on a truthy `parent_tool_use_id` before request tracking (`session-query-executor.service.ts:276-278`). `MainRequestTracker.observe` returns null for the same field (`idle-request-tracker.ts:48-49`). A `system` `task_notification` has no assistant message id, so it does not emit `request-started` (`idle-request-tracker.ts:50-59`). `applySnapshot` updates the turn registry only (`session-turn-state.registry.ts:400-407`) and does not signal idle compaction.

The wrong answer is a phase string of `generating` that arrives after the gate read. The gate treats that string as `not-idle` (`idle-fire-gate.ts:55-57`) only if it is already visible. `beforeEnqueue` never reads the phase (`idle-compaction.service.ts:419-441`). `assertAdmissible` refuses only a missing record, an abort, `turnInFlight`, or a non-empty queue (`session-stream-pump.service.ts:298-316`).

### 4. What happens when a dependency fails?

Unchanged, and still bounded. Lookup throws become `lookup-failed` and skip (`idle-compaction.service.ts:403-415`). `SessionAdmissionRefusedError` becomes `not-idle-at-send` and clears the attempt without closing the period (`idle-compaction.service.ts:455-461`, `idle-session.reducer.ts:353-366`). A send that resolves and then never claims waits `IDLE_CLAIM_TIMEOUT_MS` (120s) in `sending` or `enqueued`, then `claim-timeout` / `send-timeout` and `close()` (`idle-session.reducer.ts:369-400`). An open compact dwells at most `COMPACTION_MAX_DWELL_MS` (300s) (`compaction-state.types.ts:43`, `idle-session.reducer.ts:241-250`). `turn-ended` during `enqueued` or `precompact` logs `compaction-failed`, releases the claim, and closes (`idle-session.reducer.ts:138-147`). `boundary` becomes `boundary-ended`; `postcompacted` closes (`idle-session.reducer.ts:148-163`). `request-started` and `input` keep an in-flight attempt (`idle-session.reducer.ts:128-136`). A `turn-ended` that arrives while the attempt is still `sending` matches none of those branches and is dropped (`idle-session.reducer.ts:138-164`).

### 5. What is missing that the requirements never mentioned?

`sleeping` stays `not-idle`. A session whose only leftover work is crons can still miss the 0.9× TTL fire the same way the two field vetoes did. The field log named only `background-subagent`, so this review does not treat `sleeping` as a defect of this change.

The new service spec asserts that the sender was called (`idle-compaction.service.spec.ts:193-204`). It does not run the pump, does not flip the phase during `createUserMessage`, and does not show that a later `turn-ended` leaves the period open. Verify did not execute.

## Failure modes

### SDK-originated parent turn between the gate and the yield

- Trigger: phase is `awaiting-background`, `turnInFlight` is false, the due timer passes the gate, then a root assistant `message_start` (task-notification continuation) commits `generating` before `/compact` is yielded.
- Symptom: `/compact` is handed to a query that is already generating. The pump contract says the SDK stores that as a `queued_command` and does not run it. Idle compaction still records `fire-sent`. The notification turn's `result` closes the idle period, so the new request cannot arm.
- Evidence: `stream-event.transformer.ts:192-198` calls `markGenerating` only when `parentToolUseId` is absent. `session-turn-state.registry.ts:322-332` sets `generating` and does not touch the session record. `markTurnStarted` is only the pump, immediately before a yield (`session-stream-pump.service.ts:82-88`, `session-registry.service.ts:600-606`). `releaseTurnOnResult` clears `turnInFlight` on `result` (`sdk-agent-adapter.ts:2284-2292`), including the result that settled `awaiting-background` (`session-turn-state.registry.ts:362-367`). The gate snapshot is `idle-compaction.service.ts:401` and `idle-fire-gate.ts:55-57`. The second check is `session-stream-pump.service.ts:269-274`. Success is `idle-compaction.service.ts:446-451`. Close is `idle-session.reducer.ts:138-147` and `95-101`.
- Current handling: `not-idle` if the phase is already `generating` when the gate runs. No second phase read. `request-started` from that `message_start` keeps the in-flight attempt (`idle-session.reducer.ts:128-135`), so `takeUntil` in `idle-compaction.service.ts:254-263` does not cancel the send.
- Recommendation: before the queue push, refuse `require-idle` when the live phase is neither `idle` nor `awaiting-background`, and map that refusal to `not-idle-at-send` so the attempt is cleared and the period stays open. Also set a busy bit the pump already honors (`turnInFlight` or the queue) when a root `message_start` commits `generating`, and clear it on `result`, so a yield cannot sneak through after `sendMessage` has resolved. A phase read inside `beforeEnqueue` alone still loses to the microtask between `resolveNext` (`session-stream-pump.service.ts:280-283`) and the yield.

## Blocking issues

None.

## Serious issues

### `/compact` can be yielded mid-generation, then recorded as sent

- File: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:298-316` and `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:419-451`
- Scenario: fire is admitted on `awaiting-background`. During `createUserMessage` (the await between the two `assertAdmissible` calls, `session-stream-pump.service.ts:247-273`) the subagent's task notification starts a parent assistant turn. Phase becomes `generating`. `turnInFlight` stays false. The second check passes. The pump yields `/compact` because its drain condition is `messageQueue.length > 0 && !turnInFlight` (`session-stream-pump.service.ts:82`).
- Impact: the compact that this change exists to save is dropped on the floor, and `close()` sets `idlePeriodClosed` (`idle-session.reducer.ts:95-101`). `noArmReason` then returns `stale-turn` for the notification turn (`idle-session.reducer.ts:58-62`). The old `background-subagent` skip cleared the attempt and left the period open (`idle-session.reducer.ts:353-366`), so that follow-up turn could arm. This race is worse than the veto it replaces. It is the situation the field logs were in: a subagent still running at 0.9× the 1h TTL, which is exactly when its completion and this fire can overlap.
- Fix: see the failure mode. Do not emit `fire-sent` for a message the pump yields while the phase is `generating`.

Steady state, subagent still running and no root `message_start` yet, is safe to send. The streamed `/compact` stays on the open input and does not mark the query single-turn (`slash-command-interceptor.ts:11-19`, `sdk-query-runner.service.ts:256-262`). Deadlines stay 120s to claim and 300s to dwell.

## Moderate and minor issues

- Moderate. `idle-compaction.service.spec.ts:193-204` only checks that `sendIdleCompact` was called after `setPhase('awaiting-background')`. The harness sender invokes `beforeEnqueue` immediately (`idle-compaction.service.spec.ts:92-94`) and never drives `SessionStreamPump`. Nothing asserts refusal when the phase flips to `generating` inside the send await, or that `turn-ended` during `enqueued` must not be the outcome of a dropped yield. Gate coverage of the other phases is present (`idle-fire-gate.spec.ts:114-130`).

- Minor. `turn-ended` while phase is `sending` is ignored (`idle-session.reducer.ts:138-164`). A notification `result` in that window does not cancel the send. Pre-existing for every idle fire; this change makes an extra `result` likely. Fold it into the same busy-bit fix rather than a separate reducer special case.

## Data flow

1. Parent `result` settles `awaiting-background` when stop-snapshot tasks remain (`session-turn-state.registry.ts:362-367`) and `onTurnTerminal` clears `turnInFlight` (`session-lifecycle-manager.ts:575-579`). OK for a later user send.
2. Idle arm uses the parent request anchor. Subagent frames never call `requestStarted`. OK.
3. At `fireAt`, `attempt-due` moves the attempt to `sending` and starts a 120s deadline (`idle-session.reducer.ts:315-333`). OK.
4. `evaluateFireGate` allows `idle` and `awaiting-background` only (`idle-fire-gate.ts:55-57`). OK as a snapshot.
5. `sendMessage` awaits message build, then checks `turnInFlight` and queue length again (`session-stream-pump.service.ts:262-274`). Gap: phase is not part of that check.
6. `beforeEnqueue` checks the attempt is still `sending`, then claims (`idle-compaction.service.ts:419-441`). Gap: no phase read.
7. Pump yields and `markTurnStarted` sets `turnInFlight` (`session-stream-pump.service.ts:82-88`). Gap: yield is legal while an SDK-originated turn is already generating.
8. Promise resolve emits `fire-sent` and phase `enqueued` with another 120s deadline (`idle-compaction.service.ts:446-451`, `idle-session.reducer.ts:336-350`). Gap: success is "queued", not "SDK accepted `/compact`".
9. `pre-compact` → dwell 300s; `compact-boundary`; `post-compact` releases and closes. OK when those signals actually arrive.
10. A `result` while `enqueued` or `precompact` closes the period (`idle-session.reducer.ts:138-147`). OK for a failed compact. Wrong when the `result` belongs to a notification turn and `/compact` was only queued.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Admit `awaiting-background` at the fire gate and keep `not-idle` for every other non-idle phase | COMPLETE | `idle-fire-gate.ts:55-57`, spec `idle-fire-gate.spec.ts:114-130` |
| Remove `background-subagent` from `IdleSkipReason` | COMPLETE | Union in `idle-compaction.types.ts:131-146` has no such member. Workspace search for the string finds only the replay fixture directory `with-background-subagent` (`session-replay.service.spec.ts:667`), which is not the skip reason |
| Do not count subagent traffic as parent activity | COMPLETE | Early return `session-query-executor.service.ts:276-278`; tracker `idle-request-tracker.ts:48-49` |
| Do not send `/compact` mid-generation if the phase flips between gate and send | MISSING | Admission ignores phase. See the serious issue |
| Keep claim 120s and dwell 300s behaviour for an admitted send | COMPLETE | Unchanged reducer deadlines |

Implicit requirements not addressed: `sleeping` still skips at the gate. No retry if `not-idle` is decided at the gate instant; the attempt is cleared and only a later turn can arm. That matches the previous skip behaviour and is not introduced here.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Subagent still running at fire, no new parent turn | YES | Gate allows; `turnInFlight` is false; streamed `/compact` keeps the input open | None beyond ordinary compact failure, which the 120s/300s deadlines already close |
| Subagent tool frames during the wait | YES | Filtered before `requestStarted` | Cannot cancel a pending timer |
| `task_notification` system frame alone | YES | No request key; `applySnapshot` does not signal idle | Phase may fall to `idle` when the last task drops, which the gate also allows |
| Root `message_start` before the gate | YES | Phase `generating` → `not-idle`; attempt cleared; period stays open | Follow-up turn can arm |
| Root `message_start` during the send await | NO | Yield proceeds; `fire-sent`; later `result` closes the period | Serious issue |
| User message queued during the send await | YES | Second `assertAdmissible` sees the queue and throws `busy` → `not-idle-at-send` | `session-stream-pump.service.spec.ts:359-375` |
| `generating`, `sleeping`, `failed`, missing phase | YES | `not-idle` | `idle-fire-gate.spec.ts:118-129` |
| Compact signals after a real enqueue | YES | Existing reducer phases | Extra notification `result` during `precompact` is treated as `compaction-failed` |

## Decisions

- The race is a defect, not an acceptable window. Options were to approve because a user can already send during `awaiting-background`, or to request a busy signal that tracks SDK-originated root turns. Evidence: `turnInFlight` is cleared on every parent `result` and is set again only when this process yields; `markGenerating` is a different registry. A user send has the same hole, and this change aims a `/compact` at the moment that hole is most likely to open. Reversible: restoring the `awaiting-background` veto removes the race and brings back the field-log cache miss.

## Verdict

- Recommendation: CHANGES REQUESTED
- Confidence: MEDIUM
- Top risk: a task-notification continuation that starts during the send await makes Ptah record a compact that the SDK drops, and then closes the idle period so the new turn cannot arm.
- What a robust implementation would add: a phase check at the last synchronous point before enqueue, mapped to `not-idle-at-send`; a busy bit set on root `markGenerating` and cleared on `result`, honored by both `assertAdmissible` and the pump drain; a service test that flips the phase to `generating` inside the sender and expects no `fire-sent` and `idlePeriodClosed` still false. Re-run `npm run verify -- -p @ptah-extension/agent-sdk` once the Nx daemon accepts the worktree.

## Scope examined

Changed files, read whole: `idle-fire-gate.ts`, `idle-fire-gate.spec.ts`, `idle-compaction.types.ts`, `idle-compaction.service.ts` (pipeline and `fire`), `idle-compaction.service.spec.ts` (harness and the new test). Send and turn paths, read through the cited regions: `session-stream-pump.service.ts`, `session-registry.service.ts` (`markTurnStarted` / `markTurnEnded`), `session-lifecycle-manager.ts` (`sendIdleCompact`, `onTurnTerminal`), `sdk-agent-adapter.ts` (`releaseTurnOnResult`), `idle-session.reducer.ts`, `idle-request-tracker.ts`, `session-query-executor.service.ts` (`handle`), `session-turn-state.registry.ts` (`markGenerating`, `settleTurn`, `applySnapshot`), `stream-event.transformer.ts` (root `message_start`), `slash-command-interceptor.ts`, `message-dispatch.service.ts` (`isTabBusyGenerating`). String search for `background-subagent` across the worktree. Symbol index was empty (`symbolCount: 0`); searches fell back to workspace text search after `ptah_code_search_symbols` returned no hits.
