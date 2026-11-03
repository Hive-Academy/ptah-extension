# Code Logic Review — `TASK_2026_ONBOARDING` (b3a elapsed)

## Summary

| Metric              | Value |
| ------------------- | ----- |
| Overall score       | 8/10 |
| Assessment          | APPROVED |
| Blocking issues     | 0 |
| Serious issues      | 0 |
| Moderate issues     | 0 |
| Failure modes found | 0 |

Scope: `elapsedSeconds` (`analyze-workspace.page.ts:113`), `startClock` / `stopClock` (`:164-170`), the running-state binding (`:29`), and the new spec (`analyze-workspace.render.spec.ts:191-199`). Callers of `startClock` were traced: `startFresh` (`:147-151`), `continuePrevious` (`:155-159`), `retry` (`:161`), and `stop` (`:163`). No source was edited. Tests were not executed (lane forbids npm/nx/jest). No `code-style-review.md` for this batch. No pending handoff for this deliverable. Ptah symbol index was empty, so `startFreshAnalysis` / `run` were read with Grep plus a direct read of `wizard-analysis-runner.service.ts`.

8 sits below 9 because the new test stays green if either half of the fix is removed on its own. It sits above 7 because the three restart paths cannot render a negative count again.

## Decisions

- Verdict is APPROVED, not REVISE, on the test-specificity gap. Options: require a second assertion that fails when only `Math.max` or only the paired timestamp remains; or accept one test that fails when both guards are absent, which is the reported bug. Evidence: with fake `Date` advanced 5000 ms, the old formula is `Math.floor(-5000/1000) === -5`; either `Math.max(0, -5)` or equal timestamps yields `0`. Reversible: a later test can split the cases without changing production code.

## Five logic questions

### 1. How does this fail silently?

It does not, on the paths that produced "-1s". `startClock` captures one `startedAt` and writes it to `now` before `openedAt` (`analyze-workspace.page.ts:165-166`). A live computed that reads between those two writes still sees the previous `openedAt` (an earlier start, or `null`). The earlier start makes the transient delta positive; `null` makes `elapsedSeconds` return `null` (`:113`). The negative window was `now` stuck at construction (`:111`) while `openedAt` moved forward. That window is closed.

`stopClock` (`:170`) sets `openedAt` to `null` and leaves `now` stale. The computed returns `null` whenever `openedAt` is `null`, so the stale `now` is not shown. The running template is the only reader (`:29`), and it hides the line when the value is `null`.

### 2. What user action produces unexpected behaviour?

Retry, Continue previous run, and Start fresh after Stop all call `startClock`, so the count restarts at 0 rather than going negative.

- `retry` is `continuePrevious` (`:161`), which calls `startClock` before `resumeAnalysis` (`:157-158`).
- `startFresh` calls `runner.reset()` then `startClock` (`:149-150`). `reset` clears `inFlight` and sets `isRunning` false (`wizard-analysis-runner.service.ts:241-245`). `startFreshAnalysis` → `run` sets `isRunning` true in the synchronous prefix, before the first `await` (`:250-252`). The 1000 ms interval (`analyze-workspace.page.ts:168`) therefore sees a running runner before it can call `stopClock`.
- `stop` always reaches `stopClock` in `finally` (`:163`). The next start overwrites `now` and `openedAt` together. The interval from the previous run is cleared at the top of `startClock` (`:167`) before a new one is armed.

The label says "since you opened this page" (`:29`) while the clock starts at run start. That wording is pre-existing. The running panel is not mounted until `isRunning()` is true (`:25`), so 0s at the moment that panel appears matches the coordinator decision (both stamps set when the run starts).

### 3. What input data produces a wrong answer?

No input feeds this computed. Time is the only input. `Math.floor` of a negative fraction is `-1` (the screenshot bug for a sub-second gap). `Math.max(0, …)` (`:113`) turns that into 0. A later `Date.now()` behind `openedAt` (clock step) stays at 0s until the clock catches up, and does not show a minus sign. `openedAt` is only written in `startClock` (same number as `now`) and `stopClock` (`null`).

### 4. What happens when a dependency fails?

