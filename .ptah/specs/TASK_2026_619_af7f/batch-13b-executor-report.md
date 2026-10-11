## Summary

Create, update, and supported-extension delete events now reindex that file after the debounce while a full census is in flight. They no longer queue a trailing full run. Storms, overflow, truncation, and extension-less directory deletes still coalesce to one follow-up census.

`CodeSymbolIndexer.isIndexing(root)` is true for the whole of `indexWorkspace` on that root (path identity, set in `beginRun` before discovery, cleared in `finally`). `ensureIndexFresh` and the namespace's full `reindex()` do not start another `indexWorkspace` while that signal or the namespace's own latch is set. A symbol query during an active run reports `reindexInFlight: true` and leaves the call count at one. After the run ends, a still-stale index starts the lazy run.

Task 13b.3 was not implemented.

## Files changed (absolute)

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\code-namespace.builder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\code-namespace.builder.spec.ts`

No barrel export. No port or interface file. `ensureIndexFresh` already receives the concrete `CodeSymbolIndexer`, so `isIndexing` is a method on that class. `WorkspaceSymbolIndex` did not need it: the lifecycle still tracks its own `fullRun`.

## Criteria met (file:line)

- Create/update during a full run debounce into `reindexFile` and do not set `followUp`. `schedule` no longer returns early on `fullRun` (`workspace-index-lifecycle.ts:323-340`). `apply` calls `reindexFile` for a non-delete with no `fullRun` check (`workspace-index-lifecycle.ts:343-357`).
- Supported-extension deletes during a full run call `deleteSymbolsForFile` on the same path (`workspace-index-lifecycle.ts:345-351`).
- Storm coalescing, overflow/truncated, and the directory-delete cooldown are unchanged. `onBatch` still calls `requestFullRun` for overflow, truncation, and the storm threshold (`workspace-index-lifecycle.ts:281-288`). `requestDeleteFullRun` is unchanged (`workspace-index-lifecycle.ts:303-321`). A full run already in flight still arms at most one follow-up (`workspace-index-lifecycle.ts:363-365`, `392-394`). `schedule` still collapses a pending set that reaches the storm threshold into `requestFullRun` (`workspace-index-lifecycle.ts:338-340`).
- Database artifacts and non-source filters are unchanged (`workspace-index-lifecycle.ts:266-279`).
- `isIndexing` reads `runsInProgress`, which `beginRun` fills before discovery (`code-symbol-indexer.service.ts:498`, `622`, `647`) and `settleRun` clears from `indexWorkspace`'s `finally` (`code-symbol-indexer.service.ts:508-510`, `671-678`). The key is `graphPathIdentity` (`code-symbol-indexer.service.ts:520-523`).
- `ensureIndexFresh` does not start `indexWorkspace` when `runIsActive` is true, and still reports `reindexInFlight` (`code-namespace.builder.ts:240-243`, `327-338`, `366`).
- The indexer's per-file lock covers both full-run writes and `reindexFile`. Both call `indexFileRecorded` (`code-symbol-indexer.service.ts:888`, `1021`), which takes `withFileLock` around `_indexFile` (`code-symbol-indexer.service.ts:720-741`). A lifecycle delete does not take that lock; it calls the sink directly (`workspace-index-lifecycle.ts:347`).

## Write-path trace

Watcher event -> `WorkspaceIndexLifecycleService.onBatch` drops database artifacts and non-source paths, and turns overflow, truncation, a storm, or an extension-less delete into `requestFullRun` / `requestDeleteFullRun`. A kept source create or update (and a supported-extension delete) is `schedule`d. After `debounceMs`, `apply` calls `indexer.reindexFile` or `indexer.deleteSymbolsForFile`. `reindexFile` -> `indexFileRecorded` -> `withFileLock` -> `_indexFile` -> `ISymbolSink.replaceFileSymbols`. A full run's per-file write uses the same `indexFileRecorded` lock. `requestFullRun` -> `indexer.indexWorkspace` (governor, no `userInitiated`).

Tool call `searchSymbols` -> `ensureIndexFresh` -> `checkFreshness`. If the root is host-owned, the index is stale, no namespace run was started inside the 24h gap, and `runIsActive` is false, `startBackgroundRun` calls `indexer.indexWorkspace(root, { userInitiated: false })`. If the lifecycle (or any caller) already has a run, `isIndexing` is true, `indexWorkspace` is not called, and the tool result says `reindexInFlight: true`.

## Tests added

- `workspace-index-lifecycle.spec.ts:190` — update and create during a held boot run call `reindexFile` after 500ms, before the run settles; resolving the run does not start another `indexWorkspace`.
- `workspace-index-lifecycle.spec.ts` — a supported `.ts` delete during the held run calls `deleteSymbolsForFile` once and does not queue a follow-up.
- `workspace-index-lifecycle.spec.ts` — a 3-path storm during the held run cancels the debounced per-file work and starts exactly one follow-up after the held run settles. The existing overflow-during-run test still expects one follow-up.
- `code-symbol-indexer.service.spec.ts:667` — `isIndexing` is false before `indexWorkspace`, true from the synchronous start (including a trailing-slash root) while a per-file reindex runs, and false after the run settles. The superseded-run test also expects `isIndexing` to stay true until the older run settles.
- `code-namespace.builder.spec.ts:496` — one `indexWorkspace` stands in for the lifecycle run; the first `searchSymbols` does not call it again and reports `reindexInFlight: true`; after `isIndexing` goes false, a still-empty index starts one lazy run (`userInitiated: false`).

## Checks run (command + last lines)

Jest was spawned from `node` so the mapper JSON was not stripped. Each invocation was `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c <project jest config> <spec> --coverage=false --maxWorkers=2 --moduleNameMapper=<full mapper>`. The mapper always included `^marked$` -> `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js` and `^vscode$` -> `<rootDir>/../../../__mocks__/vscode.ts`. thoth-runtime and vscode-lm-tools also mapped `(^|/)wasm-bundle-dir([.]js)?$` to `<rootDir>/__mocks__/wasm-bundle-dir.ts`.

- Lifecycle spec: `PASS` `Tests: 18 passed, 18 total` exit 0.
- Indexer spec: `PASS` `Tests: 43 passed, 43 total` exit 0.
- Namespace spec: `PASS` `Tests: 44 passed, 44 total` exit 0. The first run failed to compile (`lifecycle.resolve` takes no argument). After that one-line fix, the re-run passed. Lifecycle and indexer were not re-run.

- `npx prettier --check` on the six paths: `All matched files use Prettier code style!` exit 0. An earlier check failed only on `code-namespace.builder.ts` (a wrapped `reindexInFlight` line). That line was put on one line and the check was repeated. No `--write`.

- `npx nx typecheck @ptah-extension/thoth-runtime --parallel=1`: `Successfully ran target typecheck` exit 0 (24.9s).
- `npx nx typecheck @ptah-extension/workspace-intelligence --parallel=1`: `Successfully ran target typecheck` exit 0 (7.1s).
- `npx nx typecheck @ptah-extension/vscode-lm-tools --parallel=1`: `Successfully ran target typecheck` exit 0 (12.1s).

- `npx nx lint @ptah-extension/thoth-runtime --parallel=1`: `All files pass linting` exit 0.
- `npx nx lint @ptah-extension/workspace-intelligence --parallel=1`: exit 0. `74 problems (0 errors, 74 warnings)`. `code-symbol-indexer.service.ts` is in that set for `max-lines` (911 > 700). The file was already over the cap; this batch added `isIndexing` and did not split it.
- `npx nx lint @ptah-extension/vscode-lm-tools --parallel=1`: exit 0. `77 problems (0 errors, 77 warnings)`. None of the filtered lines named `code-namespace.builder.ts`.

- `ptah_get_diagnostics` on the three sources: first call unavailable (TypeScript check still running after 45s). Retry: `Errors: 0 | Warnings: 0`, coverage `clean`.

## Decisions (decision, options, evidence, reversible)

- Per-file work during a census is `reindexFile` / `deleteSymbolsForFile` after the existing debounce, not a second code path. Options: skip the debounce while a run is active, or keep it. Evidence: the batch says they call `reindexFile` after the debounce (`batches.md` Task 13b.1). The 500ms default is unchanged. Reversible: call `apply` immediately from `schedule` when `fullRun` is set.
- `isIndexing` is `runsInProgress.size > 0`, not `active !== null`. Options: only the newest run, or every `indexWorkspace` that has not settled. Evidence: a superseded run still writes after the newer one settles (`code-symbol-indexer.service.spec.ts` "a run superseded by a newer run"). Clearing the signal when the newer run settles would let `ensureIndexFresh` start a third run while the older one is still writing. Reversible: switch the predicate to `record.active !== null`.
- The namespace keeps its `inFlight` set and also consults `isIndexing`. Options: delete `inFlight` and trust only the indexer, or keep both. Evidence: concurrent `ensureIndexFresh` calls in one tick dedupe before `indexWorkspace` returns, and the 24h gap is `lastRunStartedAt`, which only this namespace sets (`code-namespace.builder.ts:258-278`, `342-344`). The test double's `isIndexing` defaults to false, so those tests still pass on `inFlight`. Reversible: drop `inFlight` if every caller goes through `beginRun` synchronously.
- Explicit `reindex()` (no `filePath`) also refuses to start when `isIndexing` is true and reports `reindexInFlight`. Options: only gate `ensureIndexFresh`, or gate every namespace `indexWorkspace` start. Evidence: Task 13b.2 is one owner per root; `reindex()` is the other start in this file (`code-namespace.builder.ts:514`). A single-file `reindex({ filePath })` is unchanged. Reversible: gate only `checkFreshness`.
- No interface edit. Options: add `isIndexing` to `WorkspaceSymbolIndex`, or leave the lifecycle on its own `fullRun` flag. Evidence: the lifecycle does not need the signal to avoid a second run it already started. The namespace holds `CodeSymbolIndexer`. Reversible: add the method to the narrow port if a second indexer implementation appears.
- A file created after discovery can be inserted by `reindexFile` and later removed by `purgeAbsentPaths` when that census completes (`code-symbol-indexer.service.ts:919-920`). Options: queue a trailing full run (forbidden for create/update), or teach the purge to keep paths written during the run (out of the file list's stated 13b.2 contract). The smoke window is during the run, before that purge. Not changed.

## Not done

- Task 13b.3 (query-file priority) was not implemented. The batch marks it conditional on cold-start still failing after 13b.1 and 13b.2.
- The cli-headless lifecycle smoke was not run. The orchestrator owns that.
- No commit.
- `ptah_code_reindex` of one file, VS Code `wire-runtime.ts`, and `boot-thoth-runtime.ts` still call `indexWorkspace` / `reindexFile` as before. Their signatures did not change.
- A lifecycle `deleteSymbolsForFile` during a full run does not take `withFileLock`. The two write paths do. The store delete stays the transactional sink call the batch asked to keep.

## Revision 1

Review `code-logic-review-b13b.md` was REVISE 4/10. Both BLOCKING findings are fixed. `code-namespace.builder.ts` was not changed.

### 1. Purge no longer erases a non-census write made after discovery

A successful non-census `reindexFile` records the store path on every census still running for that root (`code-symbol-indexer.service.ts:780-790`, `818-821`). The key is the file-lock identity (`graphPathIdentity`). `purgePresentPaths` merges those paths into the set passed to `purgeMissing` and does not stat the disk (`code-symbol-indexer.service.ts:1154-1185`). A read or parse failure does not set `wrote`, so it is not kept.

Test: `code-symbol-indexer.service.spec.ts:934`. The governor holds the run after discovery. `reindexFile` of a path discovery did not yield leaves that path in the row set and in the purge-present list after the census finishes.

### 2. A supported delete takes the file lock and tombstones the census

`CodeSymbolIndexer.deleteFileSymbols` uses `withFileLock` on the same identity as `reindexFile`, deletes through the sink, and tombstones every in-progress run (`code-symbol-indexer.service.ts:751-756`, `1075-1086`). The census checks that tombstone inside the lock after the read and before `replaceFileSymbols` (`code-symbol-indexer.service.ts:1379-1396`). Purge omits tombstoned paths even when discovery saw them (`code-symbol-indexer.service.ts:1162-1166`). A later successful non-census `reindexFile` clears the tombstone (`code-symbol-indexer.service.ts:786-789`).

The lifecycle's narrow interface `WorkspaceSymbolIndex` now has `deleteFileSymbols` instead of a sink-shaped `deleteSymbolsForFile` (`workspace-index-lifecycle.ts:24-38`). `apply` calls it (`workspace-index-lifecycle.ts:345-358`). `workspaceSymbolIndexFrom` forwards to the indexer and does not call the sink (`workspace-index-lifecycle.ts:145-156`). The `sink` parameter remains so `boot-thoth-runtime.ts` and `cli-workspace-index.ts` still compile; it is unused.

Tests: `code-symbol-indexer.service.spec.ts:955` (census read of X, locked delete from that read, replace skipped, X absent after purge) and `:992` (delete then re-create during the held run, rows present after purge). Lifecycle: `workspace-index-lifecycle.spec.ts:219` calls `deleteFileSymbols` on the indexer double; `:482` asserts the adapter calls that method and not `sink.deleteSymbolsForFile`.

### Checks (command + last lines)

Jest via `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c <config> <spec> --coverage=false --maxWorkers=2` with the full mapper (`^marked$` to `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js`, `^vscode$` to the worktree mock; thoth-runtime also maps `wasm-bundle-dir`).

- Indexer spec: first run failed to compile (`toBeTypeOf` is not in this Jest). After `typeof` comparison, re-run `PASS` `Tests: 46 passed, 46 total` exit 0. Includes the three new cases and the existing same-file overlap test.
- Lifecycle spec: `PASS` `Tests: 18 passed, 18 total` exit 0. Re-run after the prettier wrap: `PASS` `Tests: 18 passed, 18 total` exit 0.

- `npx prettier --check` on the four paths: failed on `workspace-index-lifecycle.ts` (one line over the print width). Wrapped the `deleteFileSymbols` call. Re-check: `All matched files use Prettier code style!` exit 0.

- `npx nx typecheck @ptah-extension/thoth-runtime --parallel=1`: `Successfully ran target typecheck` exit 0 (37.9s).
- `npx nx typecheck @ptah-extension/workspace-intelligence --parallel=1`: `Successfully ran target typecheck` exit 0 (10.2s).
- `npx nx lint @ptah-extension/thoth-runtime --parallel=1`: `All files pass linting` exit 0.
- `npx nx lint @ptah-extension/workspace-intelligence --parallel=1`: exit 0. `74 problems (0 errors, 74 warnings)`. No new error. `code-namespace` was not linted; that project was not edited.

### Decisions

- Kept paths and tombstones are written onto every `runsInProgress` entry, not only `active`. A superseded census still calls `purgeMissing` with its own snapshot. Reversible: record only on `record.active`.
- The purge extra is the store path string (forward slashes, original case), keyed by `graphPathIdentity`. The store's `normalizeStoredPath` does not case-fold, so a lowercased identity would not match the row on Windows. Reversible: pass the identity if the store starts folding case.
- A delete invoked from inside the in-flight file write re-enters via `AsyncLocalStorage` (`code-symbol-indexer.service.ts:751`). An outside caller does not see that store and still waits on the lock, which is what the same-file overlap test requires. Reversible: drop re-entry if the delete is only allowed to queue until the census replace finishes; the "read, then delete, then skip replace" test would then deadlock or change order.
- `workspaceSymbolIndexFrom` keeps its `sink` argument and ignores it. Options: remove the argument (breaks `boot-thoth-runtime.ts` and `cli-workspace-index.ts`, which this revision cannot edit) or keep calling the sink when the indexer has no locked delete. Evidence: both call sites pass the real `CodeSymbolIndexer`, which now has `deleteFileSymbols`. Reversible: delete the parameter when those call sites are updated.

### Not done

- Task 13b.3 and the cli-headless smoke were not run. No commit.
- `code-namespace.builder.ts` was not modified. `isIndexing` behavior is unchanged.

## Bounded correction (post-cap)

Round 2 REVISE 6/10. One correction. No bench, build, or `nx run-many`.

### 1. Same-root full censuses no longer overlap

`indexWorkspace` starts a census only when that root has none running (`code-symbol-indexer.service.ts:552-557`, `launchCensus` at `671-695`). A call that arrives while a census is active joins one shared follow-up (`joinCensus` at `702-746`). `startFollowUp` (`749-767`) runs that follow-up once after the active census settles, and skips it when every waiter has aborted. A waiter whose signal aborts while waiting rejects with `AbortError` and does not cancel the active run (`721-727`); the signal is not passed into the follow-up. `isIndexing` stays true while `runsInProgress` is non-empty or the slot is running or has waiters (`567-573`). `beginRun` still resets an existing root record for the next sequential census (`else` at the existing record); it is no longer reached for an overlapping call. Kept paths and tombstones still apply to the single active run.

Tests in `code-symbol-indexer.service.spec.ts`: a second call during a held run does not discover until the first ends, then once (`1046`); three calls share one follow-up (`1070`); the only aborted waiter rejects and no follow-up runs (`1091`); the older snapshot purges before the follow-up, and the new file's rows are present at the end (`1120`). The old superseded-run test was rewritten into the second-call case so it no longer awaits a concurrent census.

### 2. Dead `sink` argument removed

`workspaceSymbolIndexFrom` takes only the indexer (`workspace-index-lifecycle.ts:135-148`). Boot no longer resolves `ISymbolSink` (`boot-thoth-runtime.ts:572`). The CLI attach path no longer does either (`cli-workspace-index.ts:130`). Both files dropped the `MEMORY_CONTRACT_TOKENS` and `ISymbolSink` imports. The lifecycle spec calls the one-argument adapter (`workspace-index-lifecycle.spec.ts:482`, `496`). No boot or CLI spec passed `sink`.

### Checks (command + last lines)

Jest via `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js --coverage=false --maxWorkers=2` with the full mapper (`^marked$` to the main-repo `marked.umd.js`, `^vscode$` to the worktree mock; thoth-runtime also maps `wasm-bundle-dir`). Spawned from Node so the mapper JSON kept its quotes.

- Indexer spec: `Tests: 49 passed, 49 total` exit 0. Re-run after prettier: `Tests: 49 passed, 49 total` exit 0.
- Lifecycle spec: `Tests: 18 passed, 18 total` exit 0. The CLI spec was not edited, so it was not run.

- `npx prettier --check` on the six changed files: first check warned on the indexer spec. `--write` on that file only. Re-check: `All matched files use Prettier code style!` exit 0.

- `npx nx typecheck @ptah-extension/workspace-intelligence --parallel=1`: `Successfully ran target typecheck` exit 0 (7.2s). Nx Cloud 401.
- `npx nx typecheck @ptah-extension/thoth-runtime --parallel=1`: `Successfully ran target typecheck` exit 0 (16.6s).
- `npx nx typecheck @ptah-extension/cli-engine --parallel=1`: `Successfully ran target typecheck` exit 0 (16.2s).
- `npx nx lint @ptah-extension/thoth-runtime --parallel=1`: `All files pass linting` and `Successfully ran target lint` exit 0.
- `npx nx lint @ptah-extension/cli-engine --parallel=1`: `2 problems (0 errors, 2 warnings)` and `Successfully ran target lint` exit 0.
- `npx nx lint @ptah-extension/workspace-intelligence --parallel=1`: exit 0 (7.0s). The retained tail was the Nx Cloud footer, not the eslint count.

### Not done

- Task 13b.3, the cli-headless smoke, and any commit were not done. `code-namespace.builder.ts` was not modified.
