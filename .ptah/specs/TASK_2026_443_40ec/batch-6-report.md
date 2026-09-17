# Batch 6 report — retention lifecycle reachability

## Backend implementation — `TASK_2026_443_40ec`, batch 6

**Tasks completed**: 6.1, 6.2, 6.3, 6.4.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-storage-health.ts` — extracted the diagnostics mapping so the retention facade remains below the 720-line ceiling.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts` — injects and runs lifecycle with the shared budget; records counters/note/preview; folds lifecycle read errors into sanitized storage health.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.types.ts` — lifecycle counters and note on run reports.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts` — nine migration-0044 columns in state, run record, SQL, binding and mapping; null preview preserves prior preview.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\observation-retention.store.spec.ts` — persistence and null-preview coverage.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts` — lifecycle call/order/budget identity, skip gates, counters, exhaustion, carried m3, governor and storage-health coverage.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts` — real SQLite/sqlite-vec reachability cases through `MemoryRetentionService.run`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\retention-sqlite.test-support.ts` — lifecycle state columns for the observation-only schema path.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\register.spec.ts` — registered-graph lifecycle reach on a real lifecycle database.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\diagnostics.service.spec.ts` — required DTO fixture field.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts` — required run counters, preview DTO and lifecycle storage-health section; decay fields remain unchanged.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.spec.ts` — typed fixture fields only.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts` — typed fixture fields only.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\thoth-runtime\src\lib\memory-retention-job.spec.ts` — required `MemoryRetentionRunReport` fixture fields found by the mandated six-project test.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-6-report.md` — this report.

## Stack observed

- Nx 22.6 monorepo, TypeScript 5.9, Node 24 (`package.json`, `.nvmrc`, `tsconfig.base.json`).
- Product-side DI is tsyringe; lifecycle/store/retention registrations are singleton token registrations in `libs/backend/memory-curator/src/lib/di/register.ts`.
- Persistence is `better-sqlite3`/`node:sqlite` behind `SqliteConnectionService`; lifecycle integration loads sqlite-vec through the existing test harness.
- Settings are read through `IWorkspaceProvider`; the shared DTO remains the backend/frontend boundary.

## Task evidence

### 6.1

- `MEMORY_LIFECYCLE_SERVICE` is constructor parameter 7; optional governor is parameter 8 and remains last.
- `execute` calls `lifecycle.runStep(budget, startedAt)` after quarantine for null/row-budget stops, passing the same `RetentionRunBudget` object.
- Lifecycle stop only replaces a null run stop. Completion additionally requires `lifecycleResult.exhausted`.
- Counters, note and preview flow through `writeRun`; all nine 0044 fields round-trip. A null preview uses SQL `COALESCE` to retain every prior preview column.
- `storageHealth()` uses live lifecycle settings plus state only (no memories-table poll), and sanitizes retained lifecycle read errors with the same mapper as local read errors.
- Carried m3 is pinned using the real `MemoryLifecycleService`: a throwing `canDelete()` returns a failed run, invokes no archive/delete batch, and a second run is not blocked by single-flight.
- Governor specs prove budget identity, a busy governor holds the first lifecycle write, and lifecycle-wait `AbortError` yields partial/aborted without ledger prune or reclaim.
- Facade line count: **662**.

### 6.2

- Added the required three run counters, `MemoryLifecyclePreviewDto`, and required `memoryLifecycle` section exactly at the shared wire boundary.
- The producer maps all three counters. `lastDecay*` and `'decay-run'` remain intact for Batch 9.
- Only fixture data changed in the two named frontend specs.

### 6.3

- DI spec opens a real lifecycle-schema database with sqlite-vec, registers the production graph, resolves the singleton retention service, runs beyond boot deferral with gates open, reports numeric `memoriesArchived === 1`, and changes the seeded 31-day-unused row from recall to archival.
- This detects missing lifecycle store/service registration, missing `runStep` reach, and missing report counters.

### 6.4

- Real SQLite/sqlite-vec tests cover: vec load; Run 1 archival of 45 rows; use restoration; AC2 at T0+30 d with zero deletes; T0+61 d deletion of 44 rows and memories/chunks/FTS-docsize/vec-rowid/concept orphan checks; FTS and KNN absence; survivors; reclaim and preview; archival-cap six-row eviction; recall-cap ten-row eviction; first-run guard; vec unavailable; 25-row shared budget and hourly continuation; mid-delete rollback and flag release; disabled preview-only behavior.
- `register.spec.ts` + `memory-retention.integration.spec.ts`: **19 passed, 0 skipped**. No `.skip`, `xit`, or `xdescribe` declarations exist in either file.

## Mutation checks and restoration proof

### A — remove lifecycle `runStep`

Command:

`npx jest --config libs/backend/memory-curator/jest.config.ts --runInBand --runTestsByPath libs/backend/memory-curator/src/lib/di/register.spec.ts libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts --testNamePattern "resolved graph calls lifecycle|archives at T0"`

Observed expected failure (exit 1): **2 suites failed, 2 tests failed**. DI expected `memoriesArchived: 1`, received `0`; integration Run 1 expected 45 archived/completed, received 0/partial.

### B — remove chunk DELETE from the atomic pair

The production-like handle explicitly enables FKs, whose cascade masks the missing explicit delete. For the mutation only, FK enforcement was switched off before T0+61 d; no production/test change was retained. The same Run 1 case then failed an orphan assertion with **expected 0 chunks, received 2** (exit 1, 1 suite/1 test failed). The permanent spec also pins issuance of `DELETE_CHUNKS_SQL`, so the pair cannot silently regress on FK-enabled fixtures.

### Restore

- Restored source contains `memory-retention.service.ts:377 lifecycle.runStep(budget, startedAt)`.
- Restored source contains `memory-lifecycle.store.ts:284 this.statement(db, DELETE_CHUNKS_SQL).run(bound)`.
- Final focused rerun: **2 suites passed, 19 tests passed, 0 skipped**.
- `git diff --check`: exit 0. The only lifecycle-store difference used for mutation was restored, so it is absent from the final diff.

## Verification outputs

### Six-project tests

First default-parallel attempts timed out in the command wrapper without a result (120 s, then 600 s) while another pre-existing Nx executor was active. Per R-TL8/load guidance, the deterministic rerun used `NX_DAEMON=false --parallel=1` and did not run `nx reset`.

Header: `NX Running target test for 6 projects`.

Final: `NX Successfully ran target test for 6 projects` (exit 0). Project summaries: shared 58 suites/1520 tests; memory-curator-ui 17/184; memory-curator 41 passed suites, 2 pre-existing skipped suites, 641 passed and 59 pre-existing skipped tests; rpc-handlers 101 suites/3002 passed/33 skipped; thoth-runtime 5/90; cli-engine 19/187. An initial completed rerun exposed the newly-required thoth fixture fields; after adding them, the final run passed.

### Six-project typecheck

Header: `NX Running target typecheck for 6 projects`.

Result: `NX Successfully ran target typecheck for 6 projects` (exit 0).

### Three-project lint

Header: `NX Running target lint for 3 projects`.

Result: `NX Successfully ran target lint for 3 projects` (exit 0). No errors; existing warnings only (memory-curator 5, shared 2, memory-curator-ui 27).

### Degradation audit

`npx nx run degradation-audit:lint`: exit 0; `libs/backend/memory-curator: 20 ok (baseline 20)`; target succeeded.

### node:sqlite

Command used the mandatory memory-curator pattern under Node/Jest.

`Test Suites: 2 skipped, 41 passed, 41 of 43 total`

`Tests: 59 skipped, 641 passed, 700 total`

The skipped suites/tests are pre-existing binding-specific cases; the two required reach suites separately ran 19/19 with 0 skipped.

### better-sqlite3 via Electron

Command used the exact quoted pattern from Batch 6.

`Test Suites: 43 passed, 43 total`

`Tests: 700 passed, 700 total`

Exit 0.

### Additional checks

- Focused retention/store/DI/integration baseline and post-restore: 4 suites passed, 90 tests passed.
- Ptah scoped TypeScript diagnostics: 0 errors, 0 warnings.
- `git diff --check`: exit 0.
- Service line count: 662.

## Cross-batch risks and rules

- **R-TL1**: Batch 3's transactional pre-select `recordUse` implementation is consumed as-is; restoration behavior is exercised at T0+10 d.
- **R-TL2**: required DTO fields, producer mappings, and typed fixtures land together here.
- **R-TL3**: no decay field/event removal was made.
- **R-TL4**: lifecycle integration uses migration-backed `archived_at`; no wizard DDL was changed.
- **R-TL5**: no live database, snapshot, migration runner, backup service, or timing copy was opened.
- **R-TL6**: no parallel batch edits were made; final checks used the current worktree state.
- **R-TL7**: no local timing harness was created.
- **R-TL8**: two parallel verification attempts timed out; the `--parallel=1` rerun completed and is recorded above.
- **R-TL9**: existing test-support exclusion remains effective; six-project typecheck passed.
- **R-TL10**: retention facade is 662 lines after extracting the cohesive storage-health mapper.
- **R4**: `canDelete()` prevents destructive deletes when vec is unavailable; real integration proves archive-only completion with no `vec0` error and a not-due next hour.
- **XB1**: every added SQL call binds all named/positional parameters. The identical pattern passed under node:sqlite and better-sqlite3.
- **XB2**: the new fail-open lifecycle-settings catch carries `degradation-audit: optional-capability`; audit passed with memory-curator at 20.
- **XB3**: lifecycle receives the same run budget and calls `waitForGovernor()` before each delete/archive/evict batch; abort stops it before ledger/reclaim.
- **Carried m3**: explicitly covered as described under Task 6.1.

## Plan deviations

- Added `memory-storage-health.ts` as the nameable diagnostics-mapping concern to keep the public retention service under the stated line ceiling; public class/token/method contracts are unchanged.
- Added the thoth-runtime run-report fixture fields after the mandated project test found its typed factory. This is a fixture-only compatibility edit caused by the newly required report fields.
- The chunk-delete mutation is masked by FK cascade when `foreign_keys=ON`; the mutation-only FK-off run proves the orphan assertion, while the committed test also pins the explicit SQL issuance.

## Out-of-scope observations

- The six-project test output retains pre-existing skipped binding-specific suites and Jest worker teardown warnings; neither required reachability spec skips.
- Existing lint warnings remain unchanged in the three linted projects.

## Revision 1

### Fix-list completion

1. **M1 — foreign-keys-off reachability and orphan proof**
   - Added `RetentionTestDb.reopenWithoutForeignKeys()`. It closes and reopens the same temp-file database, reloads sqlite-vec, executes `PRAGMA foreign_keys = OFF`, reads the pragma back, and throws unless the observed value is exactly `0`.
   - Added a committed real-SQLite/sqlite-vec integration case that archives two old recall memories at T0, reopens with foreign keys off, and deletes them through `MemoryRetentionService.run` at T0 + 61 d.
   - For every deleted memory the case asserts zero `memories`, zero `memory_chunks`, zero `memory_concepts_fts`, zero `memory_chunks_fts_docsize` rows for every captured chunk rowid, and zero `memory_chunks_vec_rowids` rows for every captured chunk rowid. Fresh, pinned, and core survivors remain.
   - Every prepared statement in the new helper/spec binds all positional parameters (XB1).
2. **m2 — stale lifecycle read errors**
   - `MemoryRetentionService` now clears `lifecycleReadErrors` immediately before awaiting `lifecycle.runStep(...)`.
   - Added a regression spec: one run returns `readErrors: ['x']`; a later due run throws in lifecycle; `storageHealth().readErrors` no longer contains `x`.
3. **m4 — run-budget identity**
   - Strengthened the lifecycle persistence spec by capturing the `RetentionRunBudget` instance observed by the queue phase's `waitForGovernor()` call and asserting with `toBe` that lifecycle receives that exact instance.
4. **XB2 / scope guard**
   - No new fail-open/default-return catch was added, so no new degradation annotation was required. The audit remains at the memory-curator baseline of 20.
   - No SQL constant, `deletePair`, or delete/archive/evict production path was changed. The mutation was fully restored.

### Revision 1 files modified

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\retention-sqlite.test-support.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-6-report.md` (this appended section)

