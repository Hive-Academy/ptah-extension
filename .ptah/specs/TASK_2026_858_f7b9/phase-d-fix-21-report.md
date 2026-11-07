# Phase D fix batch 21 report: security and stores (Claude backend-developer)

Base: `9ef234807`. Worktree `.claude-worktrees/remote-workers-phase-d`. Nothing is committed and no
git command changed the index. The orchestrator commits.

## Files changed

worker-protocol (`libs/worker-protocol`):

- `src/lib/methods.ts`: adds three admin methods to `WORKER_METHOD_SCHEMAS` and `ADMIN_METHODS`:
  - `admin.grants.revoke {tokenId}` returns `{tokenId, revokedAt, connectionsClosed}`.
  - `admin.workspace.add {path}` returns a workspace.
  - `admin.workspace.remove {workspace}` returns a workspace.
- `src/lib/methods.spec.ts`: updates the admin method list and adds schema cases.

worker-runtime (`libs/backend/worker-runtime`):

- New `src/lib/atomic-file.ts`: `writeFileAtomic` and `writeJsonAtomic`. These write a unique temp
  name with `wx` and mode 0600, then rename it into place. A failed write removes its temp file.
- New `src/lib/file-lock.ts`: `withFileLock`, moved from worker-host.
  - The lock directory is staged with `owner.json` (`pid`, `acquiredAt`) and then renamed into
    place, so every lock names its owner.
  - A lock is stolen when its owner is dead (`kill(pid, 0)` gives ESRCH), when its owner record
    cannot be read, or when another live PID has held it for more than 60 s (PID reuse).
  - The operation's result or error wins over a release error, which goes to `onReleaseError`
    (otherwise to a process warning).
  - Callers in the same process queue per file. A timeout raises `FileLockBusyError`.
- New `src/lib/process-state.ts`: `processState(pid)` returns `alive`, `dead` or `foreign` (EPERM).
- New `src/lib/machine-id.ts`: `workerMachineId()`. serve and the admin client share this
  derivation.
- `src/lib/token-store.ts`:
  - `issue`, `revoke`, the new `addWorkspaces` and the new `recordUse` all go through one private
    `mutate`. It takes the lock, reloads, changes the records, writes atomically, and then swaps
    the in-memory records.
  - `revoke` returns the record and keeps the first `revokedAt`.
  - `recordUse` writes `lastUsedAt` at most once per token per minute.
  - `load()` on a missing file now resets the records to `[]`.
- `src/lib/workspace-registry.ts`:
  - Writes are locked and reloaded, through `writeJsonAtomic`.
  - New `unregister(idOrPath)` (it also matches the realpath), `has(id)`, and `resolveIds(values)`.
    `resolveIds` throws `UnknownWorkspaceError` for an unknown value.
- `src/lib/connection.ts`:
  - Bounded receive queue: `inFlight` now counts queued and running frames and is incremented
    on arrival. Past `maxInFlightRequests`, an authenticated connection gets `WORKER_BUSY`
    (nothing is buffered), and an unauthenticated one is closed with THROTTLED.
  - The token's use is recorded before the auth reply.
  - New `connectionId`, `authenticatedTokenId` and `refreshGrant(grant)`.
- `src/lib/worker-server.ts`: `MAX_WORKER_CONNECTIONS = 64`, with a `maxConnections` test seam.
  Past the cap, the upgraded socket is closed with THROTTLED (4429).
- `src/lib/worker-service.ts`:
  - `endpoint.json` is now `{host, port, pid, machineId}`, written by `writeJsonAtomic`. The
    shutdown removal of the fixed `endpoint.json.<pid>.tmp` name is gone; the helper cleans its
    own temp file.
  - New `closeTokenConnections(tokenId, exceptConnectionId?)`. It sends a goodbye
    `{reason:'revoked'}` and then closes with REVOKED.
  - New `refreshGrant(tokenId, grant)`.
- `src/lib/pending-permissions.ts`: new `assertManualApprovalSettings({enabled, permissionLevel})`.
- `src/index.ts`: exports the four new modules.
- Specs:
  - New `atomic-file.spec.ts` and `file-lock.spec.ts`. The lock spec moved from worker-host and
    gained new cases.
  - Updated `token-store.spec.ts`, `workspace-registry.spec.ts`, `connection.spec.ts`,
    `worker-server.spec.ts`, `worker-service.spec.ts` and `pending-permissions.spec.ts`.

worker-host (`libs/backend/worker-host`):

