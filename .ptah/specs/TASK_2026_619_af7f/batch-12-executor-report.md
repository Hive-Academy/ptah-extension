# Batch 12 executor report: index completeness (cap, order, purge, transactional write)

Worktree `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`. Nothing committed. Other writers' uncommitted files were left untouched.

## Summary

Fix 1 (A1) is in place on the indexer and the code-symbol store.

- The default run no longer stops at 2,000 eligible files. Discovery enumerates the whole tree, sorts it, then indexes every eligible file. An optional `maxFilesPerRun` still truncates after that sort and reports a real `omittedByCap`.
- Discovery order is stable: source paths first, `.ptah/` and `.github/skills` last, then lexicographic path. Two runs over the same tree select the same files in the same order.
- `purgeMissing` runs only after a census-`complete` run (not truncated, not aborted, not a total failure).
- Per-file write is `replaceFileSymbols`: delete + insert in one SQLite transaction. A failed insert keeps the old symbol, FTS, and vector rows.
- Files over 1 MiB still count as `failed:too-large` and are not read.
- Governor yields in the existing batch loop are unchanged.

Production wiring is `MemoryStoreSymbolSink.replaceFileSymbols` / `purgeMissing` → `CodeSymbolStore`. The indexer duck-types those extra methods on `ISymbolSink` (the contracts package was out of this batch's file cap).

## Files changed (absolute paths)

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-curator\src\lib\code-symbol.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-curator\src\lib\code-symbol.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-curator\src\lib\symbol-sink.adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.spec.ts`

Five product files (limit 6). `ISymbolSink` in `memory-contracts` was not changed.

## How each acceptance criterion is met (file:line)

| Criterion | Where |
| --- | --- |
| No default 2,000-file cap; index every eligible file | `code-symbol-indexer.service.ts:47-53`, `:777` (`maxFilesPerRun` optional, no `DEFAULT_MAX_FILES`) |
| Cap, if set, reports a truthful `omittedByCap` | `:820-854` (discovery finishes, then slice); coverage `:596` |
| Deterministic order: source first, `.ptah/` and `.github/skills` last | `:108`, `:173-178`, sort at `:842` |
| Two runs over the same tree select the same files in the same order | sort after full discovery (`:842`); spec `:1147-1168` |
| Purge only after a COMPLETE run (not truncated, cancelled, or failed) | `:910-918` (after the all-errored throw; `run.census === 'complete'` only). Abort throws at `:897-904` before purge. Discovery failure returns at `:831-838`. |
| Files over 1 MiB stay `failed:too-large` | `:113`, `:868-874`; existing coverage spec still expects `failedByReason['too-large']` |
| Governor yields reused | `:863-864` (`yieldToForeground` before each batch) |
| `replaceFileSymbols` atomic delete+insert | `code-symbol.store.ts:161-252` (one `db.transaction`) |
| Failed insert keeps old rows | same txn; spec `:1459-1544` |
| FTS + vector rows deleted with symbols | vec DELETE by rowid before symbol DELETE (`:207-215`, `:294-301`); FTS via `code_symbols_ad` trigger |
| `purgeMissing` batched and scoped by `workspace_root` | `:259-320`, `PURGE_MISSING_BATCH = 200` at `:127`; listing SQL `WHERE workspace_root = ?` at `:266-268` |
| Purge never crosses workspace roots | listing and DELETE always bind `workspaceRoot`; spec `:1548-1595` |
| Indexer uses the store methods | adapter `:42-56`; indexer `writeFileSymbols` `:1032-1054`, `purgeAbsentPaths` `:1060-1078` |

## Write-path trace (Mode 3)

Each new/changed DB write and its reader.

| Write | Table | Key | Scope | Reader |
| --- | --- | --- | --- | --- |
| `replaceFileSymbols` DELETE vec | `code_symbols_vec` | `rowid` of rows for `(workspace_root, file_path)` | that file in that root | `vecSearchSymbols` / hybrid `searchSymbols` (no hit once gone) |
| `replaceFileSymbols` DELETE symbols | `code_symbols` | `(workspace_root, file_path)` | that file in that root | `search`, `searchSymbols`, `count`, `getIndexFreshness` |
| FTS follow-on (trigger `code_symbols_ad` / `code_symbols_ai`) | `code_symbols_fts` | `rowid` | same | `bm25SearchSymbols` |
| `replaceFileSymbols` INSERT/UPSERT | `code_symbols` | `(workspace_root, subject)` unique | that root | same readers by `workspace_root` + `file_path` / `symbol_name` |
| `replaceFileSymbols` INSERT vec | `code_symbols_vec` | `rowid` of the new/updated symbol | that root | `vecSearchSymbols` |
| `purgeMissing` batched DELETE vec + symbols | `code_symbols_vec`, `code_symbols` (+ FTS trigger) | files from `SELECT DISTINCT file_path … WHERE workspace_root = ?` that are absent from `presentPaths` | **that `workspace_root` only** | same; a second root's rows are not listed or deleted |
| `deleteFileRows` (used by leftover `deleteByFile`) | same delete pair | `(workspace_root, file_path)` | that file | same |

Indexer call chain: `_indexFile` → `writeFileSymbols` → sink `replaceFileSymbols` → store `replaceFileSymbols`. Complete run → `purgeAbsentPaths` → sink `purgeMissing` → store `purgeMissing`.

## Tests added

Indexer (`code-symbol-indexer.service.spec.ts`):

- `:715` truncated run: `omittedByCap: 1`, `purgeMissing` not called
- `:1130` no cap: all eligible files, `omittedByCap: 0`, purge called with present paths
- `:1147` deterministic order + second run matches first; `replaceFileSymbols` used
- `:1172` cancelled run purges nothing
- `:1193` truncated purges nothing; later complete run purges
- Existing `:635` still asserts `too-large` for a 2 MiB file

Store (`code-symbol.store.spec.ts`):

- `:221` SQL: `purgeMissing` lists `file_path` with `workspace_root = ?`
- `:1459` native: failed insert in `replaceFileSymbols` keeps symbol, FTS, and vec rows
- `:1548` native: `purgeMissing` drops FTS/vec with the symbol and leaves another `workspace_root` intact

## Checks run (command + tail of result)

### Prettier

```
npx prettier --write <five files>
npx prettier --check <five files>
```

`--write`: all five unchanged. `--check`: `All matched files use Prettier code style!` exit 0.

### Nx

```
npx nx run-many -t typecheck,lint,test -p @ptah-extension/workspace-intelligence,@ptah-extension/memory-curator --skip-nx-cache --parallel=2
```

Tail:

```
√  nx run @ptah-extension/workspace-intelligence:typecheck
√  nx run @ptah-extension/workspace-intelligence:lint
√  nx run @ptah-extension/memory-curator:typecheck
√  nx run @ptah-extension/memory-curator:lint
PASS  memory-curator  …/code-symbol.store.spec.ts
PASS  workspace-intelligence  …/code-symbol-indexer.service.spec.ts
…
Failed tasks:
- @ptah-extension/memory-curator:test
- @ptah-extension/workspace-intelligence:test
workspace-intelligence: Test Suites: 1 failed, 69 passed, 70 total
Tests: 2 skipped, 2213 passed, 2215 total
Time: 104.084 s
```

The failed suites do not load this batch's files. They fail at Jest config:

```
Could not locate module marked mapped as:
D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\node_modules\marked\lib\marked.umd.js
```

The worktree has no `node_modules`; resolution for source walks up to `D:\projects\ptah-extension\node_modules`, but this mapper pins the worktree path. Unrelated specs (`memory-trigger*.spec.ts`, `mcp-contract.bench.spec.ts`, …) fail to load. Fixing that mapper is outside the 6-file cap and would touch Jest config used by the rest of the repo. Batch 12 specs passed inside this same run.

Symbol-suite smoke (hit@5 / index time / DB size) was not run: the task forbids `tools/mcp-bench`, dist builds, and the live bench.

## Decisions

1. **Default cap**
   - Options: remove the cap; raise it to a measured 20,000 and report `omittedByCap`.
   - Choice: no default cap (`maxFilesPerRun` optional). Research ranked “index every eligible file” first. Callers can still pass a bound.
   - Evidence: research-report.md:69; batches.md Task 12.1.
   - Reversible: restore a default bound on `maxFilesPerRun`.

2. **How the indexer reaches the store**
   - Options: change `ISymbolSink` (memory-contracts, extra project); inject `CodeSymbolStore` into the indexer (wrong dependency direction); duck-type extra methods and add them on the existing adapter.
   - Choice: adapter methods + duck-type on the indexer. Production uses the transactional path; sinks that only implement `ISymbolSink` still delete-then-insert.
   - Evidence: batch file cap; `symbol-sink.adapter.ts` is the store façade the indexer already uses.
   - Reversible: promote the methods onto `ISymbolSink` in a later batch.

3. **Purge after truncated discovery**
   - Options: purge whenever discovery finished (presentPaths is now complete even under a cap); purge only when census is `complete`.
   - Choice: complete census only, as batches.md validation notes require. A truncated run does not call `purgeMissing`.
   - Reversible: one-line change at `:917`.

## Not done

- Full `memory-curator:test` / `workspace-intelligence:test` green: blocked by the pre-existing `marked` Jest mapper in this worktree, not by Batch 12 code.
- Scorecard smoke (`ptah_code_search_symbols` hit@5, index time, DB size): bench and host builds forbidden while a benchmark is running.
- `ISymbolSink` in `libs/backend/memory-contracts` not updated (file cap). Superseded by Revision 1 below: the orchestrator approved going past the 6-file cap, and the methods are now required.

## Revision 1

Codex review `code-logic-review-b12.md` was REVISE 4/10. All four findings are fixed. Decision 2 in the original report (duck-typed sink methods) is superseded: `replaceFileSymbols` and `purgeMissing` are required on `ISymbolSink`, and the indexer calls them directly.

### 1. Blocking — cancel of the only or last batch purged

`throwIfAborted` runs before the batch loop, after the governor yield and before each batch's writes, after every batch including the last, after the loop (before the all-files-failed throw), and again immediately before `purgeAbsentPaths`.

- `code-symbol-indexer.service.ts:857` before any write
- `:860` after `yieldToForeground`, before the batch
- `:896` after every batch, including the last
- `:903` after the loop, so a cancel is `AbortError` rather than a finished index
- `:915` immediately before purge, and only when `run.census === 'complete'` (`:916`)

A governor `AbortError` is still rethrown from `yieldToForeground` (`:965`) and never reaches purge. A truncated census does not purge. Discovery failure still returns before the loop. The all-files-errored path still throws before purge (`code-symbol-indexer.service.spec.ts` total-failure test now asserts `purgeMissing` was not called).

Tests (`code-symbol-indexer.service.spec.ts`):

- `:1225` cancel during the only batch → `AbortError`, no purge
- `:1245` cancel during the last batch (4 files, batch size 2, abort on the 4th read) → no purge
- `:1267` signal already aborted before work → no read, no replace, no purge
- `:433` governor abort before the only batch → no purge
- `:446` governor abort before the last batch → no purge
- existing mid-run governor dispose now also asserts no purge
- governor fail-open (not an abort) still purges once, so a non-abort governor failure is not treated as a cancel

### 2. Blocking — vec outage left stale or orphan `code_symbols_vec` rows

`code_symbols.id` is `TEXT PRIMARY KEY` (`libs/backend/persistence-sqlite/src/lib/migrations/0013_code_symbols.ts:14-16`), not `INTEGER PRIMARY KEY AUTOINCREMENT`. The implicit SQLite rowid can be reused. No migration was added.

While sqlite-vec is unloaded the vec table is not touched, so a symbol delete in that window leaves a vec row. `reconcileOrphanVecRows` (`code-symbol.store.ts:174-203`) runs on the first store call after vec is available again (replace, purge, delete, insert, and `searchSymbols` before the vector query). It clears when vec is unavailable, so the next outage is reconciled too.

The orphan predicate is `rowid NOT IN (SELECT rowid FROM code_symbols)`. It is applied on the vec0 shadow `code_symbols_vec_rowids`, and each orphan is removed with `DELETE FROM code_symbols_vec WHERE rowid = ?`. A single `DELETE FROM code_symbols_vec WHERE rowid NOT IN (...)` is not the write shape this store uses for vec0 (every writer deletes by rowid). That is the protection for true orphans.

A reused rowid is already in `code_symbols`, so that delete must not remove it. The second protection is delete-then-insert: `replaceFileSymbols` deletes the vec row for the new rowid immediately before insert (`:304-305`). `insertBatch` already did this. `INSERT OR REPLACE` is not used.

Tests (`code-symbol.store.spec.ts`, native, 47 passed):

- `:1641` vec unavailable during `deleteByFile` leaves the vec row; the next `searchSymbols` after vec is available removes it
- `:1670` a later `insertBatch` with vec available writes the new embedding; symbol and vec counts match on the live rowid, including when SQLite reused the implicit rowid

### 3. Moderate — atomic replace was optional on the port

`ISymbolSink` now requires `replaceFileSymbols` and `purgeMissing` (`symbol-sink.port.ts:37-49`). The indexer calls `this.sink.replaceFileSymbols` (`code-symbol-indexer.service.ts:1044`) and `this.sink.purgeMissing` (`:1056`). The duck type and the delete-then-insert fallback are gone.

`NullSymbolSink` implements both (`null-implementations.ts:36-37`). `MemoryStoreSymbolSink` already forwarded them and was not edited this round.

Every other implementation was updated:

- `language-honesty.contract.spec.ts` object sink and `TableSink`
- `code-symbol-indexer.exports.integration.spec.ts` `TableSink` (replace deletes that file's rows, then inserts)
- `java-rust-grammar.integration.spec.ts`
- `kotlin-grammar.integration.spec.ts`
- `php-ruby-cpp-grammar.integration.spec.ts` (three sinks, including the two `reindexFile` doubles)

### 4. Moderate — missing boundary tests

Covered above, plus:

- `:1731` `purgeMissing` of 201 missing paths (200 + 1) deletes all 201 and leaves the kept file and the other workspace root; symbol, vec, and FTS counts match
- `:1780` a throw on the 201st symbol delete rolls back only the second batch. The first 200 stay deleted. The survivor keeps its symbol, vec, and FTS rows (counts stay equal). Each batch is its own transaction (`code-symbol.store.ts:326-331`, loop `:384`) so one file cannot lose its symbol row while keeping a vec row, and the write lock is not held for the whole purge. Earlier batches stay committed because those paths are already absent; the next purge deletes what remains
- `:1843` `workspace_root` is not normalised. `normalizeStoredPath` (`code-symbol.store.ts:129-131`) only rewrites `\` to `/` on **file** paths when comparing the present set. The root is bound as given (`WHERE workspace_root = ?`). `C:/Repo`, `C:/Repo/`, and `c:/Repo` do not see each other's rows. A present path written with backslashes still keeps `C:/Repo/src/keep.ts`. Emptying `c:/repo` deletes only that root

### Files touched this revision

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.exports.integration.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\testing\mcp-contract\language-honesty.contract.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\ast\java-rust-grammar.integration.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\ast\kotlin-grammar.integration.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\ast\php-ruby-cpp-grammar.integration.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-curator\src\lib\code-symbol.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-curator\src\lib\code-symbol.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-contracts\src\lib\symbol-sink.port.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-contracts\src\lib\null-implementations.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-12-executor-report.md`

`symbol-sink.adapter.ts` already implemented both methods and was left as it was.

### Checks (Revision 1)

Prettier `--write` then `--check` on the eleven source and spec files: `All matched files use Prettier code style!` exit 0.

```
npx nx run-many -t typecheck,lint -p @ptah-extension/workspace-intelligence,@ptah-extension/memory-curator,@ptah-extension/memory-contracts --skip-nx-cache --parallel=2
```

Tail: `Successfully ran targets typecheck, lint for 3 projects` in 40.5s. Five tasks, all green: typecheck for all three, lint for workspace-intelligence and memory-curator. `@ptah-extension/memory-contracts` has no lint target, so none ran.

Jest (worktree has no `node_modules`; mapper pins `marked` and `vscode` at the parent install), `--coverage=false --maxWorkers=2`:

```
jest -c libs/backend/memory-curator/jest.config.ts …/code-symbol.store.spec.ts
Tests: 47 passed, 47 total
```

```
jest -c libs/backend/workspace-intelligence/jest.config.ts
  code-symbol-indexer.service.spec.ts
  code-symbol-indexer.exports.integration.spec.ts
  java-rust-grammar.integration.spec.ts
  kotlin-grammar.integration.spec.ts
  php-ruby-cpp-grammar.integration.spec.ts
  language-honesty.contract.spec.ts
Test Suites: 6 passed, 6 total
Tests: 221 passed, 221 total
```

No git writes, no `tools/mcp-bench` or dist edits, no electron/cli/mcp-bench builds, no bench run. Other writers' files were not reverted.
