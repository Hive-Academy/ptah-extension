# Code Logic Review — `TASK_2026_627` (Phase 1, diff af9ed9112..6cb27e3e4)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 5              |
| Failure modes found | 8              |

Scope: read in full the coordinator (`session-handoff/session-handover-coordinator.service.ts`), `main-thread-notice-queue.ts`, the PostToolUse handler, `subagent-budget-monitor.ts` (stop/observe/recordTaskStarted), the builder's agent-handoff path, the lifecycle `subagentsInFlight`/`armHandoverIfIdle` diff, the budget-service `release`/`clearAll`/workspace diff, the executor `task_started` tap, the `register.ts` wiring and the `AgentProcessManager` lane provider. Static review only; no checks were run. The known Batch 8 gap (waiting auto-handover not re-armed when the last background subagent ends with no later parent turn) is not counted.

## Five logic questions

### 1. How does this fail silently?

- A waiting `budget-auto` operation that meets the blocking limit stays gated and shows "waiting for subagents" (S1).
- A handoff notice posted after `stopSubagent` resolves can miss the stopped subagent's own `Agent` PostToolUse and then sits in the queue undelivered (M1). Nothing reports the loss.
- `workInFlight` swallows a lane-provider throw and counts 0 lanes (`session-handover-coordinator.service.ts:411-419`). It does warn, and this is the documented fail-open choice, so it is acceptable.

### 2. What user action produces unexpected behaviour?

- The user keeps working near the limit while a subagent runs. The op is `waiting-for-turn-end` with `reason: budget-auto`. When usage then crosses the blocking limit, the banner stays "waiting" instead of the one-click `budget-limit` confirmation (S1).
- Cancelling or losing the source during a wait leaves a stale `waitingFor` on the cancelled or failed state (M2).

### 3. What input data produces a wrong answer?

- `requestAgentHandoff`: if `previousId` is not found in the post-turn history (curation read is windowed or pruned), `previousIndex = -1` and `slice(0)` concatenates every assistant message. The builder then keeps the head of that text up to 6,000 characters, so the real handoff is cut off (M3, `coordinator:617-625`).
- An agent handoff longer than 6,000 characters is cut at the tail by `capText`, which drops `## Next action` and `## Still running`, the two sections that matter most (M4).

### 4. What happens when a dependency fails?

- Lane provider throws: handled, fail-open, warns on every terminal.
- Notice queue throws in the hook: handled, the hook is not broken.
- `stopSubagent` rejects: retried up to the existing cap, unchanged.
- A stuck subagent record or a hung lane: nothing bounds the wait (S1, M5).

### 5. What is missing that the requirements never mentioned?

- A bound or timeout on `waiting-for-turn-end` gated by work-in-flight.
- Delivery of a notice when the main agent has no further tool call.
- `armHandoverIfIdle` has no non-spec caller in `libs/` (`grep` finds only its definition). Until it is wired, it has no runtime effect. Treat it as a Batch 6+ item and confirm it is not silently dropped.

## Failure modes

### Blocking-limit handover stays gated (S1)

- Trigger: a `budget-auto` op is in `waiting-for-turn-end` (subagent or lane running). The next terminal reports `atBlockingLimit = true`.
- Symptom: the operation stays `budget-auto` / `waiting-for-turn-end` and never reaches `awaiting-confirmation`.
- Evidence: `session-handover-coordinator.service.ts:294-312`. `reason = live?.reason ?? ...` keeps `budget-auto` for a live op, so the gate at lines 299-303 applies even at the blocking limit. The "does not gate the blocking limit" spec (spec ~638) only covers the no-live-op case.
- Current handling: none.
- Recommendation: when `atBlockingLimit`, upgrade a waiting `budget-auto` op to `budget-limit` (or skip the gate) and clear `waitingFor`. Add a spec for waiting → blocking limit.

### Notice misses the stopped subagent's own tool result

- Trigger: the monitor stops a subagent. The `Agent` tool result (main-thread PostToolUse) fires as soon as the task terminates, possibly before `await stopSubagent` resolves and `pushParentMessage` posts (`subagent-budget-monitor.ts:616-690`).
- Symptom: the notice waits for the next main-thread tool call. With a background subagent, or when the parent answers in text only, it is never delivered before `release` clears it.
- Evidence: `register.ts` handoff comment, which assumes the Agent result drains the queue; `main-thread-notice-queue.ts` has no delivery fallback.
- Recommendation: post the notice before awaiting the stop, or keep the fallback of a user-visible log line or an idle push when the queue is non-empty at turn end.

