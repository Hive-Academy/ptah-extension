# Code logic review: TASK_2026_619 Batch 13h (a2b67e457)

Verdict: REVISE

Scope: I read index-settle.ts and its spec in full. I also read pollUntil, searchSymbol and indexAgeScenario in lifecycle-probe.ts, the main.ts diff and the askSuites/runBench regions, the retrieval-suite-kind.ts diff, the suite-runner.ts assemble path, gate/baseline.ts verdictReasons and recordedResult, and the product's checkFreshness in code-namespace.builder.ts. I did not run the tests, per the instructions.

## CRITICAL

None.

## SERIOUS

### S1. Settle accepts any reply that says `reindexInFlight:false`, whatever it shows about coverage or symbol count
- Evidence: index-settle.ts:44. The predicate is only a regex on the raw text. searchSymbol (lifecycle-probe.ts:57-79, 89-92) returns `text` for `unknown-coverage` replies and for every error class, and it does so with `errored: true`. The predicate ignores `errored`, `underUnknownCoverage`, `symbolCount` and `coverage`.
- Scenario: the product's checkFreshness (code-namespace.builder.ts:314-329) starts a reindex only when freshness is stale and `!startedWithinThreshold`. If a boot or earlier reindex failed, or ended before the first poll, `startedWithinThreshold` blocks a restart. The reply then carries `reindexInFlight:false`, `symbolCount` null or 0 and coverage `unknown`. The bench logs "settled after 0 s (unknown symbols)" and scores 40 questions on an empty or partial index. That is the same hit@5 = 0 defect the batch was meant to remove, now shown as `settled: true` in the scorecard.
- The first poll runs with no delay after host start. The product mostly avoids the cold-start false settle: a stale or empty index starts a run, and `runIsActive` is read after that start. The bench still does not verify this. An index that was never started, or a start failure, goes through undetected.
- Fix: require `!probe.errored` or `underUnknownCoverage === false`, `symbolCount` greater than 0, and coverage that is neither unknown nor `updating`. Treat an unsettled-but-idle reply (`reindexInFlight:false` with `symbolCount` of 0 or null) as "not settled, keep polling". The timeout message should then say what was actually seen. The spec should also cover the first-poll case of `false` with `symbolCount` 0 and unknown coverage.

### S2. Transport failure or error replies during the wait are swallowed and reported as "reindexInFlight still true"
- Evidence: lifecycle-probe.ts:57-65 turns every non-result outcome into `text: ''`, so the regex never matches. pollUntil keeps polling for the full 20 minutes (lifecycle-probe.ts:141-143). index-settle.ts:64 then hardcodes the failure text "reindexInFlight still true". `symbolCountOf` returns null, `coverage` is "none in the answer", and `states` holds the transport state.
- Scenario: the host crashes or the connection resets right after start. The bench waits 20 minutes, then records the suite as failed with a reason that blames indexing and hides the transport error. The same applies to a persistent tool-error class (for example `index unavailable`). In recorded-failure gate mode the recorded reason text is misleading.
- No settled-on-error path exists, which is good. But the reason is wrong, and there is no early abort when the transport or the tool is down.
- Fix: track the last probe state. Fail fast after N consecutive transport errors, or at least build the failure text from `settled.states` and say "never saw a reindexInFlight:false reply, last state X".

### S3. The failure text contains a run-varying `symbolCount`, which breaks the recorded-failure gate comparison
- Evidence: index-settle.ts:64 embeds `symbolCount ${measurement.symbolCount ?? 'unknown'}`. gate/baseline.ts:137-147 (`verdictReasons`) and the comparison at baseline.ts:~186-195 use exact JSON equality of the `(verdict)` reasons. The suite-runner pushes `options.failure` verbatim as the verdict reason (suite-runner.ts:595-596).
- Scenario: a baseline is recorded with a timeout at symbolCount 4120. The next timeout run sees 4377. The gate reports `changed: unscored with a different reason` for a suite that failed identically for the same cause. That flaps in recorded-failure mode and makes a new baseline necessary on every run. Claim mode is unaffected, because it fails either way.
- Fix: keep the reason text stable, for example "did not settle within 1200 s". Put the count only in `details.indexSettle`, which already carries it.

