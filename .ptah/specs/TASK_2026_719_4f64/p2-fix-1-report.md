# P2 fix 1 report: the reserved route identity is enforced again for auth children

Finding: code-logic-review-p2.md finding 1 (Serious). The B8b deviation is reverted in substance. Each auth child (status, logout, login console) again revalidates the reserved `CanonicalProviderAccountRoute` before spawn, and its creation is guarded by the route's file identity, which the spawner also checks on the off-thread worker. The status and logout children are revalidated again after close, before any result can be recorded.

Verdict: fixed. The changed and adjacent suites pass (119/119).

## Changes (all under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/`)

- MODIFIED `claude-route-certifier.ts`
  - :36-41 — `ClaudeAuthContext.route?: CanonicalProviderAccountRoute` (the route the store reserved).
  - :56-57 and :63-64 — `routeChanged?: true` on `ClaudeStatusProbeResult` and `ClaudeLogoutProbeResult`.
  - :150 and :165 — `authContext` and `certify` pass the request's route into `prepare`.
  - :243-244 and :276 — `prepare` takes the route and freezes it into the context.
  - :174 — run certification step 6 refuses `route-changed` when the status child reports `routeChanged`.
- MODIFIED `claude-account-command.ts`
  - :90 — new `claudeAccountRouteHolds(route)`. It calls `revalidateProviderAccountRoute`, which compares the canonical path, volume/file id and fingerprint, never a directory string. A missing route never holds.
  - :105 — new `claudeAccountRouteGuard(route)`. It returns `{ fileIdentities: [{ path: requestedPath, realpath: canonicalPath, devIno }] }`, the same shape the removed implementation used.
  - :124 — `ChildRequest.launchGuard`.
  - `run()` (:336) forwards the guard to `spawnProcess`. The spawner checks it at creation, on the worker thread too (`off-thread-process-spawner-source.ts`, `launchGuardRefusal`).
  - `status` (:249-262) and `logout` (:266-276):
    - Before spawn they revalidate. A changed route returns `routeChanged: true` with `terminated: true` and spawns nothing.
    - They spawn with the guard.
    - After the child closes, or after the kill grace, they revalidate again. A changed route returns `routeChanged: true`, no status or exit code, and the real `run.terminated` value.
- MODIFIED `claude-login-console.ts`
  - :16-18 — new start kind `'route-changed'`.
  - :98-100 — `launch` revalidates the route on every platform before the platform check, so no fallback script is offered for a replaced directory.
  - :116 — the `conhost.exe` spawn passes the guard.
  - :107 — when no child started (the guard refused, a spawn error, or `whenSpawned` is null), `launch` revalidates once more. It reports `route-changed` instead of `unavailable` when the route no longer holds.
- MODIFIED `provider-account-actions.service.ts`
  - :340-341 — sign-in start-up: a console `route-changed` ends the operation as `route-changed`. No child was started, so the gate releases at once and no fallback is offered.
  - :389-390 — sign-in status poll: `routeChanged` ends the operation as `route-changed`. The probe's termination fact was already recorded in the ledger, so an unproved child keeps the reservation and the result is `busy`.
  - :414 and :422 — sign-out: `routeChanged` after logout, and after the follow-up status, ends with `route-changed`.
  - :449-450 — status action: `routeChanged` completes through `unobserved('route-changed', probed.terminated)`. No signed-in or signed-out result or identity is recorded. A terminated child releases; an unproved one retains.
- MODIFIED `provider-account-auth-env.spec.ts` (command spec). The status/logout fixture is now a real directory from `mkdtempSync(os.tmpdir())` with a resolved route. `replaceDirectory()` renames the reserved directory away and creates a new directory at the same path.
- MODIFIED `claude-login-console.spec.ts`. Same real temp-directory fixture for the `launch` tests. The fallback-script tests are unchanged.

## Regression tests added