### Stale `waitingFor`

- Trigger: `cancel()` or `sourceEnded()` on a waiting op (`coordinator:333-353`, `670-688`).
- Symptom: the published cancelled or failed state still carries `waitingFor`, because `snapshot` copies it whenever set (`:782`).
- Recommendation: clear `waitingFor` in `cancel`, `fail` and `sourceEnded`.

### Agent handoff window mis-selection and tail truncation

See Q3 above.

### Unbounded wait on a leaked running record or hung lane

- Evidence: `getRunningBySession` has no expiry check, unlike `getBackgroundAgents` (`subagent-registry.service.ts:574-597`). `countRunningLanes` counts any `running` lane (`agent-process-manager.service.ts` diff).
- Symptom: with no later parent turn, a record or lane that never terminates blocks the auto handover indefinitely. Together with S1 the source hits the limit while "waiting".
- Recommendation: add a wait deadline (for example waiting longer than N minutes, then arm) or an expiry filter for running records.

### Per-terminal republish

Every terminal while waiting bumps the revision, publishes and logs INFO, even when `waitingFor` is unchanged (`coordinator:308-310`, `:767`). This is noisy but bounded.

### `startedTasks` retention

`recordTaskStarted` stores every task, including bash and workflow tasks, with no pruning until session release (`subagent-budget-monitor.ts:376-387`). It grows with tasks per session. Tiny entries, but unbounded for a long session.

### Notice text includes model-authored task text

`handoffMessage` embeds `taskText` taken from the Agent tool input (`:753`), while the queue contract says "host-authored, never transcript text". It is capped at 2,000 characters by the queue. Low risk, but it contradicts the stated invariant.

## Blocking issues

None.

## Serious issues

### S1. Waiting `budget-auto` op is gated even at the blocking limit

- File: `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:294-312`.
- Scenario: handoff stage is reached while a subagent runs. The op is `waiting-for-turn-end`. Subagent-completion turns push usage to the blocking limit.
- Impact: the user never gets the `budget-limit` confirmation, the source refuses further input, and the handover cannot start until the subagent ends. The plan says budget-limit is never gated.
- Fix: derive `reason` (or the gate condition) from `atBlockingLimit`, not only from `live.reason`. Convert the waiting op to `budget-limit` or bypass the gate when `atBlockingLimit`.

### S2. No upper bound on the work-in-flight wait

- File: `coordinator:299-312`; `subagent-registry.service.ts:574-597`; lane count in `agent-process-manager.service.ts`.
- Scenario: a leaked `running` registry record (no expiry check) or a hung lane.
- Impact: the auto handover never starts, so a long session runs into the hard limit. The only escape is the user's one-click confirm.
- Fix: a wait deadline stamped on the op (check at each terminal and via `armHandoverIfIdle`), or filter expired running records.

## Moderate and minor issues

- M1. Notice may miss the Agent result and never drain (`subagent-budget-monitor.ts:616-690`, `register.ts:~507-512`, `post-tool-use-hook-handler.ts:~126-134`).
- M2. Stale `waitingFor` in cancelled and failed snapshots (`coordinator:782`).
- M3. `requestAgentHandoff` takes all assistant messages when `previousId` is not found (`coordinator:617-625`).
- M4. Agent handoff tail-truncation drops the last sections; prefer a head-and-tail split or an instruction to keep it short (`session-handoff-builder.ts:214-225`, `quoteWithin`).
- M5. `startedTasks` is never pruned during a session (`subagent-budget-monitor.ts:376-387`).
- Minor: `clearAll` clears notices only for sessions that have a budget entry (`session-budget.service.ts:317-324`), so a notice queued for a session with no entry lingers until process end (bounded at 4 per session).
- Minor: `setLaneWorkProvider` has a single slot. A second `AgentProcessManager` instance replaces the first (the unregister is identity-guarded, which is correct).
- Minor: `admitInterrupt` reports held for a `waiting-for-turn-end` op (`coordinator:358-363`). Check that interrupts during a wait behave as intended.
- Minor: `armHandoverIfIdle` has no caller yet.

