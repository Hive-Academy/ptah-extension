# Backend implementation — `TASK_2026_712_5d7c`, batch 27a

**Tasks completed**: Batch 27a (D29): an account RPC endpoint that exists but is not registered yet. It adds zod schemas, the handler class, a handler spec and the push message type. No method can be called until Batch 27b lands.

## Files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`. It holds strict zod schemas for the 10 `provider:*Account*` methods. `PROVIDER_ACCOUNT_RPC_SCHEMAS` is typed as `{ [K in ProviderAccountRpcMethodName]: z.ZodType<ProviderAccountRpcMethodRegistry[K]['params']> }`, so a schema cannot drift from the shared contract without a compile error. The schemas accept only provider, workspaceRoot, requestId, profileId, operationId, label, scope, selection and revisions. Any extra field fails the parse, including path, env, token and owner fields.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`. This is `ProviderAccountRpcHandlers`, with `METHODS = PROVIDER_ACCOUNT_RPC_METHOD_NAMES` and `register()`.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts`. It uses an in-memory fake service with the store's compare-and-set rules. The handler is resolved through a tsyringe child container, so every `@inject` token is exercised. The spec covers:
  - all 10 methods are registered
  - 17 invalid-param cases, each with zero side effects
  - closed and relative workspace roots are denied
  - a non-Claude provider gets `wrong-provider`
  - list, status and field stripping
  - add, rename, remove, selection (named and ambient) and default
  - a duplicate request returns the first outcome
  - a reused request ID with different params is refused
  - stale revisions are refused
  - selections are keyed by the registered root
  - one notification per committed revision, in order
  - a failed broadcast does not fail the write
  - redaction: coded, uncoded and safe store sentences
  - release hold for sign-in, cancel and sign-out, including a closed workspace
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/shared/src/lib/types/messages/message-constants.ts`. Adds `PROVIDER_ACCOUNTS_CHANGED: 'provider:accountsChanged'`, which carries `ProviderAccountsChangedNotification`. The name does not match the host-source pattern in `host-source-registry.contract.spec.ts:17-18`, so that baseline spec is not affected.

## Behaviour

- **Order of checks**: zod parse (failure throws `RpcUserError` `INVALID_PARAMS`), then workspace authority (failure throws `RpcUserError` `UNAUTHORIZED_WORKSPACE`), then provider (only `claude`; anything else returns refusal `wrong-provider`), then the request ledger, then the service call. Nothing runs before every check has passed.
- **Workspace authority**: the root must be absolute and must match an `IWorkspaceProvider.getWorkspaceFolders()` entry after `path.resolve`; on win32 the match is case-insensitive. The service is called with the registered folder string, never the caller's spelling.
- **Writes**: rename and remove pass `expectedRevision`. `setAccountSelection` passes `expectedSelectionRevision` plus `expectedProfileRevision` for a named choice, and `setAccountDefault` passes both scope revisions. A stale revision makes the service throw `conflict`, which becomes a typed refusal.
- **Idempotency**: an in-memory ledger maps requestId to (method + params fingerprint, outcome). It is bounded at 256 entries, evicts the oldest first and uses no timers.
  - The same request returns the identical outcome without calling the service again.
  - The same ID with different params returns `conflict`.
  - Refusals are remembered too, so a duplicate gets the same outcome.
  - The service is synchronous and nothing in the write path awaits, so writes cannot interleave.
- **Revision and notification**: `revision` is seeded from `Date.now()` so it stays monotonic across host restarts, and it is bumped once per committed write. The snapshot is then built field by field and exactly one `provider:accountsChanged` push is sent through `TOKENS.WEBVIEW_MANAGER.broadcastMessage`. The push is deferred to a microtask; a delivery failure is logged by error name with a `degradation-audit: reported` justification and does not fail the committed write. Refusals push nothing.
- **Snapshot read after commit fails**: the result is the refusal `unavailable-storage` with "The change may have been saved, but account storage could not be read. Refresh to check." The write is never reported as rolled back.
- **Redaction**:
  - A refusal code comes from `error.code` when it is in `PROVIDER_ACCOUNT_RESULT_CODES`; otherwise it is `unavailable-storage`.
  - The summary is fixed copy per code. The only exception is a `ProviderAccountStoreError` whose message passes `isSafeProviderAccountSummary`, such as the duplicate-route sentence.
  - Logs carry the method and the code only.
- **Release hold (D7)**: sign-in, cancel and sign-out are validated and authorized, then return `release-held`. They never call the service or the actions service, and they never broadcast.

## Decisions

1. **Host capability is enforced by the manifest, not inside the handler.** Options were (a) the existing manifest `requires` gating, or (b) a runtime capability check inside the handler. Evidence: no handler reads capabilities at runtime; `HostCapabilities` only feeds the manifest and `registerRpcSurface` (`host-profile/host-profile.ts:89-97`). The Electron-only siblings `lane-plan-limits-rpc.handlers.ts:22-23` and `diagnostics-consent-rpc.handlers.ts:26-29` document "Host gating is data". On a non-Electron host the methods are therefore not registered, so a call never reaches this handler. Reversible.
2. **Inject the service by its class token** (`@inject(ProviderAccountService)`). Options were (a) the class token, or (b) `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION`, which is typed as the admission port and has no metadata operations. Evidence: `ProviderAccountService` is registered as a class singleton (`auth-providers/src/lib/di/register.ts:158-160`) and already resolved by class in `cli-agent-runtime/src/lib/di/register.ts:165-166`. The constructor parameter is typed as the narrow `ProviderAccountRpcService` Pick. Reversible: switch to a Symbol token if one is added later.
3. **A workspace that is not open is an `RpcUserError` `UNAUTHORIZED_WORKSPACE`, not a domain refusal.** No `ProviderAccountResultCode` means "not your workspace", and the code already exists in `shared/src/lib/types/rpc/rpc-error-codes.types.ts:9`. Reversible.
4. **`METHODS` uses `PROVIDER_ACCOUNT_RPC_METHOD_NAMES`** rather than `satisfies readonly RpcMethodName[]`. The names are not in `RpcMethodName` until Batch 27b. `registerMethod` takes `name: string` (`vscode-core/src/messaging/rpc-handler.ts:160`), and `provider:` is an allowed prefix (`:53`).
5. **Only `claude` is served.** The service is Claude-only: its store and SQL hardcode `provider = 'claude'`, and `summary()` sets `provider: 'claude'`.
6. **The refusal copy is a local table in the handler**, identical to `COPY` in `auth-providers/src/lib/accounts/claude-account-command.ts:6-22`. That table is not exported and I was not allowed to edit auth-providers. Reversible: export `accountActionResult` later and remove the duplicate.

## Gaps in the service (auth-providers not edited)

- **No sign-in, cancel or sign-out on `ProviderAccountService`** (`provider-account.service.ts:91-126` has add/list/rename/remove/selection/select/setDefault only). `ProviderAccountActionsService` (`AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS`) exists but is release-held (D7), so the handler returns `release-held`. `getAccountStatus` never returns `operation`.
- **No persisted aggregate snapshot revision.** The handler keeps its own revision, seeded from the clock. Changes made outside this handler (for example a future sign-in state change in the actions service) do not bump it or broadcast. The certification batch should add a store revision or a change event.
- **No workspace authority in the service**, so the handler enforces it. Profiles are global and only selections are per workspace.
- **`ProviderAccountStoreError` is not exported from the barrel** (`auth-providers/src/index.ts:3-4`). The handler recognizes it structurally (by `name` and `code`), the same way `chat-slash-command-router.service.ts:62-72` does.

## DI tokens used and where each is registered

| Token | Registered by |
| --- | --- |
| `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER` | every host root (used by all handlers) |
| `ProviderAccountService` (class token) | `libs/backend/auth-providers/src/lib/di/register.ts:158` (`registerProviderAccountServices`, called at `:134` from the shared auth registration) |
| `PLATFORM_TOKENS.WORKSPACE_PROVIDER` | platform registrations on all hosts |
| `TOKENS.WEBVIEW_MANAGER` | Electron (already injected without `isOptional` by `gateway-rpc.handlers.ts:104`, which is Electron-gated; the Electron smoke spec registers it at `container.smoke.spec.ts:637`) |

No new token was created.

## Exact edits Batch 27b needs

1. `libs/shared/src/lib/types/rpc.types.ts`: make `RpcMethodRegistry` extend or merge `ProviderAccountRpcMethodRegistry`, and add the 10 names to `RPC_METHOD_ENTRIES` / `RPC_METHOD_NAMES`, all in the same commit as step 3 (D27).
2. `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts`: add a capability to `RPC_CAPABILITIES`, for example `'providerAccounts'`. This is a fifth file beyond the five D29 lists for 27b; flag it to the orchestrator. Also add `providerAccounts: false` to `ALL_DISABLED` in `host-profile/host-profile.ts:66-86`.
3. `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`: add an entry next to `lanePlanLimits` (`:503-510`): `{ key: 'providerAccounts', methods: ProviderAccountRpcHandlers.METHODS, requires: ['providerAccounts'], handler: ProviderAccountRpcHandlers }`. Once the names are in `RpcMethodName`, optionally change `METHODS` to `... as const satisfies readonly RpcMethodName[]`.
4. `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`: register the class wherever the manifest-driven handlers are wired (follow `LanePlanLimitsRpcHandlers`). Also export the class from `libs/backend/rpc-handlers/src/index.ts` (next to `LanePlanLimitsRpcHandlers` at `:60`), which is another file outside the D29 list.
5. `apps/ptah-electron/src/rpc-host-profile.ts`: set `providerAccounts: true` next to `lanePlanLimits: true` (`:48`). VS Code, CLI and TUI need no edit, because a missing capability defaults to `false`.

## Guard specs likely to need updates (27c if over the cap)

- `apps/ptah-extension-vscode/src/di/expected-absent.ts` (class at `:32`/`:58`, capability key at `:80`, the `lanePlanLimits` pattern) and `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` (`:35` area): VS Code must list the new handler, capability and methods as absent.
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts` and `resolve-handler-plan.spec.ts`: the partition, plus the Electron true / others false capability.
- `apps/ptah-electron/src/di/container.smoke.spec.ts` and any surface-composition or allowlist spec for the Electron surface.
- The CLI/TUI expected-absent lists, if they enumerate capabilities.
- `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`: no change needed, because no new service token was added (handler classes are covered by the surface specs).
- `libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts` may pin "names not yet in the registry". Re-check it once step 1 lands.

