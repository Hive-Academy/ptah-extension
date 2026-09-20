# Track A Merge Spec Gaps

## Specs added

1. `applies custom per-subject and total limits at the same time`
   - Pins that `perSubjectLimit = 2` removes the third high-ranking row from one subject while `totalLimit = 3` simultaneously truncates the four rows still eligible across both subjects.
2. `returns exactly the five highest-ranked rows for one subject in rank order`
   - Pins that the default per-subject cap returns the best five of seven rows, in descending rank order, rather than any five matches.
3. `breaks identical rank-score ties by id descending`
   - Pins the deterministic `id DESC` tie-break by expecting `zzz` before `aaa` when every ranking input is identical.
4. `trims surrounding whitespace from an input subject before matching`
   - Pins that the input `  padded-subject  ` matches a stored subject of `padded-subject`.

## Ranking derivation for gap 2

The fixture sets `hits = 0` and `pinned = 0` through the existing `seed(...)` defaults, so the hit and pin terms contribute zero. From `salience-ranking.ts`, with half-life `H = 604,800,000 ms`, the remaining expression is:

```text
rank = salience * H / (H + age)
```

Let `δ` be the few milliseconds between capturing the fixture's `now` and the query's `Date.now()`. The derived order is:

| Order | ID       | Salience |    Age | Score expression  | Nominal score at δ = 0 |
| ----- | -------- | -------: | -----: | ----------------- | ---------------------: |
| 1     | `rank-1` |      1.0 |      δ | `1.0H / (H + δ)`  |                   1.00 |
| 2     | `rank-2` |      0.9 |      δ | `0.9H / (H + δ)`  |                   0.90 |
| 3     | `rank-3` |      1.0 |  H + δ | `1.0H / (2H + δ)` |                   0.50 |
| 4     | `rank-4` |      0.8 |  H + δ | `0.8H / (2H + δ)` |                   0.40 |
| 5     | `rank-5` |      0.9 | 2H + δ | `0.9H / (3H + δ)` |                   0.30 |
| 6     | `rank-6` |      0.5 |  H + δ | `0.5H / (2H + δ)` |                   0.25 |
| 7     | `rank-7` |      0.6 | 2H + δ | `0.6H / (3H + δ)` |                   0.20 |

Therefore the asserted capped result is exactly `rank-1`, `rank-2`, `rank-3`, `rank-4`, `rank-5`. The score gaps are much larger than the millisecond-scale `δ`, and the fifth-versus-sixth inequality remains ordered for every non-negative `δ`.

## Verification

- Command: `npx nx test @ptah-extension/memory-curator --skip-nx-cache`
- Before: 42 suites passed, 721 tests passed.
- After: 42 suites passed, 725 tests passed.
- Added specs: 4 passed, 0 failed.

Verbatim output tail:

```text
(node:29776) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
Test Suites: 42 passed, 42 total
Tests:       725 passed, 725 total
Snapshots:   0 total
Time:        32.511 s, estimated 43 s
Ran all test suites.
```

## Surprises

All four promised behaviours matched the current implementation. No production-code defect was found, and no production file was edited.

Jest reported that a worker failed to exit gracefully and was force-exited after the suite passed. This warning does not identify an added-spec failure and did not change the successful exit code or totals, but it indicates an existing teardown/open-handle issue worth investigating separately.