### FK-off mutation check

Baseline command:

`npx jest --config libs/backend/memory-curator/jest.config.ts --runTestsByPath libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts --testNamePattern "deletes every dependent row at T0 \+ 61 d when foreign keys are off" --runInBand`

Baseline output:

```text
Test Suites: 1 passed, 1 total
Tests:       15 skipped, 1 passed, 16 total
```

Mutation: temporarily removed only `this.statement(db, DELETE_CHUNKS_SQL).run(bound);` from `deletePair`, without changing the SQL constant. The same command failed as required:

```text
FAIL memory-curator ...memory-retention.integration.spec.ts
Expected: 0
Received: 2
at memory-retention.integration.spec.ts:468:9
Test Suites: 1 failed, 1 total
Tests:       1 failed, 15 skipped, 16 total
```

After restoring the invocation, the same case passed again:

```text
Test Suites: 1 passed, 1 total
Tests:       15 skipped, 1 passed, 16 total
```

Restore proof: `git diff -- libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.ts` produced no output. `git diff --check` exited 0.

### Unchanged Batch 6 command set

#### Tests

`npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/memory-curator-ui @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime @ptah-extension/cli-engine`

```text
NX   Running target test for 6 projects:
NX   Successfully ran target test for 6 projects
```

Exit 0. Project Tests lines:

