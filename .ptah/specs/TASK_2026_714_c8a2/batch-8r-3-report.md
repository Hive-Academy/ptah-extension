# Batch 8r-3 report

`config:models-list` now names the workspace it is answering, and the composer drops a reply whose scope or generation is stale. A saved model that the SDK base list omits is still offered through the existing saved-model option.

No Ptah MCP server named `ptah` was connected (`search_tool` for `ptah` and `agent_report` returned no tools; the connected server is `tasks`). `ptah_agent_report` was not called. File search used ripgrep. Tests, typecheck, and lint were not run (forbidden for this batch).

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\shared\src\lib\types\rpc\rpc-config.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\shared\src\lib\types\rpc.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\config-rpc.schema.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\config-rpc.handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\config-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\core\src\lib\services\model-state.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\core\src\lib\services\model-state.service.spec.ts`

`rpc.types.ts` re-exports the models-list types from `rpc-config.types.ts`. The interfaces live in the latter; the method map lives in the former. There was no dedicated `config:models-list` schema file. Validation was added to the existing config RPC schema, `config-rpc.schema.ts`.

## What changed

- `rpc-config.types.ts:101-103` — `ConfigModelsListParams.workspacePath?: string | null`.
- `rpc-config.types.ts:117-126` — `ConfigModelsListResult.workspacePath?` echoes that path. `null` is the ambient scope. Optional on the type so a `{ models }` fixture still assigns.
- `rpc.types.ts:193-194,980-983` — `config:models-list` params are `ConfigModelsListParams` (was `Record<string, never>`).
- `config-rpc.schema.ts:80-101` — `parseModelsListParams`. Missing body is ambient. A present path must be a non-empty string or null.
- `config-rpc.handlers.ts:114-115` — optional `WorkspaceScopeResolver`, last constructor argument.
- `config-rpc.handlers.ts:499-627` — the handler parses the path, then snapshots provider, saved model, cached catalog ids, tier overrides, and subscription coverage before `getSupportedModels` / `getApiModels`. The reply is `{ models, workspacePath }`.
- `config-rpc.handlers.ts:648-699` — `captureModelsListScope` / `readWorkspaceModelScope`. A path uses `readForPath` with the same app-scopable provider key as `ModelSettings`. No path uses one ambient read of `resolveActiveProviderId` and `selectedModel.get`. A path with no resolver throws instead of answering from ambient.
- `config-rpc.handlers.ts:710-743` — `appendSavedModel` takes the snapshotted provider id and cached ids. It still calls `savedModelOption` and does not invent ids.
- `config-rpc.handlers.ts:756-764` — `getTierOverrides(providerId)` no longer re-reads the active provider.
- `model-state.service.ts:294-313` — the request sends `workspacePath`. A reply is dropped when `modelsGeneration` or `scopeKey` moved, or when a present `workspacePath` is not the path that was asked for. A reply that omits the field is still applied (legacy fixtures).
- `model-state.service.ts:359-369` — `responseMatchesWorkspace`.

## Specs added

`config-rpc.handlers.spec.ts`

- `1138` rejects a non-string `workspacePath`.
- `1147` a workspace path with no scope resolver throws and does not read the ambient model.
- `1157` workspace-saved `gpt-6-sol` is offered and selected when the base list is only `default`, `gpt-6.1-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`. Name comes from the Codex static entry (`GPT 6 Sol`). Ambient `gpt-6-astra` is not read.
- `1190` two in-flight calls. The workspace call snapshots a null catalog (static option keeps `gpt-6-sol`). The catalog mock then changes to `['gpt-6-astra']` and the null-path call selects `gpt-6-astra`. Each result echoes its own path.
- `1240` Claude workspace saved `claude-opus-4-7` stays selected after the ambient provider, saved model, and cache are flipped to Codex `gpt-6-astra` during the catalog await. `getModelTiers`, `resolveActiveProviderId`, and `selectedModel.get` are not called.

`model-state.service.spec.ts`

- `89` initial load sends `{ workspacePath: null }`.
- `747` workspace and global requests are in flight; the global reply is applied first; the later workspace reply is dropped.
- `797` a reply whose echoed path is null is dropped when the request asked for a workspace.
- `826` a matching echo selects `gpt-6-sol`.
- `847` the same path match selects `claude-opus-4-7`.

## Callers

These call `config:models-list` and were not edited. They do not use `RpcMethodParams<'config:models-list'>`, so the params change does not force a source edit. They compile as they stand. Omitted params are the ambient scope.

| Caller | Line | Compiles unchanged |
| --- | --- | --- |
| `apps/ptah-cli/src/cli/commands/config.ts` | 422-426 | Yes. `callRpc<unknown>(..., undefined)`. The notification payload gains `workspacePath: null`. |
| `apps/ptah-tui/src/hooks/use-agent-config.ts` | 76-79 | Yes. Explicit `<void, ModelsListResult>`. Reads `.models` only. |
| `apps/ptah-tui/src/components/overlays/ModelSelector.tsx` | 61-64 | Yes. Same explicit generic. |
| `apps/ptah-tui/src/components/settings/SettingsPanel.tsx` | 44-46 | Yes. Same explicit generic. |
| `apps/ptah-electron-e2e/src/specs/rpc.spec.ts` | 68 | Yes. Untyped `rpcCall('config:models-list')`. Asserts the success envelope, not the field set. |
| `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts` | 57 | Yes. Local mock map, not the shared result type. |
| `libs/frontend/chat/.../chat-input.component.spec.ts` | 170 | Yes. Mock `{ models: [] }` is not annotated as `ConfigModelsListResult`. A missing `workspacePath` is still applied. |
| `libs/frontend/chat/.../chat-input.command-center-lock.spec.ts` | 150 | Yes. Same. |
| `libs/frontend/chat/.../chat-view.component.spec.ts` | 364 | Yes. Same. |
| `libs/frontend/chat/.../cli-agent-output.component.spec.ts` | 87 | Yes. Same. |

`model-state.service.ts:296` is the production frontend caller and was updated.

## Decisions

- The host scope is `workspacePath`, not the webview generation. The generation only exists in `WorkspaceScopeService`. The client still drops a stale generation. The echoed path catches a reply built for a different folder while this generation is still current.
- A named path is read with `WorkspaceScopeResolver.readForPath` (auth method, provider id, `provider.<authKey>.selectedModel`), matching `ModelSettings` and `ActiveProviderResolver.resolveActiveAuthForPath`. The resolver is an optional last constructor argument so existing positional specs keep their argument lists.
- A named path with no resolver throws. Falling through to the ambient model would recreate the race.
- `getSupportedModels` and `getApiModels` stay on the adapter and still follow that adapter's ambient auth during the await. Provider, saved model, tier overrides, and the cached id list used by `savedModelOption` are the values captured before that await. No second catalog proxy and no fabricated SDK row.
- `gpt-6-sol` is already on the Codex static list (`codex-provider-entry.ts`). With no live cached catalog, `savedModelOption` offers it. A live catalog that does not include it still wins, which is the existing rule.
- `workspacePath` on the result is optional so `{ models }` fixtures stay valid. The handler always sets it.

## Not done

- No test, typecheck, lint, or Nx target was run.
- Comments in `workspace-scope.service.ts` and `workspace-coordinator.service.ts` still say `config:models-list` has no workspace parameter. Those files are outside this batch.
- `config-rpc.handlers.ts` was already over the `max-lines` warning. This batch adds the scope snapshot in that file. A split would be a new module, which this batch does not own.
- `ptah_agent_report` could not be called: no connected MCP server named `ptah`.

## Revise 1

Both review defects are closed in the handler. `ModelResolver` already accepts `envOverride` on `resolve` and `isSubscriptionCovered`, so `model-resolver.ts` and its spec were not edited.

### Defect 1 — candidate matching after the catalog await

`config-rpc.handlers.ts:106-137` `modelsListResolutionEnv` builds one auth env from the pinned provider id and the tier overrides captured with it (persisted tier, otherwise that provider's registry `defaultTiers`).

`config-rpc.handlers.ts:573` calls `captureModelsListScope` before the awaits at `577-578`. `744-756` stores that env and resolves the saved model with it. `612-617` `matchesSaved` passes the same env into `resolve`. A later write to the shared auth env is not read.

Spec `config-rpc.handlers.spec.ts:1341`. Workspace saved `haiku` is snapshotted to `gpt-5.6-terra`. The catalog await is gated. Before release, the ambient alias table and `getModelTiers` flip so `sonnet` becomes `gpt-5.6-terra` and `haiku` becomes `gpt-6-astra`. The selected entry stays `claude-haiku-4-5`. Every `resolve` call received an env whose haiku tier is still `gpt-5.6-terra` and whose token is the Codex placeholder.

### Defect 2 — explicit workspace priced and resolved against ambient

`config-rpc.handlers.ts:759` sets `subscriptionCovered` with `isSubscriptionCoveredProvider(pinned.providerId)`. `isSubscriptionCovered()` is not called, so the shared auth env is not consulted for the fee label. The same resolution env used for the saved model is the env for every candidate.

Spec `config-rpc.handlers.spec.ts:1411`. Before the call, ambient is direct Anthropic (`haiku` → `claude-haiku-4-5`, `isSubscriptionCovered` would be false). The requested workspace is Codex with `haiku` → `gpt-4o`. The selected id is `gpt-4o` and its description contains `covered by subscription`. `resolveActiveProviderId`, `selectedModel.get`, and `isSubscriptionCovered` are not called. Every `resolve` call received the Codex token and haiku tier `gpt-4o`.

### Null scope

Spec `config-rpc.handlers.spec.ts:1469`. `workspacePath: null` still reads the ambient provider (`openrouter`) and `selectedModel`. A Codex workspace on the resolver is not used. The selected id is ambient `gpt-4o`. The description has rates and does not say `covered by subscription`. The resolution env token is the OpenRouter placeholder.

### Files

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\config-rpc.handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\config-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8r-3-report.md`

