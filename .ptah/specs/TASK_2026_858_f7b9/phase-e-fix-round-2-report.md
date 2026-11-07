# Phase E fix round 2

## Fixes

- **N1:** A token without a stored worker identity starts unpaired; `connect()` never opens a client, sends a token, or schedules a retry. Internal reason asks for re-pairing. `machine-connection.ts:76,222`; spec: `does not send a token without a stored worker identity`.
- **N2:** Removal revokes online with its existing five-second limit, deletes the credential, then writes the registry; connection disposal remains in `finally`. Either persistence failure becomes a typed `MachineServiceError`. Failed credential deletion leaves the entry for retry; failed registry writing leaves an entry without a token. `machines-service.ts:250-293`; specs: `keeps the registry entry if token deletion fails`, `leaves an unpaired entry if registry writing fails after token deletion`. The existing order assertion was updated.
- **N3:** Each explicit attach resets its cursor to the caller's `afterSeq`, allowing lower-cursor replay. Automatic reconnect still uses the last delivered cursor. `machine-connection.ts:387-405`; spec: `reattaches after reconnect and replays from an explicit lower cursor`.
- **N5:** Registry `stat` checks the 256 KiB cap before `readFile`, retaining the post-read check for file growth between operations. `machine-registry.ts:39-47`; spec: `caps registry input and machine count` now asserts `readFile` is not called for an oversized file.
- **N7:** Unknown errors log a credential-redacted message while RPC users receive fixed text. The shared `RpcUserErrorCode` has no generic internal code, so the fallback remains `MACHINE_UNREACHABLE`. `machines-rpc.handlers.ts:51-61`; spec: `logs an unknown machine error while returning fixed user text`.
- **N8:** Pairing rejects a pending/reconnecting connection with a clear error before replacing its client. `machine-connection.ts:326-331`; spec: `rejects pairing while connect is in flight without replacing its client`.

## Deferred

- **N4 (Phase F):** Rebind flow and visible mismatch reason.
- **N6 (Phase F):** Visible reason for a dropped session re-attach.

## Verification

- Initial command: `npm run verify -- -p @ptah-extension/remote-machines -- --output-style=static > /tmp/p-e-fix2-lane.log 2>&1; echo exit=$?` returned `exit=1`: test mock typing and two fixture/assertion issues. Corrected those and reran the same scoped command.
- Final command returned `exit=0`. Filter: `grep -E "Running target|Tests:|Failed tasks|Successfully ran|error" /tmp/p-e-fix2-lane.log | head -30`.
- Result lines: `Successfully ran targets lint, typecheck for project @ptah-extension/remote-machines`; `Tests: 63 passed, 63 total`; `Successfully ran target test for project @ptah-extension/remote-machines`. No `Failed tasks` line.
- Prettier was run on all eight changed TypeScript files. No build, application target, other project, or git write was run.
- The untracked `phase-e-fix-round-1-review.md` was present before this round and was not changed.
