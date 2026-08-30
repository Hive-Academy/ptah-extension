/**
 * The `MESSAGE_TYPES.BATCH` envelope.
 *
 * A batch is a TRANSPORT-LEVEL coalescing wrapper, not a domain message: it
 * carries N ordinary `{ type, payload }` messages that a producer chose to
 * deliver in one hop instead of N. Every consumer unwraps it by re-dispatching
 * each inner message through the exact path an unbatched message would take, so
 * nothing downstream — routing, tab gating, handler lookup — can tell the
 * difference. That is the whole contract.
 *
 * It deliberately has no `payload-map.ts` entry. `MessagePayloadMap` maps a
 * message type to the ONE payload shape it carries; a batch's meaning is "these
 * other types, whatever they were", which the map cannot express without
 * flattening every entry into a union and losing the per-type narrowing that is
 * the map's entire job.
 *
 * Producers (both send this exact shape):
 *   - `ChatStreamBroadcaster` — coalesces SDK stream events, all three hosts.
 *   - `IpcBridge` — coalesces `BATCHABLE_STREAM_TYPES` on the Electron hop.
 *
 * Consumers (both re-dispatch inner messages one at a time):
 *   - `MessageRouterService` — VS Code + Electron webviews.
 *   - `CliWebviewManagerAdapter` — CLI/TUI EventEmitter transport.
 *
 * `IpcBridge` and `MessageRouterService` still declare this shape privately;
 * adopting the type there is a mechanical follow-up, not a behaviour change.
 */

/**
 * One message inside a batch — the same `{ type, payload }` pair the transport
 * would have sent on its own.
 *
 * `payload` is `unknown` on purpose. A batch is heterogeneous by construction,
 * so the only honest static type for the payload of an arbitrary member is
 * "something"; the consumer recovers the real type when it re-dispatches on
 * `type`.
 */
export interface BatchedMessage {
  readonly type: string;
  readonly payload?: unknown;
}

/** Payload of a `MESSAGE_TYPES.BATCH` message. Order is delivery order. */
export interface BatchMessagePayload {
  readonly events: readonly BatchedMessage[];
}
