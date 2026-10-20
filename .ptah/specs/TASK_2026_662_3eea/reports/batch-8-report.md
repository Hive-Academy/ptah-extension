# Batch 8 report

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:25`: widened `CloneSummary.successRate` to `number | null`.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2305`: return `null` when invocation stats have no denominator; preserve measured zero rates.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:993-1002`: regression case for null rate from `listClones`.

## `rg -n "successRate" libs apps` consumers

- `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:25`: changed DTO.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2305,2323` and `.spec.ts:985,998,1001`: clone producer and tests.
- `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts:242,255`, `clone-action-gating.spec.ts:27,312,317,321,325`, `clone-card.component.spec.ts:18,100,117,455,482,497,512,531,549,561,582`, `clone-detail-drawer.component.spec.ts:16,266,277,291,319,333,362`, `skill-clones-view.component.spec.ts:45`, and `services/{clone-bulk-rebase.service.spec.ts:18,skill-clones-state.perf.spec.ts:28,skill-clones-state.service.spec.ts:18}`: UI formatting and test fixtures.
- `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts:28,90`, `.spec.ts:34-37,46`, `skill-scorecard.service.ts:57,98,159`, `.spec.ts:29`, and `skill-enhancer.service.ts:1053,1072`: grade and scorecard internals.
- `libs/shared/src/lib/types/webview-ui.types.ts:17`: unrelated `PerformanceMetrics.successRate` for dashboard metrics; it does not consume `CloneSummary`.
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts:117,163`: unrelated generated fixture text for `ProcessingBatchSummary`.

No breaking `CloneSummary` consumer was found outside skill-synthesis, skill-synthesis-ui, rpc-handlers, and shared. The shared RPC DTO file has no mirrored Zod schema or matching spec.

## Decisions

- Treat zero total invocations as unmeasured: the handler only has invocation totals and successes at this boundary; division is meaningful when `total > 0`. Options were keep the prior zero or return null. The requested nullable contract and existing UI guard support null. Reversible.
- Keep dashboard `PerformanceMetrics.successRate` unchanged: it is a separate DTO and this batch prohibits other DTO changes. Reversible.

## Verification

- Confirmed the three edited source files use LF line endings.
- Tests, typecheck, lint, Nx, build, e2e, and diagnostics were not run, as instructed. The orchestrator owns verification.