## Data flow

1. Terminal → `onTurnTerminal` → `armAtTerminal(key, atLimit, queue, atHandoffStage)`: OK.
2. Gate: `workInFlight` → `runtime.subagentsInFlight`. OK. Dedupes by `toolCallId` across the source, real and tab ids (`session-lifecycle-manager.ts:~549-566`). Lanes are counted by real id or tab id.
3. Wait → publish with `waitingFor`: the S1 gap at the blocking limit, and the S2 unbounded wait.
4. Terminal with no work → `armed` → `startAutomatic`, or `budget-limit` → `awaiting-confirmation`: OK.
5. One-click confirm → `confirmBudgetOperation`. OK: idle starts at once, and mid-turn sets `userConfirmed`, which skips the gate at the next terminal.
6. `begin`: `source-unavailable` is returned before any op is created (`:233-235`). OK.
7. Complete → build with agent handoff (capped at 6,000 characters, block-quoted, controls stripped, seed ≤ 14,200 characters, arithmetic checks out) → write → successor. OK except for M3 and M4.
8. Notice: producer → queue (4 per session, 2,000 characters each) → PostToolUse drain (main thread only via `agent_id`). OK except for M1. Keys match, because both sides use the SDK session id.
9. Release → `entries.delete`, the rotation advisor release and `noticeQueue.clear`: OK.

## Requirements fulfilment

| Requirement                                      | Status   | Gap                       |
| ------------------------------------------------ | -------- | ------------------------- |
| Auto handover waits for subagents and lanes      | COMPLETE | no bound (S2)             |
| budget-limit never gated                         | PARTIAL  | a live `budget-auto` op is gated at the limit (S1) |
| One-click confirm                                | COMPLETE |                           |
| source-unavailable before creating anything      | COMPLETE |                           |
| No double count of subagents across ids          | COMPLETE |                           |
| `armHandoverIfIdle` no-op mid-turn, no `markTurnEnded` | COMPLETE (logic) | no caller yet        |
| Notice queue bounded, main thread only           | COMPLETE | delivery race (M1)        |
| Task id from `task_started`                      | COMPLETE | retention (M5)            |
| Agent handoff caps and sanitising                | COMPLETE | M3 and M4                 |
| Workspace memory and queue clear                 | COMPLETE | `clearAll` minor          |
| Lane provider fail-open, unregister on disposeAll | COMPLETE | single slot (minor)      |

Implicit requirements not addressed: a wait deadline and a user-visible reason for a lost notice.

## Edge cases

| Case                                        | Handled | How                                   | Concern                    |
| ------------------------------------------- | ------- | ------------------------------------- | -------------------------- |
| Lane provider throws                        | YES     | warn + 0 lanes                        | warns every terminal       |
| Empty lane parent id                        | YES     | not counted                           | untracked lanes never gate |
| Waiting op, then blocking limit             | NO      | still gated                           | S1                         |
| Cancel during wait                          | PARTIAL | cancelled and suppressed              | stale `waitingFor`         |
| Subagent record under the tab id            | YES     | union of ids, set dedupe              |                            |
| Mid-turn confirm                            | YES     | `userConfirmed`                       |                            |
| Source gone at begin                        | YES     | `source-unavailable`                  |                            |
| Notice overflow                             | YES     | drop the oldest, cap 4                |                            |
| Notice after the Agent result               | NO      | waits for the next tool call          | M1                         |
| Handoff over 6,000 characters / surrogates  | YES     | block-quote loop, surrogate-safe      | tail loss (M4)             |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (static review; the gate behaviour is traced against the existing spec cases)
- Top risk: a waiting `budget-auto` handover is still gated when the session reaches the blocking limit, and no wait is bounded, so the user can be stuck waiting on a subagent.
- What a robust implementation would add: upgrade or bypass the gate when `atBlockingLimit` (with a spec); a wait deadline or an expired-running-record filter; clear `waitingFor` on cancel, fail and source end; post the subagent notice before awaiting the stop, or add a fallback delivery; select the handoff by an explicit marker and keep head and tail when truncating; prune `startedTasks`.
