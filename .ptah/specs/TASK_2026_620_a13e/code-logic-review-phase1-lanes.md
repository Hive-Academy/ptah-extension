# Code Logic Review, Phase 1 lane-authored code (Batches 1-7) — TASK_2026_620_a13e

Worktree `task-620-memory-skills-bench`, commits 4733c7b21, 10abf8578, 346cfccc1, 9450ebd17, 817ee839e, 52755452e, a07178aa6. All paths below are relative to `tools/mcp-bench/src/memory-skills/` unless noted.

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Major | 6 |
| Minor | 9 |

Checks run: `jest tools/mcp-bench/src/memory-skills` gives 18 suites and 209 tests, all passing. `nx run-many -t typecheck,lint -p mcp-bench` passes. Both are green, so the findings below are all defects the specs do not exercise.

I also ran throwaway probes (outside the repo) to confirm the numeric findings. The probes ran each lane function against hand-computed values, ran the generator through the real `clampTranscript`, and diffed `buildFtsOrQuery` against `git show 51f235a1e:...fts-query.util.ts`.

## Findings

### Major

**1. `falseMemoryRate` violates `value === num/den` (R-M6), so the scorecard projection hash is unstable.**
- File: `metrics/curation-metrics.ts:60-67`. `value` is `1 - writtenBaits/baitCount` but `num` is `baitCount - writtenBaits`.
- Failure: floating-point error makes the two differ. Probed: `falseMemoryRate(7,10)` gives value 0.30000000000000004 against num/den 0.3, and `(9,10)` gives 0.09999999999999998 against 0.1. `mergeF1` carries a comment saying value must be exactly `num/den` for hash stability, and this function breaks that rule. The spec only checks `(1,4)`, which happens to be exact in binary.
- Required change: `value: den === 0 ? null : num / den`. Add a spec case with `(7,10)` that asserts `value === num/den`.

**2. `mergeF1` returns `null` for a real zero, hiding the worst outcome.**
- File: `metrics/curation-metrics.ts:109-113`. With `truePositive === 0` and `falsePositive` or `falseNegative` greater than 0, F1 is 0 (den > 0). The code returns `{value: null, num: 0, den: 3}`.
- Failure: a baseline that merges only wrong pairs is reported as "undefined" rather than 0. Probed: `mergePrecision` returns 0 for the same counts, so the two functions disagree. It also breaks `value === num/den`. The comment claims "precision + recall is 0", which makes F1 0, not undefined.
- Required change: `value: den === 0 ? null : num / den`.

**3. `quadraticWeightedKappa` builds its category scale from the values that happen to be observed, so ordinal distances are wrong.**
- File: `metrics/agreement-metrics.ts:135-146`. Categories are the union of observed scores, and the weight is the squared index gap divided by `(k-1)^2`.
- Failure: probed: scores {0,1,10} and scores {0,1,2} with the same disagreement pattern give the identical κ (0.3636), so a 1-to-10 disagreement costs the same as a 0-to-1 one. The scale also changes with whichever scores raters used for each criterion, so the per-criterion κ values are not comparable. Criteria are scored 0-10 integers (`label-schemas.ts:217`).
- Required change: weight by the actual value difference over the fixed scale (0..10, `(a-b)^2 / 100`). Compute the expected disagreement from the marginals over the same scale. Add a spec with a sparse-scale negative control.

**4. `generateLongSeededSession` permits fact placements the product clamp does not drop, so middle-window recall is contaminated.**
- File: `ground-truth/seeded-session-generator.ts:369` (`maxPlantings = 13 - 8 + 1 = 6`), with placement at `:395-399`.
- Failure: the clamp budget is 8 windows, 25% head and the rest tail, so it keeps window 1-2 and about window 8 onward. With 6 plantings, F-006 at window 9 is **kept** (probed: offset 263,824, `kept true`). Windows 4-7 are dropped. Design 3.1 expects about 0 middle-window recall, and a retained fact would silently score as recalled. The spec (`seeded-session-generator.spec.ts:284-345`) only plants 2 facts and the guard test (`:420-432`) only checks the count of 6.
- Required change: derive the cap from the clamp (at most 4 for n=13) or assert after generation that no fact survives `clampTranscript`, throwing otherwise. Add a spec that plants the maximum number and asserts every statement is dropped.

