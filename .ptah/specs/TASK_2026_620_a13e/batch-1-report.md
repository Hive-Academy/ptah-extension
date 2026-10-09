# Batch 1 report

## Task 1.1: Seeded PRNG and paired bootstrap

Implemented `bootstrap.ts` and its Jest specification.

- `bootstrapInterval(values, { resamples, seed, alpha })` returns a percentile interval for the resampled mean or `null` for empty input.
- `pairedBootstrapDelta(a, b, opts)` samples paired `b - a` deltas, rejects unequal input lengths, and returns `null` for two empty arms.
- The FNV-1a-seeded Mulberry32 generator is entirely local and never uses `Math.random`, so identical input and seed produce byte-identical JSON output across runs.
- The spec verifies deterministic output, empty input, constant values, paired direction, and mismatched pairs.

Evidence: the scoped TypeScript diagnostics reported no errors in either Batch 1 bootstrap file.

## Task 1.2: Curation metrics

Implemented `curation-metrics.ts` and its Jest specification.

- Every implemented rate returns `{ value, num, den }`; zero denominators return `value: null`.
- Extraction metrics cover recall, precision excluding `unlabelled` rows, FMR, and over-suppression.
- Update classification covers correct/stale/omission/hallucination. Correct requires v1 to be absent, matching the current no-superseded-marker rule.
- Merge precision, recall, F1, duplicate-cluster rate, singleton-subject share, false-delete, false-retain, and archived-then-needed metrics use hand-computed fixtures.
- `recallAtK` and `ndcgAtK` are re-exported from the existing retrieval metrics module rather than reimplemented.

Evidence: the scoped TypeScript diagnostics reported no errors in either Batch 1 curation file.

## Risks and edge cases

- Empty bootstrap samples and empty paired arms return `null`; unequal paired arms throw a `RangeError` rather than silently truncating.
- All metric zero denominators are represented as `null`, with numerator and denominator retained for scorecard reporting.
- Duplicate fact IDs cannot inflate recall because ground truth is deduplicated before counting.
- Unlabelled rows are excluded from precision; bait rows are counted only by FMR.
- Update cases with both v1 and v2 remain stale even when v2 ranks higher, because no superseded marker exists today.
- No files under the real user `.ptah` directory were intentionally read or written. No forbidden Batch 1-external source files were changed.

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\metrics\bootstrap.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\metrics\bootstrap.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\metrics\curation-metrics.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\metrics\curation-metrics.spec.ts`
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_620_a13e\batch-1-report.md`

## Verification

- `npx prettier --check --ignore-unknown tools/mcp-bench/src/memory-skills/metrics/bootstrap.ts tools/mcp-bench/src/memory-skills/metrics/bootstrap.spec.ts tools/mcp-bench/src/memory-skills/metrics/curation-metrics.ts tools/mcp-bench/src/memory-skills/metrics/curation-metrics.spec.ts`
  - `All matched files use Prettier code style!`
- Scoped diagnostics on all four Batch 1 files:
  - `No diagnostics in the requested files.`
  - Seven TypeScript errors remain in existing sibling files `memory-skills/doubles/recorded-curator-llm.spec.ts` and `memory-skills/doubles/recorded-lane-runner.spec.ts`; none are in Batch 1 files.
- `npx nx run-many -t typecheck,test,lint -p mcp-bench`
  - Started exactly as required: `NX Running targets typecheck, test, lint for project mcp-bench`.
  - It was still running with no additional output after one 30-second completion check, so a completed pass/fail result was not available without violating the requested single-check long-command policy.

## Anything not done

No implementation task remains. The combined Nx validation command did not provide a terminal result before the allowed completion check elapsed; its final status must be observed by the orchestrator or a later validation run.
