## Files changed

- `libs/backend/worker-host/src/lib/commands/serve.ts`: pairing attempt tracking, real local lock listing in admin status, readiness from the engine's effective provider route RPC, and serialization of grant rewrites. Round 3: resolves the engine seams (chat history read, session metadata store, SDK permission handler, session driver lock, workspace lifecycle provider), composes the remote session handlers, sends authenticated client calls to them, routes the push adapter tap into them, wires `--max-active-turns`, wires log append failure to the driver, and replaces the `releaseLocks` placeholder. On shutdown it interrupts driven turns before the logs close.
- `libs/backend/worker-host/src/lib/commands/remote-sessions.ts` (new, round 3): composes `InProcessRpc`, `Transcript`, `SessionDriver`, `WorkerSessionIndex`, `WorkerAuthorizer`, `PendingPermissionIndex`, `WorkerEventCapture` and the per-session writer fan-out behind `dispatchWorkerMethod`. Holds handlers for all ten remote methods, the synchronous push tap, turn abort, and the shutdown lock release.
- `libs/backend/worker-host/src/lib/commands/serve-sessions.spec.ts` (new, round 3): serve integration through a stub `bootstrap` and a real `ws` client.
- `libs/backend/worker-host/src/lib/commands/workspace.ts`: serialized workspace add/remove rewrites with a fresh registry read.
- `libs/backend/worker-host/src/lib/commands/file-lock.ts`: atomic directory lock for cooperating worker-host processes.
- `libs/backend/worker-host/src/lib/commands/file-lock.spec.ts`: lock serialization and release after failure.
- `libs/backend/worker-host/src/lib/commands/serve.spec.ts`: bundle-adjacent package version and SIGTERM/SIGINT coverage. Round 3: the stub container also provides the lock `held()` and `addFolder` that the session composition resolves.
- `libs/backend/worker-runtime/src/lib/pairing-window.ts` and `.spec.ts`: success notification for pairing status and focused callback coverage.
- Round 3 runtime changes are listed under "Cross-lib changes".

## Decisions

- `grants add` continues to use the authenticated admin WebSocket. The service takes a directory lock on the token file and reloads it under the lock before extending the grant. Workspace add/remove take the same kind of lock around the workspace registry read and rewrite. A competing writer waits up to two seconds and then receives an explicit busy error. The lock is intentionally not stolen: a crash may require an operator to remove a stale `.lock` directory after confirming the process has exited.
- `admin.status` maps `listLocalDriverLocks()` results to the protocol's held-lock fields and converts `acquiredAt` from the platform ISO timestamp to milliseconds.
- The pairing window callback updates the admin-visible attempts after a failed exchange and closes the visible window when exhausted.
- Readiness calls the registered `auth:getEffectiveRoute` in-process RPC, which reads the engine's provider configuration and status sources. A failed RPC is an explicit readiness failure.
- Round 3 decisions:
  - **The composition lives in its own file.**
    - Options: grow `serve.ts`, or add `remote-sessions.ts`.
    - Evidence: the "one responsibility per unit" rule. `serve.ts` is the boot and admin surface.
    - Reversible: yes.
    - The module has only type imports. `serve.ts` passes in the runtime barrel and the tokens it lazy-loads, so platform-core still loads first.
  - **`session.start` admission is in `SessionDriver.start`.**
    - Options: count starts in the host, or add `start` to the driver.
    - Evidence: the driver owns the private `turns` and `reservations` counters that enforce `maxActiveTurns`. A start outside it would bypass the limit.
    - Reversible: yes.
    - A new session's baseline is the empty history, `historyMark { count: 0, lastEventId: null }`. The session did not exist before this turn, and reading history after `chat:start` could already contain this turn's prompt.
  - **Pre-resolution tab events use a `tab:` routing key.**
    - Options: route by `payload.sessionId` only, or route tab-keyed events through `SessionDriver.route`.
    - Evidence: W6 and W7 queue tab events under the tab and move them into the log in order once the ID resolves.
    - Reversible: yes.
    - Session IDs never contain `:`, because the log file regex forbids it.
  - **Attach registers after the reply.** The fan-out subscription, the head read and the replay run in one synchronous step after the attach result frame is sent.
    - Options: subscribe inside the handler with fan-out buffering, or subscribe after the response.
    - Evidence: the client reducer ignores `evt` frames received before its attach result. A subscription made inside the handler would leak if the result failed validation.
    - Reversible: yes.
    - The connection needed a hook for this. See `WorkerPeer.afterReply` under "Cross-lib changes".
  - **An epoch mismatch on attach is answered as a fresh attach.** The handler drops `afterSeq`, and the result carries the current epoch. The reducer resets on a new epoch, which matches the W7 resync.
  - **Typed refusals keep their code through `dispatchWorkerMethod`.**
    - Evidence: dispatch mapped every handler error to `INTERNAL`, so `WORKER_BUSY`, `TURN_IN_FLIGHT` and `ALREADY_ANSWERED` could not reach the client.
    - Only codes in `WORKER_ERROR_CODES` pass. `CODEX_UNAVAILABLE` stays `INTERNAL` (Batch 18 decision).
    - The connection's own allow list still applies afterwards.
  - **Shutdown lock release.**
    - First, `abortTurns()` runs `chat:abort` for each driven turn while the logs are open. `SessionDriver.abort` now records `worker:turn.interrupted`.
    - Then the service's `releaseLocks` calls platform-core `requestRelease(sessionId)` for every `lock.held()` entry. That is the same path `ptah-worker locks release` takes, through the coordinator's release gate.
    - Last, it releases any lock still held directly with its nonce, because a lock left at process exit would be stranded.
    - Failures are logged by error name and do not stop endpoint cleanup.
  - **Engine folders.** Before a workspace-scoped call, the host calls `IWorkspaceLifecycleProvider.addFolder` for the registered path, because `session:list` and the chat RPCs only authorize folders the engine knows. The call is idempotent.
  - **Provider readiness gate.** `providerReady` is the last readiness report: `ready`, and the `provider` check passing when it is present.
  - **`token.revokeSelf`** revokes under the same token-file lock as `grants add`. After the reply it sends `ctl goodbye { reason: 'revoked' }` and closes with `WORKER_CLOSE_CODES.REVOKED`.
  - **`permission.respond`** records `by` as the paired client's name from the token store, as the record schema documents.

