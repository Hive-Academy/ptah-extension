# Phase E fix round 1 review - TASK_2026_858_f7b9

## Verdict

**REVISE - 7/10.** Every L and S item in scope is resolved or mostly resolved, and the worker-identity check (S1/S2) is correctly ordered before `auth`. Three Moderate defects remain, two of which meet the stated bar for REVISE (one can orphan a token at rest, one can lose replayed events). No Blocking or Serious finding is open. Scope: fix commit `dc3d5e425..63a580fb7` (libs/backend/remote-machines only), read in full for `machine-connection.ts`, `machines-service.ts` and the diffs of the other source files. Tests and builds were not re-run. Paths are under `libs/backend/remote-machines/src/lib/`.

## Finding status

| id | status | evidence | spec proves it |
| --- | --- | --- | --- |
| S1 | RESOLVED for entries that have `workerMachineId`; PARTIAL for entries without one (N1) | `machine-connection.ts:255-262` compares `hello.worker.machineId` before `auth` at `:265`; mismatch sets `unpaired` and throws `PAIRING_REJECTED` | Partly. `machine-connection.integration.spec.ts:60-76` uses a real worker and asserts `unpaired` and the reason, but not that the worker never saw `auth`. The state and reason would be the same if `auth` were sent first. No spec for an absent `workerMachineId`. |
| S2 | RESOLVED | `machines-service.ts:172-180` requires `grant.machineId === hello machineId` (returned by `exchange`, `machine-connection.ts:~337`) and the stored `workerMachineId`; the local registry key stays separate. Both ids arrive on one socket, so this proves consistency, not authenticity (see N1 note) | Yes. `machines-service.spec.ts:217` fails without the check: it asserts that `tokens.set` and `registry.write` are not called |
| S3 | RESOLVED | `ssh-worker-commands.ts:45-49` allowlist `^[A-Za-z0-9_./:@-]{1,256}$`. JS `$` does not accept a trailing newline. The only other remote arguments are the constant `WORKER_REMOTE_COMMAND`, the alias (validated, after `--`) and the TTL integer. The workspace list is not even populated by `pairViaSsh` | Yes. `ssh-worker-commands.spec.ts:174-184` runs the real function with `;`, `$()`, backtick, space and newline inputs, and asserts rejection |
| S4 | RESOLVED | `machines-rpc.handlers.ts:14-23,53` fixed text; `error.message` is no longer passed on | Yes (hostile detail asserted absent in `machines-rpc.handlers.spec.ts`) |
| S5 | RESOLVED | `ssh-stdio-transport.ts:55-57` no longer embeds the stream error message; stderr kept on a separate property | Yes (`ssh-stdio-transport.spec.ts`) |
| S7 | RESOLVED | `machine-connection.ts:85-88` `maxPayload: WORKER_LIMITS.maxPayloadBytes` | Partly. The spec checks the option passed to the factory, not that `ws` enforces it. Acceptable, since `ws` enforcement is library behaviour |
| S8 | RESOLVED (N5 for the ordering) | `machine-registry.ts:22,39-41` | Yes |
| S9 | RESOLVED | `machine-registry.ts:63` `randomUUID()` | No assertion, but `wx` creation already existed. Fine |
| L1 | RESOLVED | `machine-connection.ts:266-272` the failed attach is dropped and the connection stays connected | Yes (regressions spec L1 asserts `connected` and a single delay). Drop is silent, see N6 |
| L2 | RESOLVED | `machine-connection.ts:291-296` `closing` is set around `client.close()`. The real `WorkerClient.close()` reports `onClose` synchronously (`worker-client.ts:406-412,504-518`), so the flag covers it | Yes. The L2 spec expects delays 1/2/5/10/30/30 s, which fails with the old double increment |
| L3 | RESOLVED | `machines-service.ts:119-135` runs `list()` through `serialize`; `create` re-checks `disposed` after the token read (`:79-81`) | Yes (`machines-service.spec.ts:152`) |
| L4 | PARTIAL | `machines-service.ts:256-265` writes the registry, then deletes the token, with dispose in `finally`. The live connection is always disposed, so no live connection keeps a deleted token. A failed `tokens.delete` leaves the keyring token orphaned (N2). A failed registry write is safe, because the next connection that uses the revoked token gets a 4401 and removes it | Partly. `machines-service.spec.ts:189` proves dispose on a delete failure. No assertion of order, and none for an orphaned token |
| L5 | RESOLVED | `machines-rpc.handlers.ts:30-55` maps `MachineServiceError`, `SshWorkerCommandError` and `WorkerClientError` to fixed codes | Yes |
| L6 | RESOLVED, with a regression (N3) | `machine-connection.ts:194-217,363-379` the cursor is stored before the attach call and same-epoch duplicates are dropped | Yes. The spec delivers frame 7 twice and frame 6 during the attach, and expects a reconnect `afterSeq` of 7 |
| L7 | RESOLVED | `machine-connection.ts:100-130` generation captured in `socket()`, and in `makeClient` | Yes. The spec emits old-socket `close` and `error` after a new transport exists and asserts that no delay is added and the new transport is not destroyed |
| L8 | RESOLVED | `machine-connection.ts:218-230` returns the tracked promise unchanged; `this.disposed` checked after each await at `:243,249,266,273` | Yes. The spec checks the exact promise and no emit after dispose |
| L9 | RESOLVED | `machines-service.ts:166-170` rejects pairing while connected. `:190-202` revokes the new token if persistence fails | Yes |
| L10 | RESOLVED | `machines-service.ts:276-284` | Yes |
| L11 | RESOLVED | `machine-connection.ts:235-240` local version is set before `hello` | Yes |
| L12 | RESOLVED | `machine-connection.ts:165-177` clears the memory token and calls `onTokenRejected`, which deletes the keyring token; `retry()` then does not reconnect | Yes |
| L13 | RESOLVED | `machines-service.ts:91-100` both broadcasts have `.catch` | Yes |

