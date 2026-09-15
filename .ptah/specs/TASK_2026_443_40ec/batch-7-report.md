# Batch 7 report — `TASK_2026_443_40ec`

## Backend implementation — `TASK_2026_443_40ec`, batch 7

**Tasks completed**: 7.1 retention summary, 7.2 Electron lifecycle reachability, 7.3 CLI lifecycle reachability, 7.4 R-TL11 integration-suite load robustness.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\thoth-runtime\src\lib\memory-retention-job.ts` — changed only the completed/partial summary literal to include archived, deleted, and evicted memory counts.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\thoth-runtime\src\lib\memory-retention-job.spec.ts` — pinned the new completed and partial summaries.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\thoth-runtime\src\lib\start-thoth-cron.spec.ts` — added the Electron-host reachability proof through a real `MemoryRetentionService`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\thoth-runtime\CLAUDE.md` — documented the lifecycle step and exact summary shape.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts` — added the CLI-host reachability proof through a real `MemoryRetentionService`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts` — switched the two fixed-size cap cohorts to the transaction-backed batch seed helper without changing row counts or assertions.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\retention-sqlite.test-support.ts` — added `seedMemories`, which prepares all five statements once and inserts one seed cohort in one transaction.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-7-report.md` — this report.

No production host registration file changed. In particular:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\thoth-runtime\src\lib\start-thoth-cron.ts` — unchanged.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts` — unchanged.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts` — mutation restored; no diff.

## Stack observed

- Nx 22.6.5 monorepo, TypeScript 5.9.3, Jest 30.0.2, tsyringe 4.10.0, and better-sqlite3 13.0.3 from `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\package.json`.
- Product-side wiring uses tsyringe tokens. Both hosts register the shared `createMemoryRetentionHandler`; the reach tests resolve `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` from their host container seam.
- The real service constructor order used by both proofs is logger, workspace, SQLite connection, page reclaimer, observation store, limits, lifecycle, optional governor. The governor is `null`, so the real `RetentionRunBudget` follows its no-governor fast path.
- The specs use the existing internal configuration seam; there is no new external boundary or untrusted input.

## Task evidence

### 7.1 — summary and documentation

The summary is now:

```text
purged <p> processed, quarantined <q> stuck, archived <a> / deleted <d> / evicted <e> memories, reclaimed <r> pages
```

The existing partial suffix remains `(partial: <reason>)`. The single guarded dependency-resolution block, job id `@ptah/memory-retention`, job name, handler name `memory:retention`, cron `17 * * * *`, gating, and failed-report throw channel are unchanged.

### 7.2 — Electron reachability

`start-thoth-cron.spec.ts` registers an actual `MemoryRetentionService` under `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE`, starts `startThothCron`, invokes the registered `memory:retention` handler, and proves:

- the lifecycle spy returns `{ archived: 4, deleted: 2, evicted: 1, exhausted: true, stop: null, note: null, preview: null, readErrors: [] }`;
- `runStep` is called exactly once;
- its arguments are `expect.any(RetentionRunBudget)` and `expect.any(Number)`;
- the handler summary contains `archived 4 / deleted 2 / evicted 1 memories`.

### 7.3 — CLI reachability

`thoth-runtime.spec.ts` performs the same proof through `activateThoth(container, 'runtime', logger)`. The existing oneshot assertion remains and still proves no handlers or jobs are registered for the oneshot tier.

### 7.4 — R-TL11

The slow cap cases were dominated by complete-memory seed setup: every row was committed separately and each call prepared the memory, chunk, rowid lookup, vec, and concept statements again. `seedMemories` now prepares those statements once and wraps each cohort in one transaction. Production code and assertions are unchanged.

Fixed seed counts remain intact:

- archival cap cohort: 1,006 workspace-A cap rows (1,003 old + 3 grace), plus the existing workspace-B and protected controls;
- recall cap cohort: 1,010 rows;
- main lifecycle cohort: existing 40/10/2/2/2/5 groups unchanged.

`expect(` count before: **159**. After: **159**.

Per-test durations are Jest `assertionResults[].duration` values from the before/after JSON measurements; totals below also record the exact required verbose commands.

| Test (short title) | Before ms | After ms |
|---|---:|---:|
| loads sqlite-vec without skipping | 113 | 171 |
| archives at T0, restores use, waits through +30 d, then deletes dependants | 578 | 697 |
| deletes dependants with foreign keys off | 157 | 232 |
| evicts six oldest grace-eligible archival rows | 3,693 | 417 |
| evicts ten oldest recall rows | 3,600 | 408 |
| back-to-back first run guard | 210 | 300 |
| vec unavailable archive / not-due | 113 | 170 |
| shared memory budget / next-hour completion | 212 | 293 |
| mid-delete rollback / single-flight release | 1,026 | 1,370 |
| disabled lifecycle preview | 166 | 148 |
| real SQLite binding | 3 | 7 |
| purge/quarantine/reclaim/default windows/idempotence | 336 | 483 |
| shared purge/quarantine row cap | 123 | 117 |
| row-budget next-hour completion | 65 | 78 |
| third-purge failure / flag release | 70 | 82 |
| governor wait before real-SQLite purge | 46 | 57 |

The two targeted slow cases improved by about 89% each. The required verbose baseline completed 16/16 in 20.241 s; the required post-change verbose run completed 16/16 in 12.501 s. The comparable JSON timing runs were 13.211 s before and 12.230 s after.

## Mutation checks

No mutation was committed.

### Mutation A — remove `lifecycle.runStep(...)` from `MemoryRetentionService.execute`

Header/output:

```text
===== MUTATION A: lifecycle.runStep removed — Electron proof =====
MUTATION_A_ELECTRON_EXIT=1
Expected number of calls: 1
Received number of calls: 0
Tests: 1 failed, 30 skipped, 31 total

===== MUTATION A: lifecycle.runStep removed — CLI proof =====
NX Running target test for project @ptah-extension/cli-engine failed
MUTATION_A_CLI_EXIT=1
Expected number of calls: 1
Received number of calls: 0
Tests: 1 failed, 20 skipped, 21 total
```

Both host proofs failed at their `runStep` call-count assertion.

### Mutation B — remove `service.run(...)` from `createMemoryRetentionHandler`

The first mutation-B attempt failed both suites during compilation because the temporary hand-built report allowed a skipped status with a null reason. The mutation was adjusted to preserve the handler result type and rerun, so the meaningful semantic result is recorded below:

```text
===== MUTATION B (semantic rerun): service.run removed — Electron proof =====
MUTATION_B_ELECTRON_EXIT=1
Expected number of calls: 1
Received number of calls: 0
Tests: 1 failed, 30 skipped, 31 total

===== MUTATION B (semantic rerun): service.run removed — CLI proof =====
NX Running target test for project @ptah-extension/cli-engine failed
MUTATION_B_CLI_EXIT=1
Expected number of calls: 1
Received number of calls: 0
Tests: 1 failed, 20 skipped, 21 total
```

Both host proofs failed at their `runStep` call-count assertion because the shared handler no longer entered the real service.

### Restore proof

```text
===== restore proof: memory-retention.service.ts =====
<empty>

===== restore proof: memory-retention-job.ts =====
@@ -95,7 +95,7 @@
- const summary = `purged ... stuck, reclaimed ... pages`;
+ const summary = `purged ... stuck, archived ... / deleted ... / evicted ... memories, reclaimed ... pages`;

===== production host files unchanged =====
git diff --stat -- libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts
<empty>
```

Thus `memory-retention.service.ts` is fully restored, and `memory-retention-job.ts` differs only in the Task 7.1 summary literal.

## Cross-batch rules and risk handling

- **XB1**: every prepared statement in `seedMemories` binds all positional parameters on every execution. The memory insert binds 12 values, chunk insert 6, rowid lookup 1, vec insert 2, and concept insert 2. The Electron/better-sqlite3 verification passed 43 suites / 702 tests.
- **XB2**: no new fail-open/default-returning catch was added. The new transaction catch rolls back and rethrows, so no degradation annotation applies. `degradation-audit:lint` exited 0; `libs/backend/memory-curator` remains 20/20 and `libs/backend/cli-engine` 12/12 against baseline.
- **XB3**: neither host bypasses the lifecycle service. Each resolves a real `MemoryRetentionService`, whose `execute` creates the real `RetentionRunBudget`; the lifecycle spy is reached through `runStep(budget, startedAt)` and is asserted to receive a `RetentionRunBudget` plus a number. The optional governor is explicitly `null`, exercising the budget's defined fast path.
- **R-TL11**: the expensive seed work is transaction-batched with statements prepared once; all assertions and fixed cap sizes remain. The full load proof passed twice in succession under `--parallel=2 --skip-nx-cache`.

## Verification outputs

### Required host test command

```text
===== REQUIRED: host tests =====
NX Running target test for 2 projects:
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine

@ptah-extension/cli-engine: 19 suites passed; 188 tests passed
@ptah-extension/thoth-runtime: 5 suites passed; 91 tests passed
NX Successfully ran target test for 2 projects
HOST_TEST_EXIT=0
```

The cli-engine run emitted its existing non-fatal file-settings migration messages from unrelated specs.

### Required host typecheck command

```text
===== REQUIRED: host typecheck =====
NX Running target typecheck for 2 projects:
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine
tsc --noEmit --project libs/backend/thoth-runtime/tsconfig.lib.json
tsc --noEmit --project libs/backend/cli-engine/tsconfig.lib.json
NX Successfully ran target typecheck for 2 projects
HOST_TYPECHECK_EXIT=0
```

### Required host lint command

```text
===== REQUIRED: host lint =====
NX Running target lint for 2 projects:
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine
@ptah-extension/thoth-runtime: all files pass linting
@ptah-extension/cli-engine: 0 errors, 2 warnings
NX Successfully ran target lint for 2 projects
HOST_LINT_EXIT=0
```

The two cli-engine warnings are existing: an empty `dispose` method in `cli-adapters.ts` and the existing unused `ThothRefs` import in `thoth-runtime.spec.ts`.

### Required memory-curator test command

```text
===== REQUIRED: memory-curator tests (1 project) =====
NX Running target test for project @ptah-extension/memory-curator
Test Suites: 2 skipped, 41 passed, 41 of 43 total
Tests: 59 skipped, 643 passed, 702 total
Time: 43.822 s
NX Successfully ran target test for project @ptah-extension/memory-curator
MEMORY_TEST_EXIT=0
```

### Required load proof, run 1

```text
===== REQUIRED: load proof run 1 (2 projects) =====
NX Running target test for 2 projects:
- @ptah-extension/memory-curator
- @ptah-extension/rpc-handlers

memory-curator: 41 passed suites; 643 passed / 59 skipped tests; 54.598 s
rpc-handlers: 101 passed suites; 3002 passed / 33 skipped tests; 76.877 s
NX Successfully ran target test for 2 projects
LOAD_PROOF_1_EXIT=0
```

rpc-handlers emitted the existing Jest ESM-config warning and a worker force-exit warning; the target passed.

### Required load proof, run 2

```text
===== REQUIRED: load proof run 2 (2 projects) =====
NX Running target test for 2 projects:
- @ptah-extension/memory-curator
- @ptah-extension/rpc-handlers

memory-curator: 41 passed suites; 643 passed / 59 skipped tests; 51.415 s
rpc-handlers: 101 passed suites; 3002 passed / 33 skipped tests; 62.699 s
NX Successfully ran target test for 2 projects
LOAD_PROOF_2_EXIT=0
```

The second run emitted the same existing rpc-handlers ESM-config warning; memory-curator emitted a worker force-exit warning. Both targets passed.

### Required degradation audit

```text
===== REQUIRED: degradation audit =====
degradation-audit: scanned 2849 file(s)
libs/backend/cli-engine: 12 ok (baseline 12)
libs/backend/memory-curator: 20 ok (baseline 20)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
DEGRADATION_AUDIT_EXIT=0
```

### Required exact before/after integration timing command

```text
Command: npx jest --config libs/backend/memory-curator/jest.config.ts --runTestsByPath libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts --verbose --runInBand

Before:
Test Suites: 1 passed, 1 total
Tests: 16 passed, 16 total
Time: 20.241 s

===== REQUIRED: post-change verbose integration timing =====
After:
Test Suites: 1 passed, 1 total
Tests: 16 passed, 16 total
Time: 12.501 s
POST_TIMING_EXIT=0
```

### Required production-host no-diff proof

```text
===== REQUIRED: production host diff-stat =====
git diff --stat -- libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts
<empty>
HOST_PRODUCTION_DIFF_EXIT=0
```

### Required better-sqlite3 via Electron proof

```text
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-retention.integration|memory-lifecycle|di/register.spec"' --runInBand

Test Suites: 43 passed, 43 total
Tests: 702 passed, 702 total
Snapshots: 0 total
Time: 32.771 s
BETTER_SQLITE_ELECTRON_EXIT=0
```

### Supplemental checks

```text
memory-curator lint: 0 errors, 5 existing warnings; exit 0
git diff --check: empty; exit 0
```

## Plan deviations

None. The task text's `readErrors: []` lifecycle result was used (it is newer than the implementation-plan excerpt). No timeout was added, no assertion was removed or weakened, and no production lifecycle or host-registration implementation was changed beyond the required summary literal.

## Out-of-scope observations

- The concurrent Batch 8 lane modified only `libs/frontend/memory-curator-ui/**`; those files were not touched by Batch 7.
- Existing lint/Jest warnings are recorded above and were not changed.
