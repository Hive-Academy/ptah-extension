# Code logic review: TASK_2026_619 Batch 13h rev 1 (d1fd8e9f4)

Verdict: REVISE (small, targeted; no blocking or serious defects remain)

Scope: I read index-settle.ts and its spec in full. I also read pollUntil and searchSymbol in lifecycle-probe.ts, classifyToolResult in call-recorder.ts, the main.ts askSuites and polyglot hunks, retrieval-suite-kind.ts, the gate and scorecard spec additions, and the coverage vocabulary in language-coverage.interface.ts. I ran nothing, as instructed.

## Finding status

| ID | Status | Note |
|----|--------|------|
| S1 false settle | FIXED | One residual risk and one untested branch (O2, O3) |
| S2 transport errors | PARTIAL | Transport and rpc abort early. The persistent `unavailable` class does not. The renderer mislabels an abort (O1, O4) |
| S3 stable text, gate-unchanged | FIXED | Minor flap between abort kinds (m1) |
| M1 `??=` | FIXED | |
| M2 skip failed or na runs | FIXED | Those runs are still asked, as before (m2) |
| M3 polyglot probe | FIXED | Probe is built from the host's own corpus; the throw is placed early (m3) |
| M4 timeout constant | PARTIAL | The unsettled line is wrong for an aborted wait (O1) |
| M5 tests | PARTIAL | Several claimed behaviours have no test (O3) |

## S1: FIXED

- index-settle.ts:`isSettledProbe` requires `!probe.errored`, `!probe.underUnknownCoverage`, `"reindexInFlight":false`, `symbolCount > 0`, and no `updating` or `stale` in the coverage text.
- The predicate reuses the existing logic. `searchSymbol` (lifecycle-probe.ts:57-92) derives `errored` from `classifyToolResult`, whose `unknown-coverage` class comes from `UNKNOWN_CENSUS` and `hasUnknownReason` (call-recorder.ts:148-156). `errored` is `true` for `unknown-coverage` (probe.ts:~84), so `!errored` already excludes unknown coverage.
- `!underUnknownCoverage` is redundant. It is `unknown && found`, a subset of `errored`. This is harmless, but it makes the predicate look as if it handles two cases when it handles one.
- No unknown-coverage logic is duplicated. The `updating|stale` regex is new, and it is correct against the real vocabulary: `COVERAGE_REASONS` contains `updating`, and `stale` is the `incomplete` state (language-coverage.interface.ts:211, 308-309).
- `updating` and `stale` treatment:
  - `updating` is transient, so waiting on it is right.
  - `stale` means `state: 'incomplete'`, which can be the permanent end state of a finished run (the last run was partial). Requiring it to clear means such an index never settles. The suite fails after 20 minutes with "did not settle", even though the reindex is done. That is fail-closed and gate-stable, but it is a possible false failure (O2). The `incomplete` case has not been shown to arise on the bench corpora, so I have not confirmed it.
- Any reason ending in `?` is also treated as unknown by `hasUnknownReason`. If a finished index keeps a persistent `unchecked?` or `failed?` reason, it will also time out. This is the same fail-closed behaviour.
- The first-poll false settle (reply with `reindexInFlight:false` and 0 symbols) is now rejected. Evidence: the spec test "does not settle on an idle empty index" (spec:~77).

## S2: PARTIAL

Fixed:
- `pollUntil` takes an `abort` callback (probe.ts:~118-140). After three consecutive `transport `, `rpc ` or `tool-error` states, `index-settle.ts` stops the wait and records `aborted` and `abortKind`.
- `tool-error` is live. `classifyToolResult` returns `tool-error` when `isError` is true, and `searchSymbol` puts that class in `state`. lifecycle-probe.spec.ts:173 confirms it.
- `building` correctly does not count as an error.
- Guard and voiding errors are not caught anywhere on this path. `searchSymbol` catches only `ToolResultParseError`, `pollUntil` has no catch, and `askAfterIndexSettle` has no catch. The spec test "rethrows a guard error" asserts `rejects.toBe(guard)` (spec:~165). This holds.

Open:
- `unavailable` (for example "index unavailable", with the indexer not registered) is not in `retryableErrorKind` (index-settle.ts:`retryableErrorKind`). A permanent unavailable reply still polls for 20 minutes, and the failure text is the generic timeout. This is the error class my previous review named. See O4.
- Three strikes at a 5 s poll interval is an abort after about 10 s of real time, plus call latency. A host that is busy during the reindex and returns repeated RPC errors, such as a busy or lock error, will be aborted early. I could not verify that those errors occur in practice. Moderate.
- The abort text says "repeated transport errors (rpc)" or "(tool-error)". The label is inaccurate for non-transport kinds. Minor.

