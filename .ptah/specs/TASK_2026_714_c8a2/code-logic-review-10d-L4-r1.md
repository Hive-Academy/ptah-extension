# Code Logic Re-review - 10d.L4 revision 1

Verdict: REVISE (one MAJOR; no BLOCKER). Score 7.5/10 (unchanged: the four minors are mostly fixed, but the require-idle fix does not produce Claude's typed refusal).
Read-only review; no tests, typecheck or verify run. Read: codex-chat-peer-queue.ts and .spec.ts in full, the diffs of codex-chat-adapter.ts and codex-chat-turn-stream.ts, the adapter spec at 360-376 and 405-456, codex-chat-session-controls.ts 85-150, codex-chat-admission.ts, and the Claude pump, control and spawner code.

## MAJOR

M1. require-idle refusal is not the same error type as Claude's (minor 1 only partly fixed).
- Codex: codex-chat-adapter.ts:588-590 throws `CodexChatAdapterError('busy','turn')`.
- Claude: session-stream-pump.service.ts:236-250 and 298-316 throw `SessionAdmissionRefusedError('busy'|'session-ended')`. Its doc comment (session-admission-refused.error.ts) tells callers to `instanceof`-check it.
- Consumers branch on that type and nothing in the Codex path converts it:
  - session-spawner.service.ts:1519-1535 `sendFailure` maps only `SessionAdmissionRefusedError` to `reason: 'busy'`. A Codex child therefore reports `delivery-failed` with a raw error message on an `if-idle` send. The docstring promises the 'busy' reason and "nothing was queued".
  - surface-submit-turn.service.ts:386-397 `classifySendFailure` treats any other error as `indeterminate`. The host then never redispatches. A Claude busy refusal is a known `rejected('busy')`.
- The refusal itself is correct: nothing is queued, and it checks both `session.busy` and `peerQueue.hasPending`. Callers still see the wrong classification.
- A `session-ended` equivalent is also missing. A closing or aborted session gets `unavailable` from `peerQueue.send` (peer-queue.ts:27), not a `session-ended` refusal.
- Fix: throw `SessionAdmissionRefusedError('busy', id)` at adapter.ts:588-590, and `('session-ended', id)` for a missing, closing or aborted session on the require-idle path. Add a spec assertion on `instanceof`. If Codex children are meant to stay on `CodexChatAdapterError`, translate it in the spawner and surface-submit classifiers instead.

## Checks on the four minors and the re-check list

1. require-idle: refuses without enqueuing, as in Claude (check-before-push), but with the wrong type (see M1). The spec at adapter.spec 410-453 covers a running turn, a queued peer and a reserved idle session. Fixed in behaviour, not in contract.
2. Start-race retry (peer-queue.ts:90-104): correct.
   - A `busy`/`turn` rejection puts the same entry back at the head, so nothing is duplicated or reordered. The original promise is kept and `idle` is reset.
   - `startNext` returns while `session.busy`, so there is no spin. It re-runs only on the competing turn's `onIdle`. The retry is gated on `busy`, which only a real latch holder can set, so it is not an unbounded loop.
   - Stale-idle case: an `onIdle` during the failed attempt makes the retry start immediately, because `busy` is already false. A stale `idle=true` on an entry that then succeeds just calls `finish`, and `startNext` is guarded by `busy`. No two concurrent turns result.
   - Specs peer-queue.spec 14-69 cover FIFO, no duplicate and the stale-idle case.
   - Residual, MINOR: the turn-stream.ts:117 busy check inside the generator is a second window after the synchronous check at adapter.ts:540. It was already there and is not made worse. If a competing turn wins there, the error surfaces through the broadcaster, not the admission path, so admission may not reject. That is outside this change.
3. Stop semantics: matches Claude. The Claude evidence is real. session-control.service.ts:88-158 interrupts the query and releases the turn claim, and the held queue entry survives. session-control.service.spec.ts:130-148 asserts `messageQueue` still equals `[held]`.
   - Codex: `blocked` keeps `startNext` parked (peer-queue.ts:75). The `release` in turn-stream.ts:437-445 clears `blocked` before `onIdle`, so queued peers start after release.
   - A refused interrupt closes the context through `adapter.close`, which calls `rejectPending`. Every close path goes through `this.close` (adapter.ts:164,206,550,642), so no queued item is left hanging.
4. Spec pinning: adapter.spec 370-373 asserts `source:'complete'`, `role:'user'` and `inboundPeer:{label:'Codex lane'}`. turn-stream.ts:257-269 emits exactly those. Fixed.

Re-checks:
- No two concurrent turns: `active` ownership lasts until admission and idle. `startNext` is guarded by `active` and `busy`, and `turn()` re-checks `busy`. OK.
- Close and dispose: `rejectPending` rejects the unadmitted active entry and all queued entries with coded `unavailable` (not a raw error). It logs each with a real `Error` via `logger.error`. It clears both maps, which also avoids leaking session keys. A later `.then` of an orphaned `run` is ignored by the `active !== entry` guard. OK.
- Bound: `pending + active <= 32` (peer-queue.ts:29-32). Retry moves the entry between `active` and `queued` without changing the count. OK.
- Rule scan: no `any`, `as unknown as`, `@ts-` or `eslint-disable` in the new files (grep). No empty catch. The failure path wraps non-coded errors in `CodexChatAdapterError` with `cause`.

## MINOR
- peer-queue.ts:60 (logger line) and :27 (single-line `if` with no braces) exceed the usual width and style. Route to the style reviewer.
- adapter.ts:599-600: a non-peer send is refused with `busy` while a peer is pending. Claude would hold it in `messageQueue`. This is an existing divergence from the original L4 and is not worsened.
- Rejecting every queued peer at error level on close may be noisy. This is acceptable because it is coded and logged.
- No spec asserts the Stop-then-refused-interrupt close path rejecting a queued peer end to end. The adapter spec covers close rejection only.
