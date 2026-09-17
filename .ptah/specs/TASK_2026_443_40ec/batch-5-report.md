# Batch 5 report — TASK_2026_443_40ec

## Outcome

Tasks 5.1, 5.2, and 5.3 are complete. The retention run now has one shared budget, the memory lifecycle store and service are implemented and DI-registered, sqlite-vec is mandatory in the extended real-SQLite harness, and all required verification commands pass.

## Task 5.1 — vec harness, run budget, limits, and retention service swap

Completed with these results:

- `openRetentionTestDb({ memorySchema: true, vec: true })` opens extension-capable SQLite, loads `sqlite-vec`, enables incremental auto-vacuum/WAL/foreign keys, and applies the static and vec portions of migrations 2, 7, 10, 15, 16, 17, 18, 19, 43, and 44 in version order. Failure to load vec throws; no lifecycle test skips.
- The harness can reopen the same file without vec and can seed memories with chunks, FTS rows, 384-float vec rows, and concepts.
- `RetentionRunBudget` owns wall time, hard-stop precedence, independent queue/memory row allowances, per-kind adaptive batches, `setImmediate` yielding, and the governor wait. Busy governor waits use lane `memory-retention` and `maxDeferMs = Math.max(1, msLeft())`; `AbortError` maps to `aborted`; unexpected failures warn once per budget and fail open with the XB2 annotation.
- Added limits: 25,000 memory rows/run, 200-row delete batches, and seven-day cap-eviction grace.
- `MemoryRetentionService.execute` constructs one budget. Purge/quarantine/ledger/reclaim use it in the amended Batch 5 order. The old `msLeft`, `hardStop`, `adaptBatch`, governor closures, private `yieldToGovernor`, and duplicate event-loop helper are gone.
- Existing retention assertions, including the PR #513 governor cases, pass unchanged. No existing spec was re-pointed because none called the removed private helper.
- `memory-retention.service.ts` is 698 lines.

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\retention-run-budget.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\retention-run-budget.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\retention-sqlite.test-support.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention-config.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\tsconfig.lib.json`

## Task 5.2 — MemoryLifecycleStore

Completed with these results:

- All age-delete, archive, cap, and preview SQL is centralized in `MemoryLifecycleStore`.
- Every batch method performs exactly one `BEGIN IMMEDIATE`/`COMMIT`, with rollback and `RetentionStepError` mapping on failure; there is no internal batch loop.
- Lifecycle selects use the required `INDEXED BY` clauses and corpus exclusion. Specs run `EXPLAIN QUERY PLAN` with every named parameter bound and prove the lifecycle and corpus indexes are used without `sqlite_stat1`.
- Archive preserves `updated_at`; cutoffs are strict `<`; pinned/core/corpus rows are protected; `workspace_root IS @ws` keeps NULL and empty-string groups distinct.
- The shared delete pair removes chunks before memories in the same transaction and repeats `tier <> 'core' AND pinned = 0` in both statements. Real SQLite proves FTS docsize, vec rowid, and concept cleanup and same-batch rollback.
- `canDelete()` implements `vecStatus.available || !triggerExists('memory_chunks_vec_ad')`. The reopen-without-vec truth table is pinned.
- Read failures return safe nullable/empty values and accumulate named diagnostics; `SQLITE_BUSY` maps to `database-busy`.
- The only non-spec `SET tier = 'archival'` site in memory-curator is this store; no store SQL sets salience.

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.store.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.store.spec.ts`

## Task 5.3 — MemoryLifecycleService, config, cache invalidation, and DI

Completed with these results:

