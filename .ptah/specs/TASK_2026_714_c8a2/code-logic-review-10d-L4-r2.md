# Code Logic Review (re-review r2) - 10d-L4 (native Codex peer queue + require-idle admission)

Score: 9/10. Verdict: APPROVED. BLOCKER: 0. MAJOR: 0. MINOR: 2.

Scope: `git diff` of codex-chat-adapter.ts, codex-chat-turn-stream.ts and codex-chat-adapter.spec.ts, plus the untracked codex-chat-peer-queue.ts and its spec. I read the Claude pump (session-stream-pump.service.ts:224-317), the error class, both callers, and the routing adapter. I did not run any tests (the hard rules forbid it), so spec results are by reading only.

## Prior MAJOR: fixed

- **Error type.** codex-chat-adapter.ts:591-593, 620-622 and codex-chat-peer-queue.ts:32, 36, 40, 73, 127 all throw `SessionAdmissionRefusedError`, not `CodexChatAdapterError('busy')`. It is the same class as Claude's. `SdkError` is the base class. `cause` is passed through the third `ErrorOptions` argument.
- **Reasons and mapping match the pump.**
  - A missing, closing or aborted session gives `session-ended`. Pump: 238-243, 299-310.
  - A turn in flight, blocked, or a message queued gives `busy`. Pump: 311-315. The Codex `blocked` and `hasPending` conditions are the natural analogues of the pump's `turnInFlight` and `messageQueue.length`.
  - The reason is a closed union (`'busy' | 'session-ended'`), as in session-admission-refused.error.ts:18.
- **Both callers classify a Codex refusal like a Claude one.**
  - session-spawner.service.ts:1520 and surface-submit-turn.service.ts:389 use `instanceof SessionAdmissionRefusedError` on `error.reason`. Neither depends on which adapter threw.
  - The path is a pure passthrough: `routing-agent-adapter.ts:127-131` delegates directly to the adapter and wraps nothing. Both callers import the class from `@ptah-extension/agent-sdk`, and `agent-sdk/src/index.ts:141` exports it. This is the same class object as the one the Codex adapter imports, so `instanceof` holds.
- **Import path.** The adapter, the queue and both specs import `../errors/session-admission-refused.error`. This is a relative import inside the same lib (agent-sdk), not a deep cross-lib path. External consumers use the public alias. Idle-compaction already imports it the same way (idle-compaction.service.ts:29). Nothing to fix.
- **Specs assert `instanceof` and `reason`.**
  - codex-chat-adapter.spec.ts:426-433, 452-453, 469-475, 489-490, 509-510, 566-567.
  - codex-chat-peer-queue.spec.ts:21-22, 33-34.
  - Together they cover busy-running, busy-queued, session-ended on both the peer and direct paths, and a late `busy` race.
  - Line 570-571 asserts that a non-require-idle sibling still gets `CodexChatAdapterError` `unavailable`. That is correct, because the type change is scoped to require-idle.

## L4 queue regression check: no regression found

- **Peer messages without require-idle still queue.** codex-chat-adapter.ts:603-610 routes any `inboundPeer` through `peerQueue.send` with `admissionId` undefined. The `admissionId &&` guard at peer-queue.ts:35 means the busy refusal applies only to require-idle. Without an id it enqueues, up to the 32 cap, then `CodexChatAdapterError('busy', 'peerQueueFull')` at :41.
- **FIFO and no concurrent turns.** `startNext` (:83-90) is gated by `active.has || session.busy || blocked`. It shifts the head. `onIdle` (turn-stream.ts:445) advances only after the turn releases busy. The "busy after selection" branch (:109-121) restores the head with `unshift`, so order is kept.
- **Close rejects with a code and a log.** adapter :661 calls `rejectPending` before `controls.close`. For each entry, `rejectPending` logs via `logger.error` (:75) and rejects (:79). It uses `CodexChatAdapterError('unavailable')` for plain peers and `session-ended` for require-idle ones. An admitted active entry is not double-rejected (:68). Its turn is torn down by close.
- **Non-peer direct sends.** codex-chat-adapter.ts:611-612 refuses with `busy` while a peer queue is pending. This is unchanged behaviour for non-require-idle. The require-idle path is already refused earlier with the typed error.

## Findings

- MINOR - codex-chat-adapter.ts:619-625. The fallback mapping of `busy` / `unavailable` on the `turn` operation to `SessionAdmissionRefusedError` is a plausible late race, but `unavailable` is inferred from session state. If an unavailable error arises for another reason (session still live), it is reported as `busy`. This is acceptable: the message is not sent and the caller can retry.
- MINOR - codex-chat-adapter.ts:588. A session that is still being opened (`this.opening`, not yet in `sessions`) reports `session-ended`. Claude's pump does the same for an unregistered session (:238-243), so this is parity. A comment would help.

Residual uncertainty: no spec run (forbidden). The late-race path at adapter :619-625 and peer-queue :124-131 is covered by spec lines 489-510 by reading only.
