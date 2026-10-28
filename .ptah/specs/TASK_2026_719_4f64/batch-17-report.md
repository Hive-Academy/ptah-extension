# Backend implementation — `TASK_2026_719_4f64`, batch 17

**Verdict**: PARTIAL. The handler half is done and verified. The Electron persistence binding is
BLOCKED: the symbols it needs are not exported from their lib barrels, and the barrels are outside
this batch's four files.

**Tasks completed**: Task 17.1, handler half (acceptance items 1-7) plus the smoke assertion that
the handler resolves with the actions token. Not done: the Electron `ClaudeNamedAccountPersistence`
bindings and their smoke assertions (see Blocker).

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`: injects the actions port and routes sign-in, cancel, sign-out and status through it.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts`: adds a `FakeActions` port in `setup()`. The "release hold (D7)" block is replaced by 12 "account actions (Batch 17)" tests.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/apps/ptah-electron/src/di/container.smoke.spec.ts`: the provider-accounts smoke test registers a fake under `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS` and asserts that `register()` subscribes once to `onStateChanged`.
- NOT MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/apps/ptah-electron/src/di/phase-2-libraries.ts`: blocked (see Blocker).

## Acceptance evidence (handler)

| Criterion | Evidence |
| --- | --- |
| Injects `SDK_PROVIDER_ACCOUNT_ACTIONS` | The constructor has a new last parameter, `@inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS) actions: ProviderAccountRpcActions`. `ProviderAccountRpcActions` extends the port `ProviderAccountActionPort` from `@ptah-extension/auth-providers-tokens` with `fallback?` on `startSignIn` and with `onStateChanged`. `ProviderAccountActionsService` satisfies it structurally. That service is not exported from the auth-providers barrel, so the handler does not import it. |
| Sign-in, cancel and sign-out call the port | `startSignIn` / `cancelSignIn` / `signOut` handler methods; specs "starts a sign-in through the port…", "cancels with the operation id and the current profile revision", "signs out through the port…". `operationId` is server-issued (`randomUUID`). Cancel passes the profile's current revision, which equals the reservation revision the port compares (`provider-account-actions.service.ts:reserve`, `revision: expectedRevision + 1`). A port result of `ok` or `cancelled` counts as a successful cancel. |
| `releaseHeld` deleted | `grep releaseHeld` gives 0 hits in the handler. |
| `getAccountStatus` uses `actions.readStatus` | It is now async. A port refusal maps to its code and the fixed copy. When the result is ok, the summary is read and the live `operation` is added while this handler holds one. Spec: "getAccountStatus refuses with the port code and reads no summary". |
| Subscribes to `onStateChanged` and notifies the snapshot | `register()` subscribes once (`??=`). Each change bumps the revision once and pushes one sanitized snapshot per open workspace folder, with no `requestId`. A terminal state clears the tracked sign-in operation. A failed snapshot read logs `{ code }` only (degradation-audit justified). `dispose()` is the release path. Specs: "a state change pushes one sanitized snapshot per open workspace", "…snapshot read fails logs the code only", "dispose ends the state-change subscription". |
| COPY `release-held` neutral | "Named accounts are not available on this host." Spec: "the release-held copy is neutral". |
| `fallback` never logged | It is returned to the caller only. No log line includes the result object; refusal logs carry `{ code }`. The spec checks that every logger call and every push lacks the script text. |
| Idempotency | The ledger stores an action's promise (`LedgerEntryKind` for `operation` / `cancel`). A concurrent replay returns the first outcome with one port call, and the same `requestId` on a different method gives `conflict`. Spec: "a replayed sign-in returns the first outcome without a second start". |
| RPC method set unchanged | "registers exactly the ten provider account methods" passes, and the Electron smoke still checks the ten-method set. |

## Blocker: Electron persistence bindings (acceptance items 8-10)

`phase-2-libraries.ts` and the matching smoke assertions need these symbols. None is exported from its lib barrel:

