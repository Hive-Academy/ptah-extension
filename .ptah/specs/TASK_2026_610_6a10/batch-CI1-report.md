# Batch CI1 report

## Changes

- `libs/shared/src/lib/utils/test-command-matcher.ts:251` and `:258` — removed the catch-and-return-false blocks from `classifyTestCommand` and `hasMaskedTestCommandOutcome`, retaining the non-string guard. `splitSegments`, `tokenize`, and `matchesSegment` operate only on strings and do not throw for malformed shell syntax.
- `scripts/generate-host-source-registry-baseline.ts:11` — added the explicit UTF-16 code-unit comparator `a < b ? -1 : a > b ? 1 : 0` for both registry sorts.
- `scripts/eager-closure-gate.js:30,61,85,104` — added and used the same explicit comparator at all three sort sites.
- `libs/shared/src/mcp-apps-contracts/ptah-ui-fence.ts:17` — converted the outer line scan to a `while` loop and advanced `index` explicitly. A consumed closing fence advances to `closeIndex + 1`.
- `libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts:318` — replaced `charCodeAt` with `codePointAt(index) ?? 0`. The compared values are ASCII controls (`<= 0x1f` and `0x7f`); astral code points remain non-controls, so the result is unchanged. The fallback satisfies TypeScript; loop indices are always in bounds.

## Commands and observed results

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=1` — exit 0. Shared test/lint/typecheck all succeeded (the successful rerun used cached test and lint outputs).
- `npx nx test @ptah-extension/shared '--testPathPatterns=ptah-ui-(fence|pipeline|parser|compactness|converter|resolver).spec.ts' --runInBand` — exit 0; 6 suites, 134 tests passed.
- `npx nx test @ptah-extension/shared --testPathPatterns=host-source-registry.contract.spec.ts --runInBand` — exit 0; 1 suite, 5 tests passed.
- `npx nx test ptah-electron --testPathPatterns=eager-closure-gate.spec.ts --runInBand` — exit 0; 1 suite, 6 tests passed. `scripts/eager-closure-gate.js` has no `--self-test` option in its usage/header, so no self-test command was run.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` — exit 0; `libs/shared/src: 3 ok (baseline 3)` and total 294 unsuppressed sites.
- `npx prettier --write` was run on all five changed source/script files, followed by `npx prettier --list-different` on those files — exit 0 with no output.
- `git diff --check` — exit 0.

## Registry baseline observation

`npx tsx scripts/generate-host-source-registry-baseline.ts` was run as specified. After repository formatting, it would add six existing unrelated registry names (`session:budgetAction`, four `skillSynthesis` names, and `wizard:preview-generation`) to `host-source-registry.baseline.ts`. That generated diff is not caused by the comparator change, and the task explicitly prohibits changing the committed baseline contract. I restored the baseline unchanged. The final `git diff --name-only` does not list `host-source-registry.baseline.ts`.