- New `src/lib/commands/admin-handlers.ts`: `createAdminHandler(deps)` and `AdminPairingStatus`.
  - Every admin method parses its params with `parseParams` (the `WORKER_METHOD_SCHEMAS` row) from
    the lazily imported protocol module, which is passed in as `deps.protocol`.
  - Bad params answer `INVALID_PARAMS`. An unknown token or workspace answers
    `NOT_FOUND_OR_FORBIDDEN`.
  - The shared id-or-path mapping is `registry.resolveIds`.
  - `grants.add` uses `tokens.addWorkspaces` and then refreshes the token's live grant.
  - `grants.revoke` closes the token's live connections.
- `src/lib/commands/serve.ts`:
  - The admin closure is gone (410 → 380 lines). serve now wires `createAdminHandler`.
  - The machine ID comes from `workerMachineId()`.
  - The autopilot guard runs at startup and again before each `session.start` or
    `session.continue`.
  - The effective grant drops workspaces that are no longer registered.
  - `revokeToken` revokes and closes the token's other connections.
  - The fs imports and `withFileLock` are no longer used here.
- `src/lib/commands/remote-sessions.ts`: `revokeToken(tokenId, callerId)`. `token.revokeSelf`
  passes `peer.id`.
- `src/lib/commands/status.ts`: `runningEndpoint` now returns the full record.
  - It throws `WorkerNotRunningError` when `endpoint.json` is missing or invalid, when the owner
    PID is dead, or when the connect fails.
  - It refuses a record with no `pid` or `machineId`, and an owner that belongs to another user.
- `src/lib/commands/admin-client.ts`:
  - Typed params and result.
  - Checks the `hello` reply's machine ID against `workerMachineId()` and `endpoint.json` before
    it reads and sends the admin key.
  - A refused reply reports its wire code (`Worker command failed: CODE`).
- `src/lib/commands/grants.ts`: new `revoke` action.
- `src/lib/commands/workspace.ts`: `add` and `remove` go over the admin channel while the service
  runs.
  - Paths are made absolute first; a `ws_` ID is sent as is.
  - They fall back to the locked registry file only on `WorkerNotRunningError`.
  - The hand-rolled write is gone.
- `src/lib/dispatch.ts`: `grants revoke <tokenId> [--json]`. Any other argument count prints a
  usage line to stderr and exits 1.
- Deleted `src/lib/commands/file-lock.ts` and `file-lock.spec.ts` (the lock moved to worker-runtime).
- Specs:
  - New `commands/admin-client.spec.ts`.
  - Updated `commands/serve-sessions.spec.ts`: the harness answers `config:autopilot-get` and
    returns `token` and `tokenId`; a new `security and stores (Batch 21)` describe block.
  - Updated `commands/serve.spec.ts` (the fake transport answers `config:autopilot-get`) and
    `dispatch.spec.ts`.
- `docs/worker.md`: describes the following. The capability table and its markers are unchanged.
  - the new `grants revoke` row
  - `workspace` going to the running service
  - `grants add` reaching live connections
  - revocation closing live connections, and `lastUsedAt`
  - the lock owner and stealing
  - the admin-key identity check
  - the autopilot refusal
  - the connection cap and the per-connection queue cap

## Decisions

- **21.1: refuse `serve`, and refuse a turn if the setting changes.**
  - Options: force `setPermissionLevel('ask')` for each worker-driven turn, or refuse.
  - Evidence that the persisted level applies in the worker host profile:
    - `cli-engine/src/lib/container.ts:895` registers `ConfigRpcHandlers`, and the worker profile
      uses the shared manifest (`rpc-handlers/src/lib/host-profile/manifest.ts:229-231`).
    - `config-rpc.handlers.ts:146-157` (`register`) reads `autopilot.enabled` and
      `autopilot.permissionLevel` and calls `permissionHandler.setPermissionLevel(effectiveLevel)`.
    - Each Claude session seeds `rec.permissionLevel` from `permissionHandler.getPermissionLevel()`
      (`session-query-executor.service.ts:1763-1773`). `yolo` auto-approves every tool
      (`sdk-permission-handler.ts:592-604`). `auto-edit` auto-approves file tools (`:606-614`) and
      maps to the SDK's `acceptEdits` mode.
    - Codex reads the same two settings for each profile
      (`rpc-handlers/src/lib/chat/codex-host/codex-saved-permission-level.ts:12-23`).
  - Forcing `ask` covers only the Claude global default. The Codex path re-reads settings, so
    forcing the level would need engine changes.
  - Chosen behaviour:
    - serve reads `config:autopilot-get` (the persisted `{enabled, permissionLevel}`) after the
      engine is up and before it listens.
    - It refuses `yolo` and `auto-edit` with a clear message. `plan` and `ask` still prompt.
    - An unreadable setting also refuses (fail closed).
    - The same check runs before every `session.start` and `session.continue`. A refused turn
      answers `INTERNAL` and logs the reason to stderr. This covers a desktop edit while the
      worker runs, as far as the worker's settings store sees that edit.
  - Reversible: yes.
