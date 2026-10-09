# Code logic review — 619 export adoption r2

## Verdict: APPROVED

Score: 8/10 (sound within this corrective-commit scope). The prior suite-result provenance-loss finding is closed with direct path-level rejection and focused tests. This is not 9–10 because the review is limited to the corrective boundary rather than a new end-to-end benchmark run, which was intentionally out of scope.

## Finding status

1. **CLOSED — Moderate: silently stripped nested suite-result fields.** `tools/mcp-bench/src/memory-skills/runner/suite-result.ts:173-182` now compares every key path in the submitted core object with the parsed shared-schema output and emits `unrecognized key: <path>` for a path the non-strict shared schema would otherwise discard. The old success-looking loss is therefore no longer possible at this file boundary. The regression tests cover nested `claim.reff`, `groundTruth.frozen`, `cost.tokens.billd`, and an array-item `baselines.0.lable` at `suite-result.spec.ts:116-148`.

## Boundary verification

- Arrays are traversed by index in `keyPaths` (`suite-result.ts:108-110`), and object paths are retained recursively at `:111-118`; the baseline-array test verifies the observable error path.
- Optional and nullable values are not falsely refused: absent/explicit `undefined` keys are skipped because JSON also drops them (`:112-115`), while `null` remains a key path and is retained by the parsed output. The valid-result test exercises optional `claim.text`, `groundTruth.raterCount`, `groundTruth.frozenAt`, `arm`, optional token metrics, nullable `tokens.output`, an array baseline, and record metrics/deltas (`suite-result.spec.ts:150-169`). Dynamic record keys remain valid because `z.record` preserves them in the shared schemas (`scorecard.types.ts:63-71`).
- `details` is correctly exempted only at the top-level (`suite-result.ts:101-117`): 619 deliberately declares it `z.unknown()` (`scorecard.types.ts:52-57`), then each registered suite kind validates it (`scorecard.types.ts:112-133`). The runner passes that payload through rather than pretending the shared core can decide suite-specific keys; the valid free-form details test proves no false refusal (`suite-result.spec.ts:151-153`).
- The runner-set `cost.source` remains explicitly rejected before placeholder insertion (`suite-result.ts:153-165`), so the comparison does not convert a forbidden caller value into an allowed one.

## New findings

None in the corrective commit.

## Five logic questions

1. **Silent failure:** closed; unknown nested keys now fail parsing with their complete path (`suite-result.ts:173-182`).
2. **Unexpected user action:** a host/suite artifact containing a misspelled nested optional field now receives a clear validation failure rather than a modified result.
3. **Wrong-answer input:** nullable values, optional fields, record keys, and baseline array entries survive the comparison when schema-valid; the valid-result coverage demonstrates this (`suite-result.spec.ts:150-169`).
4. **Dependency failure/timeout/bad shape:** no launch/dependency behavior changed in this commit; malformed suite-result shapes are rejected before a scorecard can be assembled (`suite-result.ts:166-182`).
5. **Missing requirement:** no remaining gap identified for the previously reported nested-key contract; suite-kind-owned `details` correctly remains outside the shared-core boundary.

## Tests

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/runner --runInBand` — 7 suites passed, 70 tests passed, exit 0. Scoped TypeScript diagnostics for the two changed files: 0 errors, 0 warnings.

## Scope

Reviewed `f94a9bdd4`, its complete changed runner source and spec, and the shared scorecard schema contract. No source was edited and no benchmark host, real benchmark, Electron, or workspace-wide check was run.
