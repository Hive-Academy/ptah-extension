# Batch 10d.L5 revision 2: lane outcome startup

## Root cause and timing

The live Electron log at `C:\Users\abdal\AppData\Local\Temp\ptah-live-p10dL4-20261101-012450\app.log:76` identifies the missing `Symbol(WorkspaceScopeResolver)`. The warning appears before settings registration at log line 78.

`apps/ptah-electron/src/di/container.ts:42-48` runs phases 0 through 4 and then starts lane outcomes. Phase 2 registers outcome services and both classifier aliases at `apps/ptah-electron/src/di/phase-2-libraries.ts:293-303`; the structured decision binding is installed by `libs/backend/agent-sdk/src/lib/di/register.ts:882-884`. `libs/backend/lane-outcomes/src/lib/di/start.ts:75-82` previously resolved the recorder immediately. Its factory resolves the failure and task kind classifiers at `libs/backend/lane-outcomes/src/lib/di/register.ts:76-93`. The routing classifier factory resolves `STRUCTURED_DECISION` at `libs/backend/lane-routing/src/lib/di/register.ts:189-218`.

From there the log's dependency chain is `StructuredDecisionAdapter` (`libs/backend/agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts:75-81`) -> `InternalQueryService` (`libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:64-66`) -> `SdkQueryRunner` (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:276-290`) -> `SdkModelService` (`libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:372-381`) -> `AuthManager` (`libs/backend/auth-providers/src/lib/auth/auth-manager.ts:95-98`) -> `ProviderModelsService` (`libs/backend/auth-providers/src/lib/provider-models.service.ts:123-128`) -> `ActiveProviderResolver` (`libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:62-65`) -> `SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER`.

Electron registers `ACTIVE_WORKSPACE_SOURCE` only after `ElectronDIContainer.setup` returns (`apps/ptah-electron/src/activation/bootstrap.ts:418-434`). `registerElectronSettings` then conditionally registers `WORKSPACE_SCOPE_RESOLVER` when that source exists (`libs/backend/platform-electron/src/settings/electron-settings-registration.ts:86-103`). Moving outcome startup after phase 4 in commit `2d1c69dd2` could not fix this, because all DI phases still precede settings registration in bootstrap.

## Change

`libs/backend/lane-outcomes/src/lib/di/start.ts:77-82,103-131` now resolves the recorder when a subscribed outcome callback first runs. Startup still resolves the write pipeline, attaches the stop, budget stop and optional subagent ended callbacks, and registers the bounded shutdown disposer (`start.ts:141-144,197-213`). Electron settings registration precedes agent adapter initialization (`apps/ptah-electron/src/activation/bootstrap.ts:431-434,661-665`), so ordinary lane callbacks run after the resolver exists. I kept the `2d1c69dd2` phase-4 move: callback registries and SQLite storage are registered before startup, and reverting it adds an unrelated ordering change. `apps/ptah-electron/src/di/container.smoke.spec.ts:768-825` remains consistent with that order.

The existing startup failure spec now makes the pipeline factory throw, because a recorder factory is intentionally no longer invoked during startup. A new spec in `libs/backend/lane-outcomes/src/lib/di/start.spec.ts` registers a recorder factory that throws while `WorkspaceScopeResolver` is absent. It asserts that startup emits no warning, subscribes a callback and registers a disposer before the token exists; after the token is registered, the first event resolves the recorder, records the event and the disposer drains the pipeline. This would fail with the old eager recorder resolution.

## Other hosts

- VS Code registers the failure classifier alias at `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:150-157`, registers SDK services at line 199 and starts outcomes at line 268. `DIContainer.setup` completes before bootstrap registers `ACTIVE_WORKSPACE_SOURCE` and VS Code settings (`apps/ptah-extension-vscode/src/activation/bootstrap.ts:123-136`); the scope resolver is conditional in `libs/backend/platform-vscode/src/settings/vscode-settings-registration.ts:114-128`. The same eager chain could fail there. The shared change defers it; no VS Code edit is needed.
- CLI registers the failure classifier alias at `libs/backend/cli-engine/src/lib/lane-outcomes-wiring.ts:14-20`, SDK services at `libs/backend/cli-engine/src/lib/container.ts:702`, and starts outcomes at `container.ts:799` via `lane-outcomes-wiring.ts:23-27`. It registers `ACTIVE_WORKSPACE_SOURCE` and CLI settings later at `container.ts:836-840`; the resolver is conditional in `libs/backend/platform-cli/src/settings/cli-settings-registration.ts:89-105`. The same eager chain could fail there. The shared change defers it; no CLI edit is needed.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\lane-outcomes\src\lib\di\start.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\lane-outcomes\src\lib\di\start.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L5-r2-report.md`

## Evidence and risks

I inspected the live log stack, source registration order, and the changed diff. Tests, typecheck, lint, build and live Electron verification were not run, as instructed. The remaining runtime risk is an outcome callback arriving before host settings registration, or another service resolving the recorder independently during that interval. The host boot paths register settings before agents can spawn. Skill discovery was available, but its local inventory contained no matching backend or DI skill, so no skill was applied.

## Line endings

Byte scan of every file written (CR bytes; BOM):

| File | CR bytes | BOM |
| --- | ---: | --- |
| `libs/backend/lane-outcomes/src/lib/di/start.ts` | 0 | no |
| `libs/backend/lane-outcomes/src/lib/di/start.spec.ts` | 0 | no |
| `.ptah/specs/TASK_2026_714_c8a2/batch-10d-L5-r2-report.md` | 0 | no |