## MODERATE

### M1. The settle failure overwrites an existing `run.failure`
- Evidence: index-settle.ts:88 uses `run.failure = ...`, while main.ts:537 uses `??=`. main.ts:481 seeds `failure: nativeFailures.get(definition.id)` before askSuites.
- Scenario: the native baseline had already failed, so the index suite carried a native-failure reason. On a settle timeout that reason is lost. When the settle succeeds, the native failure is kept. When it does not, the root cause is hidden.
- Fix: use `??=`, or join both reasons.

### M2. A 20-minute wait runs even when the suite already has a failure or an `na`
- Evidence: index-settle.ts:81-84 filters only on tool name. It ignores `run.failure`, and it ignores `definition.naReason` (suite-runner.ts:585).
- Scenario: a run whose index suite already has a failure, or is `na`, still polls and can stall for 20 minutes before skipping. Also, `indexRuns.length > 0` waits once per call, so a run list with no index suite has no wait (verified). Per-host wait is correct only because `askAfterIndexSettle` is called once per host.

### M3. The settled measurement is shared and the settle probe is repeated on the polyglot hosts with a main-corpus symbol
- Evidence: main.ts:546-549 passes `probe.name` and the main-corpus `probe.location` to the Python and Go hosts.
- Scenario: the symbol cannot exist in those corpora. This is harmless to the settle itself, because the predicate checks only `reindexInFlight`. But it means S1 is worse there: an empty, failed index looks the same as a fine one, and `found` is never usable as a correctness signal. The wiring is otherwise correct. Both hosts go through `askSuites`, and the timeout path sets `run.failure` on `poly.runs`, which main.ts:619 and :620 then record.

### M4. Hardcoded "1200 s" in the Markdown line duplicates `CODE_INDEX_SETTLE_TIMEOUT_MS`
- Evidence: retrieval-suite-kind.ts:83 hardcodes the limit. If the constant changes, the line goes stale. The unsettled line also drops the `symbolCount` that is already in the details.

### M5. Spec does not prove the claims
- Evidence: index-settle.spec.ts has three tests: true then false, the timeout with all-true replies, and no poll for non-index suites. They cover none of the following:
  - the first reply being `reindexInFlight:false` with `symbolCount` 0 or unknown coverage (S1);
  - a transport error or error-class reply during the wait (S2);
  - a tool not listed. The listed gate at index-settle.ts:84 is untested; the "no poll" test passes only because no index run is selected;
  - a rethrow of a guard error or a non-ToolResultParseError from the poll, which is not asserted;
  - the settle time being kept out of latency. It is out of the CallRecorder by construction, because the raw caller is used, but nothing asserts it;
  - an old scorecard parsing without `indexSettle`. I did not read the new scorecard-writers.spec case for it.
- Also, the 99-symbol timeout case leaves coverage `clean`, which hides S1.

## MINOR

- main.ts:251-257 builds the caller with `host.callerFor(corpusRoot)` every call. That is fine, and the client is cached.
- The timeout path elapsed value is exactly 1200000 only with the fake clock. The spec's `toMatchObject({elapsedMs: CODE_INDEX_SETTLE_TIMEOUT_MS})` encodes that. With a real clock it is 1195 to 1200 s plus call latency.
- `suiteRecord` adds `indexSettle` to the main record and to the breakdown subset records alike (suite-runner.ts:~652). That is harmless but repeated.

## Checks that held

- Guard and voiding errors: `askAfterIndexSettle` does not catch. A thrown error propagates up through `askSuites` inside `runThenStop`, as before. The new code adds no catch.
- Settle time versus latency: the settle polls use the raw caller, not CallRecorder, so they are not counted in query latency.
- Tool not listed: the wait is skipped (index-settle.ts:84). The suite fails through the existing "tool not exposed" reason.
- Non-index suites: they are asked as before, without a wait. The timed-out index suite is skipped, with `tools` left null and `failure` set. `assembleSuite` reports the failure as a verdict reason and records `indexSettle`.
- Claim mode: a failed verdict with an unscored suite fails the row, which is the intent.
- Old scorecards: `indexSettle` is `.optional()` in the schema, and the renderer guards `undefined`.
