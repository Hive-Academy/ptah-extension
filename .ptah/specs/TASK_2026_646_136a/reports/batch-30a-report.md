# Batch 30a report (AB14-pre, TL-59)

Executor registered `registerLaneRoutingServices` once in each host composition root and added the TL-59 smoke guards. No Nx or Jest run (decision #53). No git writes. `libs/backend/lane-routing/**`, `libs/backend/rpc-handlers/**`, `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, and `libs/backend/vscode-lm-tools/**` were not edited. No `package.json` change (#79).

`ptah_agent_report` is not on this session's MCP catalog (`search_tool` for report/ptah returned no tools; only the `tasks` server is connected). The handoff is this file.

## Task 30a.1

`registerLaneRoutingServices(container, logger)` (`libs/backend/lane-routing/src/lib/di/register.ts:51`) stores the host logger on `LANE_ROUTING_TOKENS.LOGGER` and builds `DECISION_MODEL_CONFIG` with `useFactory`. `STRUCTURED_DECISION` is read only inside that factory, and only when `container.isRegistered(token, true)` (`register.ts:43-48`, `:86-89`). The host logger is the same `logger` argument the neighbouring `register*Services(container, logger)` calls already receive (SC-9). No cast.

Production calls, one per host:

| Host | Call | Before |
| --- | --- | --- |
| VS Code | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:123` | `registerVsCodeLmToolsServices` at `:124` in the same function. `DIContainer.setup` runs phase 2 at `apps/ptah-extension-vscode/src/di/container.ts:53` before `registerRpcSurface` at `apps/ptah-extension-vscode/src/activation/bootstrap.ts:177` (`DIContainer.setup(context)` is `:123`). |
| Electron | `apps/ptah-electron/src/di/phase-2-libraries.ts:308` | Beside `registerCliAgentRuntimeServices` (`:309`). `apps/ptah-electron/src/di/container.ts:44` runs phase 2 before phase 3 (`:45`), and phase 3 calls `registerVsCodeLmToolsServices` at `apps/ptah-electron/src/di/phase-3-storage.ts:134`. `main.ts:179` `bootstrapElectron(` (which calls `ElectronDIContainer.setup`) is before `wireRuntimePreWindow(` at `main.ts:284`. That function calls `registerRpcSurface` at `apps/ptah-electron/src/activation/wire-runtime.ts:328`. |
| CLI | `libs/backend/cli-engine/src/lib/container.ts:739` | Phase 2, for both `minimal` and `full`. `registerVsCodeLmToolsServices` is `:837` and `registerRpcSurface` is `:953`, both inside `bootstrapMode === 'full'`. |

VS Code placement: the plan landmark "beside :216" is now `registerCliAgentRuntimeServices` at `phase-2-libraries.ts:220`, which is after `registerVsCodeLmToolsServices`. The quality rule requires the lane-routing call before that LM-tools call, so it sits at `:123`, immediately above `:124`. `registerSdkServices` still runs later in the same phase. That is safe: the decision-model factory checks `STRUCTURED_DECISION` when the token is first resolved, which is `registerRpcSurface`, after `registerSdkServices`.

Grep of `registerLaneRoutingServices(` under `*.ts` shows one production call in each of the three files above. The other hits are the definition, `register.spec.ts`, and the three smoke specs (a child container, not the host root).

## expected-resolvable

`EXPECTED_RESOLVABLE` stays a list of handler classes. A symbol has no `.name`, and the shared `it.each` title reads `.name`. `AgentRpcHandlers` was not added to that list: the shared case would resolve it before the fixtures below exist.

Sibling constant, same symbol as `LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG` (`Symbol.for('LaneRoutingDecisionModelConfig')`), matching `LANE_MODEL_LISTING_TOKEN` and `STRUCTURED_DECISION_TOKEN`:

- `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:45`
- `apps/ptah-electron/src/di/expected-resolvable.ts:51`
- `apps/ptah-cli/src/di/expected-resolvable.ts:41`

## Smoke specs (TL-59)

Each file has one `describe` with two `it`s. The first reads the host source and asserts a single `registerLaneRoutingServices(container, logger)` before `registerVsCodeLmToolsServices` and before `registerRpcSurface` runs. The second resolves the config and `AgentRpcHandlers`.

| File | Order case | Resolve case |
| --- | --- | --- |
| `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` | `:322` | `:347` (call at `:350`) |
| `apps/ptah-electron/src/di/container.smoke.spec.ts` | `:347` | `:378` (call at `:381`) |
| `apps/ptah-cli/src/di/container.smoke.spec.ts` | `:324` | `:348` (call at `:351`) |

The resolve case calls `registerLaneRoutingServices` on the spec's child container. That container is hand-built and does not execute phase 2 (header of each smoke spec). This matches the structured-decision case, which calls `registerSdkServices` on the same kind of container. The source `it` is what fails if a host drops or duplicates the production call.

`AgentRpcHandlers` is library-owned and is not in `EXPECTED_RESOLVABLE`. Resolving it constructs `CliModelListService` (registered by `registerSharedRpcHandlers`) and needs tokens the minimal container does not bind. `registerAgentHandlerFixtures` stubs only those, the same way `registerLaneModelListingFixtures` stubs the listing adapter:

- `PLATFORM_TOKENS.STATE_STORAGE` with `get` returning `undefined`. `DecisionModelConfig` calls `storage.get` from `loadMark` in the constructor (`decision-model.config.ts:125`, `:541-544`). `undefined` leaves the mark unset and does not log.
- `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` when missing. The CLI minimal container does not register it. VS Code and Electron already do.
- `PLATFORM_TOKENS.PLATFORM_INFO`
- `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY`
- `TOKENS.AGENT_PROCESS_MANAGER`
- `SDK_TOKENS.SDK_SESSION_METADATA_STORE`
- listing fixtures: `CLI_DETECTION_SERVICE`, Codex auth, Copilot auth (and the provider-models / persistence stubs that helper already adds). `MODEL_DISCOVERY` is already on the minimal container.

The case resolves the handler and checks `toBeInstanceOf`. It does not call `register()`. The smoke file's job is the constructor token list. `register()` runs `detectAll` and settings migration, which these stubs do not implement. Boot fails at `container.resolve(ctor)` before `register()` (`register-rpc-surface.ts:185`), and that resolve is what the case performs.

`STRUCTURED_DECISION` is left unregistered in this case. The factory's `optional()` returns `undefined`. The existing structured-decision `it` already resolves that port after `registerSdkServices`.

## validate-deps

Not changed and not run. `apps/ptah-electron/scripts/validate-deps.js` builds the production main bundle (`nx run ptah-electron:build-main:production`) before it scans external imports. This batch does not run Nx build. `@ptah-extension/lane-routing` is already a TypeScript path in `tsconfig.base.json` and `apps/ptah-electron/tsconfig.build.json` (around `:89`). It was not added to any `package.json`. If the pre-push gate reports a missing external, allowlist it then.

## Assumptions and risks

No assumption row in `batches.md` is assigned to Batch 30a. The optional-port behaviour is the code cited above, not a new guess.

Risk handled: a second registration of the lane-routing tokens would throw at boot. Each host file contains one call. The smoke source `it` asserts `toHaveLength(1)`.

Risk left: Jest on the three `container.smoke.spec.ts` files was not run here. The orchestrator runs them (Batch 30a verification). A resolve failure would mean a constructor token is still missing from `registerAgentHandlerFixtures`.

## Checks

ESLint on the nine edited files, exit 0. 0 errors, 4 warnings:

- `apps/ptah-cli/src/di/container.smoke.spec.ts:64` `SetupRpcHandlers` unused. Pre-existing import. Not added here.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:68` same warning.
- `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:46` same warning.
- `libs/backend/cli-engine/src/lib/container.ts:982` `max-lines` 701, maximum 700 (warn). Comments and blank lines are skipped, so the new call is the counted line. The two comment lines above it are not. Left in place. The call is the task.

Prettier `--check` on the nine files: `All matched files use Prettier code style!` (exit 0). `prettier --write` was needed once on `apps/ptah-electron/src/di/container.smoke.spec.ts`. `git diff --stat` for that file is insertions only.

Degradation audit (`Select-String 'FAIL|TOTAL'` because this shell has no `grep`): exit 0. Output:

```
degradation-audit: per-directory totals
degradation-audit: TOTAL 296 unsuppressed site(s)
```

No `FAIL` line. Total 296.

di-lint (`Select-Object -Last 5`): exit 0.

```
di-lint OK: 1843 @inject sites all resolve to a registered token (814 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies
```
