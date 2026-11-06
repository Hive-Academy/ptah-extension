# Independent review of Phase D fixes

**Score: 5/10. Verdict: CHANGES REQUESTED.**

Scope: `9ef234807` (Batch 20) and `e8d5a89b9` (Batch 21). Read-only source review; no tests or sockets run. The orchestrator reports worker-protocol 186, worker-runtime 127, and worker-host 43 passing tests. Paths below are relative to the repository root. `D` means `libs/backend/worker-runtime/src/lib/session-driver.ts`, `R` means `libs/backend/worker-host/src/lib/commands/remote-sessions.ts`, `C` means `libs/backend/worker-runtime/src/lib/connection.ts`, `S` means `libs/backend/worker-host/src/lib/commands/serve.ts`.

## Plan items

| Item | Status | Evidence |
| --- | --- | --- |
| 20.1 | FIXED | `D:168-177,414-451` marks early terminal events and ends after registration; `session-driver.spec.ts:239-291` covers start and continue. |
| 20.2 | PARTIAL | `D:282-305,438-447,454-460` retains unresolved starts and aborts failed registration, but an ID that never arrives leaves an unabortable orphan; `D:366-372` reports it, then `R:528-531` releases all locks during shutdown. See finding 3. |
| 20.3 | FIXED | `D:328-334,485-494` checks `chat:abort` success; `R:406-411` refuses stop on failed abort; `session-driver.spec.ts:292-303` covers it. |
| 20.4 | PARTIAL | `R:462-484` holds tab-only requests and binds them on resolution; `R:386-388` discards them when `start` times out although `D:282-290` keeps the orphan for later resolution. See finding 4. |
| 20.5 | PARTIAL | `worker-service.ts:189-204` closes the listener before drain/logs/locks; `D:355-372` includes pending admissions. But `R:516-531` releases locks even if abort failed. See finding 3. |
| 20.6 | FIXED | `D:225-245,414-437` buffers continue events until baseline and turn begin; `session-driver.spec.ts:259-291` exercises order. |
| 20.7 | FIXED | `D:496-505` bounds and marks overflow without throwing in the push tap; `session-driver.spec.ts:304-326` covers refusal. |
| 20.8 | FIXED | `C:49-60,99-128` lets stop and permission responses run around the serial receive chain; `connection.spec.ts:220-282` exercises pending start. |
| 20.9 | FIXED | `D:463-482` clears the resolution timer on resolve/reject; RPC failure occurs before `sessionOf` creates one (`D:265-284`). |
| 20.10 | NOT FIXED | No item 20.10 exists in `phase-d-fix-plan.md:11-26`; the plan ends Batch 20 at 20.9. There is no requirement to confirm. |
| 21.1 | FIXED | `S:142-157,316-326` reads and refuses persisted auto-approving settings at startup and per turn; `pending-permissions.ts:25-45` names yolo/auto-edit. `pending-permissions.spec.ts:18-31` covers levels. |
| 21.2 | PARTIAL | `admin-handlers.ts:127-143`, `worker-service.ts:119-139` refresh grants and close known token connections; `C:334-355` allows an auth-in-progress to become a live client after the close scan. See finding 2. |
| 21.3 | FIXED | `token-store.ts:60-84,123-143,164-175` runs issue/grant mutations under lock with reload; `token-store.spec.ts:44-83` exercises two instances. |
| 21.4 | PARTIAL | `file-lock.ts:83-95,118-145` preserves operation outcome and steals dead-owner locks, but also steals after 60 seconds from a live owner. See finding 1. |
| 21.5 | FIXED | `workspace.ts:31-46` sends mutations to live admin RPC and only falls back for a stopped service; `admin-handlers.ts:145-157` mutates the live registry. |
| 21.6 | FIXED | `worker-server.ts:65-72` caps tracked WS connections; `C:99-128,216-227` caps receive work. `worker-server.spec.ts:108` and `connection.spec.ts:324-376` cover both. |
| 21.7 | PARTIAL | `status.ts:47-68` checks endpoint PID/user, `admin-client.ts:35-52` checks hello machine ID before sending the key. The machine ID is disclosed in unauthenticated hello (`C:289-293`); PID liveness does not bind the listener to that PID. See finding 5. |
| 21.8 | FIXED | `admin-handlers.ts:87-187` isolates admin routing and validates with `parseParams`; `atomic-file.ts` is shared by token/registry/endpoint writes (`token-store.ts:172`, `workspace-registry.ts:112`, `worker-service.ts:104`). |
| 21.9 | PARTIAL | `token-store.ts:146-161` updates once per minute and `C:342-346` invokes it on auth; the timestamp is set before the write and is not reset on failure, so a failed write suppresses retries for a minute. See finding 6. |

