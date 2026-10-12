# Code Logic Re-review — TASK_2026_623_3492, Phase 2 fix (12F)

## Result

| Score | Verdict | Findings |
| --- | --- | --- |
| 5/10 | REVISE | 0 Blocking, 1 Serious, 0 Moderate, 0 Minor |

The two requested changes cover ordinary malformed values and ordinary thrown `Error`s, but the newly shared fixed-error path is itself not safe for every value JavaScript can throw. This retains a Serious privacy/error-boundary escape. The score is above 3 because the valid path and most required failure cases are deliberately preserved and covered; it is below 6 because the one purpose of Serious #1 is a complete fixed-text, cause-dropping boundary for response-build failures, and that boundary can still rethrow the original value.

## Status of previous findings

### Serious #1 — OPEN (partially closed)

The response build is now enclosed by the intended catch at `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts:94-98`; `buildResult` includes formatter projection and all four counts at `:141-157`. For ordinary `null`, non-array values, and rows whose access throws a normal `Error`, `unavailable()` returns the exact new `Error(UNAVAILABLE)` without a cause at `:127-131`, and its logger arguments omit `error.message` and row contents at `:128-130`.

However, `unavailable()` uses `error instanceof Error` and then reads `error.name` at `:129`. A malformed-row getter may throw an `Error` whose own `name` getter throws (or an exotic Proxy whose prototype lookup throws). In that case this error-reporting expression throws before `new Error(UNAVAILABLE)` is constructed. The caller receives the original/sentinel error rather than the required fixed text, and the response-build boundary does not meet decision #42. This is a Serious defect because a dependency/row shape failure again escapes the privacy boundary.

The new tests are real handler-path tests: null at `lane-plan-limits-rpc.handlers.spec.ts:535-544`, non-array values at `:546-558`, and a normal throwing row plus no-cause/no-sentinel-log assertions at `:560-592`. Each of those failure assertions would fail against commit `c8c137611`. They do not cover an error object whose `name`/prototype inspection throws.

### Moderate #2 — CLOSED

Only `undefined` is normalized to `{}` at `lane-plan-limits-rpc.handlers.ts:80-82`; `null` is passed to the strict schema and throws `RpcUserError(..., 'INVALID_PARAMS')` before `lookup()` at `:83-90`. The regression invokes the registered handler with exact `null` at `lane-plan-limits-rpc.handlers.spec.ts:489-500` and proves neither `build()` nor `list()` ran. The retained omitted-payload case at `:502-506` confirms the allowed `undefined` behavior. It is a preservation test, so unlike the four corrective cases it intentionally also passed before this fix.

## New finding

### Serious — fixed-error helper can rethrow untrusted error inspection

`unavailable()` classifies an untrusted caught value using `instanceof` and `error.name` (`lane-plan-limits-rpc.handlers.ts:127-131`). Both operations can execute adversarial proxy/getter traps. A row accessed by `formatPlanLimitRows` or `countState` can throw such a value; the `getLanePlanLimits` catch then calls this helper (`:94-98`) and leaks that new exception instead of returning `Lane plan limits are unavailable on this host`. The error-classification/logging path needs to be non-throwing before it can guarantee the decision #42 boundary.

No Blocking, Moderate, or Minor findings found. The changed production code has no empty body, TODO, PLACEHOLDER, or incomplete implementation; the test’s existing loader `jest.mock` at `lane-plan-limits-rpc.handlers.spec.ts:11-18` is an environment seam, while all response assertions execute the real handler implementation.

## Five logic questions

1. **Silent failure:** `null` parameters no longer look successful (`lane-plan-limits-rpc.handlers.ts:80-87`). The remaining failure is not silent: an exotic thrown error can escape to the caller, potentially exposing private text (`:94-98`, `:127-131`).
2. **Unexpected user action:** no new valid-user action regressed: valid calls still invoke only `agent.list()` then `agent.limits(rows)` (`:105-110`), with this constrained by `lane-plan-limits-rpc.handlers.spec.ts:413-453`. A malformed provider row can unexpectedly show a raw error through the helper defect.
3. **Wrong-answer input:** valid empty limits remain a correct empty response because `buildResult` maps an empty array and all counts derive from it (`lane-plan-limits-rpc.handlers.ts:145-156`). Null/non-array ordinary values now reject fixed-text; an exotic thrown value remains wrong-error output, not a wrong successful answer.
4. **Dependency failure, timeout, or wrong shape:** rejected `list()`/`limits()` flows use `unavailable()` (`:107-113`); `undefined` retains the unavailable path (`:114-117`); ordinary malformed resolved results use the response-build catch (`:94-98`). An error whose inspection traps is the unresolved dependency-shape failure described above. No timeout/cancellation policy is added or changed in this commit.
5. **Missing requirement case:** the batch requires failures from formatting/counting to receive the fixed, cause-dropping error, but does not state that a caught value itself can be hostile. That condition is necessary to make the stated boundary total and needs a regression test with a throwing `name` getter or Proxy trap.

## Scope and verification

Read in full: both files in commit `76b125fa0` and their diff from `c8c137611`; task context, task description, implementation plan, batch 12F contract, decisions #42/#45, the prior Phase 2 logic review, and the Phase 2 style review. `git diff --check c8c137611..76b125fa0` produced no whitespace finding. Ptah diagnostics did not return a scoped result: its TypeScript compiler remained unavailable after 45 seconds.

The one permitted targeted Jest attempt did not execute tests. The first command stopped before launch because this PowerShell environment has no `tail`; the single Jest launch with the documented external `marked` mapper then stopped while Jest parsed the CLI `moduleNameMapper` JSON. It was not rerun under the one-Jest-run rule. Batch 12F records a prior passing scoped suite, but this review has no new executable confirmation.
