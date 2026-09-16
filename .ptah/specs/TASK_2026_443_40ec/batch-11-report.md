# Batch 11 report — Gate 3 fixes

Task: `TASK_2026_443_40ec`, Batch 11  
Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle`

## Task 11.1 — memory-row-budget reclaim

Acceptance spec was added first to `memory-retention.service.spec.ts`.

Pre-fix command:

```text
npx nx test @ptah-extension/memory-curator --testPathPatterns=memory-retention.service.spec --runInBand
```

Pre-fix failure (exit 1):

```text
FAIL memory-retention.service.spec.ts
MemoryRetentionService — run › prunes the ledger and reclaims pages after a memory row budget stop
- Expected pagesReclaimed: 5
+ Received pagesReclaimed: 0
Test Suites: 1 failed, 1 total
Tests: 1 failed, 49 passed, 50 total
```

Fix: added one named `isRowBudgetStop` predicate covering `row-budget` and `memory-row-budget`, and used it in both post-row guards. Reclaim still changes `stop` only when the prior stop is null, so `memory-row-budget` retains precedence.

Post-fix pass:

```text
Test Suites: 1 passed, 1 total
Tests: 50 passed, 50 total
NX Successfully ran target test for project @ptah-extension/memory-curator
```

Files:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`

## Task 11.2 — crash-safe lifecycle accounting

The lifecycle unit spec and real-SQLite integration assertion were added first.

Pre-fix command:

```text
npx nx test @ptah-extension/memory-curator --testPathPatterns='memory-lifecycle.service.spec|memory-retention.integration.spec' --runInBand
```

Pre-fix failures (exit 1):

```text
MemoryLifecycleService › returns committed counts and invalidates touched roots after a mid-step error
Received promise rejected instead of resolved
Rejected: RetentionStepError: delete-archived: injected delete failure

memory lifecycle — integration › rolls back the second delete pair after a mid-delete failure and releases single-flight
- Expected memoriesDeleted: 100
+ Received memoriesDeleted: 0

Test Suites: 2 failed, 2 total
Tests: 2 failed, 26 passed, 28 total
```

Fix:

- `runStep` catches only `RetentionStepError`, returns accumulated counters with the error attached, marks the step non-exhausted, and maps `database-busy` onto the existing stop token.
- Workspace cache invalidation is in `finally`, covering every root touched by a committed batch; an empty root set remains a no-op.
- `MemoryRetentionService` throws the attached error only after assigning the returned lifecycle result, so its existing outer classifier still maps `database-busy` to `partial` and all other errors to `failed`, while persisted/report counters reflect committed work.
- The existing `run` single-flight `finally` was unchanged.

Post-fix focused pass:

```text
Test Suites: 3 passed, 3 total
Tests: 78 passed, 78 total
NX Successfully ran target test for project @ptah-extension/memory-curator
```

Final acceptance-set pass after formatting:

```text
memory-curator: 4 suites passed; 111 passed, 9 skipped
cli-engine: 1 suite passed; 8 passed
rpc-handlers: 1 suite passed; 6 passed
NX Successfully ran target test for 3 projects
```

