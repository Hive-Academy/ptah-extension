# Batch 21 code logic re-review, round 1

**Score: 7/10. Verdict: REVISE.** Both original gaps have code-level fixes, and the report correctly leaves the live results pending. One remaining path can still publish a failed call's duration as a valid cold inference sample. This is above the prior 5/10 because A2 now has direct assertions and the timer has moved to the suite's first inference attempt; it is below 9/10 because that sample is not required to have succeeded.

## Original findings

1. **Cold measurement — partially resolved.** `libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts:91-110,117-128,190-243` places the timer on the first `decide()` call in this file, before the probe and fixture calls. Jest runs these `it` blocks in declaration order within the file. The prior 438 ms value is now correctly marked as warmed and provisional in `routing-constants.ts:114-122` and `test-report.md:21-22,37`. The success-condition gap below still prevents treating every printed `coldMs` as an inference latency. A remote service may also already have the model warm before this suite starts; the measurement establishes only the first inference attempt **by this suite**.
2. **A2 raw-status evidence — resolved in code; live verification pending.** `system-one.live.spec.ts:159-187` uses `buildProbeUrls(CLOUD_BASE_URL)` and sends `POST`, `content-type: application/json`, `authorization: Bearer <key>`, and body `'{}'` to both route and control, exactly as `decision-model.prober.ts:65,72-75,94-104` does for endpoint mode. It asserts route 400/422 and control 404. It logs only `{route,control}` status numbers, not the key. Its per-request abort signals differ from the prober's shared signal, but the method, headers, body, and URLs match. `test-report.md:30-37` correctly keeps A2 and its Task 21.3 branch pending the user's rerun.

## New finding

1. **Moderate — `libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts:122-133,236-243`.** The first hosted-ID `decide()` result is timed and assigned to `coldMs` whether `outcome.ok` is true or false. The test asserts only `accepted[suffixed]`; if the hosted request fails but the suffixed request succeeds, the suite can pass and print the failed request's duration as a cold inference sample. That can silently select the wrong side of the 3000 ms calibration rule when the rerun is recorded. **Fix:** time the product's suffixed-ID call first and require that call to succeed before recording `coldMs`; alternatively, assert the first hosted call succeeded and fail the latency case when it did not. Keep the sample labelled as the suite's first call rather than proof of a cold remote worker.

## Logic questions and verification

1. **Silent failure:** `coldMs` can contain a failed hosted request's duration while A1 still passes (`system-one.live.spec.ts:122-133`).
2. **User action:** a user re-running U1 when the hosted alias fails can obtain passing tests and a misleading calibration sample from the same path (`system-one.live.spec.ts:122-133,236-243`).
3. **Wrong-answer input:** a failed first hosted-ID response, followed by a successful suffixed-ID response, makes the latency output look valid rather than becoming an error (`system-one.live.spec.ts:128-133,238-243`).
4. **Dependency failure:** a fetch rejection on the first request prevents `coldMs` assignment and fails that test; a handled provider/auth error produces an `outcome.ok === false` value and is currently recorded as a sample (`system-one.live.spec.ts:123-129`). The A2 direct fetch rejects on transport failure rather than reporting success (`system-one.live.spec.ts:172-187`).
5. **Missing requirement:** the plan's cold input has no stated way to ensure the remote worker itself was cold; this suite establishes the first inference attempt it made, subject to the success gap above (`implementation-plan.md:623-628`, `system-one.live.spec.ts:72,122-128`).

## Decisions and scope

- **Decision:** keep the 3000 ms remote constant provisional until the updated live spec is rerun. Options were to finalize from the old 438 ms sample or wait for the new first-call sample; `test-report.md:21-22,37` and the formula in `batches.md:1021-1024` support waiting. This is reversible.
- Read the complete changed live spec, probe and prober implementation, previous review, current test report, task requirements and Batch 21 plan. `git diff` confirms the constant changed only in its comment; the report is untracked. Scoped `ptah_get_diagnostics` returned zero errors and warnings. No tests or live calls were run here; the orchestrator reports lane-routing lint, typecheck, and tests passed, but the updated live measurements and A2 statuses remain pending.
