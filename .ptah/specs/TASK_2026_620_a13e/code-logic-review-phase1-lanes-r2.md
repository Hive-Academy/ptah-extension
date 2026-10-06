# Code Logic Review, Phase 1 lanes, round 2 (TASK_2026_620_a13e)

Paths are relative to `tools/mcp-bench/src/memory-skills/`. Fix commits reviewed: 525db5bd5, 4c0db24f2, fe0ad8fff.

Check run: `jest tools/mcp-bench/src/memory-skills --runInBand` gives 28 suites and 354 tests, all passing (round 1 had 18 suites and 209 tests).

## Round-1 findings

| Id | Status | Evidence |
| --- | --- | --- |
| 1 falseMemoryRate value vs num/den | CLOSED | `metrics/curation-metrics.ts:62-68` now returns `value: num / den`, with `den === 0` giving null. |
| 2 mergeF1 null on a real zero | CLOSED | `metrics/curation-metrics.ts:108-113` gates on `den === 0` only. TP=0 with FP or FN above 0 gives 0. |
| 3 kappa category scale | CLOSED | `metrics/agreement-metrics.ts:288-292` uses the fixed `(a-b)^2/100` weight, and the expected-disagreement function at `:294-303` uses the same weight. |
| 4 long session leaves middle facts inside the clamp | CLOSED | `ground-truth/seeded-session-generator.ts:341-345` (`maxMiddlePlantings`, which gives 4). The authoritative real-`clampTranscript` check is `assertClampPlacement` at `:533-568`. It throws `MiddleFactSurvivesClampError` for a surviving middle fact and throws for a dropped head fact. The spec covers the cap and the throw (`seeded-session-generator.spec.ts:373`, `:493-503`). |
| 5 cassette re-record ignored | CLOSED | `doubles/cassette-store.ts:175-188` replaces the key's entry with a temp-file rewrite and rename. `:222-231` throws `CassetteDuplicateError` on a key with two different responses. |
| 6 bootstrap spec can't catch a wrong implementation | CLOSED | `metrics/bootstrap.spec.ts` now pins `[1.5, 3.5]` for `[1,2,3,4]`, asserts the interval contains the mean, and checks that a wider sample gives a wider interval. |
| 7 archivedThenNeededRate | CLOSED | `metrics/curation-metrics.ts:154-165`. The numerator needs `(deleted \|\| archived) && needed`, and the denominator is the needed (useful) cases. See N1 for a residual risk. |
| 8 failures recorded and replayed forever | CLOSED | `doubles/recorded-curator-llm.ts:161-167` refuses a stalled extraction. `doubles/recorded-lane-runner.ts:98-104` refuses a non-ok result. Both honour `recordFailures`. |
| 9 unchecked fault keys | CLOSED | `doubles/recorded-curator-llm.ts:125-137` (`assertAllFaultsHit`) and `:212-218` (`hitFaults`). It is an opt-in call, which is the helper round 1 recommended. |
| 10 window accounting omits the role prefix | CLOSED | The builder `chars` counts the full record (`seeded-session-generator.ts` TurnBuilder, `record.length`). `plannedWindows` is `ceil(transcript.length / CURATOR_WINDOW_CHARS)` and is no longer hard-coded. |
| 11 session id and PRNG streams | CLOSED | The session id carries the placement (`:451-456`). `contentRandom` and `factRandom` are placement-independent (`:432-442`). |
| 12 planting date validation | CLOSED | `:593-604` round-trips through `toISOString`. The spec covers `2026-02-31` (`spec.ts:540-545`). The stale barrel comment is replaced. |
| 13 matcher substring matching | CLOSED | `matching/fact-matcher.ts:36` returns false for empty `keyTokens`. `:42-47` uses `\b` word boundaries for alphanumeric tokens only, so there is no regex injection. Tokens containing punctuation still use `includes`. |
| 14 lexicographic timestamps | CLOSED | `baselines/read-side-baselines.ts:176-188` and `baselines/write-side-baselines.ts:130-143` validate the format and compare as `Date.parse` ms. No `<` or `>` comparison on timestamp strings remains in non-spec baselines. |
| 15 baselines import the barrel at runtime | CLOSED | `baselines/retention-policies.ts` now has no barrel import and takes `capEvictionGraceMs` in its settings. The barrel import is isolated in `baselines/retention-policy-defaults.ts:1-4`, and only the spec imports that file. |

## New findings

None at Blocking or Serious level. Three minor items:

1. Minor, `metrics/curation-metrics.ts:23` and `:155-165`. `RetentionCase.archived` is optional. A caller that omits it (an archived-only row) is silently undercounted. Make the field required, or have the caller set it explicitly.
2. Minor, `doubles/cassette-store.ts:176-188`. `record()` is a read-modify-write. Two processes recording into the same cassette can lose an update, and a crash between the write and the rename leaves a `.tmp` file behind. Single-process recording is synchronous and safe, so this only matters if recording is ever parallelised across processes.
3. Minor, `baselines/retention-policy-defaults.ts:1-4`. This file imports the memory-curator barrel at runtime. It is currently spec-only, so it does not break the rule. If the bench parent ever imports it, it falls under the same constraint as the open item below. Add a header comment saying it is spec/host-only.

## Open item (known, not counted)

`ground-truth/seeded-session-generator.ts:40-44` imports `clampTranscript`, `CURATOR_MAX_WINDOWS` and `CURATOR_TRANSCRIPT_MAX_CHARS` from the memory-curator barrel at runtime.

Recommendation: run generation inside the bench host, where the barrel and its `vscode` seam already load. That keeps the real-clamp assertion that makes finding 4 safe. The alternative is to move `assertClampPlacement` and the shared constants to the spec/host and keep the generator pure with hand-copied constants. That second option would bring back the drift risk the clamp check removed, so prefer the first. Either way, the generator must not be imported by the runner parent.

## Verdict

APPROVED. All 15 round-1 findings are closed, the scoped suite is green, and the three new items are minor.
