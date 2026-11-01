Verdict: REVISE
Score: 8/10

The per-block correction works. One ordering gap remains against the stated webview contract.

## Findings

1. **Medium — Message order comes from the first text delta, not from `message_start`.** `GatewayTurnText.accept()` records a message only when a text delta arrives at `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:274-278`. `pumpStream` ignores `message_start` at `gateway-chat-bridge.ts:1154-1155`. The webview records message order on `message_start` at `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:272-289`, and finalization uses that order at `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:71-80`. If `m1` starts, `m2` starts, `m2` emits text, and `m1` then emits text, the gateway joins `m2m1`. The webview orders `m1m2`. The new order specs contain only text deltas, so they do not detect this difference. **Exact fix:** add a `noteMessage(messageId)` method that creates the message entry and records its order. Call it for each `message_start` in `pumpStream`, and call it from `accept()` as the fallback for text-only streams. Add Claude and native specs with two ordered `message_start` events followed by text in the opposite order.

## Other checks

- Stream and missing sources append. Complete and history sources replace the addressed block, including an empty replacement, at `gateway-chat-bridge.ts:271-285`.
- Numeric block ordering matches `buildBlockNodes` at `libs/frontend/chat-execution-tree/src/lib/builders/message-node.fn.ts:135-159`.
- The gateway adds no separators. The old gateway also concatenated deltas directly. Normal Claude text around tools therefore keeps its previous direct concatenation when event order is unchanged. The webview keeps separate block and message nodes; it does not supply a separator that this batch removed.
- Session binding, event counting, the cancellation break, and the zero-event throw are unchanged.
- A normal mid-stream throw appends the reconciled partial body once in `finally`. `sendError` then appends the failure reply, drains the combined body, and discards it at `gateway-chat-bridge.ts:1274-1283`. This preserves the Claude failure contract.
- Before this batch, watchdog text was already in the coalescer. The watchdog appended its timeout reply and `sendError` drained both strings. The new code sends only the timeout reply. This is an intentional behavior change required by the no-append-after-cancellation rule, not parity with the old watchdog output.
- An `appendOutboundChunk` throw in `finally` would mask the stream error. The call is a synchronous coalescer append with no platform I/O at `libs/backend/messaging-gateway/src/lib/gateway.service.ts:591-593`. I do not consider this a practical blocking risk.
- The correction, empty replacement, ordering, and watchdog specs fail on the old implementation. The mid-stream failure specs preserve existing behavior. The main watchdog suite restores fake timers in `afterEach` at `gateway-chat-bridge.spec.ts:1633-1635`. The native spec restores them in `finally` at `gateway-chat-bridge.native.spec.ts:1133-1135`. I found no readonly mock assignment, pending real timer, `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable` in the batch changes.

No tests, lint, typecheck, diagnostics, or builds ran, as instructed.
