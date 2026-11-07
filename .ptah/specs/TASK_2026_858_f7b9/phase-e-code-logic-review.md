# Phase E Code Logic Review - TASK_2026_858_f7b9

## Verdict

**REVISE - 5.5/10.** The wiring, parameter validation, registry write path and SSH helpers are sound. The connection state machine and the service lifecycle have real defects: re-attach reconnect loop, double backoff increment, duplicate connections from an unserialized `list()`, and `remove()` that skips transport kill on error. No Blocking issue (no data loss or security hole). 4 Serious, 5 Moderate, 2 Minor. No tests were run; this is a read-only review.

## Findings

All paths below are under `libs/backend/remote-machines/src/lib/` unless stated.

1. **Serious - one bad attached session causes a permanent reconnect loop.** `machine-connection.ts:206-212`. `open()` sets `state='connected'`, resets `attempts=0` and emits, and only then re-attaches each tracked session. If `session.attach` rejects (session deleted on the worker, `NOT_FOUND_OR_FORBIDDEN`, driver lock), the catch block calls `schedule()` and closes the client. Because `attempts` was already reset, the retry is always 1 s. The UI flaps connected/offline every second indefinitely, and the stale session is never removed from `this.sessions`. Fix: attach each session in its own try/catch. Drop the cursor on a not-found/forbidden error and keep the connection up. Reset `attempts` only after the attach phase succeeds, or do not treat an attach failure as a connect failure.

2. **Serious - backoff steps are skipped because failure paths schedule twice.** `machine-connection.ts:225-246` and `closed()` at 126-145. In `open()`'s catch, `schedule()` runs (`attempts++`). Then `this.client.close()` (line 247) fires `onClose` per the WorkerClient contract (`worker-client.ts:518`), and `closed()` calls `schedule()` again, so `attempts++` runs again. One timer survives, because `cancelTimer` runs first, but the sequence becomes 2/5/10/30 s and the 1 s step is lost. The same happens when the socket drops mid-connect. Fix: add a `scheduled`/generation guard, so `closed()` is a no-op while `connecting` is set (open's catch owns scheduling). Alternatively increment `attempts` only when the timer fires. The specs inject `createClient` mocks and never exercise a real close-after-failure sequence.

3. **Serious - `list()` is not serialized, so it can create duplicate connections.** `machines-service.ts:97-106`. `connections.get(...) ?? (await this.create(...))` has an `await tokens.get` between the check and `connections.set`. Startup `list()` (wire-runtime) and a renderer `machines:list` can interleave. Two `MachineConnection`s are then built for one machineId. The first is overwritten in the map and never disposed, so it keeps its own timers and event broadcasts, and two SSH transports can run. Also, `list()` after `dispose()` (the startup promise resolves during quit) creates and leaks new connections. Fix: run `list()`/`create` through `serialize`, or memoize an in-flight create promise per id. Check `this.disposed` in `create`.

4. **Serious - `remove()` does not guarantee transport kill, and can leave a half-removed state.** `machines-service.ts:190-197`. `tokens.delete` and `registry.write` run before `connection.dispose()`, with no try/finally. If either throws (keyring error, disk full, corrupt registry), the connection stays alive. A revoked token remains in memory and the registry entry remains. The plan says the transport is killed "even on errors" (C9). If `registry.write` fails after `tokens.delete`, the machine is listed but has no token. Fix: wrap in try/finally with dispose. Write the registry first, or restore the token on failure.

5. **Serious - error mapping misses the SSH helper and not-found errors (W11).** `machines-rpc.handlers.ts:12-33`. `mapMachineError` handles only `RpcUserError` and `WorkerClientError`. `SshWorkerCommandError` (`ssh-worker-commands.ts`, codes `version-mismatch`/`unreachable`/`invalid-output`) thrown from `pairViaSsh` reaches the frontend as a plain internal error. It should be `MACHINE_VERSION_MISMATCH` / `MACHINE_UNREACHABLE`. Plain errors from `machines-service.ts` ('Machine not found', 'SSH alias not found', 'Machine already added', registry-corrupt) also lose a code, so the UI cannot branch on them. No `MACHINE_NOT_FOUND` exists in `rpc-error-codes.types.ts:67-77`. Fix: map `SshWorkerCommandError` and add or choose codes for the not-found/duplicate cases. Prefer mapping every non-user error to a generic coded error, so raw messages (which can include registry paths) do not leak.

6. **Moderate - re-attach cursor can be stale, which gives duplicate replay.** `machine-connection.ts:151-166, 276-281`. `event()` updates a cursor only when `previous` already exists. `attach()` stores `{epoch, seq: afterSeq}` only after the response. Replay events delivered before the attach response resolves are not counted. The cursor then stays at the requested `afterSeq`, not the last delivered `seq`, and a reconnect replays them again with no dedupe. `result.mode !== 'log'` sessions are never tracked, so they are not re-attached. A repeated `attach` with a lower `afterSeq` also moves the cursor backwards. Fix: create the cursor before the call (or accept the first event for an attaching session), and use `max(seq)`.

7. **Moderate - stale-socket close can kill the new transport and force a reschedule.** `machine-connection.ts:97-100, 126-128`. `closed()` destroys `this.transport` (the newest one), not the transport of the socket that closed. A delayed close from an old socket, after `retry()` has started a new connect, destroys the new transport and calls `schedule()`, which cancels the in-flight attempt's state. Fix: capture a generation or socket id in `socket()` and ignore events from a non-current one.