- `SDK_NAMED_ACCOUNT_PERSISTENCE`: defined at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:91`. Not in `libs/backend/agent-sdk/src/index.ts`.
- `SDK_SESSION_IMPORT_BINDING_LOOKUP`: defined at `libs/backend/agent-sdk/src/lib/session-importer.service.ts:40`. Not exported.
- `CLAUDE_LANE_ACCOUNT_PERSISTENCE`: defined at `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts:58`, outside `CLI_AGENT_RUNTIME_TOKENS`. Not in `libs/backend/cli-agent-runtime/src/index.ts`, which exports only `CLI_AGENT_RUNTIME_TOKENS` and the type `CliAgentRuntimeDIToken`.
- The type `ClaudeLaneAccountPersistence`: defined at `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:256`. Not exported, so `satisfies ClaudeLaneAccountPersistence` cannot compile from the app.

Options:

1. **(Recommended)** The team-leader adds 4 barrel exports to `libs/backend/agent-sdk/src/index.ts` and `libs/backend/cli-agent-runtime/src/index.ts`: the two SDK tokens, the lane token and `export type { ClaudeLaneAccountPersistence }`. Then a follow-up run edits `phase-2-libraries.ts` and the smoke spec. This keeps the barrel-only import rule.
2. Re-create the keys in the app with `Symbol.for('SdkNamedAccountPersistence')` and the other two keys. It resolves at runtime, but it duplicates token constants, cannot express `satisfies ClaudeLaneAccountPersistence`, and goes against "never inject by a string literal". Not taken.

`ClaudeNamedAccountPersistence` itself is exported (`libs/backend/auth-providers/src/index.ts:4`, B9).

Plan for the follow-up, already checked against the code. `phase-2-libraries.ts` uses `PERSISTENCE_TOKENS` and `SQLITE_CONNECTION` (:74, :372). After the SQLite block, under `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)`:

- `container.registerSingleton(ClaudeNamedAccountPersistence)`;
- bind the 3 tokens with `useFactory: instanceCachingFactory(c => c.resolve(ClaudeNamedAccountPersistence))`;
- type the lane factory result with `satisfies ClaudeLaneAccountPersistence`.

These registrations override the null `useFactory` that `libs/backend/agent-sdk/src/lib/di/register.ts:220-221` registers.

Main-chat persistence is therefore still inactive in Electron after this batch. The Accounts sign-in path is live through the handler.

## VS Code handler resolution finding

`ProviderAccountRpcHandlers` is listed in `apps/ptah-extension-vscode/src/di/expected-absent.ts:33,61`, so VS Code never registers or resolves it. The actions token is registered on every host anyway: `registerAuthProvidersServices` (`libs/backend/auth-providers/src/lib/di/register.ts:220-224`) is called by VS Code at `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:188`. A resolution there would succeed. No VS Code file was edited.

## Specs that mock or pin the changed members (rule 5)

- `provider-account-rpc.handlers.spec.ts`: the old release-hold block (`:688-720`) is replaced. The `setup()` DI scope gains the actions token.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:307-334`: edited as above.
- `register-shared-rpc-handlers.activation.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`, `rpc-allowlist.spec.ts`: not edited.

## Stack observed

- tsyringe with `@inject` tokens: `AUTH_PROVIDERS_TOKENS` (`libs/backend/auth-providers-tokens/src/lib/tokens.ts:72`).
- Param validation is the existing zod schemas via `PROVIDER_ACCOUNT_RPC_SCHEMAS`, unchanged.
- Logging goes through the injected `Logger`.

## Verification

All commands ran from the worktree.

- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.lib.json`: 0 errors.
- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.spec.json`: 0 errors.
- `npx tsc --noEmit -p apps/ptah-electron/tsconfig.app.json`: 0 errors.
- `npx tsc --noEmit -p apps/ptah-electron/tsconfig.spec.json`: 0 errors.
- `npx eslint` on the 3 changed files: 0 errors and 1 warning. The warning is `container.smoke.spec.ts:82` `'SetupRpcHandlers' is defined but never used`, on a line this batch did not change.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts …/provider-account-rpc.handlers.spec.ts --maxWorkers=2`: 59 passed out of 59.
- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di --maxWorkers=2`: 7 suites, 69 tests, all passed.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts surface-composition rpc-allowlist --maxWorkers=2`: 1 suite, 14 tests, passed. Only one of the two patterns matched a suite in rpc-handlers. `rpc-surface.spec.ts` lives in the VS Code app and was not run; the team-leader's `-p …,ptah-extension-vscode` verify covers it.
- `ptah_get_diagnostics`: not used. The tsc runs above cover the same files.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| A local `ProviderAccountRpcActions` interface extends the port with `fallback?` and `onStateChanged` | import `ProviderAccountActionsService` (not exported) vs. edit the port (not a B17 file) | batch-8b-report Decisions row 3; `auth-providers/src/index.ts` | yes |
| State-change pushes go to every open workspace folder | track the starting request's root vs. push per open folder | `getAccountStatus` and state changes carry no root; selections are per root | yes |
| Cancel's `expectedRevision` is the current listed profile revision | add a param (contract change) vs. read the revision | the port compares `active.revision === profile.revision` | yes |
| A port refusal uses this layer's fixed `REFUSAL_COPY`, not the port's summary | pass the summary through vs. fixed copy | the existing redaction rule in the handler header | yes |

## Plan deviations

- The Electron half is not implemented (Blocker).
- The handler gains a `dispose()` method that no caller uses yet. It is the release path for the subscription.

## Out-of-scope observations

- The barrel exports are missing (Blocker).
- The unused-import warning at `container.smoke.spec.ts:82` predates this batch.
