# Batch 11 report

## Task 11.1 — PostCompact idle target

- Added an optional, last constructor injection for `SDK_IDLE_COMPACTION` at `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts:163-164`. The existing direct constructions remain valid.
- Added the idle target to the independent, fail-open rekey loop at `compaction-hook-handler.ts:169-193`. A throwing target logs one warning and does not stop the hook, covered at `compaction-hook-handler.spec.ts:1088-1137`.
- PostCompact calls the coordinator whenever a fallback ID exists, using the payload ID or fallback ID; state rekey still requires both IDs (`compaction-hook-handler.ts:520-546`). The no-payload case is covered at `compaction-hook-handler.spec.ts:1029-1044`.
- F2: The coordinator call and idle rekey are synchronous with no `await` between them (`compaction-hook-handler.ts:533-546`). The real coordinator and idle service spec verifies old-ID input cancels a newly armed timer after rekey (`compaction-hook-handler.spec.ts:1139-1237`).
- F5: The same spec holds an idle claim, rebinds the coordinator to a new ID through PostCompact, and checks the moved claim is released (`compaction-hook-handler.spec.ts:1190-1226`). The release succeeds under the new ID; no L1 follow-up is needed for this path.

## Task 11.2 — CLI smoke assertion

- The smoke spec resolves `SDK_IDLE_COMPACTION` twice after `registerSdkServices` and asserts identity (`apps/ptah-cli/src/di/container.smoke.spec.ts:348-356`).
- Its minimal workspace fixture now supplies `onDidChangeConfiguration` (`container.smoke.spec.ts:144-150`), which the constructed idle service subscribes to. This fixes the two smoke failures exposed by resolving the handler through the container.

## Validation and decisions

- The live P1 probe recorded A2 and A3 PASS and PostCompact before `compact_boundary` (`research-report.md:24-32`). The integration spec follows that ordering, then supplies the boundary before testing the next idle period. P1 observed no ID change, so the spec explicitly simulates a changed ID.
- The handler keeps the existing fail-open hook behavior for optional or throwing targets. A missing payload ID still marks the coordinator record finished under the fallback ID; no state rekey occurs without two IDs. These choices follow `implementation-plan.md:572-585` and are reversible.
- Validation risks outside this batch (A1/A5 live QA, settings count, router admission, timer behavior, UI and settings write path) were not changed. Batch 11 adds no timer or settings key. The direct-constructor compatibility risk is handled by the optional last parameter.
- `ptah_get_diagnostics` was requested after edits but returned `Unavailable: TypeScript check still running after 45s` twice. Both targeted Nx project typechecks passed independently.

## Checks

| Check | Result |
| --- | --- |
| Agent SDK Jest: handler and live usage tracker specs, `--coverage=false --maxWorkers=2` | 2 suites, 42 tests passed |
| CLI Jest: `container.smoke.spec.ts`, `--coverage=false --maxWorkers=2` using the repository's `jest.config.cjs` | 1 suite, 18 tests passed |
| `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/agent-sdk --parallel=1` | Passed |
| `NX_NO_CLOUD=true npx nx typecheck ptah-cli --parallel=1` | Passed |
| ESLint on the three changed source/spec files | 0 errors; one existing unused `SetupRpcHandlers` warning in CLI spec at line 67 |
| Prettier `--check` on the three changed source/spec files | Passed |

The requested CLI `jest.config.ts` is absent; its project config is `jest.config.cjs`.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\apps\ptah-cli\src\di\container.smoke.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-11-report.md`
