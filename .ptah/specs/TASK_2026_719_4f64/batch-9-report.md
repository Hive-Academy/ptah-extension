# Backend implementation — `TASK_2026_719_4f64`, batch 9

**Status**: COMPLETE. Task 9.1 is done. Typecheck (lib and spec), ESLint and the two specs pass.

**Tasks completed**: Task 9.1, `ClaudeNamedAccountPersistence` with `checkLaunchBoundary`.

## Files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-named-account-persistence.ts`: the host adapter.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-named-account-persistence.spec.ts`: 22 cases.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/index.ts`: adds the public export `ClaudeNamedAccountPersistence`.

## What was built

`@injectable() class ClaudeNamedAccountPersistence`. Every constructor parameter has an explicit `@inject`, and each is typed as a `Pick<>` of its dependency:

1. `ProviderAccountService`
2. `ProviderAccountStore`
3. `SDK_TOKENS.SDK_SESSION_METADATA_STORE`
4. `ProviderAccountActionsService`
5. `ClaudeRouteCertifier` (new in rev4)

It is not registered in DI; B17 binds it. The adapter has no per-run fields. Its only field is `available = true`.

### `NamedAccountPersistencePort` members

- **`resolveAccountBinding(sdkSessionId)`** calls `metadata.resolveAccountBinding`. The callback is `lookupBySdkSession({ provider: 'claude', ... })`, which is the authoritative registry lookup.
- **`commitRunBinding(route, reservation, identity)`**:
  - If the reservation's `runId`, fingerprint, revision or epoch differs from the route, it throws `conflict` and the service is never called.
  - Otherwise it calls `service.commitRunBinding({ reservationId, operationId, authEpoch, runId, identity })`.
- **`attachSdkSession`** and **`saveAccountBound`** pass straight through to the service and the metadata store.
- **`assertRouteCurrent(route)`**:
  - `store.get(profileId)`. A missing profile becomes `route-changed`. Any other store refusal keeps its code (for example `busy`).
  - Then the stored `route_fingerprint`, `route_revision` and `auth_epoch` must equal the route's values, otherwise `route-changed`.
  - Then `resolveProviderAccountRoute(canonicalConfigDir)` must give the same fingerprint and canonical path, otherwise `route-changed`.
- **`onAuthEpochChanged(listener)`** subscribes to `actions.onStateChanged` and returns its unsubscribe. On each change it reads the profile and calls the listener with a frozen route built from the stored fingerprint, revision and epoch. `runId` is `''` because this is a profile-level notice; listeners read only provider, fingerprint and epoch. If the profile was removed or cannot be read, nothing is announced.
- **`checkLaunchBoundary(route, launch, _boundary, signal)`**:
  - It runs the `assertRouteCurrent` checks first. If they fail, it returns `{ ok:false, code:'route-changed', terminated:true }` and never calls the certifier. `terminated` is true because revalidation starts no child.
  - Otherwise it returns `await certifier.checkLaunch(launch, signal)` unchanged.
  - If the certifier throws instead of returning, the result is `identity-unproved` with `terminated:false`, so the lease is retained. This matches how `ProviderAccountService.admitClaudeRoute` handles a thrown `certify`.

### Structural `ClaudeLaneAccountPersistence` members

The file has no cli-agent-runtime import.

- **`available`** is `true`.
- **`lookupBySdkSession`** is the registry lookup. A bound record whose provider is not `claude` becomes `invalid-bound`. A thrown error becomes `unavailable-storage`.
- **`validateResume(reference)`**:
  - The reference id must equal the binding's run id, the provider must be `claude`, and the identity must be `known`.
  - `lookupRunBinding` must return the same binding.
  - The profile's fingerprint and revision must be unchanged, and its epoch must be at least the binding's. A newer epoch is allowed because the runner and admission prove the identity again.
  - The directory must still have the same physical fingerprint.
  - It returns `{ code }` and never forwards a dependency message.
- **`persistReference(reference, sdkSessionId)`** checks two things and writes nothing: the registry SDK link holds this exact binding, and `metadata.resolveAccountBinding` returns the same binding. On failure it throws `ProviderAccountStoreError` with `invalid-bound` or `unavailable-storage`.

## Acceptance evidence (`claude-named-account-persistence.spec.ts`)

