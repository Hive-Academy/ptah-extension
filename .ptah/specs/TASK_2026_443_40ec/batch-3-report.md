# Batch 3 report — ranking-only salience and explicit use recording

## Backend implementation — `TASK_2026_443_40ec`, batch 3

**Tasks completed**: 3.1, 3.2, 3.3

## Task 3.1 — ranking-only salience

Completed. Stored salience is now an insert-time base. The pure ranking module owns the shared constants, base clamp, JavaScript mirror, and the two literal SQL order clauses. `MemoryStore.list`, `MemoryStore.listAll`, and `MemorySearchService.listIndexRowsByFilter` bind a current ranking time and use the same expression. Curator merges append chunks without changing salience; inserts use `baseSalience(hint, boost)`. The scorer token, registration, public export, implementation, and store salience-write method were removed.

Evidence:

- Real-SQLite parity covers fresh/7/30/90-day rows, 0/3/50 hits, pinned/unpinned rows, deterministic ties, recent-vs-old ordering, and base clamping.
- Real-SQLite store coverage pins ranking order for both `list` and `listAll`.
- Search coverage pins the positional rank-time bind before `LIMIT`.
- Non-spec source grep `SET salience|salience = ` under `libs/backend/memory-curator/src` returned no matches.

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\salience-ranking.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\salience-ranking.spec.ts`
- DELETED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\salience-scorer.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\index.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-search.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-search.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-curator.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-curator.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\tokens.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\register.ts`

## Task 3.2 — explicit use recording

Completed. `MemoryStore` implements `IMemoryUsageRecorder`; `recordUse` deduplicates before the 200-id cap, treats empty/unknown ids as no-ops, increments each selected memory once, refreshes `last_used_at`, restores archival rows to recall, clears `archived_at`, warns once per failed call, and never throws. Search no longer writes usage and always slices the fused result to `topK`, including without a reranker and on cache hits. Archival inserts stamp `archived_at`; appends restore an archival target. DI aliases the usage-recorder token to the singleton store and the spec resolves both the constant and the required `Symbol.for('PtahMemoryUsageRecorder')` literal.

R-TL1 was implemented exactly as the validation correction: one database transaction performs `SELECT DISTINCT workspace_root ... tier = 'archival'` first and then the `UPDATE`; there is no `RETURNING`. Only the roots selected before the update have their write counter bumped. The real-SQLite spec pins both a restored-root bump and no bump for ordinary recall use.

The Batch 2 review carry was applied to the port documentation: duplicate ids count once, implementations may cap at 200, and ids after the cap are ignored.

Files:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-contracts\src\lib\memory-usage-recorder.port.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-search.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-search.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\register.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\register.spec.ts`

## Task 3.3 — Electron seed DDL

Completed. The hand-written Electron integration schema now declares nullable `archived_at INTEGER`, keeping the wizard seed path compatible with the new insert bind. This is Deviation 4 / R-TL4.

File:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\apps\ptah-electron\src\integration\wizard-seed.integration.spec.ts`

## Cross-batch rule XB1

Every new prepared statement in the Batch 3 specs binds all named and positional parameters. Production `recordUse` uses `{ ids }` for the archival-root SELECT and `{ ids, now }` for the UPDATE, avoiding both missing and surplus named binds. Ranking parity binds `now` plus the row id; ordering binds `now`; seed INSERTs bind all 25 positional values. The same four targeted suites pass under both SQLite bindings.

## Verification

### Required batch commands

Command:

`npx nx run-many -t test -p @ptah-extension/memory-curator ptah-electron`

Observed header:

`NX Running target test for 2 projects and 5 tasks they depend on:`

Observed results:

- `@ptah-extension/memory-curator` — `Test Suites: 2 skipped, 36 passed, 36 of 38 total`; `Tests: 59 skipped, 553 passed, 612 total`.
- `ptah-electron` — `Test Suites: 1 skipped, 42 passed, 42 of 43 total`; `Tests: 4 skipped, 553 passed, 557 total`.
- Final: `NX Successfully ran target test for 2 projects and 5 tasks they depend on`.
- Normal Node run binding proof: `binding=node:sqlite sqlite=3.51.3` (the Electron-ABI `better-sqlite3` load failed first, so the shared fail-not-skip opener selected `node:sqlite`).

Command:

`npx nx run-many -t typecheck -p @ptah-extension/memory-curator`

Observed header: `NX Running target typecheck for project @ptah-extension/memory-curator:` (one project).

Observed result: `NX Successfully ran target typecheck for project @ptah-extension/memory-curator`.

Command:

`npx nx run-many -t lint -p @ptah-extension/memory-curator`

Observed header: `NX Running target lint for project @ptah-extension/memory-curator:` (one project).

Observed result: `NX Successfully ran target lint for project @ptah-extension/memory-curator`. ESLint reported 0 errors and 5 warnings (existing max-lines/unused/non-null warnings; no Batch 3 error).

### Mandatory Electron better-sqlite3 run

Command (PowerShell quoting retained the pipe pattern through `electron.cmd`):

