# Batch 2 Report — memory usage recorder contract and lifecycle settings

## Backend implementation — `TASK_2026_443_40ec`, batch 2

**Tasks completed**: Task 2.1 (`IMemoryUsageRecorder` port, token, barrel, documentation); Task 2.2 (four `memory.lifecycle.*` file-based settings keys, defaults, and membership/default coverage).

## Completion evidence

### Task 2.1 — `IMemoryUsageRecorder`

- Created the zero-runtime-dependency `IMemoryUsageRecorder` interface with the exact `recordUse(memoryIds: readonly string[]): void` signature.
- Documented the behavioural contract: implementations never throw; empty and unknown ids are no-ops; using an archival memory restores it to recall.
- Added `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` as `Symbol.for('PtahMemoryUsageRecorder')`.
- Added a type-only public barrel export.
- Added the port and token to the library documentation.
- The library has no token spec and no Nx `test` target, so the conditional token-spec task did not apply. The token and public type compiled under the library's successful `typecheck` target.

### Task 2.2 — lifecycle settings

- Added `memory.lifecycle.enabled`, `memory.lifecycle.archiveAfterDays`, `memory.lifecycle.deleteAfterDays`, and `memory.lifecycle.maxPerWorkspace` beside the existing retention keys.
- Added the exact defaults `true`, `30`, `60`, and `25000` beside the existing retention defaults.
- Added a table-driven platform-core spec that pins static membership, routing through `isFileBasedSettingKey`, and each exact default.
- Platform-core Jest passed all 32 suites and 580 executed tests, including the modified settings spec.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-contracts\src\lib\memory-usage-recorder.port.ts` — explicit memory-use recording port and behavioural contract.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-contracts\src\lib\tokens.ts` — added `MEMORY_USAGE_RECORDER` global symbol.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-contracts\src\index.ts` — exported `IMemoryUsageRecorder` as a type.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-contracts\CLAUDE.md` — listed the new port and token.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\platform-core\src\file-settings-keys.ts` — registered four lifecycle keys and defaults.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\platform-core\src\file-settings-keys.spec.ts` — pinned lifecycle membership, routing, and defaults.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-2-report.md` — this report.

No files outside Batch 2 ownership were edited. `batches.md` was not edited.

## Stack observed

- Nx 22.6 monorepo and TypeScript 5.9 strict projects, established by the root `CLAUDE.md`, `package.json`, and project typecheck commands.
- `memory-contracts` is a zero-dependency interface/token leaf; `MEMORY_CONTRACT_TOKENS` uses `Symbol.for(...)`, established by `libs/backend/memory-contracts/CLAUDE.md` and `src/lib/tokens.ts`.
- `platform-core` owns the shared file-settings routing Set and default table, established by `libs/backend/platform-core/CLAUDE.md` and `src/file-settings-keys.ts`.
- No runtime wiring or external validation boundary is introduced by this additive contract batch.

## Verification

### Test

Command (exactly as assigned):

```text
npx nx run-many -t test -p @ptah-extension/memory-contracts @ptah-extension/platform-core
```

Observed header/result:

```text
NX   The following projects do not have a configuration for any of the provided targets ("test")
- @ptah-extension/memory-contracts

NX   Running target test for project @ptah-extension/platform-core:
- @ptah-extension/platform-core

Test Suites: 32 passed, 32 total
Tests:       4 todo, 580 passed, 584 total
NX   Successfully ran target test for project @ptah-extension/platform-core
```

Exit code: 0. The required two-project header was not attainable because `@ptah-extension/memory-contracts` has no `test` target. The first uncached run completed in 66.6 s; `file-settings-manager.bench.spec.ts` did not time out. The final post-documentation run used the existing Nx cache and repeated the same passing result. No `--parallel=1` rerun was required.

### Typecheck

Command (exactly as assigned):

```text
npx nx run-many -t typecheck -p @ptah-extension/memory-contracts @ptah-extension/platform-core
```

Observed header/result:

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/memory-contracts
- @ptah-extension/platform-core
NX   Successfully ran target typecheck for 2 projects
```

Exit code: 0.

### Lint

Command (exactly as assigned):

```text
npx nx run-many -t lint -p @ptah-extension/memory-contracts @ptah-extension/platform-core
```

Observed header/result:

```text
NX   The following projects do not have a configuration for any of the provided targets ("lint")
- @ptah-extension/memory-contracts

NX   Running target lint for project @ptah-extension/platform-core:
- @ptah-extension/platform-core
✖ 8 problems (0 errors, 8 warnings)
NX   Successfully ran target lint for project @ptah-extension/platform-core
```

Exit code: 0. The required two-project header was not attainable because `@ptah-extension/memory-contracts` has no `lint` target. The eight warnings are pre-existing and occur in unmodified platform-core files (`cross-process-child.ts`, `file-settings-manager.ts`, `file-settings-manager.spec.ts`, and `run-diagnostics-provider-contract.ts`).

## Plan validation risks, assumptions, and edge cases

### Batch-relevant handling

- R-TL2 (required DTO fields break intermediate builds): followed Deviation 1 exactly; this batch made no `libs/shared` DTO edit.
- R-TL6 (parallel lanes share a worktree): touched only the assigned memory-contracts and platform-core files; no persistence-sqlite file or Nx daemon reset was touched.
- R-TL8 (platform-core benchmark flake): the benchmark completed in the passing platform-core suite; no timeout occurred, so the prescribed serial retry was not needed.
- R8 (use recording on the prompt path): exposed only the synchronous, `void`, never-throw port contract; no implementation or prompt-path write was added in this batch.
- Hosts without memory: no null implementation was added. The port is a type-only export so later consumers can use the planned optional injection and resolve absence to `null`.
- Duplicate, unknown, empty, and over-200 id behaviour: the port documentation pins empty/unknown no-op and never-throw behaviour. Dedupe/cap/closed-connection implementation and tests remain correctly assigned to Task 3.2.
- Settings kill switch/defaults: all four keys and exact defaults are persisted through the shared file settings route. Range clamping and preview-only behaviour remain correctly assigned to the lifecycle configuration/service batch.

### Risks and assumptions outside Batch 2's source ownership

- A1, A2, A3, A4, A5; R-TL1, R-TL3, R-TL4, R-TL5, R-TL7, R-TL9, R-TL10; and R1 through R7, R9, R10 concern migration SQL, memory-curator persistence/lifecycle logic, DTO/frontend sequencing, timing infrastructure, or host execution. This batch neither implements nor weakens those mitigations.
- Lifecycle predicate edges (`<` cutoff), archival restoration/delete timing, pinned/core/corpus exemptions, NULL versus empty workspace groups, cap grace, vec gating, row budgets, transactional rollback, disabled preview writes, cached-search recording, and preview preservation are runtime behaviours assigned to later batches. This batch supplies only their port and settings contracts and does not claim to verify those runtime behaviours.

## Plan deviations

- Verification metadata is stale: `batches.md` expects test and lint headers for two projects, but `@ptah-extension/memory-contracts` defines neither target. Nx explicitly omitted it from those two commands while exiting successfully. Adding targets would require editing `libs/backend/memory-contracts/project.json`, which Batch 2 does not list and the lane was explicitly forbidden to touch. Typecheck did run for both projects.
- No production-source deviation from Components 3 and 8.

## Out-of-scope observations

- The platform-core lint target reports eight existing warnings in files not modified by Batch 2.
- The platform-core Jest run reports a worker that required force-exit after all suites passed, indicating existing teardown leakage; it did not fail or time out the benchmark.