`startFreshAnalysis` / `resumeAnalysis` rejecting does not unwind the clock. `startClock` has already paired the stamps. The interval calls `stopClock` on the next tick once `isRunning` and `isCanceling` are both false (`:168`), including `run`'s `finally` (`wizard-analysis-runner.service.ts:294-297`). The line unmounts because the running branch is gone, and `openedAt` becomes `null`. `stop` still clears the clock when `cancel` throws (`analyze-workspace.page.ts:163`). Elapsed is not on the failure or stop-recovery templates (`:23-36`).

### 5. What is missing that the requirements never mentioned?

A rendered-text assertion. The spec reads the computed (`analyze-workspace.render.spec.ts:197`) and never checks that the paragraph is `0s since you opened this page`. The computed is the value the template interpolates (`analyze-workspace.page.ts:29`), so the user-visible bug is covered one layer down. The design spec only requires the label and that the timer is session-local and hidden after reload.

## Failure modes

None found for a negative or stuck elapsed value on retry, continue, stop-then-start, or `stopClock`.

Reviewed: page class through `:175`, the new spec, the prior timer spec (`analyze-workspace.render.spec.ts:178-188`), and `WizardAnalysisRunner.run` / `reset` / `cancel`. Residual uncertainty: Jest was not executed. The fail-without-fix conclusion is from the fake-timer contract the task states (`advanceTimersByTime` moves mocked `Date`) plus the expression at `analyze-workspace.page.ts:113`.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. Minor — `analyze-workspace.render.spec.ts:191-197`. The test fails without the fix: construction sets `now` to fake `T`, `advanceTimersByTime(5000)` moves `Date` to `T+5000`, and the old `startClock` set only `openedAt`, so `elapsedSeconds` is `-5`. It does not fail if only one guard remains. Dropping `Math.max` still yields 0 because both stamps match. Dropping the paired `now.set(startedAt)` still yields 0 because of the clamp. The original combined bug is locked; each line is not.

## Data flow

1. Construction sets `now` to `Date.now()` and `openedAt` to `null` (`:110-111`). Elapsed is `null`. OK.
2. `startClock` stores one `startedAt`, writes `now`, then `openedAt` (`:165-166`). Elapsed is 0. OK.
3. Each 1000 ms tick writes `now` only while running or canceling (`:168`). Delta is non-negative unless the wall clock moves backward; the clamp holds that at 0. OK.
4. Tick while stopped, `stop`, or `ngOnDestroy` (`:124`) calls `stopClock`: timer cleared, `openedAt` null, elapsed `null`. OK.
5. A later `startFresh` / `continuePrevious` / `retry` runs step 2 again. The stale `now` from step 4 is overwritten before `openedAt` is set. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| No negative elapsed before the first tick | COMPLETE | Both the paired timestamp and the clamp |
| Retry / continuePrevious | COMPLETE | Same `startClock` |
| Stop, then start again | COMPLETE | `stopClock` then a fresh pair |
| Clock stop leaves `openedAt` null | COMPLETE | Computed is `null`, line hidden |
| Regression test fails without the fix | COMPLETE | Fails if both edits are reverted; see minor finding 1 |

Implicit requirements not addressed: none for this defect.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Page created, run starts seconds later | YES | `startClock` sets `now` and `openedAt` together (`:165-166`); clamp (`:113`) | Test does not separate the two guards |
| Retry / continue previous | YES | `:157` and `:161` call `startClock` | Count restarts at 0; label predates this fix |
| Stop, then start | YES | `:163` then `:150` or `:157` | `now` left stale is overwritten |
| `stopClock` sets `openedAt` null | YES | `:170` and `:113` return `null`; `:29` hides the line | Not a frozen number |
| First tick before `isRunning` | YES | `run` sets `isRunning` synchronously after `startClock` schedules the interval | Depends on that prefix staying before the first `await` |
| Wall clock steps backward | YES | Clamp shows 0s | Untested; display sticks at 0 until `now` catches `openedAt` |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a future edit can drop one of the two guards and the new test will still pass.
- What a robust implementation would add: one assertion that the value is 0 with the clamp removed is already implied by equal stamps; a second case that sets `now` behind `openedAt` after `startClock` would lock `Math.max`. Not required to close the reported bug.