## Cross-lib changes

- `libs/backend/worker-runtime/src/lib/pairing-window.ts`: emits its existing audit callback after a successful exchange, so the host can close admin-visible pairing status immediately.
- `libs/backend/worker-runtime/src/lib/pairing-window.spec.ts`: covers attempt decrement and success closure callback.
- Round 3 (smallest changes the composition needed):
  - `connection.ts`:
    - New exported `WorkerPeer` with `id`, `tokenId`, `send(evt|ctl)`, `afterReply`, `onClose` and `close`.
    - `ConnectionOptions.handle` receives it as a fifth argument, so existing four-argument handlers are unaffected.
    - Reply tasks run after the success frame, and a failing task cannot answer twice.
    - Close listeners run once.
  - `worker-service.ts`: the `handle` type gains `peer`. New `findWriter(sessionId)` returns the open writer or `undefined`. `writer()` still throws.
  - `session-log-writer.ts`: `fanOut` is now `readonly` public, so attach can subscribe.
  - `session-driver.ts`:
    - New `start(params, resolved, deliver)` under the shared active-turn limit.
    - `abort` appends `worker:turn.interrupted` for an active turn when the writer is not degraded.
  - `worker-methods.ts`: typed handler refusal codes are preserved, as described under "Decisions".
  - Specs: `connection.spec.ts`, `worker-methods.spec.ts`, `session-driver.spec.ts`, one new case each.

## Spec coverage

