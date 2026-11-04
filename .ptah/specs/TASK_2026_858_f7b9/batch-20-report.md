# Batch 20 report — turn lifecycle (Claude backend-developer)

Base: `d1d527ef7` (the round 3 work is `d125b68fc`). Nothing is committed.

## Files changed

- `libs/backend/worker-runtime/src/lib/session-driver.ts`: the turn admission lifecycle.
  - A per-turn `Admission` record replaces the reservation set. Its state is `admitting` or `orphan`.
  - It buffers the turn's tab and session events until `worker:turn.begin`, and records a terminal event that arrives during admission.
  - New `tabResolved`, `terminal`, `routeSession`, `knownSession`, `admittingTab` and `drain`.
  - `start` waits for the session ID itself and takes an `open` callback.
  - `abort` returns `boolean`, and `end` writes one record per turn.
  - New constructor option `{ resolveTimeoutMs, onAbandoned }`.
- `libs/backend/worker-runtime/src/lib/connection.ts`:
  - Each request gets its own `WorkerPeer` and its own reply-task list. The shared field is gone.
  - On an authenticated client connection, `session.stop` and `permission.respond` run outside the serialized receive chain.
- `libs/backend/worker-runtime/src/lib/worker-service.ts`: new optional `drainTurns` hook. It runs after the listener closes and before the logs close. This file was not in the batch's named list; the shutdown order needed it.
- `libs/backend/worker-host/src/lib/commands/remote-sessions.ts`:
  - Uses the driver's lifecycle API.
  - Holds tab-only permission requests and binds them on `session:id-resolved`.
  - `session.stop` reports a refused abort.
  - `drain()` replaces `abortTurns()`, and the per-session `releaseLock` is shared with `onAbandoned`.
  - Removed the host's own resolve waiters and the 30 s timer.
- `libs/backend/worker-host/src/lib/commands/serve.ts` (shutdown path only): wires `drainTurns: () => sessions.drain()`, and removes the pre-stop `abortTurns()` call.
- Specs:
  - `worker-runtime/src/lib/session-driver.spec.ts`: 8 new cases, and the start case rewritten for the new signature.
  - `worker-runtime/src/lib/connection.spec.ts`: 1 new case.
  - `worker-host/src/lib/commands/serve-sessions.spec.ts`: 7 new cases, behaviour hooks in the fake engine, and a warm-up `beforeAll`.
  - `worker-host/src/lib/commands/serve.spec.ts` and `worker-host/src/lib/worker-doc.spec.ts`: warm-up `beforeAll` (item 20.10).

## Decisions

- **The driver owns session resolution.**
  - Options: keep the waiters in the host, or move them into `SessionDriver`.
  - Evidence: the slot, the orphan state and the abort all live in the driver. A timeout in the host could not keep the slot. The host now forwards every `session:id-resolved` to `driver.tabResolved`.
  - Reversible: yes.
- **An admitted start that times out becomes an orphan.**
  - Options: abort by tab, or track the turn until its ID arrives.
  - Evidence: `chat:abort` takes only `sessionId`, so a tab cannot be aborted.
  - Behaviour: the orphan keeps its slot. When `session:id-resolved` arrives, the driver calls `chat:abort`. Only after that succeeds does it free the slot and call `onAbandoned`, which the host wires to `requestRelease` and then a direct `lock.release` for that session.
  - Reversible: yes.
- **Failed abort.**
  - When admission fails after the engine admitted the turn and `chat:abort` is then refused, the turn stays an orphan with a known session. `drain` retries it.
  - A registered turn whose abort is refused stays registered and keeps its slot, and `session.stop` answers `INTERNAL`.
  - Reversible: yes.
- **End during admission.**
  - `terminal()` on a turn still admitting sets `ended`.
  - Registration writes the baseline and `worker:turn.begin`, flushes the buffered events, then runs `end()`, so the order is begin, events, end.
  - An `ending` set makes `end()` write one `worker:turn.end` even when two terminal events arrive.