**5. Cassette re-recording is silently ignored: replay serves the stale entry.**
- File: `doubles/cassette-store.ts:127` (`appendFileSync`, no dedupe) together with `:161` (first entry wins).
- Failure: re-recording the same key after a model or prompt change appends a second line, and replay still returns the first response. The cassette set therefore reports the new model id in the newer entries while serving old behaviour. This is a silent wrong answer in the CI suites. No spec covers duplicate keys.
- Required change: in record mode, rewrite or replace the entry for an existing key. Alternatively make `load` fail on duplicate keys with different responses. Add a spec for the re-record case.

**6. The `bootstrap` spec cannot detect a wrong implementation.**
- File: `metrics/bootstrap.spec.ts:7-25`. It only checks that two runs agree, that empty input gives null, and that constant or constant-delta inputs give a degenerate interval.
- Failure: a PRNG that always returns 0, or off-by-one percentile indices, would pass every case. Nothing pins an interval for a non-degenerate sample, and nothing checks that the interval contains the mean or that a wider sample gives a wider interval. This is the module behind every R-M6 interval. I did confirm by probe that `cohenKappa`'s interval (0.68-0.90) matches an independent true bootstrap of κ (0.685-0.900), so the current code is probably right, but the spec would not catch a regression.
- Required change: pin the exact interval for `[1,2,3,4]` with the seed `TASK_2026_620` (a regression value), and assert `lo <= mean <= hi` plus an interval-width sanity check.

### Minor

**7. `archivedThenNeededRate` ignores whether the row was archived or deleted.**
- File: `metrics/curation-metrics.ts:153-158`. It counts every `neededAfterDeletion` case over all cases. Design 3.7 defines the metric as "useful rows archived on their question day".
- Failure: a needed row that was never deleted inflates the numerator, and non-deleted rows dilute the denominator. The spec (`curation-metrics.spec.ts:95-99`) locks that definition in (1 of 3).
- Required change: numerator `deleted && neededAfterDeletion`, denominator the useful rows. Confirm the intended denominator against 3.7 before changing.

**8. Cassette records provider failures and replays them forever.**
- Files: `doubles/recorded-curator-llm.ts:131-139` and `doubles/recorded-lane-runner.ts:~111`. A `stalled` extraction or a non-ok lane result is written as a normal entry.
- Failure: a transient `provider-unreachable` stall during recording becomes a permanent replayed response with no flag.
- Required change: refuse to record `stalled` and failure results unless they are explicitly requested.

**9. Cassette fault keys are unchecked.**
- File: `doubles/recorded-curator-llm.ts:345-348`. A fault configured for a key that is never called never fires, with no error.
- Failure: a liveness test that expects a failure passes vacuously on a typo or key drift.
- Required change: in `callCounts()` or a `dispose()`/assert helper, report any configured fault that was never hit.

**10. Generator window accounting omits the role prefix.**
- File: `ground-truth/seeded-session-generator.ts:705-708`. `chars` adds `text.length` but the transcript records are `"USER: " + text` or `"ASSISTANT: " + text`.
- Failure: window labels drift by about 8 characters per turn (a few thousand characters over a long session). `plannedWindows` is hard-coded to 13 (`:739`) while the transcript length gives `ceil` of 14 (probed). The turn-level `window` fields are therefore approximate. They are still inside their windows today by margin, but this is fragile.
- Required change: count the prefix, and compute `plannedWindows` from the transcript length.

**11. Generator session id and PRNG streams.**
- Files: `ground-truth/seeded-session-generator.ts:603-610` and `:391-393`. The session id depends only on seed, earliest fact id and date. Middle-placement and head-placement sessions of the same facts get the same id (and the same per-turn uuids), but different PRNG streams, because the placement is in the PRNG seed.
- Failure: if both variants are ever ingested together, the session ids collide. The head baseline also differs from the middle session in its filler text, so it is not a controlled comparison.
- Required change: include the placement in the id, and draw filler from a placement-independent stream.

