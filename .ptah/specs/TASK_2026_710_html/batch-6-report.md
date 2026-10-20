# Batch 6 + 6a report

## Files changed

- `libs/backend/rpc-handlers/src/lib/handlers/artifact-rpc.handlers.ts` (new)
- `libs/backend/rpc-handlers/src/lib/handlers/artifact-rpc.handlers.spec.ts` (new)
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
- `libs/backend/rpc-handlers/src/index.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
- `apps/ptah-electron/src/di/phase-4-handlers.ts`
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`

## Methods and scope

- `artifacts:list`: strict `{}` request (`ArtifactListRequestSchema`), `ArtifactListResponse` result. It reads the host active folder, falling back to workspace root (`artifact-rpc.handlers.ts:49-50`), and the most recently active SDK session (`artifact-rpc.handlers.ts:52`). These follow the established patterns in `diagnostics-consent-rpc.handlers.ts:324-325` and `config-rpc.handlers.ts:429`. An absent store, workspace or session produces `{ artifacts: [] }`. Client supplied scope fields are rejected.
- `artifacts:openLink`: `{ url: string }` request using the HTTP(S) rule from `ArtifactOpenLinkMessageSchema`, `{ opened: boolean }` result. It calls the platform `IUserInteraction.openExternal` port only after validation. Invalid schemes are rejected.
- Both methods are in the manifest for all hosts and in the runtime prefix allowlist. Electron registers the singleton in phase 4; VS Code and CLI resolve the manifest owned handler without host specific registrations.

## Verification

- Handler Jest spec: 1 suite, 8 tests passed.
- Electron RPC surface Jest spec: passed (exit 0).
- VS Code RPC surface Jest spec: passed (exit 0).
- CLI RPC surface Jest spec: 1 suite, 14 tests passed with `libs/backend/cli-engine/jest.config.cjs`. The initial command used `.ts` and failed because that config does not exist; rerun passed.
- `NX_NO_CLOUD=true npx nx typecheck rpc-handlers --parallel=1`: passed.
- `NX_NO_CLOUD=true npx nx typecheck shared --parallel=1`: passed.
- `ptah_get_diagnostics` twice returned unavailable after its 45 second timeout; the explicit Nx typechecks passed.

## Decisions

- Used a manifest owned handler with `requires: []`. Options were an Electron only capability or an all host handler with an optional store. The request requires an empty list on VS Code and CLI, and the manifest already uses all host entries for optional services. Reversible by changing the manifest entry.
- Used `getActiveSessionIds()[0]` as the host session source. The strict `{}` RPC request has no session identifier and `config-rpc.handlers.ts:429` establishes this pattern. This selects the most recently active SDK session when several are live; it cannot identify a particular webview tab from a scope free request. Reversible by changing the contract to carry a validated tab session identifier in a later task.
- Used the shared bridge schema URL rule and the platform opener. The Electron navigation policy accepts `mailto:` too, so the bridge schema is the narrower required HTTP(S) rule. Reversible in the schema and handler together.

## Anything not done

- Did not change the strict list request to carry a tab session ID; that would change the assigned contract and requires an explicit product decision for concurrent tabs.
