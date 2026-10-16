# Batch 20 fix round 1 report

## Verdict

F20-1 through F20-4 are implemented. Scoped TypeScript diagnostics, ESLint, Prettier, the degradation audit, and DI lint pass. Nx and Jest were not run under decision #53; the team leader owns those runs.

## Modified files

- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\pipeline.test-support.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-reader.service.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-reader.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-recorder.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-20-fix-report.md

## Fix evidence

- F20-1: `write/pipeline.test-support.ts:113` includes the three session and workspace TEXT columns, matching `store/sqlite-lane-outcome.store.spec.ts:24`. `write/outcome-write-pipeline.spec.ts:64-77` tracks every constructed pipeline and disposes it in `afterEach`, including assertion failures. Existing explicit disposals remain valid.
- F20-2: `lane-outcome-recorder.service.spec.ts` was rewritten with Prettier formatting; `prettier --check` passes.
- F20-3: `lane-outcome-reader.service.ts:121` uses zero when `startedAt` is null. `lane-outcome-reader.service.spec.ts:77-84` asserts the scope uses the stored session ID and `fromMs: 0`, `toMs: row.endedAt`.
- F20-4: `lane-outcome-recorder.service.spec.ts:85-115` covers one classification/update, transient input fields excluded from storage, and duplicate insertion; `:117-137` covers preset class, delivered/unverified verdict, stopped status, and absent classifier; `:139-162` covers null answer and rejection with an ids-only warning. The harness at `:38-55` uses the real pipeline and in-memory store.

## Decisions

- Tracked all pipeline instances in the pipeline spec and disposed them after each test. The explicit per-test disposals are preserved, and a second dispose is safe because the pipeline flushes an empty queue and clears its own timer. This makes cleanup reliable when assertions throw. Reversible: yes.

## Verification tails

- `ptah_get_diagnostics` after final source/spec edit: 0 errors, 0 warnings, clean coverage.
- `npx eslint <five changed TypeScript files>`: empty output, exit 0.
- `npx prettier --check <five changed TypeScript files>`: "All matched files use Prettier code style!", exit 0.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`: TOTAL 296 unsuppressed site(s), no FAIL, exit 0.
- `npx ts-node --transpile-only tools/di-lint/check-injects.ts`: di-lint OK: 1841 @inject sites, 807 tokens, exit 0.

## Deferred scope

M20-1 through M20-3 were left for the P2 phase review as instructed.