### Decisions

- Subscription coverage is the pinned provider id (`isSubscriptionCoveredProvider`), not `isSubscriptionCovered(env)`. Codex and Copilot registry base URLs are empty, so rebuilding an env and then asking `getActiveProviderId` is a worse source for the fee label than the provider id already pinned for the request.
- The resolution env still carries that provider's base URL, or `http://127.0.0.1` when the registry URL is empty, plus the placeholder token `getActiveProviderId` already recognizes. Tier strings are persisted overrides, then registry `defaultTiers`. The live catalogue is not read into the snapshot.
- Direct Anthropic (`providerId === 'anthropic'`) gets an empty base URL and no tier vars, which is the direct-auth shape `ModelResolver` already treats as Anthropic.
- No `ModelResolver` parameter was added. Existing callers are unchanged.

### Not done

- Tests, typecheck, lint, and diagnostics were not run.
- `model-resolver.ts` was not modified.
- No matching skill covers this RPC snapshot. Ptah MCP `ptah_agent_report` is not connected (`search_tool` for `ptah_agent_report` returned no `ptah` server). The connected server is `tasks`.

## Revise 2

`modelsListResolutionEnv` is gone. A null-scope request copies the shared auth env `ModelResolver` already reads. An explicit workspace uses the chat runtime's profile env. Neither path builds tokens or tier vars in the handler.

