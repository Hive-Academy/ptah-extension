# Batch 6 implementation report

## Tasks and evidence

- **6.1 Shared decision caller:** Extracted `openCaller`, `dispatchFor`, and `noteLive` to `DecisionCaller`. `RouteDecideService` delegates to it. The structured dispatch still uses `AbortSignal.timeout(DECISION_REQUEST_TIMEOUT_MS)` and System One still uses the resolved target timeout. Existing preflight and gate specs passed in the first lane-routing verify (3/3 targets succeeded).
- **6.2 Task-kind classifier:** Implements `LaneTaskKindClassifier` with one `task_kind` fixed question over `OUTCOME_TASK_KINDS`. It returns null for unset or blocked callers before dispatch, accepts only a validated offered choice, and catches failures with log-safe error names. The DI token and factory are registered. New specs cover unset (zero calls), accepted kind (one call), low confidence, invented choice, timeout, and thrown errors without brief text in logger calls.

## Paths touched

- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\decision-model\decision-caller.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\route-decide.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\task-kind\decision-model-task-kind-classifier.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\task-kind\decision-model-task-kind-classifier.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-06-report.md`

## Risks

- **R1 parallel edits:** Verification was scoped to lane-routing; foreign failures would have been reported without edits. The first run passed.
- **R7 shared DI files:** B6 changed only its listed routing files; B14 must apply its later DI changes after this batch. No barrel edit was made.
- **R9 shared hosts:** No host files or public API were changed. The batch's scoped verify does not establish host typecheck results; B21 owns host checks.
- **R11 Phase A wiring:** The factory and token are ready. The classifier's outcome-library wiring is assigned to later batches.
- **R12 degradation audit:** No deliberate swallow was introduced; failures are reported with safe categories and resolve to null.

## Verification tails

- Scoped `ptah_get_diagnostics` after the final test edit: **0 errors, 0 warnings**, clean coverage.
- First `npm run verify -- -p @ptah-extension/lane-routing`: **3/3 targets succeeded**, exit 0; lock acquired after 223 s, released after 56.1 s.
- Final verify after test edit: **3/3 targets succeeded**, exit 0; lock acquired after 428 s and released after 36.2 s. Tail:

  ```text
  [verify 2026-10-30T18:20:43.884Z] lock slot 0 acquired after 428s: verify lint,test,typecheck (@ptah-extension/lane-routing)
  NX   3 tasks: 3 succeeded
  Run duration:      28.7s
  Cache:             0/3 hit (0%)
  [verify 2026-10-30T18:21:20.121Z] lock released after 36.2s, exit code 0
  ```

- The requested `tail -40` filter is unavailable in PowerShell. The same verify command used `Select-Object -Last 40` for output filtering.

## Decisions

| Decision                                                                        | Options                                                                        | Evidence                                                                                                                                                                       | Reversible |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Keep `DecisionCaller` internal to lane-routing and construct it in both clients | Register a separate caller token; construct from existing dependency objects   | Component 8 requires a class with `{ config, logger, structured?, seams? }`; both clients already receive these dependencies, and B6 lists no caller token or barrel edit      | Yes        |
| Use the existing fixed-request validation result to accept an `oN` label        | Revalidate raw response; use `runFixedRequest`'s `validateChoiceAnswer` result | `pipeline/model-call.ts` validates fixed answers before returning `ModelRequestOutcome`; `choice` is null on invented labels and `cause` is `low-confidence` below 0.5         | Yes        |
| Preserve target timeout for System One and 3000 ms abort for structured calls   | Force every target to 3000 ms; preserve the current dispatch                   | `systemOneClientOptions(target)` uses the target timeout; `route-decide.service.ts` previously used `AbortSignal.timeout(DECISION_REQUEST_TIMEOUT_MS)` for structured dispatch | Yes        |

## Out-of-scope issues

- Host typechecks are assigned to B21 and were not run under Batch 6's verification constraint.