## S3: FIXED

- `indexSettleFailure` returns a constant string for a timeout, and a string that varies only with `abortKind` for an abort. `symbolCount` is no longer in the reason; it is kept only in `details.indexSettle`.
- Test strength: baseline.spec.ts:~210 feeds the same literal reason to both the baseline and the run. That proves only that the gate treats equal strings as equal. The production string's stability is covered by index-settle.spec.ts, which asserts the exact timeout string. Together they are adequate.
- A timeout and an abort give different reasons, and the abort reason varies with `abortKind`. A recorded-failure baseline can therefore flap between "changed" outcomes for the same root cause (m1).

## M1 to M4

- M1: FIXED. index-settle.ts:`run.failure ??=`. The spec test "preserves an existing failure" asserts it.
- M2: FIXED. The wait filters on `failure === undefined` and `naReason === undefined`.
- M3: FIXED. main.ts builds `polyProbe` from `set.references.questions[0]`. The reference schema's `query` is the symbol name and `file` is its declaration file (question-sets.ts:65-72), so the probe is a real symbol of that corpus.
  - The `throw` for an empty reference set runs before `selectSuites`. A corpus whose suites are all filtered out, or a corpus with no reference questions, now aborts the whole bench, where the code previously used `continue`. See m3.
- M4: PARTIAL. See O1.

## Open items

- O1 (Moderate): retrieval-suite-kind.ts:~84. The unsettled branch always renders "Index did not settle within 1200 s; symbol-suite scoring was skipped". An aborted wait took about 10 s, so the report is wrong. The renderer ignores `aborted`, `abortKind` and `lastState`, although the report says the variable diagnostics remain in the Markdown. Fix: branch on `aborted` and show `abortKind` and `lastState`.
- O2 (Moderate, unconfirmed): a finished index with persistent `incomplete` (`stale`) coverage, or a persistent `?` reason, can never settle. A bounded rule is better: once `reindexInFlight:false`, `symbolCount > 0` and the coverage is not `updating` for N consecutive polls, settle, and record the coverage that was seen. Failing that, document the choice.
- O3 (Moderate, tests): these claimed behaviours have no test.
  - Coverage `updating`, or `stale` / `incomplete` (the predicate branch at index-settle.ts:`!/\b(?:updating|stale)\b/`).
  - `rpc` and `tool-error` aborts.
  - The consecutive counter resetting after a non-error reply, so an intermittent error never aborts.
  - Aborting on `building`, which must not abort.
  - A settle that is not recorded in latency.
  - The "unknown coverage" test (spec:~92) uses `census: 'unknown'` with `reasons: ['coverage?']`. It would pass for the wrong reason if the classifier did not flag it. It is probably correct (`UNKNOWN_CENSUS` or `hasUnknownReason`), but the test does not assert that the first poll was rejected for coverage rather than for any other reason.
- O4 (Minor to Moderate): `unavailable` and other permanent classes do not abort early (see S2).

## Minor

- m1: the failure text varies with `abortKind` (S3).
- m2: `askAfterIndexSettle` still asks runs that already have a `failure` or an `naReason`, because only `indexSettle?.settled === false` skips. A failed run that is excluded from `indexRuns` is asked against an index that may be unsettled, or may have timed out. The result is wasted work only, because the failure is already set. A failed run also carries no `indexSettle` record.
- m3: move the polyglot "no reference probe" throw to after `selected.length === 0`, or turn it into a skip with a log.
- m4: `!probe.underUnknownCoverage` is redundant with `!probe.errored`.

## Checks that held

- The guard and voiding errors still rethrow, with no new catch. The spec test also covers the rethrow.
- The settle poll uses the raw caller, so its time is outside the latency measurements.
- The unlisted tool path skips the wait. A test covers it (spec:~230, asserts `indexSettle` undefined).
- Legacy scorecards: `aborted`, `abortKind` and `lastState` are all `.optional()` in the schema (retrieval-suite-kind.ts:~35-42).
- The `indexSettle` removal from breakdown subset records in suite-runner.ts:652 is safe, because the renderer reads it only from main records.

## Verdict

REVISE. The core defects (S1, S3) are genuinely fixed and the rethrow behaviour held. S2 is mostly fixed. O1 is a misleading scorecard line for an aborted wait, and it is a one-line fix. O3 adds the missing tests for the new predicate branches and abort kinds. O2 and O4 can be fixed or recorded as accepted limits.