```text
shared:            Tests: 1520 passed, 1520 total
memory-curator-ui: Tests: 184 passed, 184 total
memory-curator:    Tests: 59 skipped, 643 passed, 702 total
rpc-handlers:      Tests: 33 skipped, 3002 passed, 3035 total
thoth-runtime:     Tests: 90 passed, 90 total
cli-engine:        Tests: 187 passed, 187 total
```

The first unchanged invocation was cut off by the command harness at 124 seconds with no buffered Nx output. Its three scoped processes were terminated, and the exact command above was rerun unchanged to the successful result recorded here.

#### Typecheck

`npx nx run-many -t typecheck -p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/memory-curator-ui @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime @ptah-extension/cli-engine`

```text
NX   Running target typecheck for 6 projects:
NX   Successfully ran target typecheck for 6 projects
```

Exit 0; all six TypeScript/Angular compiler targets passed.

#### Lint

`npx nx run-many -t lint -p @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/memory-curator-ui`

```text
NX   Running target lint for 3 projects:
NX   Successfully ran target lint for 3 projects
```

Exit 0. Existing warnings only: shared 2, memory-curator-ui 27, memory-curator 5; zero errors.

#### Degradation audit

`npx nx run degradation-audit:lint`

```text
degradation-audit: scanned 2847 file(s)
libs/backend/memory-curator: 20 ok (baseline 20)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

Exit 0.

#### Electron / better-sqlite3

`$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-lifecycle|retention-run-budget|memory-retention|observation-retention|di/register.spec|memory.store.spec"' --runInBand`

