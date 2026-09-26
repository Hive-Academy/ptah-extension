# Code Logic Review — Batch 20 (Tasks 20.1 + 20.3, "20a") — r3

Cross-side reviewer (Claude), re-reviewing after Revision Round 2 (`batch-20a-executor-report.md` §10, "r2 REVISE 8/10"). This is the last normal round before a bounded correction + post-cap review.

## Summary

| Metric              | Value |
| ------------------- | ----- |
| Overall score       | 9/10 |
| Assessment          | APPROVED |
| Blocking issues     | 0 |
| Serious issues      | 0 |
| Moderate issues     | 0 |
| Minor issues        | 1 (carried, non-blocking) |
| Failure modes found | 0 new |

## r2 findings status

| r2 finding | Fix claimed | Verified | Status |
| --- | --- | --- | --- |
| Nx-flagged flaky `workspace-intelligence:test` (1 fail / 5 pass across earlier runs) | Root-cause: 4 full on-disk fixture builds (500+ writes each) in one spec file competing for I/O under load. Fix: extract `generateMcpContractFixturePlan()` (pure, zero disk I/O) from `createMcpContractFixture()`; write to disk **once** via `beforeAll`/`afterAll`; determinism and seed-sensitivity specs now diff in-memory plans; cleanup spec uses a separate minimal (`flatFileCount:0`) fixture so it doesn't disturb the shared one's lifecycle | YES — read `fixture-workspace.ts` in full (729 lines): `generateMcpContractFixturePlan` (`:283-680`) contains no `fs.*` calls anywhere in its body, confirmed by inspection — `write()` (`:296-300`) only pushes to an in-memory `files` array. `createMcpContractFixture` (`:695-728`) is the only function touching `fs`, and it now calls the plan once and writes with a `createdDirs` cache to skip redundant `mkdirSync`. `fixture-workspace.spec.ts` confirmed: single `beforeAll`/`afterAll` (`:27-33`) builds/cleans the shared `fixture` once; determinism spec (`:89-122`) and seed-sensitivity spec (`:124-137`) call `generateMcpContractFixturePlan` directly with no `fs` calls; cleanup spec (`:171-176`) builds its own minimal fixture independent of the shared one. Every earlier assertion preserved: exact-line check (`:147-152`), every edge's importer/target check (`:155-168`), the monorepo-shape checks (`:35-79`) — plus a new assertion (`:81-86`) that every file in the in-memory plan is actually present on disk, which is a genuine strengthening (catches a write silently skipping a planned file). Author's reported before/after runtime (4.253s → 2.161s spec-level; 35x drop in pure test-execution time 2,002ms→57ms) is consistent with the reduction from 4 to 2 real disk-touching fixture builds. Author's 3 consecutive clean runs (46/46 suites, 1239/1239 tests, 59.6s/47.8s/1m5s) are plausible given my own re-runs below. I independently ran `workspace-intelligence:test` twice in isolation (44.8s, 39.8s, both exit 0, no failures) plus once more inside the combined `run-many -t test,lint,typecheck` (57.6s critical path, all 6 targets green, **no** "flaky task" warning this time, unlike the r2 run). 3/3 of my own runs this round were clean. | CLOSED |
| `tsconfig.lib.json` missing `src/testing/**/*` exclude | Add the exclude, matching `platform-core`'s pattern | YES — `git diff` on the one tracked file changed this round confirms exactly `"src/testing/**/*"` was added to `exclude`, matching `platform-core/tsconfig.lib.json`'s own `exclude` list byte-for-byte in the relevant entry. `typecheck` target still green (`nx run @ptah-extension/workspace-intelligence:typecheck` in my combined run above). The spec project (`tsconfig.spec.json`) is untouched and still includes `src/**/*.spec.ts` and `.d.ts`; jest/ts-jest (not `tsc --noEmit`) transforms `fixture-workspace.ts` when imported by the spec regardless of the lib tsconfig's exclude, which is exactly why `fixture-workspace.spec.ts` (which imports `fixture-workspace.ts`) still ran and passed in every test invocation above — the folder remains fully covered for testing while now correctly excluded from the `tsc --noEmit` lib surface. `git status --short` and `git diff --stat` confirm only this one existing tracked file changed (`M libs/backend/workspace-intelligence/tsconfig.lib.json`); `fixture-workspace.ts`/`.spec.ts` remain untracked new files, consistent with "no other tracked file touched." | CLOSED |

## New defects found in r3

None. Full re-read of `fixture-workspace.ts` and `fixture-workspace.spec.ts` found no new logic gaps introduced by the refactor (e.g., no risk of the in-memory plan and the on-disk write diverging, since `createMcpContractFixture` writes exactly `plan.files` with no transformation, and the new disk-vs-plan equality assertion at spec `:81-86` pins that).

## Carried, non-blocking

- Minor: `reducers.bench.spec.ts`'s `DEFAULT_BUDGET` stays a local literal (2000 tokens/8000 chars), not the production `DEFAULT_TOOL_RESULT_BUDGET_TOKENS` constant, which lives in `vscode-lm-tools` and is unreachable from this `type:util` lib. Correctly out of this batch's reach; a code comment names Batch 21.1 as the owner of pinning the wired default. No action needed here.

## Verification performed

- `node_modules/.bin/nx run @ptah-extension/workspace-intelligence:test --skip-nx-cache` — run twice in isolation: 44.8s (exit 0), 39.8s (exit 0), no failures either time.
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/tool-output-reducers --skip-nx-cache` — all 6 targets green, 57.6s, no flaky-task warning.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — `TOTAL 300 unsuppressed site(s)`, unchanged baseline, passed.
- Read `fixture-workspace.ts` (729 lines) and `fixture-workspace.spec.ts` (178 lines) in full; `git diff` on `tsconfig.lib.json` and `git status --short` to confirm scope of tracked-file changes.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none material remaining in this batch's own scope; the only open item (production budget constant not reachable from this lib) is correctly deferred to Batch 21.1 and does not block 20a.
- What a robust implementation would add: nothing further required for 20a; recommend the team-leader confirm at Batch 21.1 time that the wired default budget is actually pinned by a spec that imports the real constant, closing the loop this batch could not reach.
