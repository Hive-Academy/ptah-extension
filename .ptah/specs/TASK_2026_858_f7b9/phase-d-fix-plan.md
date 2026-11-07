# Phase D review fix plan

Sources: `phase-d-code-logic-review.md` (Claude, 5/10), `phase-d-code-style-review.md` (Claude,
6.5/10), `phase-d-security-review.md` (Claude, 6.5/10), `phase-d-codex-review.md` (Codex, 5/10).
Codex findings 1-5 match logic review serious 1, 2, 3, 6 and the ignored `chat:abort` result.

Two batches, sequential (both edit `serve.ts`). Implementer: Claude `backend-developer`.
Reviewer: Codex (different family). The orchestrator runs every verify:
`npm run verify -- -p @ptah-extension/worker-host,@ptah-extension/worker-runtime`.

## Batch 20 (Phase D fix; report `phase-d-fix-20-report.md`) — turn lifecycle (remote-sessions.ts, session-driver.ts, connection.ts, serve.ts shutdown)

| #    | Finding                                                                                                    | Source                  |
| ---- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| 20.1 | Terminal event before the turn is registered keeps the slot and lock (start and continue)                  | Codex 1, logic S1       |
| 20.2 | `session.start` resolve timeout / log-open failure abandons an admitted engine turn and its lock           | Codex 2, logic S2       |
| 20.3 | `abort()` ignores the `chat:abort` result; `session.stop` reports success, frees the slot                  | Codex 3, logic moderate |
| 20.4 | Permission request before session resolution cannot be answered; bind by tab on resolve                    | Codex 4, logic S6       |
| 20.5 | Shutdown: stop accepting calls and close the listener first, include pending starts, then logs, then locks | Codex 5, logic S3       |
| 20.6 | On `continue`, events can reach the log before `worker:baseline` / `worker:turn.begin`                     | logic moderate          |
| 20.7 | Early-event queue overflow throws inside the synchronous push tap                                          | logic moderate          |
| 20.8 | Serialized per-connection requests: a 30 s start blocks `session.stop` / `permission.respond`              | logic moderate          |
| 20.9 | Orphaned 30 s resolve timer when `start` fails earlier                                                     | logic moderate          |

Each item needs a regression spec (delayed or missing `session:id-resolved`, end during start and
continue, failed abort, tab-only permission request, shutdown with a pending start).

## Batch 21 (Phase D fix; report `phase-d-fix-21-report.md`) — security and stores (serve.ts admin, token-store, file-lock, connection, worker-server)

| #    | Finding                                                                                                                                | Source                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 21.1 | Persisted `autopilot.permissionLevel` (`yolo`, `auto-edit`) bypasses the auto-approve refusal                                          | security H1           |
| 21.2 | Revocation and grant changes do not reach live connections; add operator `grants revoke <tokenId>`                                     | security H2, logic    |
| 21.3 | Token store: `issue()` and `grants add` write without the lock and from stale memory                                                   | security M6, logic S5 |
| 21.4 | `withFileLock`: steal a lock whose owner process is dead; keep the operation result over `rmdir` errors                                | security M7, logic S4 |
| 21.5 | `workspace add/remove` must reach the running service (admin RPC when it runs)                                                         | security M8           |
| 21.6 | Connection cap and bounded receive queue                                                                                               | security M4           |
| 21.7 | Admin client trusts any listener on the `endpoint.json` port; verify the worker identity first                                         | security M3           |
| 21.8 | Split the `serve.ts` admin closure into a focused module; one shared atomic-write helper; admin params through `WORKER_METHOD_SCHEMAS` | style S1, S2          |
| 21.9 | `lastUsedAt` never updated                                                                                                             | logic moderate        |

## Deferred to follow-ups (record in `future-enhancements.md`, no change in Phase D)

- Security L9-L15 and Info 16-18 (redaction breadth and gaps, keytar HKDF fallback, systemd
  hardening directives, directory ownership checks, session index refresh cost, unbounded event
  logs, predictable temp names, pre-auth `hello` disclosure, bookkeeping maps, pairing default scope).
- Security M5 pairing-window burn by a local process (document; per-window global backoff later).
- Style S3 `as unknown as RpcSpec` casts, S4 Electron wiring duplication, minors M1-M6.
- `queued: true` not reported; `CODEX_UNAVAILABLE` → `INTERNAL`; full rpc-handlers barrel import
  (no narrower entry exists); all session logs opened at startup; no subscriber back-pressure.
