# Phase D Code Logic Review - TASK_2026_858_f7b9

Scope: worker-runtime, worker-host (Batches 14-19.3), read statically. Files read in full or in the
relevant regions: session-driver.ts, remote-sessions.ts, serve.ts (lines 100-409), file-lock.ts,
token-store.ts, pairing-window.ts, connection.ts, worker-service.ts, session-log-writer.ts,
session-event-log.ts, fan-out.ts, event-capture.ts, redact.ts, pending-permissions.ts.
Not read in depth: transcript.ts, readiness.ts, in-process-rpc.ts, apps/ptah-electron packaging,
the spec files. No tests were run. The verdict does not cover those files.

Score: 5/10. Verdict: NEEDS_REVISION. Counts: Blocking 0, Serious 6, Moderate 13.

## Serious

1. Turn end before turns.set keeps the slot forever (CONFIRMED, known item).
   - Files: session-driver.ts:127-150 (continue), 197-213 (start); remote-sessions.ts:329-339 (tap).
   - Evidence: tap calls `driver.end()` only when `driver.driving(sessionId)`. `turns.set` happens
     after `await baseline` and `await enqueue('worker:turn.begin')`. A fast `session:turnEnded` or
     `session:turnFailed` in that window is dropped from the end path. For `start`, `routeKey`
     returns `tab:<id>` until `resolveTab`, so `driving('tab:..')` is always false.
     The event is still logged. `turns.set` then runs for an already finished turn.
   - Effect: the session reports TURN_IN_FLIGHT, one maxActiveTurns slot is lost, and the driver
     lock stays held until `session.stop` or a restart. Repeated failures (for example provider
     errors) exhaust WORKER_BUSY.
   - Fix: record a "ended while admitting" flag per session/tab in tap. After `turns.set`, check
     the flag and run `end()`. Alternatively insert the turn into `turns` before the first await.
     Also run the end check on the early-queue replay path.

2. Failed `session.start` after `chat:start` admission leaves the engine turn running.
   - File: session-driver.ts:197-221.
   - Evidence: `await resolved()` (30 s timeout, or `openSession` failure) sits outside the inner
     try/catch that calls `abort`. On a throw, only the reservation is released and `forgetTab` runs.
   - Effect: the client gets INTERNAL while the engine runs the turn and holds the driver lock.
     The turn has no log, no `turns` entry, no slot accounting and no way to stop it, because
     `session.stop` needs `driving`.
   - Fix: on failure, abort the engine by tab (or by the session ID when it is known). Release
     the lock and report only after the abort.

3. Shutdown races in-flight turns (serve.ts:~393-398, remote-sessions.ts:354-365).
   - `abortTurns` iterates `tabsBySession.keys()` only. It misses turns that are still in
     `start` (reservation and tab not yet registered) and turns whose session has no tab entry.
   - The listener stays open while `abortTurns` runs, so a new `session.start` or `continue` can
     be admitted after the sweep and then run while the logs close and locks are released
     (`WorkerService.shutdown`: logs closed, then `releaseLocks`).
   - Fix: stop accepting turn methods first (a `stopping` flag in `handle`, WORKER_BUSY). Abort
     every entry in `turns`, including reservations. Then close the server and the logs.

4. `withFileLock` never steals a stale lock (CONFIRMED, known item). File: file-lock.ts:5-25.
   - A crash or kill -9 while the `.lock` directory exists leaves it forever. Every later
     `revokeSelf`, `grants.add` and `workspace` command fails with "Worker file is busy" after
     2 s. Recovery needs manual `rmdir`.
   - The `finally { await rmdir(lock) }` can also throw and replace the operation's result or
     error.
   - Fix: store pid and timestamp in the lock. Steal it when the pid is dead or the lock is older
     than N seconds. Catch ENOENT on release.

5. Pairing token issue writes without the lock and from stale memory (CONFIRMED).
   - Files: connection.ts (`tokens.issue`), token-store.ts:53-80 and `save`, serve.ts:255-262, 323-338.
   - `issue` appends to the in-memory `this.records` without `withFileLock` and without `load()`.
     `revoke` and `grants.add` run load-modify-write under the lock. If a pairing exchange and a
     `token.revokeSelf` or `grants.add` overlap, the later rename drops the other writer's record.
     A client can be handed a token that is not in `tokens.json`, or a revocation or grant change
     can be lost.
   - `grants.add` writes through a hand-rolled temp file (fixed name `<tokens>.<pid>.tmp`, no
     `wx`) instead of `TokenStore.save`.
   - Fix: make TokenStore methods perform lock, reload, mutate and save internally.

