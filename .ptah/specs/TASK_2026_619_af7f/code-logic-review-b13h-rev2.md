# Code logic review: TASK_2026_619 Batch 13h rev 2 (d84fe4c02)

Verdict: APPROVE (no blocking or serious items; four minor notes, none needs another round)

Scope: I read index-settle.ts in full. I read its spec in full. I also read the d84fe4c02 hunks in main.ts, retrieval-suite-kind.ts and scorecard-writers.spec.ts. I read `searchSymbol` and `pollUntil` (lifecycle-probe.ts:47-160), `classifyToolResult` and `hasUnknownReason` (call-recorder.ts:122-190) and `coverageOf` (lifecycle-na.ts:35). I ran nothing, as instructed.

## Open items

| ID | Status | Evidence |
|----|--------|----------|
| O1 renderer | FIXED, no new defect | retrieval-suite-kind.ts `indexSettleLine` has three branches: settled, aborted and timeout. The test at scorecard-writers.spec.ts:134-165 asserts all three strings. |
| O2 finished partial coverage | FIXED per the orchestrator rule, no new defect | index-settle.ts:138-160 |
| O3 tests | FIXED | index-settle.spec.ts:117-258 |
| O4 abort threshold and `unavailable` | FIXED, no new defect | index-settle.ts:9, 56-63, 168 |
| Minors | FIXED | m1, m2 and m3 are fixed. m4 is still present as a harmless note. |

## O1: renderer

- Settled: the line shows elapsed time, symbol count and coverage.
- Aborted: the line shows the kind and the approximate elapsed time. It uses the shared constant for the count, which is correct because an abort can only happen at exactly that count.
- Timeout: the line shows the constant and `lastState`.
- The `aborted` branch is checked only after `settled`, and the timeout line is the fall-through. A legacy scorecard with no `aborted` field renders as a timeout, which is correct.
- The schema enum gained `unavailable`, and the field stays `.optional()`.

## O2: settle rule

`isSettledProbe` (index-settle.ts:138-148) requires all of the following:
- `reindexInFlight:false`
- `symbolCount > 0`
- no `updating` in the coverage text
- `isNormalResult`

`isNormalResult` is true for non-errored results. It is also true for an `unknown-coverage` state whose coverage block does not contain `"census":"unknown"`.

- Census unknown still blocks. The test at spec:117-131 shows this: the first poll is rejected, the second settles at 5 s, and `states[0]` contains `unknown-coverage`.
- A persistent `?` reason settles. The test at spec:164-180 passes `census: 'complete'` with `failed?`, and settles at 0 ms.
- `stale` settles (spec:148-162). `updating` waits (spec:133-146). The wait is proved by the 5 s elapsed time.
- The coverage text is recorded in `indexSettle.coverage`.
- Every error class other than `unknown-coverage` is `errored`, so none of them settles. This matches the rule.

## O3 and O4

- The abort threshold is 6, as a named constant (index-settle.ts:9).
- The abort counter increments on `transport `, `rpc `, `tool-error` and `unavailable`. It resets on any other state, including `building` and an in-flight reply. Spec:218-258 covers both cases.
- Spec:182-216 runs four abort kinds with exactly 6 replies. It asserts the kind, the stable failure text, and an elapsed time of 25 s, which is 5 sleeps for 6 polls.
- Classification order is correct. `searchSymbol` goes through `classifyToolResult`: `isError` gives `tool-error`, then `building`, then `unavailable`, then unknown coverage. `unavailable` matches either the status or the text "index unavailable", so the state begins with `unavailable` and `retryableErrorKind` classifies it.
- Abort reason text is constant (index-settle.ts:90), so the gate's reason comparison does not flap between abort kinds. The kind is kept only in `details.indexSettle`.
- Failed runs are filtered out of the wait (index-settle.ts:108-113). They are skipped in the ask loop by `failure === undefined` (121-123). Spec:331-362 covers this: the ask callback throws if it is called for the pre-failed run, and its `indexSettle` is left undefined.
- Guard and voiding errors are still not caught anywhere. The test at spec:260-275 checks the rethrow.

## Polyglot no-probe

- main.ts:392-408 moves the check to after `selected.length === 0`.
- It records the reason in `problems`.
- It pushes `root: null` runs that carry `failure`. This mirrors the existing checkout-failure pattern, so the Phase 3 loop skips them (`polyRoot === null` continue).
- Only that corpus's suites fail. The bench is no longer aborted.

## Remaining items

Serious: none. Blocking: none.

Minor (none blocks):
- m1: main.ts:392-408 (the polyglot no-probe branch) has no test. It is a straight copy of the tested checkout-failure shape, so the risk is low.
- m2: retrieval-suite-kind.ts `indexSettleLine`.
  - The coverage string is inserted raw into a Markdown line. `coverageOf` returns up to 400 characters of the host's JSON. If the JSON is pretty-printed, the line will span several lines.
  - The abort line omits `lastState`.
  - Fix: pass `coverage` through the existing `cell` escape, or collapse the whitespace. This is cosmetic.
- m3: index-settle.ts:150-160 (`isNormalResult`).
  - `unknown-coverage` is also returned for a budget-cut or non-string `reasons` array (call-recorder.ts:165-175).
  - Such a reply settles if the census is not `unknown`. This follows the orchestrator rule ("persistent `?` does not block") but it is slightly wider than "a clean `?` reason".
  - The recorded coverage text makes it auditable.
- m4: `unavailable` aborts after about 30 s. If a host reports `unavailable` for longer than that while the indexer is still starting, a suite fails early. I did not verify that this happens. The previous review asked for the early abort, and the threshold of 6 is more tolerant than the old 3.

Residual: a persistent `parse:` state (an unparseable body under unknown coverage) is neither settled nor aborted, so it waits for the 1200 s timeout. This is fail-closed, and it is rare.

## Verdict

APPROVE. Confidence is HIGH on the logic and MEDIUM on host behaviour that I could not run. All four open items (O1 to O4) are fixed. Rev 2 introduced no new serious defect.
