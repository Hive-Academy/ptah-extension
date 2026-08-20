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
7. **DONE 2026-08-18** (orchestrated: backend + frontend lanes,
   `code-logic-reviewer` found no behaviour drift):
   - Telegram 401 → `disconnected` + `TELEGRAM_TOKEN_REJECTED_REASON` (no
     pointless backoff); other polling ends stay `invalidated`.
   - Facade split per root CLAUDE.md rule: `GatewayService` (1546→901
     raw / 677 code lines) delegates to `AdapterLifecycleService`
     (adapters, start/stop/reconnect/status/lastError/recordTurnOutcome,
     emits `status-changed`) and `OutboundDeliveryService` (coalescer,
     flush, paginate, `OutboundDeliveryError`, sendTest);
     `gateway-settings-access.ts` holds keys + readers. Every public
     signature, token and event kept. Tokens `GATEWAY_ADAPTER_LIFECYCLE`
     / `GATEWAY_OUTBOUND_DELIVERY`.
   - Gateway tab renders partial guild registration failure ("Registered
     for 2 of 3 servers. Failed: Beta — Missing Access"), name-mapped via
     the guild picker list.
8. Split out: TASK_2026_277 (restart-mid-turn: notify, don't replay).
   TASK_2026_272 (send-to-messaging rework) still backlog.

## Verification review 2026-08-18 — does NOT hold at in_review

A `code-logic-reviewer` pass over the committed range `024d00940^..3ae02313e`
read the "Fix order" list above as a claim to falsify. It confirmed the facade
split (`3ae02313e`) is signature- and token-identical, that no duplicate
listener accumulates across reconnects, and that the Discord 429 retry and the
partial-guild-failure UI match their claims. It also found two defects that
send the task back to `in_progress`.

### Blocker A (critical) — the stranded-buffer bug has a second entrance

`gateway-chat-bridge.ts:279-298`: the two workspace-resolution early returns in
`runTurn` call `sendError()` and return _before_ `sealTurn` /
`completeOutboundTurn` is wired at `:305-306`. `OutboundDeliveryService.drain()`
only drops the `streamHandles` entry; the coalescer's `body` is cumulative per
conversation key and is cleared **only** by `discard()`. So a turn that dies on
a revoked workspace root leaves its error text in the buffer, and the next
turn's reply is flushed with that stale text prepended.

This is the exact class fix-order item 5 (`2f0d16d32`, `discardOutbound` in
`tryFallbackStart`) closed — but only on the resume-failure retry path. The
three specs covering these early returns assert only that `appendOutboundChunk`
/ `drainOutbound` were called; their `flushUntil(() => completeOutboundTurn...)`
polls for something that never happens and then gives up silently instead of
failing, which is how it passed review.

Fix: call `discardOutbound` / `completeOutboundTurn` — not raw `drainOutbound` —
on both early-return paths, or have `sendError` discard after draining.

### Blocker B (high) — a stopped adapter can restart itself

`adapter-lifecycle.service.ts`: `cancelReconnect` / `cancelAllReconnects` clear
only a _pending_ timer. Once the timer fires, its callback removes itself from
`reconnectTimers` and calls `reconnect()` as an independent, uncancellable
chain. `reconnect()` checks the enable flag once at entry, then calls
`maybeStart(platform, true)` — and `force: true` bypasses that same check inside
`maybeStart`. A `stopPlatform()` / `stop()` landing while a `reconnect()` is
between its check and `adapter.start()` (a window containing a real network
`login()`) brings the adapter back after the caller believed it stopped; during
shutdown that leaks a live connection past `will-quit`. The existing spec
cancels a timer that has not fired yet, so it never reaches this.

Fix: a cancellation flag `reconnect()` re-checks before `maybeStart`, or a
per-platform "stopping" guard `maybeStart` respects even under `force: true`.

### Follow-up, not blocking

- `gateway-chat-bridge.ts:284-298` — `await this.sendError(...)` unprotected at
  the early returns, unlike the `.catch`-wrapped call inside `turnWork`.
- `gateway-chat-bridge.ts:325-336` — `resolveSdkContext` failure rethrows
  without `sendError` or `recordTurnOutcome`: total silence, by design
  unreachable.
- `notifyAbuseCap` sets `abuseNotified` before `sendMessage` resolves; a failed
  send costs the whole 60s window.

### Coverage gap in the review itself

`libs/backend/agent-sdk` was outside the scoped paths, so the bridge's
_consumption_ of `PermissionPromptLifecycleEvent` was verified but
`SdkPermissionHandler` / `SdkQueryOptionsBuilder` were not.

### Blockers closed 2026-08-18 (orchestrated: `backend-developer`, red-then-green)

**Blocker A** — fixed in `sendError` rather than at the two call sites:
`append → drain → discard`, discard in a `finally` so a drain throwing
`OutboundDeliveryError` still cannot strand a body. That shape closes a **third
entrance the review did not find**: the post-seal delivery-failure reply at the
end of `runTurn`'s `finally` also calls `sendError` after `completeOutboundTurn`
has already run, so `DELIVERY_FAILED_MESSAGE` was stranding itself too. Call
sites that do seal afterwards see a no-op discard. Proof: three specs, each
running a **second turn** on the same conversation key against the real
`StreamCoalescer` in `'complete'` mode — the plain `FakeGateway` cannot observe
this bug class at all, since its `drainOutbound` is a no-op with no buffer to
leak. Before: 3 failed, e.g. received `"This thread's workspace is no longer
available…second reply"`. After: 64 passed. The ~L982 spec's `flushUntil` now
polls `discardOutbound` instead of a `completeOutboundTurn` that never comes.

**Blocker B** — a per-platform `stopping: Set<GatewayPlatform>`, not a
per-reconnect cancellation flag. A flag scoped to one `reconnect()` call does
not survive the interleave that actually bites: `reconnect` parks in
`await adapter.stop()`, `stopPlatform` completes and clears the flag, then
`reconnect` resumes and restarts anyway. The set is added synchronously before
any await by `stopPlatform` and by `cancelAllReconnects` (which is the first
move of `GatewayService.stop()`, so shutdown is covered without touching
`gateway.service.ts`), and cleared only by an explicit `startPlatform` /
`startEnabled`. Checked in `maybeStart` **above** the `force` branch, again at
the top of `startAdapter` (the last gate before the network `login()`, closing
the `decryptToken` await window), and in `scheduleReconnect` / both sides of
`reconnect`'s `adapter.stop()`. Proof: two specs cancel a reconnect already in
flight — parked inside `adapter.stop()`, past its own enable check, with
`maybeStart(…, true)` still ahead. Guards disabled: 2 failed, adapter called
twice. Guards on: 274 passed.

Follow-ups from that list also done: all five `sendError` sites consolidated
onto `sendErrorQuietly(route, message, context)`; `resolveSdkContext` failure
now sends a reply, records the turn outcome and marks the row `'failed'` before
preserving the rethrow; `notifyAbuseCap` keeps stamping before the send (a burst
must not fire N concurrent notices) but rolls the stamp back when the send
throws, so a failed notice no longer costs the whole 60s window.

Still open, same silence family: the two fail-closed workspace exits skip
`recordTurnOutcome`, so a revoked-workspace turn shows nothing in the Gateway
tab.

`gateway.service.ts` is now 792 lines against the 700 warn ceiling. No third
facade split — the guardrails say the ~100-line fragment and a 13th constructor
dep would be the worse outcome.

## Related

- TASK_2026_155 (turns hung forever — permission level, watchdog)
- TASK_2026_192 (inbound permission gate — where the `'ask'` default came from)
- TASK_2026_272 (send-to-messaging affordance rework — sibling from same audit)
