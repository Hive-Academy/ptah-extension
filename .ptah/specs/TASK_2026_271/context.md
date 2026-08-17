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
2. **DONE 2026-08-17** — #3 + #4 + #6. `DiscordAdapter` now listens to
   `error` / `shardError` / `shardDisconnect` / `shardReconnecting` /
   `shardResume` / `shardReady` / `invalidated`; `isRunning()` = started AND
   connected. New optional `IMessagingAdapter.onConnectionChange` hook.
   `GatewayService` records reasons in `lastError`, emits `status-changed`
   (pushed to the Gateway tab by `GatewayRpcHandlers`), and on `invalidated`
   or any failed `start()` reconnects with bounded backoff
   (5s/15s/45s/2m/5m); `stopPlatform`/`stop` cancel. Specs: 4 in
   `discord.adapter.spec.ts`, 3 in `gateway.service.spec.ts`. Not done:
   Telegram/Slack transport events (grammy / bolt expose fewer; follow-up),
   periodic heartbeat probe.
3. **DONE (notice path) 2026-08-17** — #1. `SdkPermissionHandler` now emits
   `PermissionPromptLifecycleEvent` (`requested` / `resolved` with
   `routingHint` = raw tab id, `routable`, `timeoutMs`, `outcome`) via
   `onPromptLifecycle`; `SdkQueryOptionsBuilder` passes the raw
   `sessionConfig.tabId` as the hint. `GatewayChatBridge` subscribes and, for
   the running `gw-*` turn, sends `gateway.sendNotice` ("needs approval to
   run `Write`… within 60s… or set gateway.permissionLevel") and on
   `timed-out` ("No approval arrived… skipped"). Bypasses the coalescer.
   Specs: 2 in `sdk-permission-handler.spec.ts`, 1 in bridge spec.
   **Deliberately NOT done**: a Discord-side approve button. TASK_2026_192
   decided remote chat must not approve local writes; revisit only as its
   own security-reviewed task. Also not done: typing/ack indicator (needs
   `IMessagingAdapter.sendTyping?` — follow-up).
4. **DONE 2026-08-17** — #7. `GatewayService.recordTurnOutcome(platform,
{ok} | {ok:false, reason})` writes `Last turn: <reason>` into `lastError`
   (prefix so a clean turn clears only turn errors, never a live transport
   error) and emits `status-changed`; the bridge calls it in `runTurn`'s
   `finally` for agent failure, watchdog stop, delivery failure, or success.
   Reconnect timers are `unref()`'d. Specs: 2 in `gateway.service.spec.ts`,
   assertions in bridge spec.
5. **DONE 2026-08-17** — #6. `GatewayService.discardOutbound(key)` added;
   `tryFallbackStart` calls it before starting the fresh session so a
   stranded partial from the failed resume is never glued in front of the
   retry's reply. Spec in bridge spec (resume streams then throws → fresh
   session; discard ordered before the retry's first append).
6. **DONE 2026-08-18** (orchestrated: two `backend-developer` lanes +
   `code-logic-reviewer` verify):
   - #8 `discord-command-registration`: 429 → `Retry-After` header / body
     `retry_after`, ≤3 retries, cap 60s; per-guild `results`, throw only if
     all fail. `registerDiscordCommands` now returns optional
     `failed: [{guildId, error}]` (shared RPC type widened) and warns.
   - Telegram (grammy) + Slack (bolt) `onConnectionChange` + `running &&
connected`. grammy: polling promise no longer discarded — settled loop
     = `invalidated` (gateway backoff-reconnects), `bot.catch` keeps live
     state. bolt: socket `error` listened, `connected`/`reconnecting`/
     `disconnected` mapped. Every adapter's `start()` rebuilds on a
     started-but-dead transport (review finding: stale `running` made the
     Start button a no-op).
   - `sendTyping` on Discord/Telegram; bridge heartbeat every 8s
     (`unref`, stopped in `finally` / on cancel / on context failure).
   - Abuse cap: one warn + one "slow down" reply per allowListId per 60s
     window; debug per drop.
   - Discord `messagesById` capped at 500; `channelEdits` pruned.
   - Docs: guild-only intents decision recorded (DMs no-op by design).
7. Still open (own tasks): restart-mid-turn replay (needs durable inbound
   queue); Telegram 401 → `invalidated` escalation (grammy error code
   inspection); UI rendering of `failed` guild list; `gateway.service.ts`
   facade split (1200+ lines, warn-level).

## Related

- TASK_2026_155 (turns hung forever — permission level, watchdog)
- TASK_2026_192 (inbound permission gate — where the `'ask'` default came from)
- TASK_2026_272 (send-to-messaging affordance rework — sibling from same audit)