- The service has exactly five injected dependencies: logger, workspace provider, lifecycle store, memory store, and retention limits.
- Policy order is disabled check, vec gate, age delete, archive, cap eviction, preview, and workspace cache invalidation.
- Every lifecycle write batch uses `hardStop()` -> `memoryRowRoom()` -> `await waitForGovernor()` -> one batch -> observe -> consume -> `yieldToEventLoop()`.
- Cap processing evicts archival rows first with seven-day grace, then recall only when recall alone exceeds the cap; remaining excess is reduced from returned delete counts.
- Disabled and vec-unavailable outcomes remain exhausted and still produce preview; hard stops and the independent memory-row budget omit preview and return the correct stop.
- Settings defaults match platform-core and validate/clamp archive days 7–365, delete days 7–730, and cap 1,000–1,000,000. Settings read fallback is warned and XB2-annotated.
- `MemoryStore.markWorkspacesChanged` bumps the existing generation counter once per supplied root; the service passes a deduplicated union of roots changed by committed batches.
- Both lifecycle collaborators are registered as tsyringe singletons and exported through the public barrel.

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle-config.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\tokens.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\register.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\register.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\index.ts`

## Verification evidence

### Node/Jest via Nx — required full suite

Command:

```text
npx nx run-many -t test -p @ptah-extension/memory-curator
```

Project header and result:

```text
NX Running target test for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator
Test Suites: 2 skipped, 41 passed, 41 of 43 total
Tests:       59 skipped, 619 passed, 678 total
NX Successfully ran target test for project @ptah-extension/memory-curator
```

This is one project. The 59 skips belong to pre-existing suites; the three new Batch 5 specs contain zero `.skip` sites.

### Node 24 / node:sqlite — new specs, zero skips

The ordinary Node ABI cannot load this repository's Electron-rebuilt `better-sqlite3`, so the harness selected `node:sqlite` (confirmed by the opener probe: `node:sqlite fallback`).

Command:

```text
node D:\projects\ptah-extension\node_modules\jest\bin\jest.js --config libs/backend/memory-curator/jest.config.ts --runTestsByPath libs/backend/memory-curator/src/lib/retention/retention-run-budget.spec.ts libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.spec.ts libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.spec.ts --runInBand
```

Scope: one project (`@ptah-extension/memory-curator`).

```text
Test Suites: 3 passed, 3 total
Tests:       28 passed, 28 total
Snapshots:   0 total
```

Skipped tests in new specs: **0**.

### Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/memory-curator
```

```text
NX Running target typecheck for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator
NX Successfully ran target typecheck for project @ptah-extension/memory-curator
```

Result: one project, exit 0.

### Lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/memory-curator
```

```text
NX Running target lint for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator
✖ 5 problems (0 errors, 5 warnings)
NX Successfully ran target lint for project @ptah-extension/memory-curator
```

Result: one project, exit 0. The five warnings are pre-existing and outside Batch 5: one non-null assertion in `memory-search.service.spec.ts`, max-lines in `memory-search.service.ts`, two unused imports in `memory-trigger.coalesce.spec.ts`, and max-lines in `memory-trigger.service.ts`.

### Degradation audit

Command:

```text
npx nx run degradation-audit:lint
```

```text
degradation-audit: scanned 2846 file(s)
libs/backend/memory-curator: 20 ok (baseline 20)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
```

Result: exit 0; the memory-curator baseline did not grow.

### Electron / better-sqlite3

Command (PowerShell, with the pattern kept as one quoted argument):

```text
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-lifecycle|retention-run-budget|memory-retention|observation-retention|di/register.spec|memory.store.spec"' --runInBand
```

Scope: one project (`@ptah-extension/memory-curator`). Under Electron, the harness selects the Electron-built `better-sqlite3` binding.

```text
Test Suites: 43 passed, 43 total
Tests:       678 passed, 678 total
Snapshots:   0 total
```

Result: exit 0, zero skipped.

### Line count and invariant greps

```text
LINE_COUNT 698 libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts
NEW_SPEC_SKIPS 0
ARCHIVAL_SET_SITES memory-lifecycle.store.ts:22 only
REMOVED_SERVICE_HELPERS no matches
```

## Risk and cross-batch handling

- **R-TL1:** Batch 3's restore-only `recordUse` design was not changed. Lifecycle cache invalidation uses the workspace roots returned by committed lifecycle batches and the existing `MemoryStore` instance.
- **R-TL2:** Shared DTO changes remain in Batch 6; Batch 5 does not create a between-commit DTO break.
- **R-TL3:** Decay field/removal work remains in Batch 9 and was not touched.
- **R-TL4:** No `insertMemoryWithChunks` binding change was made here; the existing migration-44-compatible schema remains intact.
- **R-TL5:** No live Ptah database, forbidden state database, or pre-migration snapshot was opened. All SQL tests used fresh OS-temp databases; no migration runner or backup service was invoked.
- **R-TL6:** Batch 5 was executed sequentially in its assigned worktree; no parallel memory-curator lane was used.
- **R-TL7:** No `memory-lifecycle.timing.local.spec.ts` file was created or run.
- **R-TL8:** Neither known load flake occurred, so the `--parallel=1` contingency rerun was not needed.
- **R-TL9:** `src/**/*.test-support.ts` is excluded from `tsconfig.lib.json`; the one-project typecheck passes.
- **R-TL10:** `memory-retention.service.ts` is 698 lines, below the 700-line ceiling.
- **R4:** `canDelete()` blocks destructive memory/chunk deletion when the vec cleanup trigger exists but vec is unavailable. Real SQLite proves false with the trigger present and true after it is removed; the service still archives and records `vec-unavailable` without due-looping.
- **XB1:** Every new named or positional SQL statement, including all `EXPLAIN QUERY PLAN` helpers, binds every parameter. Both node:sqlite (28/28 new tests) and Electron/better-sqlite3 (678/678) pass.
- **XB2:** Every new fail-open/default catch carries a `degradation-audit` annotation. Audit exits 0 and memory-curator remains 20/20 against baseline.
- **XB3:** One shared `beforeBatch` gate enforces hard stop, memory row room, then awaited governor clearance before each age-delete, archive, and cap-eviction batch. Specs prove no store batch runs while held, one wait per batch, AbortError stops further writes, and preview reads do not wait.

## Plan deviations

The implementation follows the Batch 5 task text where it supersedes the older plan: governor admission moved into `RetentionRunBudget`, and `MemoryRetentionService.execute` was swapped onto that budget in this batch. No other plan deviation was needed.

## Out-of-scope observations

The lint target retains five warnings in pre-existing memory-search/memory-trigger files. They were not edited because they are outside Batch 5 ownership. No required verification failed.

## Revision 1

Applied the Batch 5 Revision 1 fix list without changing any delete, archive, evict, exemption, or lifecycle query SQL.

### Diff summary

- M1: removed the singleton `MemoryLifecycleStore.readErrors` field. `overCapWorkspaces` now returns `{ workspaces, readErrors }` from a fresh local array, and `readPreview` returns its three counts plus its own fresh `readErrors`. `overCap` is `null` only when the over-cap read itself failed.
- M1: added `readErrors` to `MemoryLifecycleStepResult`, always present. Cap-read and preview-read diagnostics now flow through the step result for Batch 6.
- M2: added real-SQLite failure/recovery assertions for the archive count, delete count, and over-cap reads. Each failed field is `null`, each failure contributes one named message, and repaired follow-up calls return `readErrors: []` with no stale diagnostics.
- M2: added service coverage proving an over-cap read failure runs no evict batch, does not throw, preserves the step's exhausted result, and reaches `MemoryLifecycleStepResult.readErrors`; preview errors are also propagated.
- m4: removed the dead `archivalExcess` reassignment. Recall eviction remains based only on `recallEvictable - maxPerWorkspace`.
- m5: restored the accurate hourly-cron-tick documentation. `memory-retention.service.ts` remains within the ceiling at exactly 700 lines.
- XB1: every new prepared statement binds every parameter. The read-failure fixtures use parameter-free DDL and the production reads continue to bind `cutoff`/`cap` fully.
- XB2: the moved fail-open catches retain their `degradation-audit` annotations; no new catch was introduced.

Revision files:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.store.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.store.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\index.ts`

