# Batch 21 code logic re-review, round 2

**Score: 8/10. Verdict: APPROVED.** The remaining code defect is fixed. This is above 7/10 because a failed first call can no longer yield a passing latency result; it is below 9/10 because the updated keyed live run has not yet measured the first-call latency or A2 statuses.

## Finding status

1. **Resolved — failed first inference counted as `coldMs`.** `libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts:125-135` records the duration only when the first call returns `outcome.ok`. If it fails, `:242-253` prints `coldMs: null` and throws, so a passing run cannot supply the failed call's duration to the timeout formula. The first inference attempt remains before the probe and fixture calls (`:120-139,141-200`). The comment at `libs/backend/lane-routing/src/lib/routing-constants.ts:114-123` and the pending wording at `.ptah/specs/TASK_2026_684_a11d/test-report.md:21-22,37` correctly distinguish this suite's first call from proof that the remote worker was cold.

## New findings

None in the changed code or report. The pending user rerun is still required before finalizing the cold half of the timeout rule or A2's Task 21.3 decision (`test-report.md:21-22,31,35-37`).

## Logic checks and verification

1. **Silent failure:** a failed first call leaves `coldMs` undefined and forces a test failure after the latency line (`system-one.live.spec.ts:132-135,244-253`).
2. **User action:** running the live suite with a hosted-ID failure can no longer produce an all-pass calibration result, even if the suffixed ID succeeds (`system-one.live.spec.ts:125-138,251-253`).
3. **Wrong-answer input:** the failed hosted-ID outcome is excluded from the cold sample; the fixture results still have their own `wrong` and `invalid` assertions (`system-one.live.spec.ts:132-135,255-256`).
4. **Dependency failure:** a rejected first `decide()` call fails the ID test; a handled error leaves a null cold sample and fails the latency test (`system-one.live.spec.ts:125-135,244-253`).
5. **Unspecified case:** a remote model may already be warm when the suite begins. The source and report now state the measurement's actual scope (`system-one.live.spec.ts:72-76`; `test-report.md:21,37`).

Read the complete changed live spec in the prior round and inspected this round's full diff, the original finding, updated report, and affected code paths. Scoped `ptah_get_diagnostics` found zero errors or warnings. The orchestrator reports lane-routing lint, typecheck, and tests passing. No tests or live calls were run in this review.