8. **Moderate - `retry()` during an in-flight connect rewrites state.** `machine-connection.ts:262-265`. It sets `state='offline'` and `attempts=0` and then returns the existing `connecting` promise. A connected-bound state flickers to offline in the UI. Also `dispose()` during `open()` is not honoured: `open()` continues, sets `state='connected'` and emits after dispose. Fix: if `connecting`, return it before mutating; check `disposed` after each await in `open()`.

9. **Moderate - pairing on an already-connected machine drops the live link.** `machines-service.ts:126-148`, `machine-connection.ts:249-263`. `exchange()` calls `client.connect()` on a live client and its `finally` closes it, which drops the working connection and triggers a reconnect. A failed re-pair also leaves an orphan worker token (`pair` never revokes it when `tokens.set` fails, line 142-146). Fix: reject `pair` when `state==='connected'`, or call `clearToken` first. Best-effort revoke if `tokens.set` fails.

10. **Moderate - `readiness()` throws when the remote is unreachable.** `machines-service.ts:209-211`. A rejected `machine.info` fails the whole call and the local self-test result is lost. Fix: catch and return `remote: null`.

11. **Moderate - `hello` mismatch leaves `versions` unset, so the UI cannot show both versions.** `machine-connection.ts:182-195` and the `VERSION_MISMATCH` branch at 220-230. Versions are only built after a successful `hello`. When the worker rejects `hello` with `VERSION_MISMATCH`, `versions` is undefined. The plan row (~1347) wants both versions shown. Fix: set `versions.local` before the call.

12. **Minor - `4401`/`4410` close leaves the dead token in the store.** `machine-connection.ts:132-136`. `closed()` moves to `unpaired` but `retry()` sets `offline` again because `this.token` is still set, so retry loops on a rejected token. Clear the token (and the store) on 4401/4410.

13. **Minor - `void broadcastMessage(...)` has no `.catch`.** `machines-service.ts:68-77`. `WebviewManager.broadcastMessage` can reject, since `observeAttention` runs before its try. This would be an unhandled rejection. Add `.catch(() => undefined)`.

Checked and fine: `serialize()` does not poison the chain (`.then(op, op)` plus swallowed tail). Registry writes use tmp + fsync + rename and refuse a corrupt file. `ssh-stdio-transport.ts` kills the child on destroy and handles stdin/stdout/stderr errors, exit code, and the stderr tail cap. `ssh-worker-commands.ts` has a timeout, output cap, and schema-parsed output. No token appears in any RPC result. All `MACHINES_RPC_METHOD_NAMES` are registered and params are parsed with `safeParse` (`machines-rpc.handlers.ts:42-56`). Electron wiring (`phase-4-handlers.ts`, `wire-runtime.ts`, `shutdown.ts`): startup `list()` then `retry()` is fire-and-forget with per-machine catch, so it never blocks or crashes boot. `MachinesService` is an `instanceCachingFactory` singleton, and `refs.remoteMachines` is disposed through `nonFatal` on quit.

## Requirements coverage

| Batch / requirement | Status | Evidence |
| --- | --- | --- |
| B20 alias validation, `ssh` spawn with `shell:false` and `--`, registry atomic write, token store | Met | `ssh-alias.ts`, `ssh-stdio-transport.ts:14-33`, `machine-registry.ts` |
| B20 transport child lifecycle / timeout / exit-code mapping | Met | `ssh-stdio-transport.ts:50-77`, `ssh-worker-commands.ts` |
| B21 states incl. auth failure -> unpaired, mismatch -> version-mismatch | Met | `machine-connection.ts:132-142, 220-230` |
| B21 backoff 1/2/5/10/30 s +-20% | Not met in practice | Table is right (line 14, 163), but finding 2 skips steps after a failure |
| B21 exactly one timer, no double reconnect | Partially met | `cancelTimer` keeps one timer, but see findings 2, 7, 8 |
| B21 re-attach with afterSeq + epoch after reconnect | Partially met | Cursor and epoch passed (206-212); findings 1 and 6 |
| B21 pairing stores nothing on failure | Met (with orphan-token caveat) | `machines-service.ts:139-146`, finding 9 |
| B21 remove online/offline, `revokeSelf` 5 s, token + registry deleted, transport killed on errors | Partially met | Timeout and deletion present; finding 4 (no kill on error) |
| B21 serialized registry writes | Met for add/pair/remove | `list()` and `create()` are outside the lock (finding 3) |
| B21 dispose idempotent | Met | `machines-service.ts:234-239`; use-after-dispose via `list()` (finding 3) |
| B21 handlers: all methods, validation, W11 error codes, no token in results | Partially met | Methods and validation met; code mapping incomplete (finding 5) |
| B21 integration spec proves behaviour | Partial | `createClient`/`createTransport` mocks; no spec covers the close-after-failure double schedule or the attach-failure loop |
| B22 DI singleton, host handler registration, rpc-surface "excludes nothing" | Met | `phase-4-handlers.ts`, `rpc-host-profile.ts`, `rpc-surface.spec.ts` |
| B22 startup connect never blocks boot; dispose on quit | Met | `wire-runtime.ts` (void promise, catches), `shutdown.ts` (`nonFatal`) |

## Review family

Implementer: Codex (Batches 20-22). Reviewer: Claude (different family). Read-only static review: no tests, builds or git state changes were run. I did not read the batch reports' "Known limits" sections or the full spec files, so spec-quality claims rest on the test names and mock-injection points I saw.
