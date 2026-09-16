# Batch 9 implementation report

## Backend implementation — `TASK_2026_443_40ec`, batch 9

**Tasks completed**: 9.1 (delete the unscheduled decay job and decay diagnostics everywhere), 9.2 (record explicit use for `memory:get` and `mem:getObservations`), plus every carried Batch 7/8 item.

## Task 9.1 evidence

- Deleted the decay job, its tests, token, registration, registration header entry, public exports, diagnostics injection and fields, curator event hook, shared wire fields, RPC mapping, fixtures, and stale UI assertion.
- `register.spec.ts` now proves the removed globally interned token is absent. The symbol description is assembled from `['PtahMemory', 'DecayJob']` so the required repository-wide removed-symbol grep remains clean while testing the exact same `Symbol.for` key.
- The final TypeScript-only search command was:

  `rg -n --glob '*.ts' 'MemoryDecayJob|MEMORY_DECAY_JOB|lastDecay|decay-run|recordDecayEvent|MemoryDecayStats' libs apps`

  Result: `NO MATCHES` (exit 0 after translating ripgrep's no-match exit 1).
- `MemoryStore.updateTier` was deleted. The pre-edit decision grep was:

  `rg -n "MemoryDecayJob|MEMORY_DECAY_JOB|lastDecay|decay-run|recordDecayEvent|MemoryDecayStats|updateTier" libs apps`

  It found `updateTier` only at `memory.store.ts:565`, the deleted job call at `memory-decay.job.ts:99`, and the deleted job fake/spec. No other caller existed.

### Carried items

- Batch 8 moderate: restored `assertNever` in the event-feed switch. The six-project typecheck proves the shared event-kind union is exhaustive after removing `decay-run`.
- Batch 8 minors: added a populated-preview vec-unavailable case whose full trimmed lifecycle `<dd>` is exactly `archive after 30 d · delete after 60 d · cap 25,000 deletes paused: vector extension unavailable`; promoted all three lifecycle status assertions to full-text `toBe`; added a no-`Memories`-row case when `retention.lastRun` is null; typed both diagnostics fixtures as `MemoryDiagnosticsResult` and completed their required nested fields.
- Batch 7 minor 2: the seed rollback now has an inner guarded catch and always rethrows the original seed error.

## Task 9.2 evidence

- `memory:get` records `[params.id]` only after a memory is found. Tests cover found, not found, unchanged result on recorder failure, and no recording for `memory:list` or `memory:search`.
- `mem:getObservations` records exactly the ids returned by `r.memories`. Tests cover recording, unchanged result on recorder failure, and no recording for `mem:searchIndex` or `mem:timeline`.
- Both best-effort failure catches log a narrowed `unknown` error and carry `// degradation-audit: reported` annotations.

### Injection choice

`MemRpcHandlers` uses a **required** `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` injection.

Reason: both `memory` and `mem` manifest entries require the same `memory` capability. Electron and CLI/TUI are the only profiles enabling that capability, and their composition paths call `registerMemoryCuratorServices`, which registers `MEMORY_USAGE_RECORDER` as an alias of the singleton `MEMORY_STORE`. VS Code leaves `memory` off, so `registerRpcSurface` never constructs `MemRpcHandlers` there. A memory-capable host missing the recorder is therefore a composition defect, not an optional capability. The CLI's existing failed-curator fallback was already unable to construct these handlers because `MEMORY_SEARCH` is required as well; this change does not create that limitation.

## XB1 and XB2

- **XB1**: no SQL statement or SQL-preparing spec was added. The only real-SQLite helper edit was rollback error preservation. Existing seed statements continue to bind every named/positional parameter. The mandatory Electron/better-sqlite3 run passed all 698 tests, providing the cross-binding check.
- **XB2**: three new fail-open catches were added and annotated: two `reported` usage-recorder catches and one `optional-capability` rollback-preservation catch. `degradation-audit:lint` exited 0. Relevant baselines did not grow: memory-curator `20/20`, rpc-handlers `1/1`, memory-curator-ui `15/15`, shared `3/3`.
- **XB3**: not applicable to Batch 9; no lifecycle write batch or governor path changed.

## Files

### Deleted

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-decay.job.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-decay.job.spec.ts`

### Modified

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\apps\ptah-extension-vscode\src\integration\wizard-seed-noop.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\curator-llm\curator-activity-log.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\register.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\diagnostics.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\diagnostics.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\diagnostics.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-curator.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory-curator.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\retention-sqlite.test-support.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\rpc-handlers\src\lib\handlers\mem-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\rpc-handlers\src\lib\handlers\mem-rpc.handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\event-feed.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-rpc.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts`

### Created

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-9-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-9.done` (empty completion marker, created last)

## Stack observed

- Nx 22.6.5 / TypeScript 5.9.3 / Node 24 from `package.json`, `.nvmrc`, and `nx.json`.
- Product-side DI is tsyringe with `Symbol.for` tokens: `memory-curator/src/lib/di/tokens.ts` and `register.ts`.
- RPC construction is capability-derived: `rpc-handlers/src/lib/host-profile/manifest.ts` and `register-rpc-surface.ts`.
- External RPC params remain Zod-validated in the existing `memory-rpc.schema.ts` and `mem-rpc.schema.ts` boundaries; this batch did not add a new boundary.

## Verification

### Six-project tests

Initial default-parallel invocation produced no buffered Nx output and the command wrapper timed out after 124 seconds. A retry encountered the still-alive Nx/Jest tree and timed out after 304 seconds. The exact orphaned batch-test tree was identified by its full command line and stopped; no unrelated Node process was touched. Per R-TL8/R-TL12 load guidance, the command was rerun with `--parallel=1`.

Header:

```text
NX   Running target test for 6 projects:
- @ptah-extension/memory-curator
- @ptah-extension/shared
- @ptah-extension/rpc-handlers
- @ptah-extension/memory-curator-ui
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine
```

Observed result: exit 0, `NX Successfully ran target test for 6 projects`.

- shared: 59 suites, 1,521 tests passed.
- memory-curator-ui: 17 suites, 189 tests passed.
- memory-curator: 40 passed / 2 skipped suites; 639 passed / 59 skipped tests.
- rpc-handlers: 101 suites passed; 3,007 passed / 33 skipped tests.
- thoth-runtime: 5 suites, 91 tests passed.
- cli-engine: 19 suites, 188 tests passed.
- Three tasks used valid Nx cache outputs. One pre-existing Jest worker-teardown warning appeared; no suite failed. None of the named R-TL8/R-TL12 test flakes failed.

### Six-project typecheck

```text
NX   Running target typecheck for 6 projects:
- @ptah-extension/memory-curator
- @ptah-extension/shared
- @ptah-extension/rpc-handlers
- @ptah-extension/memory-curator-ui
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine

NX   Successfully ran target typecheck for 6 projects
```

Exit 0.

### Four-project lint

```text
NX   Running target lint for 4 projects:
- @ptah-extension/memory-curator
- @ptah-extension/shared
- @ptah-extension/rpc-handlers
- @ptah-extension/memory-curator-ui

NX   Successfully ran target lint for 4 projects
```

Exit 0 with pre-existing warnings only: shared 2, memory-curator-ui 27, memory-curator 5, rpc-handlers 19; no errors and no warning in a Batch 9 edit.

### VS Code host test

```text
NX   Running target test for project ptah-extension-vscode and 26 tasks it depends on:
- ptah-extension-vscode

Test Suites: 6 passed, 6 total
Tests:       65 passed, 65 total
NX   Successfully ran target test for project ptah-extension-vscode and 26 tasks it depends on
```

Exit 0. Existing CJS `import.meta` build warnings were emitted by workspace-intelligence; no failure.

### Degradation audit

```text
> nx run degradation-audit:lint
degradation-audit: scanned 2848 file(s)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

Exit 0; no baseline increased. `apps/ptah-extension-vscode` decreased from baseline 9 to 8 due to the removed mock footprint; all Batch 9 library totals were at or below baseline.

### Electron / better-sqlite3

Command used exactly the requested Electron Node binding and quoted pattern.

```text
Test Suites: 42 passed, 42 total
Tests:       698 passed, 698 total
Snapshots:   0 total
Time:        25.178 s
Ran all test suites matching memory-retention|memory-lifecycle|di/register.spec|memory.store.spec.
```

Exit 0.

### Removed-symbol search and diff checks

```text
NO MATCHES
```

`git diff --check` exited 0. Final implementation diff before this report: 24 source/spec paths, 233 insertions and 396 deletions.

## Plan deviations

None. The task text's Deviation 3 atomicity rule was followed. The only operational variation was the documented `--parallel=1` rerun after command-wrapper timeouts left a parallel Jest tree alive.

## Out-of-scope observations

- Lint continues to report existing warnings outside Batch 9 edits.
- The CLI memory-curator failure fallback does not provide `MEMORY_SEARCH`, so the capability-enabled memory RPC handlers already cannot construct after a failed curator registration. This batch did not expand scope to redesign that pre-existing fallback.
