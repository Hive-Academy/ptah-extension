# PR 962 CodeRabbit round 1 — fix commit re-review (e437a801c)

## Verdict

APPROVED, 8/10. No Blocking or Serious finding is open. No open Moderate finding can leak a token, deadlock or lose data. The three Moderate findings and one Minor finding below are follow-ups. I read the diff and the full `machines-service.ts`, and the changed regions of `machine-connection.ts` and `machine-registry.ts`. I did not run builds or tests, as instructed. "Fails without the fix" below is judged from the code, not from running the specs without the fix.

## Item status

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Registry write caps | RESOLVED | `machine-registry.ts` `write()` checks the count first (`MAX_MACHINES`), then serializes and checks `Buffer.byteLength` against `MAX_REGISTRY_BYTES`. Both checks run before `read()`, the temp-file `open` and the rename, so the existing file is never touched. `machine-registry.spec.ts` (+36 lines) covers it. The size spec fails without the fix, because the old code wrote the file and only `read()` later refused it. The count spec would still throw (zod `.max`) but as a ZodError, not the new typed error. |
| 2 | Token read failure in `list()` | RESOLVED | `machines-service.ts:86-96`. A throwing or non-string `tokens.get` is caught, the token stays `undefined`, and the connection is created unpaired. The log line has the machineId and `error.message` only, never the token value. A non-string value is never interpolated. The "keeps listing other machines" spec fails without the fix, because the old code let the rejection abort `list()`. |
| 3 | `retry()` on a connected machine | RESOLVED | `machine-connection.ts:416` returns early when `exchanging` or `state === 'connected'`, before `state` and `attempts` are reset. `connect()` (line 232) has the same guard. |
| 4 | Pairing and connect mutual exclusion; ownership of the transport at cleanup | RESOLVED | `exchanging` is set at `machine-connection.ts:~391` and cleared in `.finally`. It is registered before the caller's await, so it is cleared before the caller resumes. `connect()` and `retry()` return early while it is set. `exchange()` rejects while `connecting`, `reconnecting`, `connected` or `exchanging`. In the `finally`, transport and client are destroyed and cleared only if `this.client === client`. The service-level `pairing` Set rejects a second `pair` or `pairViaSsh` for the same machine (`machines-service.ts:185, 62`). |
| 5 | Identity mismatch revokes the issued token | RESOLVED | The `validate` callback in `pairLocked` (`machines-service.ts:214-250`) runs inside `exchange`, before `tokens.set`, `registry.write` or `setToken`. It revokes on the pairing client with a 5 s race and the timer is cleared. The revoke loser of `Promise.race` has its rejection handled by the race. The error log carries no token. The existing connection and credential are untouched, because `connected` is rejected earlier and nothing is written. The new token is sent only to the endpoint that issued it, so the invariant "no token sent before hello matches the stored workerMachineId" still holds for the saved-pairing connect path. |
| 6 | Offline summary for a retryable first-connect failure | RESOLVED, see M3 | `machines-service.ts:~296-308`. The error is swallowed only when `state === 'offline'`, `nextRetryAt` is set and the error is not a non-retryable `WorkerClientError`. Auth and pairing errors still reject. |
| 7 | `pairViaSsh` preconditions and serialization | RESOLVED | The entry and `connected` checks run at `machines-service.ts:~329-339`, before `sshCommand`. The whole body runs inside `serialize` and under the `pairing` Set. It calls `pairLocked` directly, not `pair()`, so there is no re-entrant queue wait and no deadlock. The Set is added before and removed in `finally` around the queued work, so a failed call cannot leave the lock set. |
| 8 | `add` accepts any valid alias | RESOLVED | The `sshAliases` membership check is removed (`machines-service.ts:165-180`). `validateSshAlias(alias)` runs first, and the registry `write` re-validates. |

## Earlier invariants

- Removal order revoke, then delete token, then write registry, with dispose in `finally`: unchanged (`machines-service.ts` `remove`).
- Explicit `afterSeq` resets the cursor: `attach` is unchanged.
- No 'connected' state with a closed client: the `exchange` cleanup now clears `this.client` and `this.transport` only when it owns them, so a live client is never destroyed by pairing.
- One backoff step per failure and one timer per machine: `retry()` and `connect()` now return early in more cases and add no timers. `exchange` calls `cancelTimer()`.
- Callers: `phase-4-handlers.ts:222` builds `MachinesService` with the same option shape. The new `logger` option is optional. `wire-runtime.ts:343-350` still calls `list()` and `retry()` with unchanged signatures.

## New findings

1. **Moderate** — `libs/backend/remote-machines/src/lib/machines-rpc.handlers.ts:29-60` (`mapMachineError`). `MachineRegistryWriteError` (`machine-registry.ts`) is not mapped. `machines:add` at the cap, or a registry over 256 KiB, reaches the generic fallthrough: a `console.error` and an opaque error to the renderer, and the "Remove machines or shorten names" guidance never reaches the user. It is not a silent failure, because the write is refused. Fix: map `MachineRegistryWriteError` to a coded RPC error, or wrap it as `MachineServiceError` in `add`.
2. **Moderate** — `machines-service.ts:~329-345` (`pairViaSsh`). The serialized queue is held across the ssh command (15 s timeout, `ssh-worker-commands.ts:87`) and the exchange. During that time `list`, `add` and `remove` for all machines wait. There is no deadlock and no data loss, because `dispose` is not queued and `pairLocked` is not re-entered. Cost: a UI stall of up to about 15 s plus the exchange. Acceptable for now; the exchange has no overall timeout of its own in this lib. Fix, if wanted: run the ssh command outside the queue, then queue only `pairLocked`.
3. **Moderate** — `machines-service.ts:~298-308` (item 6 filter). A non-`WorkerClientError` thrown by `connect()` (a programming error or a transport TypeError) while the state is offline with `nextRetryAt` set is treated as retryable and swallowed. The pairing is saved, and the offline summary is honest in that case. Fix: swallow only `WorkerClientError` with a retryable code, and rethrow everything else.
4. **Minor** — `machines-service.ts:86-96`. After a token read failure the connection is cached as unpaired for the process lifetime. If the keyring recovers, the machine stays unpaired until a restart or a re-pair. This matches the item 2 requirement. Consider one lazy re-read in `retry()`.

## Review family

Claude (Sonnet 5.5), the different family from the Codex implementer.
