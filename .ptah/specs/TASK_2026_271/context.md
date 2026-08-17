# TASK_2026_271 — Messaging gateway reliability

## User intent

"Discord and messaging integrations are flaky and not reliable at all." Audit
(2026-08-17, three parallel code-logic reviews of `messaging-gateway`,
`gateway-chat-bridge`, `messaging-gateway-ui`) found the architecture sound —
per-conversation `ConversationQueue`, 10-min watchdog, unique-constraint dedup,
fail-closed workspace resolution — but every remaining failure path ends in
silence. Same failure class was already fixed twice (`f7915f168` second message
lost, `bf55272c2` 2000-char truncation). This task closes the rest of the class.

## Findings (ranked)

### Critical

1. **Permission prompts unroutable at default `'ask'`.**
   `gateway-chat-bridge.ts:232` uses `tabId: gw-<conversationId>`. Not a UUID,
   so `sdk-query-options-builder.ts:653-668` builds `canUseTool` with no
   session/tab. `sdk-permission-handler.ts:519-551,844-868` classifies every
   `Write`/`Edit`/`Bash`/`WebFetch`/`WebSearch`/MCP call as unroutable: 60 s
   stall (`UNROUTABLE_PERMISSION_TIMEOUT_MS`), then auto-deny. Multi-tool turns
   stack stalls and hit the 10-min watchdog. No typing indicator or interim
   message anywhere in `messaging-gateway`, so the Discord user sees a dead bot.
2. **`flushOutbound` swallows every error.** `gateway.service.ts:966-1024`
   wraps the whole page loop in one `catch { logger.warn }`. Coalescer runs in
   `'complete'` mode — one flush at end-of-turn — so any `channel.send`/`edit`
   failure (deleted message → `Unknown Message 10008`, revoked perms, 429,
   network) eats the entire reply. `stream-coalescer.ts:191-217` sets
   `flushed = true` before calling flush, so the bridge sees success.
   `gateway.service.spec.ts` has zero send/edit rejection cases.
3. **Discord client has no lifecycle handlers.** `discord.adapter.ts:175-200`
   registers only `interactionCreate` + `messageCreate`. No `error`,
   `shardError`, `shardDisconnect`, `shardReconnecting`, `invalidated`.
   Unlistened `error` on an EventEmitter throws. `running` set once after
   `login()`, only reset by `stop()` — UI shows green while bot is offline.
   `lastErrors` populated only at boot.

### High

4. No retry when initial `login()` fails (`gateway.service.ts:812-831`
   `maybeStartDiscord`) — adapter dead until manual toggle.
5. `editMessage` on deleted/expired message throws with no fallback to a fresh
   `sendMessage` (`discord.adapter.ts:230-243`; lookup only in in-memory
   `messagesById`).
6. Resume-fails-mid-stream fallback (`gateway-chat-bridge.ts:558-622`
   `tryFallbackStart`) pumps the new session into the same conversation buffer
   already holding stranded partial deltas — two generations glued into one
   message. Only mid-stream-throw spec uses a fresh session, so path untested.
7. UI status (`gateway-state.service.ts:462-483`, `gateway.service.ts:239-258`)
   surfaces only adapter start/stop `lastError`; turn-level failures (1, 2, 6,
   watchdog kills) never reach `lastError`/`globalError`.
8. `discord-command-registration.ts:132-160` uses raw `fetch`, ignores
   `Retry-After` on 429, aborts multi-guild loop on first failure with no
   partial-success report.

### Medium / low

- Abuse cap 60/min (`gateway.service.ts:855-870`) drops silently by design;
  indistinguishable from a bug for the user. Log at info, consider one throttled
  "too fast" reply.
- Restart mid-turn loses in-flight message; `ConversationQueue` and turn
  tracker in-memory, no replay on `GatewayChatBridge.start()`.
- `messagesById` / `channelEdits` unbounded until `stop()`.
- Guild-only intents (`discord.adapter.ts:97-114`); DMs are a silent no-op.
  Document or add `DirectMessages` + partials.
- Hand-rolled `PER_CHANNEL_EDIT_LIMIT=5/5s` throttle double-throttles with
  discord.js REST manager.
- Test gaps: no spec for client `error`/disconnect events, 429/retry-after,
  edit-on-deleted, partial multi-guild registration, flush rejection.

## Fix order

1. **DONE 2026-08-17** — #2 + #5. `flushOutbound` now recovers per page:
   failed edit falls back to a fresh `sendMessage`; failed send retries once,
   then throws `OutboundDeliveryError` (exported from the barrel).
   `completeOutboundTurn` / `drainOutbound` reset buffer + handle in `finally`
   so an undelivered body can no longer leak into the next turn. The bridge
   catches the seal failure and sends `DELIVERY_FAILED_MESSAGE` on a fresh
   message. Specs added in `gateway.service.spec.ts` (retry-then-succeed,
   throw-after-retry + buffer reset, multi-page partial failure) and
   `gateway-chat-bridge.spec.ts` (delivery-failure reply).
2. #3 + #4 — register discord.js lifecycle events, route into
   `running`/`lastErrors`; bounded exponential backoff on initial connect;
   heartbeat/health in `gateway:status`.
3. #1 — either a real approval surface for gateway turns (Discord button /
   reply through the pending-response registry) or an interim "waiting on
   approval for X … denied" outbound message plus a shorter timeout; add a
   typing/ack signal in `IMessagingAdapter`.
4. #7 — push last-turn outcome/error through `GatewayStatusChangedPayload`.
5. #6, #8, medium/low as follow-ups.

## Related

- TASK_2026_155 (turns hung forever — permission level, watchdog)
- TASK_2026_192 (inbound permission gate — where the `'ask'` default came from)
- TASK_2026_272 (send-to-messaging affordance rework — sibling from same audit)
