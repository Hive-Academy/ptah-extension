# Future enhancements — Ptah remote workers (after Phase D)

Sources: `phase-d-fix-plan.md` "Deferred", `phase-d-fix-20-report.md` and `phase-d-fix-21-report.md` "Not
done", and the Phase D reviews. Priority: P1 = before the fleet rollout (Phase F), P2 = before
the mobile PWA, P3 = later.

## P1 — before the fleet rollout

| Item | Source |
| --- | --- |
| A turn whose `session:id-resolved` never arrives cannot be aborted (`chat:abort` needs a session ID); its slot stays held until restart. Needs an engine abort by tab ID. | batch 20 |
| Shutdown waits with no timeout on an admission stuck inside an in-process RPC. Add a bounded drain. | batch 20 |
| Admin key: no challenge-response and no rotation. A local process with a reused PID that answers `hello` with the host-derived machine ID passes the identity check. | batch 21, security 3 |
| Pairing window can be burned by a local process (the attempt counter is global, the backoff is per connection). Add a per-window backoff, or document the risk. | security 5 |
| systemd unit hardening (`NoNewPrivileges`, `ProtectSystem`, `PrivateTmp`, `UMask=0077`). | security 11 |
| Verify owner and mode of `~/.ptah/worker` and its files at start. | security 12 |
| Jest "worker process has failed to exit gracefully" warning in worker-runtime and worker-host runs; find the open handle. | batch 21 |

## P2 — before the mobile PWA

| Item | Source |
| --- | --- |
| `session.continue` result `queued: true` is not reported (the driver does not expose it). | batch 19.2 |
| `session.stop` on a turn still in admission returns `{ stopped: false }`. | batch 20 |
| An end event before `session:id-resolved` during a start is not recognized (not expected from the engine). | batch 20 |
| No subscriber back-pressure in the fan-out. | logic review |
| All session logs open at start and are never evicted; one corrupt log stops the worker. Event logs grow without bound and are read in full on open. | logic review, security 14 |
| Session index keeps cached entries for a removed workspace (no access). Session index refresh on an unknown ID re-lists every granted workspace. | batch 21, security 13 |
| `admin.grants.remove` (remove one workspace from a grant). | batch 21 |

## P3 — later

| Item | Source |
| --- | --- |
| `redact.ts`: wire it at more log sites; mask bare 8-char pairing codes; handle `code` keys without hiding error codes. | security 9 |
| keytar fallback derives the master key from `username:hostname` (same as the CLI). | security 10 |
| Pre-auth `hello` discloses host name, machine ID and version. | security 16 |
| Unbounded bookkeeping maps; pairing grants every registered workspace by default. | security 17, 18 |
| `CODEX_UNAVAILABLE` maps to wire `INTERNAL` (W12 fallback). | batch 18 |
| worker-runtime imports the full `@ptah-extension/rpc-handlers` barrel; add a secondary entry point. | style M5 |
| `as unknown as RpcSpec<…>` casts over `IN_PROCESS_SPECS`; type the table. | style S3 |
| `build-worker-host` copies the banner and externals of sibling targets; `validate-deps` keeps a second hand list. | style S4 |
| `serve.ts` still 380 lines; extract the readiness probe. Style minors M1–M6. | batch 21, style |
| Batch 14 state-store specs are thin. | handoff |

## Phase E follow-ups (added 2026-11-06)

| Item | Source |
| --- | --- |
| Phase F: add an optional safe `reason` to the shared `machines:state` payload and show it. It covers a different worker on the alias, "re-pair this machine" and a dropped session re-attach. | fix round 1 clarification; re-review N4, N6 |
| Phase F: a rebind flow for a reinstalled worker. Today the user must remove the machine and add it again. | re-review N4 |
| Phase F: sanitize the worker-supplied strings in `machines:event` payloads, display names and versions when the Machines view renders them. | security S6 |
| Shared `RpcUserErrorCode` has no generic internal code. Unknown machine errors map to `MACHINE_UNREACHABLE` (logged). | round 2 N7 |
| Cross-process lock for `~/.ptah/remote-machines.json` (two Ptah processes can lose an update). | security S9, re-review |
| `phase-2-libraries.config-home.spec.ts` walks above its `mkdtemp` folder. A stray `/tmp/.ptah` makes it fail. Bound the walk-up in the spec. | batch-22-report.md |
| `MachineConnection`: serialize `retry()` with `pair()`/`exchange()`. A manual retry during an exchange can lose its transport (`machine-connection.ts:326-345`). | round 2 review, Minor 1 |
| `exchange()`: move `await client.connect()` inside the `try` so a failed connect closes the client and the transport (`machine-connection.ts:345`). | round 2 review, Minor 2 |
| A failed explicit re-attach drops the tracked cursor, so auto-reconnect no longer re-attaches that session (`machine-connection.ts:387-405`). Fold into the Phase F reason work. | round 2 review, Minor 3 |
| A re-pair over a legacy token without a worker ID does not revoke the old token on the worker. | round 2 review, Minor 4 |