- Command spec :255 — status and logout requests carry the reserved `launchGuard` (path, realpath, `dev:ino`).
- Command spec :265 — the directory is replaced after reservation and coverage (after the context was built). `logout` and `status` both return `routeChanged`, and zero children are spawned.
- Command spec :275 — a context without a route spawns nothing.
- Command spec (after :275) — the directory is replaced while the status child runs. After close the result is `{ status: null, terminated: true, routeChanged: true }`, so no auth result can be recorded.
- Command spec :290 — the directory is replaced during a logout that never closes. The result is `{ exitCode: null, terminated: false, routeChanged: true }`: termination stays unproved and the caller retains its reservation.
- Console spec :136 — the `conhost.exe` request carries the file-identity guard.
- Console spec :155 — on win32 and linux, a directory replaced after reservation and coverage gives `route-changed` and zero console launches (so no fallback either).
- Console spec :164 — a context without a route launches nothing.
- Console spec :170 — the spawner refuses with `ELAUNCHGUARD` after the directory changed, and the result is `route-changed`.

## Checks

- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json`: no output (pass).
- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.spec.json`: no output (pass).
- `npx eslint` on the 6 changed files: no output (0 errors, 0 warnings).
- `npx jest -c libs/backend/auth-providers/jest.config.ts provider-account-auth-env.spec.ts claude-login-console.spec.ts claude-route-certifier.spec.ts provider-account-actions.service.spec.ts src/lib/di/register.spec.ts --maxWorkers=2`: 5 suites, 119 tests passed.
- `ptah_get_diagnostics` was not called. The scoped tsc runs above cover the same files.
- Not run: `npm run verify`, build, other projects. These belong to the team-leader. No real `claude`, `conhost.exe` or `reg.exe` was started; all spawners are fakes.

## Specs that mock or pin changed members (rule 5)

- `provider-account-actions.service.spec.ts` fakes `commands.status/logout` and `loginConsole.launch`. It was not edited and still passes. Ambient-path pins are untouched.
- `claude-route-certifier.spec.ts` mocks `ClaudeCliProbe.status/logout` and uses `authContext`. It was not edited and still passes.
- `claude-login-console.spec.ts` and `provider-account-auth-env.spec.ts` were edited as described above.

## Decisions

- `ClaudeAuthContext.route` is optional, and a missing route fails closed (`route-changed`, no spawn).
  - Options: a required field, or an optional field that fails closed.
  - Evidence: a required field breaks the context literal in `provider-account-actions.service.spec.ts:97` (`let context: ClaudeAuthContext`). That would make the run 7 files, past the 6-file limit in rule 9.
  - Every production context comes from `ClaudeRouteCertifier.prepare`, which always sets the route.
  - Reversible: make the field required and add `route` to that spec literal in a follow-up.
- The certifier was touched because it owns `ClaudeAuthContext` and `ClaudeCliProbe`; the route cannot be carried any other way. To stay within 6 files, `provider-account-actions.service.spec.ts` was the file dropped.
- The route is checked on every platform before the console's platform check, so posix does not get a fallback script for a replaced directory either.

## Left for a follow-up run

- Service-level regression in `provider-account-actions.service.spec.ts`. It should assert:
  - start-up `route-changed` gives a `route-changed` result and releases;
  - `routeChanged` from a status poll or the status action records no signed-in or signed-out state;
  - `routeChanged` with `terminated: false` stays `busy`.

  The mapping is a one-line branch at each site listed above. The command and console regressions cover the launch-blocking behaviour.
- Optional: make `route` required, as described under Decisions.

## Collision notes for finding 2 (late probe close)

- `ClaudeAccountCommand.status` and `logout` now return `{ ..., terminated: run.terminated, routeChanged: true }` after the post-close revalidation (`claude-account-command.ts:257`, `:274`). If finding 2 replaces the `terminated` boolean with a close receipt or subscription, both return sites need the receipt passed through as well. The pre-spawn refusals (`:251`, `:268`) start no child, so they have no receipt.
- `run()` (`claude-account-command.ts:~300-375`) now spreads `launchGuard` into the `spawnProcess` request. Finding 2's rework of `run()` must keep that spread.
- In `provider-account-actions.service.ts`, the new `routeChanged` branches come right after `operation.ledger.recordProbe(...)` (:389-390, :414, :422). Finding 2 changes `recordProbe` to per-child tracking, which will edit those same lines.
- The status action branch at :449-450 calls `unobserved('route-changed', probed.terminated)`. This is the same boolean finding 2 replaces.
- Finding 3 (`claude-auth-settings-scan.ts`) does not collide with this fix.
