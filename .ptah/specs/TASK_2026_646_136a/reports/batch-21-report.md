# Batch 21 (A8) — Route decide pipeline

Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`. No git writes. Nx, Jest, and project `tsc` were not run (decision #53).

## Files

Line counts are physical lines after Prettier.

Created:

| Lines | Path                                                                                                                                   |
| ----: | -------------------------------------------------------------------------------------------------------------------------------------- |
|   433 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\route-decide.service.ts`        |
|   396 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\pipeline\phase-plan.ts`         |
|   106 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\pipeline\phase-resolve.ts`      |
|   394 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\pipeline\assemble-gate.ts`      |
|   172 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\pipeline\preflight-answer.ts`   |
|   347 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\pipeline\model-refine.ts`       |
|   258 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\pipeline\model-call.ts`         |
|   358 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\pipeline\gather.ts`             |
|    72 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\pipeline\answer-validation.ts`  |
|   123 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\di\register.ts`                 |
|   116 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\di\register.spec.ts`            |
|   792 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\route-decide.gate.spec.ts`      |
|   300 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\route-decide.preflight.spec.ts` |

Modified:

| Lines | Path                                                                                                         |
| ----: | ------------------------------------------------------------------------------------------------------------ |
|   177 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\index.ts` |

Source files are under 450 lines. `route-decide.gate.spec.ts` is 792. `eslint.config.mjs` ignores `**/*.spec.ts` for `max-lines` (warn at 700, skip comments and blank lines), and the eslint run reported no max-lines warning. The spec file name is the one Batch 21 assigned, so it was not split.

## Acceptance

### Live notFound re-check (R3-2)

`RouteDecideService.noteLive` (`route-decide.service.ts`) calls `recheckAfterLiveNotFound` when a sent System One outcome carries `notFoundDetail`, and `recordLiveSuccess` only when that call succeeded. It does not call `markUnsupported` or `getStatus`. A search of `pipeline/` for `markUnsupported(` found no call. `DecisionModelConfig.markUnsupported` is reached from the re-check probe at `decision-model.config.ts:421`.

`route-decide.gate.spec.ts:284-299` stubs the client `notFound` against ready probe routes and expects: recheck called once, `markUnsupported` not called, `recordLiveSuccess` not called, `getStatus().state === 'ready'`, and detail containing `last call failed: ` plus the live detail.

`route-decide.gate.spec.ts:302-316` uses the unsupported probe routes and expects recheck once, `markUnsupported` once, the mark invocation ordered after the recheck, and `state === 'unsupported-endpoint'`.

These specs were not executed. The team-leader runs Jest.

### Register (D11, SC-9)

`registerLaneRoutingServices(container, logger)` (`di/register.ts:50-54`) stores the host logger on `LANE_ROUTING_TOKENS.LOGGER`.

`DECISION_MODEL_CONFIG` is a `useFactory` (`di/register.ts:83-96`). It builds `new DecisionModelConfig(workspace, secrets, storage, logger, structured)` with no seams argument. That matches the positional constructor at `decision-model.config.ts:108-119`. `structured` is resolved only through `optional()`, which calls `container.isRegistered(token, true)` (`di/register.ts:42-47`). The same guard covers `LANE_MODEL_LISTING` and `LANE_OUTCOME_READER`. The service factory resolves `DecisionModelConfig`, `CapabilityMatrixStore`, `RotationStore`, and `LaneRoutingLogger` with explicit type arguments (`di/register.ts:110`). No `@inject`. `FAILURE_CLASSIFIER` is not registered.

### Barrel

Batch 12 names are already exported at `src/index.ts:49-78` (`DecisionModelConfig`, selection schemas and constants, `StructuredDecisionCompleter`). This batch appends, without duplicating `MatrixCell`:

- `registerLaneRoutingServices` (`src/index.ts:139`)
- `RouteDecideArgsSchema` and `RouteDecideResultSchema` (`src/index.ts:145-163`)
- `LaneModelListing`, `LaneModelEntry`, `RouteCandidateSource` (`src/index.ts:164-168`)
- `FAMILY_PROFILE_MODEL`, `MatrixProfileKey`, and the other matrix types vscode-lm-tools and rpc-handlers take from the barrel (`src/index.ts:169-177`)

Pin checks stay in Batch 33's `RouteDecideArgsSchema`. This batch does not edit that schema.

## Assumptions

- `DecisionModelConfig` cannot be auto-constructed. Evidence: plain constructor at `decision-model.config.ts:108-119`, optional `structured` and `seams`.
- `isRegistered(token, true)` walks parent containers. Evidence: `node_modules/tsyringe/README.md` (recursive check) and the same call in `libs/backend/vscode-lm-tools/src/lib/di/register.ts`.
- A live 404/405 is persisted only inside `recheckAfterLiveNotFound` when the probe agrees. Evidence: `decision-model.config.ts:421`.
- There is no exported Ptah-home helper. The matrix factory uses `join(homedir(), '.ptah')` (`di/register.ts:38`). The store does not expand `~`.
- A built-in subagent role is always offered, so "all lanes at limit and no eligible candidate" uses role `custom-role` (`route-decide.gate.spec.ts:474`). The default implement role still resolves to the subagent.
- Host wiring of `registerLaneRoutingServices` is Batch 30. This batch does not edit `apps/*/src/di`.
- Task-type and depth answers are different enums (`route-decide-result.schema.ts:221-222`). `preflightAnswer` is generic so each field keeps its own value union.

## Decisions

- Split the service on planning (`phase-plan.ts`), resolution (`phase-resolve.ts`), gate assembly (`assemble-gate.ts`), preflight (`preflight-answer.ts`), and the model call (`model-call.ts`). Behaviour is the same call sequence. Reversible by inlining. The gate spec stays one file because Batch 21 named it and `max-lines` ignores specs.
- `DecisionModelConfig`, `RouteDecideService`, `RotationStore`, and `CapabilityMatrixStore` are plain classes built with `useFactory`, not `@injectable`. Optional ports use `isRegistered(token, true)`.
- Matrix home is `join(homedir(), '.ptah')`. Leaving the store unregistered was rejected because this function is the composition root and only receives `(container, logger)`.
- Final rotation save rebuilds from the loaded document with `withPick` of the chosen ids. A save failure is logged and the decide result is still returned.
- Structured adapter errors are recognized by `name` and `kind` (`error['name']`, `error['kind']`). This lib does not import agent-sdk.

## Checks

PowerShell has no `grep` or `tail`. The audit and di-lint filters were `Select-String` and `Select-Object -Last 5`.

Prettier (`npx prettier --write` on the Batch 21 files), exit 0. The second format, after the size split, rewrote `model-refine.ts`, `model-call.ts`, `assemble-gate.ts`, and `preflight-answer.ts`. The other listed files were unchanged.

ESLint on those files, exit 0, no output, no max-lines warning. An earlier pass warned that `AskedQuestion` in `model-refine.ts` was unused after the call split. That interface was removed. The clean run is the one above.

Degradation audit, exit 0:

```
degradation-audit: per-directory totals
degradation-audit: TOTAL 296 unsuppressed site(s)
```

No `FAIL` line. The baseline was not raised.

di-lint, exit 0:

```
di-lint OK: 1841 @inject sites all resolve to a registered token (811 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies
```

`ptah_agent_report` is not in this session's MCP tool list (`search_tool` returned no tools). The summary is in the lane's final message.

Verdict: Batch 21 source, specs, register, and barrel exports are in the worktree; eslint is clean, degradation stays at 296, and di-lint is OK. Jest was not run.