`$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"salience-ranking|memory.store.spec|memory-search.service.spec|di/register.spec"' --runInBand`

Observed binding proof: `binding=better-sqlite3 sqlite=3.53.1` under the same Electron-as-Node executable.

Observed Jest lines:

- `Test Suites: 4 passed, 4 total`
- `Tests: 82 passed, 82 total`
- `Snapshots: 0 total`
- `Ran all test suites matching salience-ranking|memory.store.spec|memory-search.service.spec|di/register.spec.`

### Invariant grep

`rg "SalienceScorer|MEMORY_SALIENCE_SCORER|recordHit|updateSalience" libs` has two intentional text-only matches:

- `libs/backend/memory-curator/src/lib/di/register.spec.ts` contains the batch-required negative assertion `Symbol.for('PtahMemorySalienceScorer')`.
- `libs/backend/memory-curator/CLAUDE.md` contains pre-existing documentation drift assigned to Task 10.1 and was not edited in this batch.

There are no production-code matches. The batch instruction requiring the negative literal assertion and the unqualified zero-match grep are textually incompatible; the required assertion and batch ownership were preserved.

## Stack observed

TypeScript 5.9 in an Nx 22.6 monorepo; product-side DI uses tsyringe (`libs/backend/memory-curator/src/lib/di/register.ts`); persistence is supplied through `SqliteConnectionService` and its synchronous `SqliteDatabase` contract (`libs/backend/memory-curator/src/lib/memory.store.ts`); tests use the repository's fail-not-skip real-SQLite adapter (`libs/backend/memory-curator/src/lib/retention/retention-sqlite.test-support.ts`). No external boundary or new dependency was introduced.

## Plan deviations

The plan removes the scorer in Batch 3 but schedules deletion of the still-compiled decay job for Batch 9. To keep every Batch 3 verification command green while preserving immutable stored salience, the unscheduled interim decay job now reads the pure ranking function and performs only tier changes through `MemoryStore.updateTier`; its focused interim spec was updated. Batch 9 can still delete the job, token, diagnostics integration, and spec as planned.

Files additionally modified for this buildability bridge:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-decay.job.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-decay.job.spec.ts`

## Out-of-scope observations

- Batch 4's uncommitted `libs/backend/agent-sdk` and `libs/backend/vscode-lm-tools` changes were not touched.
- Pre-existing task documents and Batch 4 review/report files in the dirty worktree were not touched.
- No live Ptah database, WAL/SHM file, or pre-migration snapshot was opened.
- No `nx reset`, git commit, push, stash, or staging operation was run.

## Revision 1

Applied the three Batch 3 revision items, changing only the two assigned spec files.

### M1 — usage-recorder alias identity

`register.spec.ts` now resolves `MEMORY_TOKENS.MEMORY_STORE` and proves that both recorder token spellings resolve to that exact singleton instance:

- `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER`
- `Symbol.for('PtahMemoryUsageRecorder')`

Resolving the store reached `EmbedderWorkerClient`, whose required tracer token was not present in the existing test container. The spec now registers the repository's existing `NoopTracer` under `PLATFORM_TOKENS.TRACER`; no production registration or implementation changed.

### m2 — core and pinned recall use

The real-SQLite store spec now seeds one core memory and one pinned recall memory, records both in one call, and asserts for each row:

- `hits` increments from 0 to 1;
- `last_used_at` falls within the call's measured time interval;
- core remains `core` and pinned recall remains `recall`;
- neither workspace write counter increments.

### XB1

The new real-SQLite SELECT uses two positional placeholders and binds both ids via `.all('core', 'pinned-recall')`. The identity assertions prepare no SQL.

### Verification

Command:

`npx nx run-many -t test -p @ptah-extension/memory-curator`

Observed header: `NX Running target test for project @ptah-extension/memory-curator:` (1 project).

Observed test lines:

- `Test Suites: 2 skipped, 36 passed, 36 of 38 total`
- `Tests: 59 skipped, 554 passed, 613 total`
- `Snapshots: 0 total`
- `NX Successfully ran target test for project @ptah-extension/memory-curator`

The first run exposed the missing tracer dependency while resolving the store and failed only the new identity assertion. After registering `NoopTracer` in the test container, the required command above passed.

Electron better-sqlite3 command:

`$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"di/register.spec|memory.store.spec"' --runInBand`

Observed test lines:

- `Test Suites: 2 passed, 2 total`
- `Tests: 42 passed, 42 total`
- `Snapshots: 0 total`
- `Ran all test suites matching di/register.spec|memory.store.spec.`

### Two-spec diff stat

```text
 .../memory-curator/src/lib/di/register.spec.ts     |  22 +-
 .../memory-curator/src/lib/memory.store.spec.ts    | 233 ++++++++++++++++++++-
 2 files changed, 243 insertions(+), 12 deletions(-)
```

This stat is against the branch HEAD and therefore includes the original uncommitted Batch 3 changes already present in these two files. Revision 1 itself added only the identity/tracer assertions and the core/pinned real-SQLite case described above. `git diff --check` passed for both files.
