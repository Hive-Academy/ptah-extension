# B3 round 2 fix report

## Superseded workspace switch

`electron-layout.service.ts:486,603-613,895-897,992`: a shared supersession
path cancels a queued user switch, invalidates its response, clears its pending
flag, and releases its origin. Backend sync also marks workspace resolution
pending until the sync completes. Removal and cached-folder fallback call the
same path. The existing user-switch `finally` continues to clear pending on
normal success or failure.

`onboarding-workspace.store.ts:63-75`: picker completion now waits for the
selected workspace to become ready or for the active path to change, with a
35-second bound. Its existing `finally` resets `switching` on either outcome.

Specs: `electron-layout.service.spec.ts:2454,2492` cover in-flight sync and
fallback supersession, including a late user response;
`onboarding-workspace.store.spec.ts:71` covers a superseded picker wait and
the reset of `switching`.

## RPC mode validation

`workspace-rpc.handlers.ts:212-214`: reject any picker mode except absent,
`open`, or `create` with an error result before invoking the dialog.
`workspace-rpc.handlers.spec.ts:209` verifies rejection and no dialog call.

## Verification

Command: `npm run verify -- -t test,typecheck -p @ptah-extension/core,@ptah-extension/onboarding,@ptah-extension/rpc-handlers`

Exact result line: `NX   6 tasks: 6 succeeded` (exit code 0).

Command: `npm run verify -- -t test,typecheck -p @ptah-extension/core,@ptah-extension/onboarding,@ptah-extension/rpc-handlers -- --output-style=static`

Exact header: `NX   Running targets test, typecheck for 3 projects:`

Exact result line: `NX   Successfully ran targets test, typecheck for 3 projects`

The static rerun read all six task outputs from cache. Test totals:
core 51 suites / 1,629 tests passed; onboarding 47 suites / 516 tests
passed; RPC handlers 198 suites / 5,310 tests passed (3 skipped).
`git diff --check` passed for the six changed source and spec files.

## Not done

No work outside the requested scope. Ptah diagnostics timed out, so the
scoped Nx typechecks provided the compiler result. No visual review was
needed for these state and RPC changes. Native skill invocation was
unavailable; I read the local Angular and backend skill instructions directly.
No external reviewer was run, as instructed.