- **Event order on continue (20.6).** While a continue is admitting, events carrying its session ID are buffered and flushed after `worker:turn.begin`, in the same synchronous step that registers the turn.
- **Overflow (20.7).** The admission buffer is capped at 10,000 events.
  - Past the cap, the buffer is dropped and the turn is marked overflowed. Registration then aborts that engine turn, logs `worker:turn.interrupted`, and answers `SESSION_LOG_FAILED`.
  - The pre-existing early-tab queue (tabs with no admission) drops events past the cap and counts them in `driver.dropped`.
  - Neither path throws inside the push tap.
- **Concurrent stop and respond (20.8).**
  - Options: run every authenticated call concurrently, or bypass only `session.stop` and `permission.respond`.
  - Evidence: the coordinator asked to keep the per-connection order for everything else. The two methods address a turn that already exists, so their order against other calls carries no meaning.
  - The method is read from a frame of at most 8 KiB (both methods' params are small), so a large `session.start` frame is not parsed twice.
  - Consequence: a `session.stop` sent right after a `session.continue` that is still admitting can overtake it and answer `{ stopped: false }`. The client sees that the turn was not yet running.
  - Reversible: yes.
- **Shutdown order (20.5).** `WorkerService.shutdown` now runs:
  1. Close pairing and send goodbye.
  2. `server.close()`, which closes the listener and the connections.
  3. `drainTurns`, which runs `driver.drain()`:
     - Set `closing`, so `start` and `continue` refuse with `WORKER_BUSY`.
     - Cancel the starts that are waiting for a session ID; they become orphans.
     - Await the other pending admissions.
     - Abort every registered turn, and retry orphans whose session is known.
  4. Sync and close the logs.
  5. `releaseLocks`, which releases every lock in `lock.held()`.

  `drain` never throws. The host logs the tab-only orphans that are left and any refused aborts.

- **20.10 CI timeout.** Each engine-loading spec file has a `beforeAll(..., 180_000)` that imports the engine module graph in `serve.ts`'s order, platform-core first. The per-case timeouts stay at `60_000`. The project Jest timeout is unchanged.

## Item → fix → spec

| #     | Fix                                                                                                                                                                | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20.1  | `terminal()` flags a turn still admitting; registration runs `end()` after the flush; `ending` gives a single end record                                           | `session-driver.spec.ts`: `ends a start whose terminal event arrived during admission, once, after turn begin`, `ends a continue whose terminal event arrived during admission and buffers its events after turn begin`; `serve-sessions.spec.ts`: `ends a turn whose terminal event arrives during start, once, and frees the slot`, `ends a turn whose terminal event arrives during continue, after the baseline and turn begin` |
| 20.2  | Resolve timeout leaves an orphan that keeps its slot and is aborted when its ID arrives; a log-open failure aborts before release; `onAbandoned` releases the lock | `session-driver.spec.ts`: `waits for a delayed session:id-resolved after chat:start`, `keeps the slot of a start whose session never resolved, then aborts it when the ID arrives`, `aborts an admitted start whose log cannot open before freeing the slot`; `serve-sessions.spec.ts`: `answers session.start after a delayed session:id-resolved`                                                                                 |
| 20.3  | `abort()` checks `chat:abort`, keeps turn, slot and log on refusal; `session.stop` answers `INTERNAL`                                                              | `session-driver.spec.ts`: `keeps the turn, its slot and its log when chat:abort is refused`; `serve-sessions.spec.ts`: `reports a refused chat:abort from session.stop and keeps the slot`                                                                                                                                                                                                                                          |
| 20.4  | Tab-only requests held per tab (capped at 100) and bound on `session:id-resolved`; another session is still refused                                                | `serve-sessions.spec.ts`: `binds a tab-only permission request to its session on resolution and refuses another session`                                                                                                                                                                                                                                                                                                            |
| 20.5  | `drainTurns` hook in the order above                                                                                                                               | `session-driver.spec.ts`: `drain cancels a start waiting for its session, refuses new turns and aborts admitted ones`; `serve-sessions.spec.ts`: `shuts down promptly with a start still waiting for its session and releases its lock`, `interrupts the driven turn and releases its driver lock on shutdown` (existing)                                                                                                           |
| 20.6  | Session events buffered while a continue admits                                                                                                                    | `session-driver.spec.ts` and `serve-sessions.spec.ts` continue cases in 20.1 (log order checked)                                                                                                                                                                                                                                                                                                                                    |
| 20.7  | Capped admission buffer; overflowed turn aborted with `SESSION_LOG_FAILED`; `route` never throws                                                                   | `session-driver.spec.ts`: `drops an overflowing admission queue without throwing and refuses that turn`; `serve-sessions.spec.ts`: `refuses a start whose early-event queue overflows without failing the push tap`                                                                                                                                                                                                                 |
| 20.8  | `session.stop` and `permission.respond` bypass the receive chain; per-request peers                                                                                | `connection.spec.ts`: `answers session.stop and permission.respond while a session.start on the same connection is pending, and keeps order otherwise`                                                                                                                                                                                                                                                                              |
| 20.9  | The resolve timer exists only after `chat:start` succeeded and is cleared on resolve, reject or cancel; the host timer is removed                                  | Covered by the 20.2 and 20.5 specs; the verify run printed no leaked-worker warning                                                                                                                                                                                                                                                                                                                                                 |
| 20.10 | Warm-up `beforeAll(..., 180_000)` in `serve-sessions.spec.ts`, `serve.spec.ts` and `worker-doc.spec.ts`; case timeouts stay `60_000`                               | Verify: worker-host suite 34.3 s, every case passed                                                                                                                                                                                                                                                                                                                                                                                 |

## Not done

- **A start that never reports its session ID is never aborted.** If `session:id-resolved` never arrives, the turn's slot stays held until the worker restarts, because `chat:abort` cannot target a tab. Shutdown logs the count. A tab-addressed abort in the engine would close this gap.
- **A terminal event before `session:id-resolved` is not recognized.** A terminal event that carries only a session ID, arriving during a start before `session:id-resolved`, cannot be linked to its tab, so it is dropped. The engine sends `session:id-resolved` at SDK init, before any result, so this order is not expected. The integration spec uses the engine's order.
- **`session.stop` does not stop a turn that is still admitting.** It answers `{ stopped: false }`, as described under "Decisions".
- **Shutdown can wait on a hung in-process RPC.** `drain` waits for admissions that are inside `chat:start` or `chat:continue`. A hung in-process RPC would delay shutdown; there is no timeout on that wait.
- **Batch 21 items were not touched**, as instructed.
- **One Jest run outside verify.** During development I ran one targeted Jest command, `npx jest -c libs/backend/worker-runtime/jest.config.ts` on two spec files with `--maxWorkers=1`, before the prescribed verify. Every result below is from verify.

## Verify

- Command:
  `npm run verify -- -p @ptah-extension/worker-host,@ptah-extension/worker-runtime -- --output-style=static`.
- Result: `Successfully ran targets lint, test, typecheck for 2 projects`.
  - worker-runtime: 24 suites and 111 tests passed.
  - worker-host: 6 suites and 32 tests passed, in 34.3 s.
- An earlier run failed 3 spec cases. All three were wrong spec assumptions:
  - The connection case asserted the order in which handlers were called; only the reply order matters.
  - The fake engine sent `turnEnded` before `id-resolved`, the reverse of the engine's order.
  - The flood hook fired on every start, not only the first.
- Degradation audit (`tools/degradation-audit/check-degradation.ts`): no site is reported for `libs/backend/worker-host` or `libs/backend/worker-runtime`. The one new swallow, in `SessionDriver.interrupted`, carries a `degradation-audit: reported` marker.
