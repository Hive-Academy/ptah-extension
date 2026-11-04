## Files changed

- `libs/backend/worker-host/src/lib/commands/serve.ts`: pairing attempt tracking, real local lock listing in admin status, readiness from the engine's effective provider route RPC, and serialization of grant rewrites.
- `libs/backend/worker-host/src/lib/commands/workspace.ts`: serialized workspace add/remove rewrites with a fresh registry read.
- `libs/backend/worker-host/src/lib/commands/file-lock.ts`: atomic directory lock for cooperating worker-host processes.
- `libs/backend/worker-host/src/lib/commands/file-lock.spec.ts`: lock serialization and release after failure.
- `libs/backend/worker-host/src/lib/commands/serve.spec.ts`: bundle-adjacent package version and SIGTERM/SIGINT coverage.
- `libs/backend/worker-runtime/src/lib/pairing-window.ts` and `.spec.ts`: success notification for pairing status and focused callback coverage.

## Decisions

- `grants add` continues to use the authenticated admin WebSocket. The service takes a directory lock on the token file and reloads it under the lock before extending the grant. Workspace add/remove take the same kind of lock around the workspace registry read and rewrite. A competing writer waits up to two seconds and then receives an explicit busy error. The lock is intentionally not stolen: a crash may require an operator to remove a stale `.lock` directory after confirming the process has exited.
- `admin.status` maps `listLocalDriverLocks()` results to the protocol's held-lock fields and converts `acquiredAt` from the platform ISO timestamp to milliseconds.
- The pairing window callback updates the admin-visible attempts after a failed exchange and closes the visible window when exhausted.
- Readiness calls the registered `auth:getEffectiveRoute` in-process RPC, which reads the engine's provider configuration and status sources. A failed RPC is an explicit readiness failure.

## Cross-lib changes

- `libs/backend/worker-runtime/src/lib/pairing-window.ts`: emits its existing audit callback after a successful exchange, so the host can close admin-visible pairing status immediately.
- `libs/backend/worker-runtime/src/lib/pairing-window.spec.ts`: covers attempt decrement and success closure callback.

## Spec coverage

| Requirement                                             | Spec name                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Bundle-adjacent package version                         | `commands/serve.spec.ts`: `reads the package version adjacent to the worker bundle`                               |
| SIGTERM and SIGINT listener shutdown                    | `commands/serve.spec.ts`: `starts a loopback WebSocket and stops on %s`                                           |
| Cross-process rewrite serialization and lock cleanup    | `commands/file-lock.spec.ts`: `serializes competing writers and releases the lock after failure`                  |
| Pairing attempt updates and successful exchange closure | `worker-runtime/pairing-window.spec.ts`: `reports remaining attempts and closes the visible window after success` |
| Serve preflight refusals and basic WebSocket startup    | Existing `commands/serve.spec.ts` refusal and listener specs                                                      |
| Real lock status                                        | Code changed; focused host-level spec still needed                                                                |
| Authenticated session and permission method composition | No spec; implementation incomplete                                                                                |
| Actual provider auth route                              | Code changed; focused host-level spec still needed                                                                |

## Not done / Clarifications Needed

- The authenticated remote session and permission methods are still unimplemented in `serve.ts`; `SessionDriver`, `Transcript`, `PendingPermissionIndex`, `WorkerAuthorizer`, and `dispatchWorkerMethod` have not been composed. `maxActiveTurns`, the push adapter tap, and the release-lock callback therefore remain placeholders. The listener can start but cannot drive remote turns.
- Focused host-level specs for admin lock status, the effective auth route, grant and workspace rewrites across separate processes, and the missing session composition remain to be written. The file-lock spec verifies concurrent serialization inside one process using the same filesystem primitive.
- No Nx, Jest, verify, build, application target, or socket was run in this lane, as instructed. The orchestrator must run verify.

## Static check results

- Host spec TypeScript (`tsconfig.spec.json`): passed.
- Host library TypeScript (`tsconfig.lib.json`): passed after the auth-route change.
- ESLint on host source and the changed runtime files: passed with zero errors and zero warnings.
- Prettier completed on all changed source, spec, and report files.
- The changed worker-runtime spec was not typechecked separately; the orchestrator owns the prescribed verify run.

## Orchestrator verification and corrections (round 2)

- `npm run verify -- -p @ptah-extension/worker-host,@ptah-extension/worker-runtime`: lint,
  typecheck and test pass (worker-runtime 99 tests, worker-host 19 tests).
- Correction: `serve.spec.ts` SIGTERM/SIGINT cases had the default 5 s Jest timeout and failed
  under the shared verify lock (suite 43.9 s). They now pass `60_000` as the timeout.
- Phase D review notes: `withFileLock` never steals a stale `.lock` directory, so a crash blocks
  later writes until an operator removes it. Check that every token-store writer (pair exchange,
  revoke) takes the same lock.
