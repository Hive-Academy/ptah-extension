# Batch 7 implementation report

Implemented lazy registry/action DI, public exports, and container-owned action disposal. The ownership blocker and concurrent-writer integration are resolved. Runtime verification and the combined P1-A review remain outstanding; task state was not changed.

## Files changed

- `libs/backend/auth-providers/src/lib/di/register.ts`: lazy store/facade/command registration and one singleton actions class registration with cached token alias. Removed the redundant AccountProcessSpawner class, registration and imports. ClaudeAccountCommand receives the existing SDK process spawner directly.
- `libs/backend/auth-providers/src/lib/di/register.spec.ts`: phased startup, safe busy refusal, package export checks, singleton identity/disposal checks, and injected-process container-disposal coverage for proved and unproved close.
- `libs/backend/auth-providers/src/index.ts`: inherited explicit facade and type-only port exports; unchanged in this integration pass.
- `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts`: admission facade remains fail-closed. Named routes are validated but return release-held; release/retain reject unknown reservations with conflict. No shipped path manufactures a certified route. Unchanged in this integration pass.
- `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`: one idempotent asynchronous dispose implementation, constructor injection, abort of all active status/login/logout controllers and cancellation rechecks, bounded completion wait, and typed unavailable-storage guards on every action surface. Retained unchanged in this integration pass.
- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`: metadata, lease, release-boundary and injected-process disposal regressions. ClaudeAccountCommand import is present; grouped imports before the fake process class.
- This report. No task states, host guard files or out-of-scope sources were edited. No git commands were run.

## Registered tokens and lifetimes

- SDK_PROVIDER_ACCOUNT_ADMISSION: cached alias to singleton ProviderAccountService, tracked by tsyringe for disposal.
- SDK_PROVIDER_ACCOUNT_ACTIONS: cached alias to singleton ProviderAccountActionsService, tracked by tsyringe for disposal.
- ProviderAccountStore: singleton class registration, with no constructor database read.
- ClaudeAccountCommand: cached factory resolving SDK_CLI_DETECTOR and SDK_PROCESS_SPAWNER. The command retains its existing bounded observation/termination implementation; the actions service owns the abort controllers and waits for command completion.
- Registration performs no persistence resolution or database reads. Dependencies resolve after host registration phases. There is no additional process-owner wrapper or duplicate actions registration.

## Exported symbols

New runtime export: ProviderAccountService. New type-only exports: ProviderAccountAdmissionPort and ProviderAccountActionPort from the tokens package. Store implementation/rows, actions implementation, command/certification helpers and secrets remain private. No agent-sdk source was edited and no concrete auth-providers dependency was added there.

## Acceptance coverage

Tests are authored, not executed, as instructed.

1. Lazy startup: `registers without persistence and resolves account singletons after phased startup without reading the DB`. Checks no eager DB access, class/token identity, and exactly one container disposal call for both disposable services.
2. Safe busy refusal: `returns typed busy refusals through every account port surface with an injected busy database`. Fixed safe results contain no private database error text.
3. Executable surfaces: preceding port test; `executes the metadata facade surfaces against an injected isolated connection`; existing Batch 6 injected-process action tests. Live admission intentionally returns release-held; unknown release/retain requests return conflict.
4. Disposal and uncertain reservations:
   - `container disposal stops account actions with proved close=%s and preserves unproved reservations`, parameterized for false/true. Real registration graph with isolated SQLite and an injected process; killProcessTree is mocked. Container disposal aborts login, waits for bounded completion, releases only with proved close, retains pending/exclusive operations otherwise, removes listeners/timers, and rejects all four action surfaces afterward.
   - `disposal awaits bounded %s process termination, retains an unproved lease and refuses every new action`, parameterized for status/login/logout. Verifies idempotence, the existing 2-second grace, durable exclusivity, guards, and listener/timer cleanup using injected processes without a real PID.
   - `disposal aborts a cancellation status recheck and retains its unproved operation`. Covers an independently signalled recheck already running when shutdown starts.
   - `disposal retains an uncertain lease and refuses caller-driven release of a prior host reservation`.
5. Public API: `exports the metadata facade and keeps account store and certification internals private`; inherited dependency-direction inspection found no concrete auth-providers import added to agent-sdk.

Release boundary: `keeps live admission release-held without discovering or spawning a provider command`.

## Required guard updates

none identified by the previous lane's source inspection. Existing guard lists enumerate handler classes rather than all auth token symbols. No host suites were run; CI must confirm.

## Decisions

1. **Authorized ownership extension.** The orchestrator authorized provider-account-actions.service.ts changes for disposal/guards. Chosen over indirect access to private controllers or duplicate action logic. Existing bounded command outcomes determine whether termination is proved; shutdown never independently releases an uncertain reservation. Reversible source change; no migration.
2. **One lifecycle owner.** The orchestrator stopped the previous writer and explicitly authorized integration/removal of redundant ownership. Removed AccountProcessSpawner because actions disposal does not depend on it. Kept one actions singleton class registration and cached token alias, following the disposable facade pattern. This avoids duplicate kill/listener/timeout paths. Reversible registration change.
3. **Preserve D7.** Production admission remains release-held, including named routes. No certified route is constructed from persisted metadata. Successful injected certification is permitted by the task but not implemented by the current facade; removed success-path specs are not claimed as coverage. Live certification/release remains Batches 8/17 work.
4. **Abort cancellation rechecks on disposal.** Rechecks normally survive cancellation so they can observe final state. They use the disposal signal and no new recheck starts during shutdown. This preserves normal behavior while bounding shutdown. Unproved recheck close retains the operation. Reversible lifecycle change.
5. **Verification scope.** ptah_code_search_symbols returned zero hits for completeAuth; one targeted native search confirmed that proved completion deletes the operation, supporting the DI spec expectation. No test/build execution was authorized.

## Verification

Final scoped ptah_get_diagnostics covered all six owned TypeScript files: **0 errors, 0 warnings; clean coverage; TypeScript compiler source**. Store-spec imports compile. Diagnostics caught a stale wrapper registration during removal; it was removed before the final clean check.

No nx, Jest, tsc, lint, build, real CLI binary, sign-in/out, network or paid call was run. No runtime pass is claimed.

## Not done / handoff

- CI must execute the specs and host guard suites; combined code-logic/public-API review of Batches 1-7 remains required.
- Live admission/source certification and release authorization remain held for Batches 8/17 under D7.
- No ownership or concurrent-writer blocker remains.