**Existing specs that mock changed members**: none. Only `MESSAGE_TYPES` gained a key. `host-source-registry.contract.spec.ts` does not match `provider:accountsChanged` (pattern `turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage`).

## Verification

- `ptah_get_diagnostics` on the 4 changed files: 0 errors, 0 warnings. The tool reported `analyzed: null`, so this is weak evidence; the orchestrator should typecheck.
- I did not run nx, jest, tsc or lint, as the batch rules required. Suggested command:
  `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts --coverage=false --maxWorkers=2`
  Then `npx nx typecheck rpc-handlers --parallel=1` and `npx nx typecheck shared --parallel=1`.
- The spec mocks `@ptah-extension/auth-providers` with `jest.mock` (a module mock, not `jest.spyOn`). It uses no `process.cwd()`, no `any` and no `as unknown as`. The fake service is registered under an `InjectionToken<ProviderAccountRpcService>` typed alias of the class token.

## Plan deviations

None in scope. Host capability refusal is enforced by manifest registration, not by an in-handler check (Decision 1).

## Out-of-scope observations

- Batch 27b's file list (D29) is missing `host-profile/capabilities.ts` and `rpc-handlers/src/index.ts`.
- The renderer side needs a frontend subscriber for `provider:accountsChanged` that ignores snapshots that are not newer and re-reads on reconnect. That belongs to a later UI batch.