| Requirement                                                                                                                                                                         | Spec name                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle-adjacent package version                                                                                                                                                     | `commands/serve.spec.ts`: `reads the package version adjacent to the worker bundle`                                                            |
| SIGTERM and SIGINT listener shutdown                                                                                                                                                | `commands/serve.spec.ts`: `starts a loopback WebSocket and stops on %s`                                                                        |
| Cross-process rewrite serialization and lock cleanup                                                                                                                                | `commands/file-lock.spec.ts`: `serializes competing writers and releases the lock after failure`                                               |
| Pairing attempt updates and successful exchange closure                                                                                                                             | `worker-runtime/pairing-window.spec.ts`: `reports remaining attempts and closes the visible window after success`                              |
| Serve preflight refusals and basic WebSocket startup                                                                                                                                | Existing `commands/serve.spec.ts` refusal and listener specs                                                                                   |
| Authenticated start, attach and pushed events (tap → capture → log → fan-out), gap-free seq, early tab event order, turn end and history mark, `sessions.list`                      | `commands/serve-sessions.spec.ts`: `starts a remote turn and streams logged and live events to an attached client`                             |
| Unauthenticated call refused (4403); out-of-grant `sessions.list`, `session.start`, `attach`, `continue` and `permission.respond` refused `NOT_FOUND_OR_FORBIDDEN` with no chat RPC | `commands/serve-sessions.spec.ts`: `refuses an unauthenticated call and any resource outside the grant`                                        |
| `--max-active-turns` refuses the (N+1)th start and continue (`WORKER_BUSY`) until a turn ends                                                                                       | `commands/serve-sessions.spec.ts`: `refuses the turn past --max-active-turns until a turn ends`                                                |
| Permission request round trip, `worker:permission.answered`, second answer `ALREADY_ANSWERED`                                                                                       | `commands/serve-sessions.spec.ts`: `round-trips a permission request to the SDK handler exactly once`                                          |
| Shutdown aborts the driven turn, logs `worker:turn.interrupted`, calls `requestRelease` and releases the held lock                                                                  | `commands/serve-sessions.spec.ts`: `interrupts the driven turn and releases its driver lock on shutdown`                                       |
| Driver `start`: shared limit, empty baseline, early tab delivery, interrupted on abort                                                                                              | `worker-runtime/session-driver.spec.ts`: `starts a session within the shared active-turn limit and delivers early tab events after turn begin` |
| Typed refusal codes through dispatch; untyped stay `INTERNAL`                                                                                                                       | `worker-runtime/worker-methods.spec.ts`: `keeps a typed refusal code from a handler and hides any other failure`                               |
| Peer reply ordering and single close notification                                                                                                                                   | `worker-runtime/connection.spec.ts`: `gives the handler a peer whose reply tasks run after the response and whose close listeners run once`    |
| Real lock status                                                                                                                                                                    | Code changed; focused host-level spec still needed                                                                                             |
| Actual provider auth route                                                                                                                                                          | Code changed; focused host-level spec still needed                                                                                             |

## Not done / Clarifications Needed

- Focused host-level specs for admin lock status, the effective auth route, and grant and workspace rewrites across separate processes remain to be written. The file-lock spec verifies concurrent serialization inside one process using the same filesystem primitive.
- Known limits of the round 3 composition, for the Phase D review:
  - **Turn end before admission returns.** A turn whose `session:turnEnded` arrives before `chat:continue` or `chat:start` admission has finished would not be ended, and would hold an active-turn slot until `session.stop`. The driver registers the turn only after the baseline and `worker:turn.begin`.
  - **Queued continues.** The W12 step 5 `queued: true` result for an enqueued continue is not reported, because `SessionDriver.continue` does not expose `enqueued`.
  - **Early permission requests.** A `permission:request` that carries neither `sessionId` nor a resolved tab is not indexed. Answering it returns `ALREADY_ANSWERED`.
  - **Operator release during a turn.** `ptah-worker locks release` during a worker turn goes through the coordinator's gate. The worker driver keeps the turn active until the engine reports its end.
  - **Workspace registry is not reloaded.** The serve process loads the workspace registry once at start, as in round 2. A workspace added later from another process is not visible until restart.
- Pair-exchange token issue (`WorkerConnection` → `TokenStore.issue`) still writes the token file without `withFileLock`. `revokeSelf` now takes the lock (see the round 2 review note).

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

## Round 3 (Claude backend-developer)

- Command:
  `npm run verify -- -p @ptah-extension/worker-host,@ptah-extension/worker-runtime -- --output-style=static`.
- Result: `Successfully ran targets lint, test, typecheck for 2 projects`.
  - worker-runtime: 24 suites and 102 tests passed (99 before, plus 3).
  - worker-host: 5 suites and 24 tests passed (19 before, plus 5).
- One earlier run failed lint on `prefer-const` in `serve.ts`. The fix made `service` a `const` and set the tap target just before `service.start()`. The run above is after that fix.
- Every engine-loading spec in `serve-sessions.spec.ts` uses a `60_000` timeout.
- Degradation audit (`tools/degradation-audit/check-degradation.ts`):
  - Every new swallow site carries a `degradation-audit: reported` marker, and none is orphaned.
  - The run reports `worker-host` 1 and `worker-runtime` 1 over a baseline of 0. Both sites are older than this round: `commands/admin-client.ts:54` and `worker-runtime/readiness.ts:89`. They are not changed here and still need a marker or a baseline update.
