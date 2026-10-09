# Phase 1 revise — metrics, matcher, and baselines

Scope: `tools/mcp-bench/src/memory-skills/{metrics,matching,baselines}` only.

## Findings addressed

| Finding | Change and location | New regression coverage |
| --- | --- | --- |
| 1 | `falseMemoryRate` now derives `value` directly from its integer `num / den`, preserving exact projection-hash semantics. `metrics/curation-metrics.ts:61` | `(7, 10)` asserts exact `value === num / den` at `metrics/curation-metrics.spec.ts:32`. |
| 2 | `mergeF1` returns `0` when TP is zero but its denominator is positive; only zero denominators return `null`. `metrics/curation-metrics.ts:110` | `(TP: 0, FP: 2, FN: 1)` asserts `{ value: 0, num: 0, den: 3 }` and exact ratio semantics at `metrics/curation-metrics.spec.ts:77`. |
| 3 | Quadratic kappa now uses actual fixed-scale 0..10 distance, `(a - b)^2 / 100`, for observed and marginal expected disagreement. `metrics/agreement-metrics.ts:122`, `:288` | The hand calculation comment now reflects fixed-scale values, and `{0,1,10}` vs `{0,1,2}` cannot compress to the same kappa at `metrics/agreement-metrics.spec.ts:19`, `:39`. |
| 6 | Bootstrap has a pinned non-degenerate seeded interval, mean containment, and interval-width control. `metrics/bootstrap.spec.ts:12` | `[1,2,3,4]`, seed `TASK_2026_620`, pins `[1.5,3.5]`; `[0,0,0,8]` must be wider. |
| 7 | `archivedThenNeededRate` now counts only useful rows that were deleted or archived, over all useful rows. The implementation quotes benchmark design §3.7. `metrics/curation-metrics.ts:154` | Retention matrix includes active-useful and archived-useful rows and asserts `2 / 3` at `metrics/curation-metrics.spec.ts:98`. |
| 13 | Alphanumeric tokens use Unicode word boundaries; blank key-token groups never match. `matching/fact-matcher.ts:25` | `api` does not match `capital`, forbidden `v1` does not match `v10`, and empty keys fail at `matching/fact-matcher.spec.ts:39`. |
| 14 | Read-side grep and write-side latest-wins normalise ISO timestamps with `Date.parse` milliseconds and reject invalid/non-ISO strings. `baselines/read-side-baselines.ts:121`, `:174`; `baselines/write-side-baselines.ts:121`, `:131` | Mixed `Z`/millisecond spellings order by time and invalid values throw in `baselines/read-side-baselines.spec.ts:113`, `:125`, `:178` and `baselines/write-side-baselines.spec.ts:134`. |
| 15 | Pure policies no longer import the memory-curator barrel. They require a complete settings object, including grace duration. Product-derived defaults live solely in `baselines/retention-policy-defaults.ts:9`, which specs/host can import. `baselines/retention-policies.ts:109` | B7 continues to prove every supplied default (including grace) equals the product constants at `baselines/retention-policies.spec.ts:49`. |

## Verification

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/metrics tools/mcp-bench/src/memory-skills/matching tools/mcp-bench/src/memory-skills/baselines --runInBand` — `Test Suites: 8 passed, 8 total`; `Tests: 77 passed, 77 total`.
- `npx eslint <changed files>` — `0 errors`.
- `npx nx run-many -t typecheck -p mcp-bench` — exit 0.
- `npx prettier --check --ignore-unknown <changed files>` — `All matched files use Prettier code style!`.
- Scoped diagnostics — no diagnostics in requested files. It reported two unrelated existing sibling diagnostics: `projection.spec.ts:244` and `runner/net-recorder.ts:437`.