**12. Planting date validation is vacuous for day overflow.**
- File: `ground-truth/seeded-session-generator.ts:469-475`. V8 accepts `2026-02-31T00:00:00.000Z` (probed: returns a valid timestamp, March 3). Only month 13 is rejected, yet the comment claims parity with the schema's round-trip check (`label-schemas.ts:18-22`).
- Required change: round-trip compare as `isCalendarDate` does. Also drop the stale claim that the barrel cannot load under Jest (`:41-45`); the spec itself imports it.

**13. Fact matcher uses bare substring matching.**
- File: `matching/fact-matcher.ts:41-43`. Probed: key `api` matches `capital`; forbidden `v1` matches `v10`. `keyTokens: []` matches every row, because `every` on an empty array is true. The schema forbids empty `keyTokens` (`label-schemas.ts:41`), but the matcher takes unvalidated input.
- Required change: use word-boundary matching where the token is alphanumeric, or document the substring semantics in the R-M4 text before the human-agreement gate runs. Treat an empty `keyTokens` as no match.

**14. Timestamp comparison is lexicographic with no format check.**
- File: `baselines/read-side-baselines.ts:121` (also `:163-165`, and `write-side-baselines.ts:179`). Mixed `...:00Z` and `...:00.000Z` or offset-bearing strings sort incorrectly ('Z' > '.').
- Required change: validate or normalise to `Date.parse` ms, or throw on a non-canonical ISO form.

**15. The baselines import the product barrel at runtime.**
- File: `baselines/retention-policies.ts:21-25` imports `DAY_MS`, `MEMORY_LIFECYCLE_DEFAULTS` and `RETENTION_CAP_EVICTION_GRACE_MS` from `@ptah-extension/memory-curator`, which loads the whole curator graph (tsyringe, persistence). This is non-test source that the bench parent will import.
- Required change: confirm it loads in the runner parent (no `reflect-metadata` or native-module side effects), or add narrower exports.

## Verified (no defect)

- **Pre-473 OR builder (B6)** is faithful. Pinned `51f235a1e`, and the body is byte-for-byte the pre-473 `escapeFtsQuery` (probed: identical output on 4 queries including NEAR/AND/apostrophe cases). The header citation is correct.
- **Age-only retention (B7)** matches `memory-lifecycle.service.ts:80-191` and `memory-lifecycle.store.ts:12-48` in run order (delete, archive, cap evict). The guards also match: strict `<` on archived_at and last_used_at, `pinned = 0`, `archival` and `recall` tier filters, core rows excluded from the cap, the grace cutoff, `last_used_at` ordering, `recallExcess` after archival eviction, and just-archived rows counted toward the cap. The unmodelled quarantine, corpus-link and budget guards are declared in the header. It uses `RETENTION_CAP_EVICTION_GRACE_MS`, the same value as the default `capEvictionGraceMs`.
- **Manifest**: missing, changed and unexpected files are all reported. Raw-byte hashing is safe because `.gitattributes` sets `eol=lf`. `canonicalJsonlHash` is exported but unused so far.
- **Label schemas**: `known-failure` requires `direction` and `toleranceReason`; the committed rubric row rejects `note` (strictObject) and recomputes total and pass. Merge-pair and update-case cross-field rules are present.
- **Record/replay**: replay mode refuses an `inner` adapter, so a miss can only be `CassetteMissError` and never a live call. Keys use sorted-key canonical JSON and `related` is sorted by id.
- **Committed fixtures**: no user data found. They use repository content, git citations and synthetic text (the `TASK_2026_318` id in D-001 is deliberate sediment bait).
- **Bootstrap determinism**: seeded FNV-1a plus Mulberry32, with no `Math.random` or clock.

## Verdict

REVISE. Items 1-6 are small, local fixes. Items 1, 2 and 3 corrupt reported numbers, 4 and 5 are silent wrong-answer paths in the CI suites, and 6 leaves the interval code untested. Item 7 needs a decision about the intended definition. Items 8-15 can be batched with the same pass or tracked as follow-ups.