```text
Test Suites: 43 passed, 43 total
Tests:       702 passed, 702 total
Snapshots:   0 total
```

Exit 0. The required reachability specs therefore execute under better-sqlite3/sqlite-vec as well as the focused node:sqlite run above.

#### Line and skip counts

- `memory-retention.service.ts`: **663 physical lines** (`[System.IO.File]::ReadAllLines(...).Length`), below the ~720 ceiling.
- `di/register.spec.ts`: **0** skipped tests.
- `memory-retention.integration.spec.ts`: **0** skipped tests.

### Requested `git diff --stat`

```text
 .../memory-curator/src/lib/di/register.spec.ts     |  43 +-
 .../src/lib/diagnostics.service.spec.ts            |   8 +
 .../retention/memory-retention.integration.spec.ts | 617 ++++++++++++++++++++-
 .../lib/retention/memory-retention.service.spec.ts | 289 +++++++++-
 .../src/lib/retention/memory-retention.service.ts  | 185 +++---
 .../src/lib/retention/memory-retention.types.ts    |   4 +
 .../retention/observation-retention.store.spec.ts  |  34 +-
 .../lib/retention/observation-retention.store.ts   |  69 ++-
 .../lib/retention/retention-sqlite.test-support.ts |  38 +-
 .../src/lib/memory-retention-job.spec.ts           |   4 +
 .../memory-diagnostics-accordion.component.spec.ts |  12 +-
 .../storage-health-panel.component.spec.ts         |  21 +-
 .../lib/types/rpc/rpc-curator-diagnostics.types.ts |  37 +-
 13 files changed, 1203 insertions(+), 158 deletions(-)
```

The stat is for the complete uncommitted Batch 6 worktree, including the original Batch 6 implementation. The new untracked `memory-storage-health.ts` is not represented by plain `git diff --stat`; it remains listed in `git status --short` as part of the original Batch 6 work.