### What changed

`config-rpc.handlers.ts`

- `84-86` `snapshotAuthEnv` is `{ ...env }`.
- `132-140` optional `AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV` and `SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER`, after the scope resolver so existing positional constructors stay valid.
- `532-535` `captureModelsListScope` is awaited before `getSupportedModels` / `getApiModels`.
- `691-729` provider, saved model, cached ids, and tier overrides are still read before that await. Null scope copies the shared env on that same turn, before any await. An explicit path then awaits the workspace profile once.
- `727` `modelResolver.isSubscriptionCovered(resolutionEnv)`.
- `733-763` `snapshotSharedAuthEnv` / `workspaceResolutionEnv`. The profile call is `resolveProviderProfileForWorkspace(workspacePath, savedModel)`. A returned profile's `authEnv` is copied. `undefined` copies the shared env, which is what that method means. No resolver throws.

Deleted from the same file: `modelsListResolutionEnv`, `RESOLUTION_PROXY_TOKEN`, `CapturedTierOverrides`, and the placeholder / `getAnthropicProvider` / `isSubscriptionCoveredProvider` imports that only those used.

Saved-model reads are unchanged: `readWorkspaceModelScope` still pins `providerId` and `savedModel` from the scope resolver. `appendSavedModel` still uses that pin.

### Builder and registration

