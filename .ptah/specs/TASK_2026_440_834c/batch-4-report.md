# Batch 4 Report — Diagnostics Contract

Status: PASS

## Task 4.2 — Memory-curator diagnostics snapshot

Files:

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.types.ts`
  - Line 2 imports `MemoryStorageHealthDto` as a type from `@ptah-extension/shared`.
  - Line 62 makes `MemoryDiagnosticsSnapshot.storage` required.
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.service.ts`
  - Lines 39-40 inject `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` as `MemoryRetentionService`.
  - Line 61 sets `storage: this.retention.storageHealth()`.
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.service.spec.ts`
  - Lines 15-47 define the typed storage fixture and fake retention service.
  - All seven constructor sites (the six existing sites plus the new focused test) pass a fake retention service.
  - Line 217 test: `returns the storage health object from the retention service unchanged`.

DI evidence:

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\di\register.ts:152` already registers `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE`; the successful memory-curator lint/typecheck confirms the injection is DI-lint compliant.

Polling-query evidence retained from Batch 3:

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts:95` defines the pending count with `WHERE processed_at IS NULL`; lines 99-104 apply the same predicate to pending bytes; lines 106-108 apply it to stuck-eligible rows.
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts:112` documents the separate unfiltered total count as end-of-run only, never diagnostics polling.
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.spec.ts:513` test: `reads pending rows, bytes, oldest pending, stuck-eligible rows and ledger rows`.

## Task 4.1 — Shared and RPC diagnostics contract

Files:

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts`
  - Line 179 makes `MemoryDiagnosticsResult.storage` a required `MemoryStorageHealthDto`.
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts`
  - Line 562 adds exactly `storage: snapshot.storage,`.
  - Diff size is exactly `1` insertion and `0` deletions; no RPC method or prefix map changed.
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.spec.ts`
  - Lines 130-154 add storage to the default snapshot fixture.
  - Line 653 adds storage to the focused diagnostics snapshot fixture.
  - Line 685 asserts that the returned result contains the identical storage object.
  - Line 603 test: `returns wire-shaped snapshot from diagnostics service`.

Frontend compile sites owned by Batch 6 (listed only; no frontend files edited):

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.spec.ts:42`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-rpc.service.spec.ts:36`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-rpc.service.spec.ts:73`

These fixtures still need their Batch 6 storage/state updates even though the current one-project Angular typecheck does not reject their mock shapes.

## Verification

### Three-project gate

Requested command was attempted as written twice but exceeded the shared-worktree execution window without producing a final summary (60 seconds, then 5 minutes). It was rerun with static output and `--parallel=1` to avoid concurrent-lane load contention:

`$env:NX_TASKS_RUNNER_DYNAMIC_OUTPUT='false'; npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator @ptah-extension/rpc-handlers @ptah-extension/shared`

- Header: `Running targets typecheck, test, lint for 3 projects`.
- Result: PASS, all 9 targets successful; 4 of 9 targets read from cache.
- Shared tests: 57 suites passed; 1,398 tests passed; 0 skipped.
- Memory-curator tests: 35 suites passed, 2 suites skipped; 547 tests passed, 59 skipped.
- RPC-handlers tests: 99 suites passed; 2,993 tests passed, 33 skipped.
- Aggregate: 191 suites passed, 2 suites skipped; 4,938 tests passed, 92 skipped.
- Typecheck: all 3 projects passed.
- Lint: all 3 projects passed with existing warnings only (0 errors).

### Frontend regression typecheck

Command:

`$env:NX_TASKS_RUNNER_DYNAMIC_OUTPUT='false'; npx nx run-many -t typecheck -p @ptah-extension/memory-curator-ui`

- Header: `Running target typecheck for project @ptah-extension/memory-curator-ui` (1 project).
- Result: PASS; 1 project passed, 0 failed.

No failures pointed into `libs\backend\persistence-sqlite`. No protected lane files were edited for Batch 4.