## New findings

1. **High — A live lock can be stolen and both processes can write concurrently.** `libs/backend/worker-runtime/src/lib/file-lock.ts:141-145` treats any other PID's lock older than 60 seconds as abandoned even when `processState` says it is alive. A slow or paused operation can therefore have its lock renamed away at `:119-133`; the second process acquires it while the first still runs, and the first can later remove the second process's lock at `:89-90`. `file-lock.spec.ts:87-95` only checks a fresh live lock. **Fix:** record process start identity (or a unique owner nonce with a live lease) to distinguish PID reuse, never use age alone to override confirmed liveness, and remove a lock only if its owner nonce still matches.

2. **High — Revocation misses a connection paused in authentication.** `libs/backend/worker-runtime/src/lib/connection.ts:334-355` gets an unrevoked token, awaits `recordUse`, then assigns `tokenId` and enters `client`. While it awaits, `worker-service.ts:119-130` skips this connection because `authenticatedTokenId` is still null. The auth reply then succeeds with the revoked token and the connection stays usable. Grant addition has the same snapshot problem: `worker-service.ts:135-139` skips the connection and `C:349` installs the old grant. **Fix:** after the await, revalidate token state and use the latest grant before entering `client`, or register an in-progress token identity that revocation/refresh can reach. Add a race spec with a deferred `recordUse`.

3. **High — Shutdown releases a driver lock after a refused abort.** `libs/backend/worker-runtime/src/lib/session-driver.ts:364-370` records failed `chat:abort`; `libs/backend/worker-host/src/lib/commands/remote-sessions.ts:516-531` logs that failure but still releases every held lock. `worker-service.ts:195-202` then closes logs and invokes that release. If the engine turn continues or shutdown stalls, another driver may acquire the lock while it is active. **Fix:** retain locks for failed aborts until the engine confirms termination, or force the engine to stop and verify it before release. Cover the refused-abort shutdown path; the current `session-driver.spec.ts:327-365` checks successful drain only.

4. **Moderate — A late-resolved start loses its pending permission request.** `R:462-467` holds a tab-only request during admission, while `D:282-290` keeps a timed-out start as an orphan for later `session:id-resolved`. Yet `R:386-388` deletes held permissions when `start` returns, before `R:475-484` can bind them. The prompt cannot then be answered remotely. **Fix:** keep held requests until resolution or confirmed abort/cleanup; add a spec where resolution arrives after start timeout.

5. **Moderate — The admin identity check does not authenticate the listener.** `libs/backend/worker-host/src/lib/commands/status.ts:62-68` proves only that the endpoint PID is alive and owned by this user; `admin-client.ts:42-52` compares a machine ID. Any local process that can bind the known worker port after a crash can answer `hello` with the same ID, which the real worker discloses pre-auth at `C:289-293`, and receive the admin key. `admin-client.spec.ts:80-118` tests a *different* machine ID and a dead PID, not a replacement listener with a reused/live PID and the same ID. **Fix:** challenge-response with the admin key (send a nonce, receive HMAC) before sending the reusable key, or use a peer-credential-bound local channel.

6. **Low — A failed `lastUsedAt` write delays the next attempt for a minute.** `libs/backend/worker-runtime/src/lib/token-store.ts:150-161` sets `lastRecorded` before `mutate` and does not roll it back when the file lock or atomic write fails. `C:342-346` catches the error and still authenticates. **Fix:** set the debounce timestamp only after a successful write, and test a failed write followed by a retry.

The stated passing test totals are accepted as orchestration evidence. This review did not run tests, Nx, verify, or a listener.
