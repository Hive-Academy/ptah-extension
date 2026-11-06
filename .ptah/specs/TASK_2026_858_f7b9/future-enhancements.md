# Future enhancements — Ptah remote workers (after Phase D)

Sources: `phase-d-fix-plan.md` "Deferred", `batch-20-report.md` and `batch-21-report.md` "Not
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
