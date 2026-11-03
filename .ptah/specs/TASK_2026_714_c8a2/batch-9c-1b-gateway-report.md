# Batch 9c-1b — gateway text reconciliation

`pumpStream` no longer appends every non-empty `text_delta`. It keeps one body per turn, keyed by `(messageId, blockIndex)`, and calls `appendOutboundChunk` once when the stream exits.

## Changes

`libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts`

- `GatewayTextDelta` and `GatewayTurnText` at lines 249–302. `source: 'stream'` and a missing source append. `source: 'complete'` and `source: 'history'` replace the block, including `delta: ''`. Messages stay in first-seen order. Blocks inside a message sort by `blockIndex`, matching `buildBlockNodes` in `message-node.fn.ts`. The joined string is concatenation with no extra separator, which is what per-delta appends produced before.
- `pumpStream` at lines 1125–1179. Session binding, event counting, the cancellation break, and the zero-event throw are unchanged. The joined body is appended in `finally` only when `cancellation.cancelled` is false and the body length is greater than 0.

## Specs

`gateway-chat-bridge.spec.ts` (Claude-shaped streams)

- Updated `textDelta` (about line 261) to take optional `source`, `messageId`, and `blockIndex`.
- Updated the per-delta append test (about line 534) to expect one `'foobar'` append. Stream source and a missing source both append.
- Updated the multi-delta flush test (about line 1218) to expect one `'abc'` append.
- Updated the mid-stream throw test (about line 1120): `'partial'` is appended once, the failure reply is appended, and `drainOutbound` runs.
- Added: stream then complete → `'corrected answer'` (about line 1255); shorter final → `'hi'` (about line 1277); empty complete → no append (about line 1300); history replace (about line 1321); two messages / out-of-order blocks → `'ABC'` (about line 1343); watchdog after a delta → no `'stale prefix'` (about line 1851).

`gateway-chat-bridge.native.spec.ts`

- Same `textDelta` options (about line 277).
- Added: complete replaces `'old'` (about line 1005); shorter final `'hi'` (about line 1022); empty complete on block 0 leaves `'tail'` (about line 1039); message and block order `'ABC'` (about line 1057); mid-stream throw drains `'partial'` once plus `GENERIC_FAILURE` (about line 1087); watchdog does not append `'stale prefix'` (about line 1104). Fake timers in that last test are restored in `finally`.

## Checks

No Jest, nx, tsc, eslint, or diagnostics. The coordinator verifies. No `ptah_*` tool was connected (MCP search returned only the `tasks` server), so the reads used the native file tools. No skill covers this gateway stream change; none was loaded.

## Risks

- A watchdog that fires after text has arrived no longer seals that partial answer. The timeout reply is the only outbound chunk. That is the no-touch rule.
- Blocks and messages are concatenated with no newline. Separate webview blocks become one chat string.
- An empty complete on the only block publishes nothing. The turn still seals.
- If `appendOutboundChunk` throws inside `finally` after the stream already threw, that new error replaces the stream error.
- The duplicate webview `callbacks.content` publish and the empty-final emit in `codex-chat-events.ts` are the other lane. This batch does not touch them.