- **21.2: refresh the live grant on `grants add`.** The other option was to close the token's
  connections so they re-authenticate. A refresh does not interrupt attached sessions.
  Revocation (operator or self) closes every connection of the token: goodbye `revoked`, then
  close 4410. The caller of `revokeSelf` closes after its reply.
- **21.5 / security 8: a removed workspace leaves every grant at once.** serve passes
  `grant ∩ registered workspaces` to the session layer. A session in a removed workspace is
  therefore refused even when the session index still caches it.
- **21.6: the connection cap closes with THROTTLED (4429), not PROTOCOL_ERROR.** THROTTLED is the
  protocol's resource-refusal code, and the frames are not malformed. The worker-client has no
  per-code retry logic, so this choice has no client impact.
- **21.7: identity check.**
  - The admin key is sent only when all of these hold:
    - `endpoint.json` names a live PID of this user;
    - the TCP connect succeeds;
    - the `hello` reply's `worker.machineId` equals both `workerMachineId()` and the
      `machineId` recorded in `endpoint.json`.
  - A dead PID counts as a stopped service. A record without `pid` or `machineId` (written by an
    older worker) is refused with "restart the worker service".
  - The challenge-response suggested in the review is not done; see "Not done".
- **21.4: the lock is placed by rename.** The owner file is written in a staging directory and
  then renamed onto `<file>.lock`, so the lock cannot exist without an owner. A steal renames
  the lock aside. If the moved lock's owner differs from the one read before, another process
  replaced it in the meantime, so the steal renames it back.
- **21.9: `lastUsedAt` is recorded before the auth reply, at most once per token a minute.**
  - The write is awaited, so no token write outlives the connection. A fire-and-forget write
    raced test teardown with ENOTEMPTY.
  - A failed write goes to the connection's `onError` and never fails the auth.
  - The cost is one locked write per token per minute on the auth path.
- **21.8: the protocol module is injected into `createAdminHandler`.** A static value import of
  `@ptah-extension/worker-protocol` fails the lint rule against lazy-loaded libraries
  (`@nx/enforce-module-boundaries`).

## Item → fix → spec

| Item | Fix                                                                                                                                | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21.1 | Refuse `serve` on persisted `yolo`/`auto-edit`; re-check before each turn                                                          | `pending-permissions.spec.ts` "refuses a persisted autopilot level that skips manual approval"; `serve-sessions.spec.ts` "refuses to serve while autopilot is persisted at %s" (yolo, auto-edit), "refuses a turn once autopilot is switched to an auto-approving level while serving"                                                                                                                                                                                                                  |
| 21.2 | `admin.grants.revoke` + `grants revoke`; `revokeSelf` closes all of the token's connections; `grants add` refreshes live grants    | `serve-sessions.spec.ts` "token.revokeSelf closes every live connection of that token", "grants revoke closes the live connections; grants add reaches them without a reconnect"; `worker-service.spec.ts` "closes every live connection of a revoked token and refreshes the grant of another"; `dispatch.spec.ts` "grants revoke emits one JSON line", "passes grants revoke its token ID and refuses extra arguments"; `methods.spec.ts` "validates the Batch 21 admin revoke and workspace methods" |
| 21.3 | One locked, reloading `TokenStore.mutate` for issue, revoke, addWorkspaces and recordUse                                           | `token-store.spec.ts` "serializes issue, revoke and grant writers from two instances; a revoked token stays revoked"                                                                                                                                                                                                                                                                                                                                                                                    |
| 21.4 | Owner PID in the lock, steal when dead, result over release error, moved to worker-runtime                                         | `file-lock.spec.ts` "steals a lock whose owner process is dead", "steals a lock with an unreadable owner record", "waits for a live owner and reports the busy file at the deadline", "keeps the operation result and error over a failed lock release", "serializes competing writers and releases the lock after failure"                                                                                                                                                                             |
| 21.5 | `workspace add/remove` over the admin channel when running; otherwise a locked file change; effective grant ∩ registry             | `serve-sessions.spec.ts` "workspace remove and add reach the running service at once"; `workspace-registry.spec.ts` "keeps concurrent writers from two instances and removes by ID or path"                                                                                                                                                                                                                                                                                                             |
| 21.6 | `MAX_WORKER_CONNECTIONS = 64`; in-flight counts queued frames                                                                      | `worker-server.spec.ts` "closes connections past the cap with THROTTLED and accepts again after one leaves"; `connection.spec.ts` "refuses frames past the in-flight cap with WORKER_BUSY instead of queueing them", "closes an unauthenticated flood past the cap with THROTTLED"                                                                                                                                                                                                                      |
| 21.7 | `endpoint.json` carries `pid` and `machineId`; the admin client checks the PID and the `hello` machine ID before sending the key   | `admin-client.spec.ts` "does not send the admin key to a listener that answers as another machine", "treats an endpoint whose owner process is dead as a stopped service", "refuses an endpoint record that does not name its owner"; `worker-service.spec.ts` (endpoint record)                                                                                                                                                                                                                        |
| 21.8 | `admin-handlers.ts`, params through `parseParams`/`WORKER_METHOD_SCHEMAS`; one `writeJsonAtomic` for tokens, registry and endpoint | `atomic-file.spec.ts` "replaces the file with owner-only content and leaves no temp file", "removes its temp file when the rename fails"; the admin paths in `serve-sessions.spec.ts`                                                                                                                                                                                                                                                                                                                   |
| 21.9 | `TokenStore.recordUse` on successful auth, debounced to once a minute                                                              | `token-store.spec.ts` "records lastUsedAt on use at most once per minute"; `connection.spec.ts` "records the token use on auth and exposes the token for revocation"; `serve-sessions.spec.ts` "records lastUsedAt when a token authenticates"                                                                                                                                                                                                                                                          |

