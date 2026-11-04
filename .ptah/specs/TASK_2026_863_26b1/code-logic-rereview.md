# Code logic re-review — idle fire phase re-check

Verdict: **APPROVE**. The serious race is closed. The post-push window is not material. The `sending` + `turn-ended` minor does not block merge.

Scope: the fix only. `isIdleFirePhase` (`idle-fire-gate.ts:29-31`, used at `:64`), the `beforeEnqueue` re-read (`idle-compaction.service.ts:431-435`), the `not-idle` → `not-idle-at-send` map (`:460-468`), and the new spec (`idle-compaction.service.spec.ts:409-427`). No source edits. No checks run (coordinator: lint, typecheck, 5303 tests).

## Does this close the serious race?

Yes. The serious case was a root `message_start` during `createUserMessage`, while `turnInFlight` stayed false, so the second `assertAdmissible` still pushed `/compact`, `fire-sent` recorded a drop, and the notification `result` closed the period.

`beforeEnqueue` now runs after that await and before `claimIdle` (`idle-compaction.service.ts:431-436`) and before `messageQueue.push` (`session-stream-pump.service.ts:269-279`). `generating` / `sleeping` / `failed` / missing phase throw `IdleSendVetoedError('not-idle')`. That maps to `fire-skipped` / `not-idle-at-send`: attempt cleared, `idlePeriodClosed` unchanged (`idle-session.reducer.ts:353-366`), and `releaseIdleClaim` is a no-op because the claim id was never stored (`compaction-coordinator.ts:165-169`). `request-started` keeps an in-flight `sending` attempt (`idle-session.reducer.ts:128-135`), so `takeUntil` (`idle-compaction.service.ts:254-263`) does not cancel the send before the veto. The new spec flips the phase to `generating` inside the sender, expects `not-idle-at-send`, and expects no claim.

## Is the queue-push → SDK-pull window material?

No. From the phase read through `push` and `resolveNext` (`session-stream-pump.service.ts:272-283`) there is no await. `resolve('message')` only schedules the generator. The drain then yields on that microtask (`:82-88`) before the next poll, and `markTurnStarted` sets `turnInFlight` before the yield. A `message_start` that arrived during the message-build await is already applied, so the re-read sees `generating` and vetoes. A chunk still sitting unread in the stdout buffer is one poll wide and is also invisible to a `markGenerating` busy bit. It is not the await-long hole that recorded `fire-sent` and closed the period.

## Should `turn-ended` during `sending` block merge?

No. For an in-flight attempt, `turn-ended` handles only `enqueued`, `precompact`, `boundary`, and `postcompacted` (`idle-session.reducer.ts:138-164`). `sending` falls through. That is pre-existing. With this fix it is the safe overlap: a notification that starts during the await is vetoed at enqueue; a notification that already settled back to `idle` or `awaiting-background` may still send into an open input. It does not emit `fire-sent` for a yield into `generating`.

## Residual notes (non-blocking)

The new spec drives the service harness, not `SessionStreamPump`. Pump ordering is the existing synchronous region at `session-stream-pump.service.ts:269-279`. The spec does not assert `idlePeriodClosed === false`; the reducer branch does (`idle-session.reducer.ts:366`).
