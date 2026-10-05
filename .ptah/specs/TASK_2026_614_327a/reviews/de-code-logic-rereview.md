# Code Logic Re-review (fix round, FM-3): `TASK_2026_614_327a`

Scope: `git diff HEAD~1 HEAD` (3e0b1507a) for `subagent-budget-monitor.ts` and `subagent-budget-monitor.spec.ts`, `fix-round-report.md`, FM-3 in `reviews/de-code-logic-review-a.md`. I read the whole monitor class (lines 252-609), not only the hunks.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 8/10           |
| Assessment          | APPROVED       |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 0              |
| Minor issues        | 3              |
| Failure modes found | 1 (Minor, two stops in flight at once) |

## Is FM-3 closed? Yes

- `rekey` now keeps the `toSessionId` state when it has a stop running or finished and the `from` state has not (`subagent-budget-monitor.ts:370-373`, `hasStopStarted` at `:607-609`). It also points the record it merged away at the surviving record (`:380`).
- After a stop finishes, `stop()` follows `mergedInto` to the live record (`liveSession`, `:410-418`). It does the bookkeeping on the state that record holds (`:528`) and returns early if that state is already `stopFired` (`:529-532`). The handoff goes to the live session id with the merged task texts (`:533`, `:561`).
- How exactly-once holds:
  - In-flight `E` on the target with a fresh `F` on the source: `E` is kept and finishes once.
  - In-flight `E` with `F` already fired: `F` is kept and `E` returns at `:529`.
  - `E` and `F` both in flight: the first stop to finish sets `stopFired`, and the second returns at `:529`.
- Release still suppresses the stop. `release` deletes the live record. `liveSession` then returns `undefined` because it checks that the map still holds that same object (`:415`), so there is no registry update and no handoff (`:523-526`). This holds even if a new record is later created under the same id, because that record is a different object.

## New failures introduced?

- **Merge-chain cycles: none.** `mergedInto` is only set on a record at the moment it is removed from the map (`:380`, which `:383` overwrites), and it always points at a record that is in the map. A record that has been merged away can never come back as `session` or `existing`, so it is never reassigned. Every chain therefore ends at a record that was live when the merge happened, and the loop at `:412` terminates.
- **Unbounded chains or retained memory: none of note.** The live record has no back-pointer, so records that were merged away are reachable only from the closure of a pending `stop()`, and they become garbage once it settles. The chain length is at most the number of merges that happen while one stop is in flight.
- **A second handoff: none.** The `stopFired` guard at `:529` and the `stopFired`/`stopInFlight` early return in `observe` (`:301`) cover it. Spec 1 pins it with a later observation over budget, which leads to no second `stopSubagent` and no second push.
- **Wrong state chosen on a merge: no.** The only change is when the target's state has a stop started and the source's does not. Previously the fresh source state won. That dropped `stopFired`, which allowed a second stop and a second handoff, so the change is a latent fix. The cost is that the source's token counts for that subagent are discarded in favour of the target's (Minor m2).
- **Behaviour change when no stop is in flight: none.** If neither state has a stop started, the source state still wins (`:371`). With no existing target, `mergedInto` is never set and `liveSession` behaves as the old `isCurrent` did.

## Failure modes / minor issues

### m1: Two stops in flight; a failure that exhausts the retries hides a later success (Minor)

- Trigger: the same `toolCallId` has stops in flight on both records. The target-side stop `E` rejects on the attempt that reaches `MAX_STOP_ATTEMPTS`, and the source-side stop `F` then succeeds.
- Symptom: `onStopFailed` runs against `liveState` (`F`, at `:535`) and sets `F.stopFired = true` (`:592`). When `F`'s own stop resolves successfully, it returns at `:529`. The subagent really was stopped, but the registry is never marked `completed` and no handoff is sent.
- Likelihood: very low. It needs the same subagent observed under two session ids, a stop running on each, and the retry budget nearly exhausted.
- Fix: count a failure only when `liveState.stopInFlight` is false, or let a later success override a give-up.

### m2: The handoff numbers come from the state that triggered the stop, not the kept one (Minor)

- At `:549-550` and `:558`, the log and `handoffMessage` use `state`, while the flags are written to `liveState`. After a merge where `liveState !== state`, the reported `contextTokens`/`weightedUsed` may differ from what `getSnapshot` later shows. This is cosmetic, and arguably correct, because those are the numbers that triggered the stop.

### m3: Spec gaps (Minor)

- `spec.ts:445-477` and `:479-499` pin the FM-3 scenario and the release case. Both use a duplicate `TOOL_CALL` on `SESSION` (via `m0`), so the merge path at `:370-373` is exercised. Spec 1 would fail against the pre-fix code, because the old `isCurrent(existing)` check returns false and nothing is pushed.
- Not pinned:
  - the in-flight stop rejecting across a merge (`onStopFailed` on `liveState`, then a retry on the next message);
  - both sides in flight at once;
  - the fired-target-plus-fresh-source preference, which is the latent double-handoff fix;
  - the handoff task text coming from the merged-away record's `taskTexts`.

## Verdict

- Recommendation: **APPROVE**. FM-3 is closed and pinned, and the fix adds no cycle, leak, duplicate handoff or change in the no-stop path. What remains is one Minor edge (m1) that needs two concurrent stops on the same subagent.
- Confidence: HIGH (I traced the logic). I did not run the tests in this re-review.
- Why 8 and not 9: m1 is a real, if remote, silent-success gap, and the failure-across-merge path has no spec.