### Revision 1 verification

`npx nx run-many -t test -p @ptah-extension/memory-curator`:

```text
NX Running target test for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator
Test Suites: 2 skipped, 41 passed, 41 of 43 total
Tests:       59 skipped, 623 passed, 682 total
NX Successfully ran target test for project @ptah-extension/memory-curator
```

Result: 1 project, exit 0. The pre-existing suites account for the 59 skips; Batch 5's three new specs still contain 0 skip markers.

`npx nx run-many -t typecheck -p @ptah-extension/memory-curator`:

```text
NX Running target typecheck for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator
NX Successfully ran target typecheck for project @ptah-extension/memory-curator
```

Result: 1 project, exit 0.

`npx nx run-many -t lint -p @ptah-extension/memory-curator`:

```text
NX Running target lint for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator
✖ 5 problems (0 errors, 5 warnings)
NX Successfully ran target lint for project @ptah-extension/memory-curator
```

Result: 1 project, exit 0. The same five pre-existing warnings remain in memory-search/memory-trigger files; Revision 1 adds none.

`npx nx run degradation-audit:lint`:

```text
degradation-audit: scanned 2846 file(s)
libs/backend/memory-curator: 20 ok (baseline 20)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
```

Result: exit 0; baseline unchanged.

Electron/better-sqlite3 command:

```text
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-lifecycle|retention-run-budget|memory-retention|observation-retention|di/register.spec|memory.store.spec"' --runInBand
```

```text
Test Suites: 43 passed, 43 total
Tests:       682 passed, 682 total
Snapshots:   0 total
```

Result: exit 0, zero skipped.

Line and invariant checks:

```text
LINE_COUNT 700 libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts
NEW_SPEC_SKIPS 0
SINGLETON_READ_ERROR_REFS 0
```

### Git diff --stat

The backend-developer execution contract prohibits running Git commands, including read-only `git diff --stat`. It was therefore not executed in this lane. The revision file inventory above is the exact six-file implementation/spec surface changed by Revision 1; the invoking workflow can append the repository-generated stat before commit.