- **ok path**: the result is `{ ok:true }`, and `checkLaunch` is called exactly once with `(launch, signal)`.
- **Certifier refusals pass through.** Three cases were run: `unsupported-source` with `terminated:true`, `unsupported-source` with `terminated:false`, and `identity-unproved` with `terminated:false`. Each outcome is `toBe` the certifier's own object.
- **Revalidation failures give `route-changed` with `terminated:true` and the certifier mock is never called** (`not.toHaveBeenCalled()`). Five cases: the epoch advanced, the route revision changed, the directory has a different physical fingerprint, the directory is gone, and the profile was removed.
- **No shared state between runs.** Two runs were checked concurrently, each with its own launch, and each got its own outcome.
- **Other members**:
  - `assertRouteCurrent`: ok, an epoch change, and keeping a `busy` refusal.
  - `commitRunBinding`: correct lease keys; a mismatched reservation gives `conflict` with no service call.
  - `resolveAccountBinding` uses the registry callback.
  - A failing lookup gives `unavailable-storage`.
  - Attach and save are delegated.
  - The `onAuthEpochChanged` route is mapped correctly and the unsubscribe is returned.
  - `validateResume`: ok, a newer epoch, a changed route, an absent binding and a mismatched binding.
  - `persistReference`: ok, no link, and a metadata failure.
- **Fakes**: plain `jest.fn` objects plus one real temp directory from `os.tmpdir()`, removed in `afterAll`. No `process.cwd()`, no `jest.spyOn` on module namespaces, and no real `claude` or `reg.exe`. The spec starts with `import 'reflect-metadata';`.

## Stack observed

- **Wiring**: tsyringe `@injectable` with `@inject(ClassToken)`, the same as `provider-account.service.ts:57-66`.
- **Tokens**: `SDK_TOKENS` comes from `@ptah-extension/agent-sdk`, which auth-providers already imports (`provider-owner.resolver.ts:33`).
- **Errors**: `ProviderAccountStoreError` (`provider-account-route.ts:16`). Swallowing catches carry `degradation-audit:` comments, the same as `provider-account.service.ts:134`.

## Verification (run from the worktree)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json` | exit 0 |
| `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.spec.json` | exit 0 |
| `npx eslint <3 files>` | exit 0; no output, so 0 errors and 0 warnings |
| `npx jest -c libs/backend/auth-providers/jest.config.ts <new spec> libs/backend/auth-providers/src/lib/di/register.spec.ts --maxWorkers=2` | 2 suites passed, 29/29 tests (22 new, 7 register) |

- `register.spec.ts` is unchanged and passes. Its private-export list (`:144-146`) includes `resolveProviderAccountRoute` and `claudeAccountRouteCertification`, and neither is exported.
- `ptah_get_diagnostics` was not used because it timed out in an earlier batch; the scoped `tsc` runs above replace it.
- `npm run verify` was not run. The team-leader owns that check (rule 12).

## Specs that mock or pin changed members (rule 5)

- This batch changes no existing member; both source files are new.
- `register.spec.ts:144-146` (private-export list) is unchanged and passes.
- The only fake of `NamedAccountPersistencePort` is in `session-query-executor.accounts.spec.ts:72`. B13 changes that port, not this batch.
- The fakes of `ClaudeLaneAccountPersistence` are in `claude-sdk-lane-runner.spec.ts:512` and `claude-cli.adapter.spec.ts:486-493`, and B12 owns them.
- No ambient-path pin was touched.

## Risks

| Risk | How it was handled |
| --- | --- |
| A cli-agent-runtime import would create a cycle | None is imported. The lane reference shape is declared locally, and the class fits structurally. |
| The certifier could run on a stale route | Revalidation runs first. On failure the certifier is never called, which the spec checks. |
| State shared between concurrent runs | The adapter has no per-run fields, which the spec checks with a concurrent case. |
| A path or secret could leak | Errors carry only result codes. Nothing is logged. Dependency messages are never forwarded. |
| Registered too early | It is not registered; B17 binds it. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| A thrown `checkLaunch` gives `identity-unproved` with `terminated:false` | Let the error reach the executor, or map it | Matches the service's thrown-`certify` handling (`provider-account.service.ts:133-136`). A real outcome is still returned unchanged. | yes |
| `validateResume` allows a profile epoch newer than the binding's | Require an equal epoch, or allow a newer one | The store's resume admission allows `binding epoch <= profile epoch` (batch-8a report). The runner proves the identity again before it calls this (`claude-sdk-lane-runner.ts:584-593`). | yes |
| `persistReference` only checks the two checkpoints and writes nothing | Write again, or verify | The runner already calls `attachSdkSession` and `saveAccountBound` before it (`claude-sdk-lane-runner.ts:549-566`). The interface asks it to await both checkpoints. | yes |
| The `onAuthEpochChanged` notice uses `runId: ''` | Invent a run id, or leave it empty | The listeners (`session-query-executor.service.ts:687-692`, `session-registry.service.ts:456`) read only provider, fingerprint and epoch. | yes |

## Plan deviations

None. The plan's `assertRouteCurrent` is "revalidation plus the epoch". The implementation also compares the stored fingerprint and route revision, which are stricter checks of the same kind.

## Out-of-scope observations

`jest.config.ts` prints a Node "Failed to load the ES module" warning, which is harmless. It comes from config the main branch already has.