Files:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts`

## Task 11.3 — degraded-boot usage recorder

The CLI degraded-boot resolution spec was added first. It simulates failed memory-curator registration, keeps the memory capability surface active, resolves the required `MemRpcHandlers` dependency, invokes `mem:getObservations`, and checks the warning token list.

Pre-fix command:

```text
npx nx test @ptah-extension/cli-engine --testPathPatterns=register-thoth-libraries.spec --runInBand
```

Pre-fix failure (exit 1):

```text
registerThothLibraries — memory-contract fallback when Track 1 throws
› keeps MemRpcHandlers resolvable with no-op memory contracts when Track 1 throws
Expected MEMORY_USAGE_RECORDER registration: true
Received: false
Test Suites: 1 failed, 1 total
Tests: 1 failed, 7 passed, 8 total
```

Fix:

- Added the frozen `NullMemoryUsageRecorder` and exported/documented it from memory-contracts.
- Registered it idempotently in CLI `ensureMemoryContractFallbacks`; the warning now includes `MEMORY_USAGE_RECORDER`.
- Registered it idempotently in RPC `installNullImplementations`; specs prove a real host recorder is preserved.
- `MemRpcHandlers` still requires `MEMORY_USAGE_RECORDER`; no optional injection was introduced.

Post-fix pass:

```text
NX Running target test for 2 projects
cli-engine: 1 suite passed, 8 tests passed
rpc-handlers: 1 suite passed, 6 tests passed
NX Successfully ran target test for 2 projects
```

Files:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-contracts\src\lib\null-implementations.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-contracts\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-contracts\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\cli-engine\src\lib\thoth\register-thoth-libraries.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\cli-engine\src\lib\thoth\register-thoth-libraries.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\rpc-handlers\src\lib\host-profile\register-rpc-surface.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\rpc-handlers\src\lib\host-profile\resolve-handler-plan.spec.ts`

## Task 11.4 — visible recordUse truncation

The truncation acceptance spec was added first.

Pre-fix command:

```text
npx nx test @ptah-extension/memory-curator --testPathPatterns=memory.store.spec --runInBand
```

Pre-fix failure (exit 1):

```text
MemoryStore ranking and explicit use on real SQLite
› caps a call at 200 ids and logs once only when distinct ids are truncated
Expected debug calls: 1
Received debug calls: 0
Test Suites: 1 failed, 1 total
Tests: 1 failed, 32 passed, 9 skipped, 42 total
```

Fix: deduplicate first, log exactly once at debug when the distinct count exceeds 200 with `{ received, recorded: 200 }`, then retain the existing 200-ID slice and contract.

Post-fix pass:

```text
Test Suites: 1 passed, 1 total
Tests: 33 passed, 9 skipped, 42 total
NX Successfully ran target test for project @ptah-extension/memory-curator
```

Files:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.spec.ts`

## Cross-batch rules

### XB1 — fully bound SQL

The new lifecycle unit and retention-service tests prepare no SQL. The integration change adds assertions only and reuses existing helpers/statements with all positional parameters supplied. The `recordUse` spec's statements bind every `?` parameter. The required Electron/better-sqlite3 execution passed all selected suites:

```text
Test Suites: 42 passed, 42 total
Tests: 701 passed, 701 total
Time: 26.152 s
Ran all test suites matching memory-retention|memory-lifecycle|memory.store.spec.
```

### XB2 — degradation audit

The new `RetentionStepError` catch carries:

```text
// degradation-audit: reported - the retention service receives the ...
```

The first audit run exposed that the marker was not in the scanner's leading-comment zone (`orphaned-suppression`, memory-curator 21 vs baseline 20). The marker was moved immediately inside the catch, and both subsequent runs passed:

```text
degradation-audit: scanned 2848 file(s)
libs/backend/memory-curator: 20 ok (baseline 20)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
```

No baseline file was changed or raised.

### XB3 — governor order

`beforeBatch` remains unchanged and retains the required sequence for every lifecycle write batch:

```text
budget.hardStop() -> budget.memoryRowRoom() -> await budget.waitForGovernor() -> batch call
```

No governor wait was moved into a transaction or after a batch. The existing governor-order specs and the complete memory-curator suite passed.

## Required verification matrix

### Tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/memory-contracts @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/thoth-runtime
```

Header:

```text
@ptah-extension/memory-contracts has no test target
NX Running target test for 4 projects
```

First run: exit 1. Memory-curator passed 642 tests (59 skipped), thoth-runtime passed 91, and cli-engine passed 188. RPC-handlers had three unrelated 5-second load timeouts in `voice-rpc.handlers.spec.ts` and `skills-sh-legacy-adoption.spec.ts` (3006 passed, 33 skipped). This is the prescribed load-flake handling class, including the skills-sh area noted by R-TL12.

Serial rerun:

