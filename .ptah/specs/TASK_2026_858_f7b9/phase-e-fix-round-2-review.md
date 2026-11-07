# Phase E fix round 2 review

## Verdict

APPROVED, 8/10. N1, N2, N3, N5, N7 and N8 are resolved. N4 and N6 are deferred to Phase F, as agreed. No Blocking or Serious finding is open. The Moderate and Minor items below cannot leak a token or lose persisted data.

## Finding status

| id | status | evidence | spec proves it |
| --- | --- | --- | --- |
| N1 | RESOLVED | `machine-connection.ts:76-79` starts a token without a worker id as `unpaired`. `connect()` at `:224-229` returns before any client, timer or token use. `retry()` at `:252` goes through `connect()`. The timer callback at `:195-198` also goes through `connect()`. In `open()`, the hello identity check at `:49-56` precedes `auth` at `:59`. `exchange()` sends only the pairing code. Pair success at `machines-service.ts` sets the worker id before the token. The pair rollback path also sets the worker id before `setToken` and `connect`. `WorkerClient` never reads the token. | Yes: `does not send a token without a stored worker identity` asserts that `createClient` and `setTimer` are never called. It fails without the guard. |
| N2 | RESOLVED | `machines-service.ts:250-293`. Revoke is bounded at 5 s and non-fatal. The token is deleted first, then the registry is written, then the connection is disposed in `finally`. If the token delete fails, the entry and token stay, no connection is live, and `list()` recreates a connection (`:129-135`). The token has already been revoked or the worker is unreachable, so a revoked token ends in 4401 and `onTokenRejected`. Removal can be retried because `remove()` needs no live connection. If the registry write fails after the token delete, the entry stays without a token. It comes back as `unpaired` and can be removed again. There is no live connection with a deleted token, no orphaned token without an entry, and no unremovable entry. | Yes: `keeps the registry entry if token deletion fails` and `leaves an unpaired entry if registry writing fails after token deletion`. |
| N3 | RESOLVED | `machine-connection.ts:387-405` sets `seq: afterSeq` on every explicit attach, so the explicit value is forwarded to `session.attach`. The post-attach `Math.max` keeps the cursor from moving back. Auto-reconnect at `:281-290` uses `cursor.seq`. The `event()` dedupe at `:205` is unchanged. | Yes: `reattaches after reconnect and replays from an explicit lower cursor`. |
| N5 | RESOLVED | `machine-registry.ts:39-47` checks `stat.size` before `readFile` and keeps the post-read check. | Yes: the `caps registry input` spec asserts that `readFile` is not called for an oversized file. |
| N7 | RESOLVED | `machines-rpc.handlers.ts:51-61` logs a redacted message. The user receives fixed text with code `MACHINE_UNREACHABLE`. The shared union has no generic internal code. | Yes: `logs an unknown machine error while returning fixed user text`. |
| N8 | RESOLVED | `machine-connection.ts:326-331` rejects `exchange()` while connecting or reconnecting. The service blocks pairing when the state is `connected`. `open()` sets `connected` only after the attach loop, and `closed()` reschedules on close, so `connected` with a closed client does not persist. | Yes: `rejects pairing while connect is in flight without replacing its client`. |
| N4, N6 | DEFERRED to Phase F | Not reviewed. | n/a |

## New findings

1. Minor. `machine-connection.ts:326-345` and `machines-service.ts:297-300`. `retry()` is not serialized with `pair()`, and `exchange()` checks the in-progress state only on entry. A manual retry during an exchange can replace `this.client` and `this.transport`. The exchange `finally` then destroys the retry's transport. Outcome: the retry fails and `schedule()` reconnects. The identity check holds, so no token leaks. Fix: also reject `retry()` and `connect()` while an exchange is active, or serialize `retry`.
2. Minor. `machine-connection.ts:345`. `await client.connect()` sits outside the `try` in `exchange()`. A connect failure leaves the client and transport unclosed until the worker closes them. Fix: move the call inside the `try`.
3. Minor. `machine-connection.ts:387-405`. If an explicit re-attach of a tracked session fails, `sessions.delete` drops the existing cursor. Auto-reconnect no longer re-attaches that session. This is the same area as the deferred N6, which tracks the missing visible reason. Fold it into Phase F.
4. Minor. `machines-service.ts` pair path. A legacy token without a worker id is overwritten by the re-pair, but the old token is not revoked on the worker. It is orphaned on the worker side only.

## Review family

Implementer: Codex. Reviewer: Claude.