6. Permission request with no session ID is lost until the session ID is known (CONFIRMED, known item).
   - File: pending-permissions.ts:29-32; remote-sessions.ts tap, `permission:request` branch.
   - `add` stores nothing when neither `request.sessionId` nor the tab mapping resolves. During
     `session.start` before `session:id-resolved`, the request is not indexed and not routed.
     The user never sees it, and `permission.respond` returns ALREADY_ANSWERED.
   - The turn blocks on a prompt nobody can answer.
   - Fix: index by tab key (`tab:<id>`) and migrate it in `resolveTab`/`session:id-resolved`.

## Moderate

7. `queued: true` is never reported (known). `continue`/`start` return no queued state, so
   acceptance wording in batches.md that mentions it is unmet.
8. CODEX_UNAVAILABLE maps to INTERNAL (known). The connection allow-list at connection.ts
   (catch block) lacks it, so the client cannot tell a Codex-driven session from a crash.
9. redact.ts:1-12 (known). Bare 8-char pairing codes without a dash are not matched. The key
   `code` is not in SECRET_FIELD, so `{ code: 'ABCD1234' }` is logged in clear.
10. worker-runtime imports the full rpc-handlers barrel (known). This is an Electron/bundle
    weight and side-effect risk only; no behaviour defect found.
11. `driver.route` throws WORKER_BUSY when the early queue holds 10000 events (session-driver.ts:72).
    It is called from the synchronous push tap (remote-sessions.ts:219-222). The throw skips the
    rest of `tap` (including the TURN_END check) and propagates into the engine's push adapter.
    Drop the event and mark the writer degraded instead.
12. Per-connection `receive` is serialized (connection.ts `this.receiving.then`). A `session.start`
    can occupy the connection for up to 30 s (RESOLUTION_TIMEOUT_MS). `session.stop` and
    `permission.respond` for another session on the same connection wait behind it. The
    `inFlight > limit` WORKER_BUSY check can never fire for the same reason.
13. `driver.abort` removes the turn and frees the slot before the `chat:abort` result is checked
    (session-driver.ts:233-246). A failed abort is ignored, `session.stop` still replies
    `stopped: true`, and the engine turn keeps running.
14. Events can reach the log before `worker:baseline` and `worker:turn.begin` on `continue`.
    The tap enqueues events carrying `sessionId` while `continue` awaits baseline and turn.begin
    (session-driver.ts:143-150). The log order is then event, baseline, turn.begin, which breaks
    the replay and history-mark assumptions.
15. Logs are all opened at start and never evicted. `recoverLogs` opens every `.jsonl` file
    (worker-service.ts:133-146). Each keeps a handle and the whole record array in memory.
    Cost grows with session count and length. One corrupt log throws
    TranscriptUnavailableError and the worker fails to start at all.
16. No back-pressure on subscribers. `peer.send` calls `socket.send` with no `bufferedAmount`
    check (connection.ts `send`, fan-out.ts). A slow or stalled client makes server memory grow
    without bound until the pong timeout.
17. Live connections keep the grant copied at auth (connection.ts `this.grant = token.grant`).
    `admin.grants.add` writes the file but running connections never see the change. There is no
    admin revoke that closes live sockets; revocation only takes effect for new `auth`.
18. `lastUsedAt` is never updated (grep: only written as null at token-store.ts:73). The grants
    list always shows "never used".
19. Failed `resolved()` and the abandoned 30 s timer: `waitForSession` timer is not cleared when
    the outer `start` fails earlier (remote-sessions.ts:~226-231). It fires later against a
    deleted waiter. Harmless but untidy; clear it in `finally`.

## Five logic questions

1. Silent failure: finding 6 (permission never shown), 2 (orphan turn with success-like cleanup),
   13 (stopped: true although abort failed), `deliver` swallows enqueue rejection (remote-sessions.ts:197;
   acceptable only because the writer degrades and aborts).
2. Unexpected user action: pairing and revoke at the same time (5); a second client starting while
   shutdown runs (3); a stop sent during a 30 s start (12).
3. Wrong answer from input: a turn that fails fast reports the session as running forever (1).
4. Dependency failure: the engine accepts the chat and the log open fails (2); stale lock directory (4).
5. Missing: queued report, lastUsedAt, live grant refresh, subscriber back-pressure, log eviction.

## Requirements gaps

- W6 (`session.start` answers after id-resolved or fails): met for the answer, but the failure
  path leaves the turn running (2).
- C6/C7 driver lock lifecycle: lock release on turn end is unmet in the fast-end case (1).
- Acceptance wording about `queued: true`: unmet.
- Token store concurrency (W-series file locking): partially met (5, 4).

## Verdict

NEEDS_REVISION, confidence MEDIUM (static read only, transcript.ts and readiness.ts not reviewed).
No data-loss or security blocker found. The six Serious findings are all in turn lifecycle and
shutdown, and are cheap to fix. Recommended order: 1, 2, 3, 5, 4, 6.