## New findings

1. **Moderate - an entry with a token and no `workerMachineId` still receives the token with no identity check (S1 not fully closed).** `machine-connection.ts:255-258` only compares `if (this.workerMachineId && ...)`; with no stored id it falls through to `auth` at `:265`. Scenario: any registry entry paired before this commit (or a hand-edited registry that drops the field) is never bound, and `wire-runtime.ts:345-360` auto-retries it at every start. Fix: when the token exists but `workerMachineId` is absent, do not send the token. Set `unpaired` with a "re-pair this machine" reason. Alternatively bind from `hello` only after the user confirms. Add a spec for the absent case. Note: `machineId` in `hello` is not a secret, so a hostile host that already knows it can claim it. The check stops misrouting (changed alias, cloned or reinstalled worker), not a targeted impersonation. That limit is acceptable but should be stated in the docs.

2. **Moderate - an orphaned plaintext token after a failed removal.** `machines-service.ts:256-261`. Registry write succeeds, `tokens.delete` throws, the error goes to the user, and the registry entry is gone. A retry gets `MACHINE_NOT_FOUND_OR_FORBIDDEN`, so the keyring entry `remote-machine:<id>:token` can never be removed. When the machine was offline, the worker token was not revoked either. Fix: delete the token first and then write the registry. A failed delete leaves a retryable entry, and a failed registry write leaves an entry with no token (unpaired, safe). Or retry the delete once and, on failure, keep the entry marked for removal.

3. **Moderate - the L6 cursor drops legitimate replay on a re-attach with a lower `afterSeq`.** `machine-connection.ts:363-379` keeps `seq: Math.max(afterSeq, previous?.seq ?? 0)` and `event()` (`:201-203`) drops frames with `seq <= previous.seq` for the same epoch. If the renderer calls `machines:session.attach` again for a session that is already tracked (after a reload or a view reopen) with `afterSeq: 0`, the worker replays events 1..N, and every one of them is discarded. The renderer shows an empty transcript with no error. Fix: when the caller passes an explicit `afterSeq`, set the cursor to exactly `afterSeq` (reset on a new explicit attach), and apply `Math.max` only for the automatic reconnect re-attach. Add a spec for attach, receive N events, attach again with `afterSeq: 0`, and expect redelivery.

4. **Minor - a user cannot recover from a worker mismatch except by remove and re-add.** `machines-service.ts:172-175` rejects a pair when the stored `workerMachineId` differs, and the mismatch `reason` (`machine-connection.ts:256`) is never shown (deferred, Phase F). A legitimately reinstalled worker therefore shows only `unpaired`, and re-pairing fails with "Pairing returned a different worker". Fix: surface the reason in Phase F, and document remove and re-add. Consider an explicit "rebind" action.

5. **Minor - the registry size cap is checked after the whole file is read.** `machine-registry.ts:39-41` calls `readFile` first, then checks `byteLength`. A huge file is still fully loaded. Fix: `stat` first, or open a handle and read at most 256 KiB + 1 bytes.

6. **Minor - a dropped re-attach is silent.** `machine-connection.ts:266-272` removes the session on a failed attach and emits nothing, so the UI still believes the session is attached. Fix: emit an event or state change for the session, or surface it in the Phase F reason field.

7. **Minor - `mapMachineError` maps every unknown error to `MACHINE_UNREACHABLE` and logs nothing** (`machines-rpc.handlers.ts:55`). Internal bugs and `Error('Invalid workspace option')` appear as "unreachable". Fix: log the original error at the handler (the text must stay fixed), or add a generic internal code.

8. **Minor - `exchange()` and `pair()` are not guarded against an in-flight `connect()`** (`machine-connection.ts:324-335`). `exchange` replaces `this.client` and the generation while an `open()` on the old client may still finish and set `state='connected'` with a closed client. This needs a token plus a pair on a reconnecting machine, which is unlikely, but `pair` should wait for or reject while `state` is `reconnecting`.

Callers: `phase-4-handlers.ts:222-237` and `wire-runtime.ts:343-368` still match the lib API (`MachinesService` options unchanged, `list()` then per-machine `retry()` with a catch). `remote-machines` exports and typecheck pass per the orchestrator's run. The duplicate import of `MachineServiceError` and `MachinesService` from the same module in `machines-rpc.handlers.ts:14-15` is a style nit for the style reviewer.

## Deferred items

- **S6 renderer payload sanitising to Phase F: agree.** The payloads carry no token, and the fixed-text error mapping (S4) removed the worker-controlled error text. Remaining worker-supplied strings (display name, versions) must be sanitised when the Machines view renders them, which is Phase F.
- **`machines:state` reason field to Phase F: agree, with a condition.** It changes a shared contract on every host. Finding 4 depends on it, so keep it on the Phase F list.
- **S10 pairViaSsh read race: agree.** `pair` re-reads the registry inside `serialize` and only the code crosses over.
- **Cross-process registry lock: agree.** Atomic rename plus the schema check bounds the damage to a lost update in a single-user desktop app. Record it in future enhancements.
- **Loose existing directory permissions: agree.** The registry holds no secret, and the temp file is `0o600` (`wx`). Tokens are in the keyring or `ISecretStorage`.

## Review family

Implementer: Codex. Reviewer: Claude (different family).
