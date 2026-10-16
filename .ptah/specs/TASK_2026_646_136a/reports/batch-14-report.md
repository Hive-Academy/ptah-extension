# Batch 14 (A10) report — Lane model listing adapter

Task 14.1 is implemented. `LaneModelListingAdapter` matches the Batch 5 port (`list(row, signal)`), covers system CLI rows and Ptah CLI provider discovery, and is registered as a singleton under `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING`.

## Files

Created:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\services\lane-model-listing.adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\services\lane-model-listing.adapter.spec.ts`

Modified:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\package.json`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-extension-vscode\src\di\expected-resolvable.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-extension-vscode\src\di\container.smoke.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\di\expected-resolvable.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\di\container.smoke.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-cli\src\di\expected-resolvable.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-cli\src\di\container.smoke.spec.ts`

Not modified: `libs/backend/rpc-handlers/src/index.ts` (hosts resolve the token; the class does not need a barrel export). No `apps/*/src/di/phase-*.ts` or `cli-engine` container edits.

## Task 14.1 evidence

- Port shape: `list(row: CliDetectionResult, signal: AbortSignal)` at `lane-model-listing.adapter.ts:119-127`. System CLI rows call `listAll()` and `listForClassification()` together (`:129-133`) and tag `reported` when `isFallback` is not true, otherwise `fallback` (`:142`).
- Ptah CLI saved entries are built before discovery: `selectedModel` is `configured`, then `tierMappings` sonnet/opus/haiku are `tier`, unique by id (`lane-model-listing.adapter.ts:214-235`).
- Discovery uses `ProviderModelsService.fetchModels(providerId, apiKey ?? null, false)` (`:282-286`) and `IAuthSecretsService.getProviderKey` (`:278`). The no-key guard matches `provider:listModels`: a provider with `modelsEndpoint` and no static catalog is skipped (`:301-308`, same condition as `provider-rpc.handlers.ts:600-612`).
- Provenance of discovery ids: `reported` when `isStatic === false`, `fallback` when `isStatic === true`. An id already saved as configured or tier keeps that provenance (`:238-256`).
- One in-flight discovery promise per `providerId`, released when it settles (`:262-273`). Each row races its own signal against that shared promise (`:190-196`, `:314-336`). Abort, throw, or an empty model list returns the saved entries and logs one `debug` with `{ ptahCliId, providerId, reason }` (`:345-350`). Raw errors are not logged.
- Registration: `register-shared-rpc-handlers.ts:61-64` registers `LaneModelListingAdapter` as a singleton on `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING`, immediately after `CliModelListService`.
- Dependency declaration: `libs/backend/rpc-handlers/package.json:21` adds `@ptah-extension/lane-routing` so `@nx/dependency-checks` accepts the import. The import is the public barrel (`register-shared-rpc-handlers.ts:24`). `lane-routing` does not import `rpc-handlers` (its `src/index.ts` exports tokens and constants only; source imports are `@ptah-extension/shared`).

Spec cases in `lane-model-listing.adapter.spec.ts`: live vs fallback CLI ids; curated `pi` list; merge order and duplicate suppression; static discovery tagged `fallback`; thrown discovery logs `reason: 'threw'` once; no key on `openrouter` does not call `fetchModels`; no key on `moonshot` (static catalog) still calls `fetchModels`; empty discovery logs `reason: 'empty'`; two rows on one provider call `fetchModels` once; a settled burst fetches again; a fetch that never resolves, with the signal aborted via fake timers at 2000 ms, still returns configured and tier entries while a Codex row in the same turn returns its full list.

## PA-1

**Result: true.** `registerSharedRpcHandlers` runs in all three host containers. Every dependency the adapter injects is registered in each root before that call. Nothing was stopped under rule 8.

Call sites:

- VS Code: `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:92`. Setup order is phase 2 then phase 3 (`apps/ptah-extension-vscode/src/di/container.ts:53-54`). The comment at the top of `phase-3-handlers.ts` that says this phase runs before the library phase is stale; `DIContainer.setup` does not do that.
- Electron: `apps/ptah-electron/src/di/phase-4-handlers.ts:105`. Setup order is phase 2 then phase 4 (`apps/ptah-electron/src/di/container.ts:43-45`).
- CLI: `libs/backend/cli-engine/src/lib/container.ts:863`, inside `CliDIContainer.setup`. `apps/ptah-cli/src/main.ts:33` imports that container. The CLI smoke fixture also calls it (`apps/ptah-cli/src/di/container.smoke.spec.ts:180`).

Dependencies, all bound before those calls:

| Dependency | Where it is registered | Before the shared RPC call |
| --- | --- | --- |
| `TOKENS.LOGGER` | phase 0 in each `setup` | yes |
| `TOKENS.AUTH_SECRETS_SERVICE` | `libs/backend/vscode-core/src/di/register-platform-agnostic.ts:150-153`, from each host's phase 1 | yes |
| `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS` | `libs/backend/auth-providers/src/lib/di/register.ts:49-53` via `registerAuthProvidersServices` | VS Code `phase-2-libraries.ts:152`; Electron `phase-2-libraries.ts:197`; CLI `container.ts:673` |
| `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE` | `libs/backend/cli-agent-runtime/src/lib/di/register.ts:60-64` via `registerCliAgentRuntimeServices` | VS Code `phase-2-libraries.ts:216`; Electron `phase-2-libraries.ts:305`; CLI `container.ts:736` |
| `CliModelListService` | same function, one line earlier (`register-shared-rpc-handlers.ts:60`) | its own deps (`CLI_DETECTION_SERVICE`, `MODEL_DISCOVERY`, `SDK_CODEX_AUTH`, `SDK_COPILOT_AUTH`) are already registered by the phase 2 calls above (`cli-agent-runtime` `register.ts:78-80`, host `MODEL_DISCOVERY`, `auth-providers` `register-providers.ts:69-85`) |

`getAnthropicProvider` is a function from `@ptah-extension/shared`, not a DI token.

The Batch 30 fallback (register the adapter directly in `cli-engine` `container.ts`) is not needed.

## Rule 8 guard edits

The registration makes `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING` (`Symbol.for('LaneRoutingLaneModelListing')`) resolvable in every host that already calls `registerSharedRpcHandlers`.

`EXPECTED_RESOLVABLE` stays a list of handler classes. The smoke title uses `token.name` (`container.smoke.spec.ts` in each app), and a symbol has no `.name`. The new token is a sibling export:

- `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:25`
- `apps/ptah-electron/src/di/expected-resolvable.ts:31`
- `apps/ptah-cli/src/di/expected-resolvable.ts:21`

Each `container.smoke.spec.ts` resolves that symbol and checks the singleton:

- VS Code `:232-240`
- Electron `:263-271`
- CLI `:224-232`

The minimal smoke containers do not construct `CliModelListService` today, so they do not bind its constructor tokens or the two ports the adapter adds. Each new test registers useValue stubs for `CLI_DETECTION_SERVICE`, `SDK_CODEX_AUTH`, `SDK_COPILOT_AUTH`, `SDK_PROVIDER_MODELS`, and `SDK_PTAH_CLI_CONFIG_PERSISTENCE` only when missing. Those tokens are already registered in the real roots (table above). The stubs are the same kind of fixture the smoke file already uses for other constructor deps. No production host file was edited to paper over a missing registration.

No RPC method or MCP tool was added, so `rpc-surface.spec.ts` and `surface-composition.spec.ts` were not changed. The known `'agent:outcomeSignals'` gap (R-5) was left alone.

## Decisions

- The Batch 5 port type is not exported from `@ptah-extension/lane-routing` (`src/index.ts` stops at tokens and constants; Batch 5 left the index export to a later batch). The adapter does not deep-import `lane-model-listing.port.ts`. Its public method matches that file's `list(row, signal)` and `LaneModelEntry` provenance union. Reversible by adding the type export and an `implements` clause when the barrel grows.
- System CLI provenance prefers `listForClassification()` for `codex`, `copilot`, `cursor`, and `opencode`, because `listAll()` does not set `isFallback` on a curated list. `antigravity`, `pi`, and `grok` are only on `listAll()`, so an entry with `isFallback !== true` is `reported`, which is the plan's rule. Reversible if those three lanes later grow a live/fallback split inside `listForClassification`.
- Discovery failures log `debug` with a fixed reason (`aborted`, `empty`, `threw`, `threw-unknown`) and do not include the thrown value. Provider clients can echo request URLs. The catch sites are marked `degradation-audit: optional-capability`. The plan asked for `debug`, not `warn`.
- `auto` on `LaneModelEntry` is left unset. Neither `CliModelOption` nor `ProviderModelInfo` carries that flag.
- Two Ptah CLI rows share discovery only while the promise is in flight. A later `list` after it settles fetches again. The port is one row per call, so the "CLI row in the same call" case is two `list` calls in one turn, not a batch argument.

## Not done

- No Nx, Jest, typecheck, or lint run. Decision #53: the team-leader runs verification. Suggested order from the batch notes: the adapter spec, then `npx nx typecheck @ptah-extension/rpc-handlers`, then the three rule-8 smoke specs one at a time.
- No git commit, push, or PR.
- `src/index.ts` was not given an export.
- Host phase files and `cli-engine` `container.ts` were not edited.