The serve, admin-client and doc specs load the engine or the runtime barrel. Each warms the graph
in `beforeAll(..., 180_000)` and runs its cases with a `60_000` timeout. The runtime unit specs do
not load the barrel.

## Not done

- **No challenge-response for the admin key** (security 3 suggests HMAC over a nonce). 21.7 uses
  the PID and machine-ID check, as the batch allowed.
  - A local process could still pass the check: it would bind the port after a crash while a
    reused PID is alive, and answer with the machine ID (derived from the host name and
    disclosed before auth).
  - The key also does not rotate. Both items are follow-ups.
- **`plan` is allowed under autopilot.** It does not auto-approve tool execution.
- **`config:autopilot-*` writes inside the worker process are not blocked.** The per-turn
  re-check covers them, and no remote method reaches those RPCs.
- **The session index is not pruned on workspace removal.** The effective-grant filter makes
  that unnecessary for authorization. The cached map entries remain (Info 17, deferred).
- **No `admin.grants.remove <tokenId> <workspace>`.** Batch 21 asked only for revoke.
- **The readiness-probe extraction from S1 is not done.** 21.8 scoped the split to the admin
  handlers, so `serve.ts` is 380 lines.
- **Jest prints "A worker process has failed to exit gracefully"** for the worker-runtime and
  worker-host test targets. Every case passes. The result of the open-handle check is under
  "Open handles" below.
- Deferred items were not touched.

## Verify

Command:
`npm run verify -- -p @ptah-extension/worker-host,@ptah-extension/worker-runtime,@ptah-extension/worker-protocol -- --output-style=static`

- **First run: exit 1.**
  - worker-host lint failed on a static import of `@ptah-extension/worker-protocol` in
    `admin-handlers.ts`.
  - Two serve-sessions cases failed with `ENOTEMPTY` in teardown, caused by the fire-and-forget
    `lastUsedAt` write. Both causes are fixed.
- **Second run: exit 0.** "Running targets lint, test, typecheck for 3 projects", all passed:
  - worker-protocol: 8 suites, 186 tests.
  - worker-runtime: 26 suites, 127 tests.
  - worker-host: 6 suites, 43 tests.

## Degradation audit

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0,
`TOTAL 218 unsuppressed site(s)`, the same as before the batch. It reports no site under
worker-runtime or worker-host. The one new marker (`file-lock.ts`, unparsable owner record) uses
`// degradation-audit: reported - <reason>`.

## Open handles

Command: `npm run verify -- -t test -p @ptah-extension/worker-runtime -- --output-style=static --skip-nx-cache --detectOpenHandles`

- Exit 0, 127 tests passed (Jest runs in band with this flag, 650 s).
- Jest reported no open handle, and the "failed to exit gracefully" warning did not appear.
- The warning appears only with the two parallel Jest workers, so this run cannot tie it to a
  Batch 21 spec.
- I did not check whether the warning also appears at `9ef234807`.
- No open-handle run was done for worker-host.

## Orchestrator verification

- `npm run verify -- -p @ptah-extension/worker-host,@ptah-extension/worker-runtime,@ptah-extension/worker-protocol -- --skip-nx-cache`:
  lint and typecheck pass; worker-protocol 186 and worker-runtime 127 tests pass. worker-host
  failed 2 of 43 once (`serve.spec.ts` SIGTERM/SIGINT cases) and passed 43 of 43 in two reruns
  (alone and with worker-runtime). The error text of the failed run was not captured. Signal
  handlers attach in the same tick as `onReady`, so it is not a listener race; a load timeout
  is likely. Watch CI.
- Degradation audit: exit 0.
