# Batch 2 executor report

## Task 2.1 — Scorecard types and writers

Status: complete.

Evidence:

- `scorecard.types.ts` supplies the B8 scorecard model and Zod validation. It requires schema version 1, accepts only `cli-headless`, `electron`, or `vscode` hosts, requires prompt-file claims, and requires a reason for each `na` suite.
- `scorecard-writers.ts` validates JSON on read and before rendering/writing. It writes `scorecard.json` and `scorecard.md`; it provides the gitignored `out/<runId>/` path and the committed `baseline/` path.
- Markdown contains a separate metrics table for every suite/tool, plus lifecycle and eager/deferred tables.
- `scorecard-writers.spec.ts` proves that an `na` suite is counted as not applicable rather than passed and that an absent `naReason` is rejected. It also proves invalid JSON is rejected on read.
- The Batch 1 carried metric finding is resolved: `callsPerAnswer(totalCalls, answerCount)` is implemented and tested; empty p50/p95 samples now return `undefined`, so they cannot be represented as a perfect 0 ms latency.

## Task 2.2 — Pinned corpus checkout and lifecycle copy

Status: complete.

Evidence:

- `corpus.config.json` pins commit `7910f34cf` and declares the eligible source extensions.
- `corpus.ts` parses the config with Zod, runs `git worktree prune`, creates a detached temporary worktree at the pin, and removes it in `finally`.
- Lifecycle callers receive an independently copied disposable directory; the pinned checkout remains unchanged. Eligible-file counts are calculated and returned for both checkout forms.
- `corpus.spec.ts` creates its own temporary Git repository, commits a tiny corpus, verifies detached-checkout isolation and lifecycle mutation isolation, and verifies checkout cleanup. No stash is used.

## Files created or modified

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\.gitignore`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\corpus.config.json`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\corpus\corpus.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\corpus\corpus.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\cost-metrics.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\retrieval-metrics.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\retrieval-metrics.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-2-executor-report.md`

## Verification tail

`npx nx run-many -t typecheck,lint,test -p mcp-bench`

```
√  nx run mcp-bench:typecheck
√  nx run mcp-bench:lint
√  nx run mcp-bench:test

NX   Successfully ran targets typecheck, lint, test for project mcp-bench
```

The runner also reported that the workspace's Nx Cloud organization is disabled (401); the local targets completed successfully.

## Risks and carried findings

- The Batch 2 corpus isolation risk is addressed by using a pinned detached worktree rather than the live checkout, pruning stale worktree metadata before use, and always removing the temporary worktree in `finally`.
- The plan's transport/CLI-host risk is outside Batch 2 source scope and remains assigned to Batch 3; the scorecard uses the required `cli-headless` host label so its eventual results do not imply that the product CLI currently exposes this surface.
- Carried Batch 1 finding: calls per answer is now computed and tested.
- Carried Batch 1 finding: empty latency samples now return `undefined`; scorecard metric fields accept `null` for unavailable values and the suite must use `verdict: 'na'` with a reason.
- The remaining Batch 1 path-case and commitlint findings belong to Batches 9.1 and 10.2 respectively and were intentionally not changed.

## Not done

Nothing in the assigned Batch 2 scope remains outstanding.

## Revision 1

- Fixed failed-add cleanup at `tools/mcp-bench/src/corpus/corpus.ts:24-70`: the worktree removal runs only after a successful add; the temporary folder is always removed in `finally`; a primary failure remains primary, with cleanup failures appended when both occur.
- Fixed stale crashed-run cleanup at `tools/mcp-bench/src/corpus/corpus.ts:116-164`: porcelain worktree entries are parsed before pruning, and only paths named `ptah-mcp-bench-corpus-*` below the OS temporary directory are removed. Other worktrees are not selected.
- Added regression coverage at `tools/mcp-bench/src/corpus/corpus.spec.ts:61-85` for an invalid pin preserving the `git worktree add` error with no registered worktree or temporary-folder leak.
- Added regression coverage at `tools/mcp-bench/src/corpus/corpus.spec.ts:87-135` for removal of a registered stale corpus worktree while an unrelated temporary-repository worktree remains registered and readable.

Verification tails:

```text
$ npx nx run-many -t typecheck,lint,test -p mcp-bench
√  nx run mcp-bench:typecheck
√  nx run mcp-bench:lint
√  nx run mcp-bench:test
NX   Successfully ran targets typecheck, lint, test for project mcp-bench

$ npx prettier --check tools/mcp-bench
Checking formatting...
All matched files use Prettier code style!
```