No new auth-providers method. The public method is `WorkspaceProviderProfileResolver.resolveProviderProfileForWorkspace` (`workspace-provider-profile-resolver.ts:347`). `resolveExecutionProfile` already calls it for a chat session (`:274`). It is exported from `libs/backend/auth-providers/src/index.ts:50`.

DI token: `AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER` (`Symbol.for('SdkWorkspaceProviderProfileResolver')`), registered in `libs/backend/auth-providers/src/lib/di/register.ts:115-118` inside `registerAuthProvidersServices`. The shared env token is `SDK_AUTH_ENV` in that same function at `:56-59` (`registerInstance` of the object `ModelResolver` injects).

Hosts that call `registerAuthProvidersServices`:

| Host | Call |
| --- | --- |
| VS Code | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:188` |
| Electron | `apps/ptah-electron/src/di/phase-2-libraries.ts:206` |
| CLI | `libs/backend/cli-engine/src/lib/container.ts:694` |

`platform-vscode`, `platform-electron`, and `platform-cli` do not register auth services. No host registration is missing. No app file was edited.

The live-derived tier chain stays where it already runs: `ProviderModelsService.applyPersistedTiers` (`provider-models.service.ts:861-877`) writes it into the shared env, and `applyProviderTiers` (`workspace-provider-profile-resolver.ts:773-792`) writes the same chain into the profile env. This handler does not call `getLiveDerivedTiers`.

### Specs

`config-rpc.handlers.spec.ts`. Revise-1 cases that only asserted the hand-built Codex/OpenRouter placeholder, and that `isSubscriptionCovered` was not called, are replaced.

- `1253` explicit path with no profile resolver throws and does not read the ambient saved model.
- `1408` null scope, provider `claude-cli`, shared env empty, catalog has `claude-haiku-5-5` and not `claude-haiku-4-5`. The saved static option `claude-haiku-4-5` is appended and selected. The profile resolver is not called.
- `1454` explicit `thirdParty` + `claude-cli`. Ambient env maps haiku to `claude-haiku-5-5`. The profile env is the empty native shape. The saved `claude-haiku-4-5` is still appended.
- `1514` null scope, no persisted tier, shared env already has live-derived haiku `live-derived-haiku`. The catalog await mutates that object. The selected id stays `live-derived-haiku`. A Codex workspace on the scope resolver is not consulted.
- `1578` explicit scope, no persisted tier, profile env has `live-derived-haiku`, ambient env has `ambient-haiku`. Mutating both objects inside the catalog fetch does not change the selection.
- `1650` explicit Codex workspace while ambient is Anthropic. Resolve and `isSubscriptionCovered` receive the profile env (`http://127.0.0.1:4317`, Codex placeholder, haiku `gpt-4o`). The selected row says `covered by subscription`.
- `1724` null scope stays on the shared OpenRouter env (`shared-openrouter-token`, haiku `gpt-4o`) and does not call the profile resolver. The fee line has rates and does not say `covered by subscription`.
- `1795` profile builder returns `undefined`. The handler copies the shared env, so the saved alias still resolves to `live-derived-haiku`.

### Files

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\config-rpc.handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\config-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8r-3-report.md`

`workspace-provider-profile-resolver.ts` and `libs/backend/auth-providers/src/index.ts` were not edited.

### Decisions

- The chat method already returns the env. Adding another public method would duplicate `resolveProviderProfileForWorkspace`, including its `undefined` means "shared env serves this provider" result. The handler copies that env, or the shared env when the result is `undefined`.
- `undefined` is copied after the profile await and still before the catalog awaits. Null scope is copied before any await, so a later write to `SDK_AUTH_ENV` cannot change it.
- Subscription coverage is `ModelResolver.isSubscriptionCovered(snapshot)`. That is the pre-8r-3 question, asked of the pinned env instead of the live object. Revise 1's provider-id check is not used.
- Calling the real builder can acquire a pooled proxy for a proxy provider. That is the env the session would use. The handler does not start a second proxy of its own.
- The profile resolver and the auth env are optional constructor arguments. A named workspace with no profile resolver throws. Production hosts register both tokens.

### Not done

- Tests, typecheck, lint, and diagnostics were not run.
- No auth-providers source file was changed.
- Ptah MCP is not connected. `search_tool` for `ptah` and `ptah_agent_report` returned no tools (`status: ready`, 10 hidden tools on the connected `tasks` server). `ptah_agent_report` was not called.