```text
npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/memory-contracts @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/thoth-runtime --parallel=1
NX Running target test for 4 projects
rpc-handlers: 101 suites passed; 3009 passed, 33 skipped
NX Successfully ran target test for 4 projects
NX detected a flaky task: @ptah-extension/rpc-handlers:test
```

R-TL8 and R-TL11 did not reproduce. R-TL12-class parallel load failure resolved on the mandated serial rerun; both runs are recorded above.

### Typecheck

```text
npx nx run-many -t typecheck -p @ptah-extension/memory-curator @ptah-extension/memory-contracts @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/thoth-runtime
NX Running target typecheck for 5 projects
NX Successfully ran target typecheck for 5 projects
```

### Lint

```text
npx nx run-many -t lint -p @ptah-extension/memory-curator @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/thoth-runtime
NX Running target lint for 4 projects
NX Successfully ran target lint for 4 projects
```

Result: exit 0, zero errors. Existing warnings remained (memory-curator 5, cli-engine 2, rpc-handlers 19); none points to a Batch 11 change.

### Degradation audit

```text
npx nx run degradation-audit:lint
NX Successfully ran target lint for project degradation-audit
```

Final result: exit 0; `libs/backend/memory-curator: 20 ok (baseline 20)`; no baseline raised.

### Electron / better-sqlite3

```text
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-retention|memory-lifecycle|memory.store.spec"' --runInBand
```

Result: exit 0; 42 suites passed, 701 tests passed, 0 skipped in the selected set.

## Plan deviations and out-of-scope observations

Plan deviations: none. `MemoryLifecycleStepResult` is exported from the memory-curator barrel and gained an optional `error` field; this is an additive public-surface change that breaks no consumer. `installNullImplementations` gained a module-level export solely for a direct colocated spec and remains absent from the `host-profile` barrel. No production dependency, adapter boundary, injection optionality, outcome mapping, single-flight behavior, or row cap changed.

Out-of-scope observations: the first parallel test run reproduced unrelated RPC filesystem/time-limit flakes and passed under the required serial rerun. Lint reported only pre-existing warnings. No out-of-scope source was edited.

## Task 11.5

### Diff

- Modified `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.ts`: removed the unreachable `database-busy` stop assignment. Its replacement comment records the actual ownership boundary: `MemoryRetentionService` maps the attached `RetentionStepError` to `partial` for `database-busy` and `failed` otherwise, while the step error path returns the attached error and committed counters with no stop token.
- Modified `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-11-report.md`: corrected the public-surface account. `MemoryLifecycleStepResult` is exported from the memory-curator barrel and its optional `error` field is additive; `installNullImplementations` has a module-level export but remains absent from the `host-profile` barrel.
- No assertion or acceptance spec was changed or weakened.

### Verification

Tests:

```text
npx nx run-many -t test -p @ptah-extension/memory-curator
NX Running target test for project @ptah-extension/memory-curator
Test Suites: 2 skipped, 40 passed, 40 of 42 total
Tests: 59 skipped, 642 passed, 701 total
NX Successfully ran target test for project @ptah-extension/memory-curator
```

Typecheck:

```text
npx nx run-many -t typecheck -p @ptah-extension/memory-curator
NX Running target typecheck for project @ptah-extension/memory-curator
NX Successfully ran target typecheck for project @ptah-extension/memory-curator
```

Degradation audit:

```text
npx nx run degradation-audit:lint
degradation-audit: scanned 2848 file(s)
libs/backend/memory-curator: 20 ok (baseline 20)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
```

Existing outcome-mapping spec, run unchanged and explicitly by name:

```text
npx nx test @ptah-extension/memory-curator --testPathPatterns=memory-retention.service.spec --testNamePattern='database-busy stops the run partial, not failed' --runInBand
Test Suites: 1 passed, 1 total
Tests: 1 passed, 49 skipped, 50 total
NX Successfully ran target test for project @ptah-extension/memory-curator
```

This confirms the established `database-busy` -> `partial` mapping remains owned by `MemoryRetentionService` and passes without any spec modification.
