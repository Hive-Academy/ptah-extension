# Backend implementation — `TASK_2026_712_5d7c`, batch 27b (registration core)

**Tasks completed**: registry merge and method entries, the `providerAccounts` capability, the manifest entry, the singleton registration, and the public barrel export for `ProviderAccountRpcHandlers`.

## Files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/`.

- MODIFIED `libs/shared/src/lib/types/rpc.types.ts`
  - Adds `import type { ProviderAccountRpcMethodRegistry } from './rpc/rpc-provider-accounts.types'` (the module was already re-exported at `:19`).
  - Changes the declaration to `export interface RpcMethodRegistry extends ProviderAccountRpcMethodRegistry`, with a doc note.
  - Adds the 10 `provider:*Account*` names to `RPC_METHOD_ENTRIES`, directly after `'provider:getPlanLimits'`, in `PROVIDER_ACCOUNT_RPC_METHOD_NAMES` order. `RPC_METHOD_NAMES` derives from it.
- MODIFIED `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts`: adds `'providerAccounts'` after `'lanePlanLimits'` in `RPC_CAPABILITIES`, with a doc comment.
- MODIFIED `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts`: adds `providerAccounts: false` to `ALL_DISABLED`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - Adds `import { ProviderAccountRpcHandlers } from '../handlers/provider-account-rpc.handlers'`. This follows the direct-file import used for `DiagnosticsConsentRpcHandlers` and `ArtifactRpcHandlers` at `:86-87`.
  - Adds a lib-owned entry `{ key: 'providerAccounts', methods: ProviderAccountRpcHandlers.METHODS, requires: ['providerAccounts'], handler: ProviderAccountRpcHandlers }` after `lanePlanLimits`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`: adds `container.registerSingleton(ProviderAccountRpcHandlers)`, imported directly from its file.
- MODIFIED `libs/backend/rpc-handlers/src/index.ts`: adds `export { ProviderAccountRpcHandlers } from './lib/handlers/provider-account-rpc.handlers'` after the `./lib/handlers` block that holds `LanePlanLimitsRpcHandlers`.

## Decisions

1. **Merge through `extends`, not by copying entries.**
   - Options: interface `extends`; duplicate the 10 entries inline; an intersection type.
   - Evidence: `ProviderAccountRpcMethodRegistry` is the single source the handler and the schema already type against (`provider-account-rpc.handlers.ts:50,72-75`). `RpcMethodName = keyof RpcMethodRegistry` (`rpc.types.ts`) picks up inherited keys, so `Record<RpcMethodName, true>` forces the 10 entries in `RPC_METHOD_ENTRIES`. A grep confirms the registry body has no duplicate keys that could conflict.
   - Reversible: yes.
2. **Register a singleton in `registerSharedRpcHandlers`. `LanePlanLimitsRpcHandlers` has no such line.**
   - Options: rely on tsyringe auto-resolution of the `@injectable` class, as lane plan limits does; or `registerSingleton`.
   - Evidence: this handler is stateful. It keeps the `ledger` Map for `requestId` idempotency and a `revision` (`provider-account-rpc.handlers.ts:139-145`). An unregistered class resolves as transient, so a second `container.resolve` would get an empty ledger. Stateful siblings use the same `registerSingleton` pattern (`GitChangeSetRpcHandlers`, `AnalyticsRpcHandlers`, `DecisionModelCatalogRpcHandlers`).
   - Registration is lazy. VS Code and the CLI never resolve the class, because their manifest plan excludes it. The VS Code absent check tests the handler plan, not container registration (`apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:491-495`).
   - Dependencies: `ProviderAccountService` is a registered singleton (`libs/backend/auth-providers/src/lib/di/register.ts:158-160`). `TOKENS.WEBVIEW_MANAGER`, `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER` and `PLATFORM_TOKENS.WORKSPACE_PROVIDER` are existing tokens. No new token was added.
   - Reversible: yes.
3. **Direct-file imports.** `lib/handlers/index.ts` is not owned by this batch, so both the manifest and the public barrel import the class from its own file. The manifest already does this for two handlers, and `src/index.ts` does it for `file-open-rpc.schema`. Moving the export into `lib/handlers/index.ts` later is optional.
4. **`METHODS` typing.** `ProviderAccountRpcHandlers.METHODS = PROVIDER_ACCOUNT_RPC_METHOD_NAMES`, which is already `as const satisfies readonly (keyof ProviderAccountRpcMethodRegistry)[]` (`rpc-provider-accounts.types.ts:46`). Every one of those keys is now an `RpcMethodName`, so it satisfies `RpcHandlerManifestEntry.methods: readonly RpcMethodName[]` (`manifest.ts:101`). Adding `satisfies readonly RpcMethodName[]` in the handler file would be redundant. I did not edit that file, because this batch does not own it.

## Other places that enumerate methods or capabilities

| Location | Needs edit? |
| --- | --- |
| `apps/ptah-electron/src/rpc-host-profile.ts:48` (`lanePlanLimits: true`) | **Yes (27c)**: add `providerAccounts: true`. Until then Electron excludes the 10 methods, and `apps/ptah-electron/src/di/rpc-surface.spec.ts:39` (`excluded` toEqual `[]`) fails. |
| `apps/ptah-extension-vscode/src/di/expected-absent.ts:33,61,86` | Already edited in the working tree (27c): class and capability are listed. |
| `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:116-127` | Already edited in the working tree (27c): the 10 methods are listed. |
| `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts:31-33` | Already edited in the working tree: `'providerAccounts'` is present. |
| **`libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:37-40`** (`EXPECTED_ABSENT_METHOD_NAMES`) | **Yes, unowned so far**: the 10 `provider:*Account*` names must be added in sorted position (after the `memory:*` group or wherever `provider:` sorts). Otherwise `'excludes exactly the live webview-only surface methods'` (`:92-94`) fails for the CLI. |
| **`libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts:188-194`** | **Yes, unowned so far**: `expect(RPC_METHOD_NAMES).not.toContain(name)` is now false by design. Invert it to `toContain`, or move it to a registry-membership assertion. |
| `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts`, `resolve-handler-plan.spec.ts` | 27c: the partition (`assertManifestInvariants`) should hold with this batch. Add the Electron-true / others-false case. |
| `apps/ptah-electron/src/di/container.smoke.spec.ts:999-1025` (the lane-plan-limits A2 resolve test) | Optional follow-up: a matching "resolves ProviderAccountRpcHandlers and registers the 10 methods" test. No existing assertion breaks. |
| `apps/*/src/di/expected-resolvable.ts` (vscode, electron, cli) | No edit. No new token was added. Including the handler there would be wrong for VS Code and CLI. |
| CLI/TUI host profiles (`libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts`) | No edit. An omitted capability defaults to `false` (`host-profile.ts` `capabilities()` helper). |
| `ALLOWED_METHOD_PREFIXES` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:53`) | No edit. `'provider:'` is already allowed. |
| Host-source registry contract (`/turn\|recap\|ptah-?ui\|change-?set\|host-?source\|turn-?tests\|usage/i`) | No edit. None of the 10 names match. |
| Electron IPC bridge and frontend allowlists | None found. A grep for `provider:getPlanLimits` in `apps/` and `libs/` finds no other enumeration site. |

**Existing specs that mock changed members**: none. `registerSharedRpcHandlers` gained one `registerSingleton`. No spec asserts its registration list: the smoke specs resolve individual classes.

## Stack observed

- tsyringe wiring: `register-shared-rpc-handlers.ts` and `register-rpc-surface.ts:118-190`, which resolve `entry.handler` from the container.
- Capability-gated manifest with `assertManifestInvariants`: `manifest.ts:529-582`.
- Compile-enforced registry map: `rpc.types.ts` `Record<RpcMethodName, true>`.

## Verification

- `ptah_get_diagnostics` on the 6 changed files: **unavailable** on three attempts ("TypeScript check still running after 45s"). Nothing was checked.
- I ran no nx, jest, tsc or lint, as the batch rules required.
- Orchestrator commands, one at a time:
  - `npx nx typecheck shared --parallel=1`
  - `npx nx typecheck rpc-handlers --parallel=1`
  - `npx nx run-many -t test -p shared rpc-handlers cli-engine ptah-electron ptah-extension-vscode --parallel=1`, after 27c lands and the two unowned spec edits above are made.

## Plan deviations

The batch asked to register the class "like `LanePlanLimitsRpcHandlers`", but `LanePlanLimitsRpcHandlers` is not registered in `register-shared-rpc-handlers.ts` at all; it relies on auto-resolution. I added an explicit singleton because the handler is stateful (Decision 2). The manifest gating is the same as lane plan limits.

## Out-of-scope observations

- Two required spec edits fall outside both the 27b and 27c lists: `cli-engine/src/lib/rpc/rpc-surface.spec.ts:37` and `shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts:193`.
- Optional cleanup: export `ProviderAccountRpcHandlers` from `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, then switch the direct-file imports in `manifest.ts`, `register-shared-rpc-handlers.ts` and `src/index.ts` to the folder barrel.
