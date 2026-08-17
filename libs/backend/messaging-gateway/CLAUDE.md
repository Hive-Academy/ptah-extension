# @ptah-extension/messaging-gateway

[Back to Main](../../../CLAUDE.md)

## Purpose

Track 4 of TASK_2026_HERMES. `GatewayService` façade routes inbound messages from Telegram / Discord / Slack into Ptah, with token-vault credential storage. Voice transcription/synthesis (formerly `FfmpegDecoder`/`WhisperTranscriber` here) moved to `@ptah-extension/voice-providers` (TASK_2026_VOICE_PROVIDERS) — this lib no longer owns any voice/ONNX code.

## Boundaries

**Belongs here**:

- `GatewayService` orchestrator
- Per-platform `IMessagingAdapter` implementations (`GrammyTelegramAdapter`, `DiscordAdapter`, `BoltSlackAdapter`)
- Stores: `BindingStore`, `MessageStore`, `ConversationStore`
- `GatewayCommandService` — Discord slash-command control plane (sessions/workspace switching)
- `ConversationTurnTracker` — per-conversation turn-in-flight signal (written by `gateway-chat-bridge`)
- `workspace-resolution.ts` — shared effective-workspace resolver + exact-root allowlist check
- `StreamCoalescer` (response chunk batching)
- Consumer-side ports: `ITokenVault`, `IGatewaySessionLister`, `ISessionActivityProbe` (impls in `apps/ptah-electron`)

**Does NOT belong**:

- RPC surface (`gateway-rpc.handlers.ts` in `rpc-handlers`)
- Token vault implementation (each platform provides its own — Electron uses safeStorage)
- Session listing / activity probing implementations (host-registered: `MetadataGatewaySessionLister` + agent-adapter factory in `apps/ptah-electron`)

## Public API

Services: `GatewayService` (+ its two collaborators `AdapterLifecycleService`, `OutboundDeliveryService`), `BindingStore`, `MessageStore`, `ConversationStore`, `StreamCoalescer`, `ConversationTurnTracker`.
Adapters: `GrammyTelegramAdapter`, `DiscordAdapter`, `BoltSlackAdapter` + their factory/client-like types.
Interfaces: `ITokenVault`, `IMessagingAdapter` (incl. optional `setCommandHandler?(handler)`, `onConnectionChange?(listener)`, `sendTyping?(externalChatId, opts?)`), `InboundListener`, `InboundMessage`, `SendResult`, `IGatewaySessionLister`/`GatewaySessionSummary`, `ISessionActivityProbe`.
Command plane: `IGatewayCommandHandler`, `GatewayCommand`, `GatewayCommandInvocation`, `GatewayCommandOutcome`, `GatewayAutocompleteRequest`.
Workspace resolution: `normalizeWorkspacePath`, `isAllowlistedWorkspaceRoot`, `workspaceRootDigest`, `resolveEffectiveWorkspaceRoot`, `EffectiveWorkspace`.
Types: `GatewayInboundEvent` (incl. `messageId`), `GatewayStatus`, `GatewayTestOverrides`, `InterruptedInboundConversation`, `BindingId`, `ConversationKey`, `GatewayMessageId`, `ApprovalStatus`, `Direction`, `GatewayBinding`, `GatewayConversation` (incl. `workspaceRoot: string | null`), `GatewayMessage` (incl. `turnState`, `conversationId`), `GatewayTurnState`, `GatewayPlatform`, `UnfinishedInboundTurn`.
DI: `GATEWAY_TOKENS`, `GatewayDIToken`, `registerMessagingGatewayServices`.

## Internal Structure

- `src/lib/gateway.service.ts` — the façade. Keeps its class name, `GATEWAY_TOKENS.GATEWAY_SERVICE`, its `EventEmitter` base and every public signature (`rpc-handlers`, `gateway-chat-bridge` and `apps/ptah-electron` all call it), and owns exactly the concerns that ARE the façade: the inbound admission path (abuse cap → transcription → pairing gate → persist → `inbound` event), binding administration (approve / attach / detach / revoke, allow-lists, token storage, Discord application id + slash-command registration), the out-of-band speech that must never touch the coalescer (`sendNotice`, `sendTyping`), and voice housekeeping. Everything else is delegated to the two collaborators below (TASK_2026_271 façade split)
- `src/lib/adapter-lifecycle.service.ts` — **collaborator 1**, `GATEWAY_TOKENS.GATEWAY_ADAPTER_LIFECYCLE`. Owns the live `IMessagingAdapter` per platform, `wireAdapter` (which also calls `adapter.setCommandHandler?.(commandService)` so Discord gets the control plane, and forwards `inbound` to the handler `GatewayService` installs via `setInboundHandler` — the handler's promise is returned untouched so an adapter that awaits its listener still awaits the real work), token decryption + the decrypt-failure flag, the persisted enable flags, `status()`, the reconnect backoff, and `lastError` per platform — including `recordTurnOutcome`, because transport errors and turn errors compete for the one line of text under the status dot. Emits `'status-changed'`; `GatewayService` re-emits it
- `src/lib/outbound-delivery.service.ts` — **collaborator 2**, `GATEWAY_TOKENS.GATEWAY_OUTBOUND_DELIVERY`. Owns the `StreamCoalescer`, the per-conversation page handles, pagination against `maxMessageChars`, `flushOutbound` + `OutboundDeliveryError` (still exported from the barrel under the same name), and `sendTest`. Depends on `AdapterLifecycleService.adapterFor(platform)` for the live adapter — a one-way edge, no cycle
- `src/lib/gateway-settings-access.ts` — the `ptah.gateway.*` key table (`SETTINGS_KEYS`, `allowedKeyFor`, `enabledKeyFor`) plus the two typed readers (`readBool`, `readStringArray`). One definition shared by the façade and the lifecycle service; a key that drifted between them would be a silently dead toggle with no type error to catch it
- `src/lib/binding.store.ts`, `message.store.ts`, `conversation.store.ts` — SQLite-backed (uses persistence-sqlite). `gateway_conversations.workspace_root` (migration 0028, NULL = inherit binding root) pins a thread to a workspace; transactional writers `setWorkspaceRootAndClearSession` (workspace switch clears the session in one txn) and `setPtahSessionIdAndWorkspaceRoot` (webview attach), plus `findBySessionId` for durable session-ownership checks
- `src/lib/commands/` — the slash-command control plane: `gateway-command.types.ts` (contracts), `gateway-command.service.ts` (`GatewayCommandService implements IGatewayCommandHandler` — rate limit 60/min per allowListId, approved-binding gate, mid-turn refusal via the turn tracker, closed-set pick re-validation for `/sessions`, `/session use`, `/new`, `/workspace list`, `/workspace use`), `command-replies.ts` (pure, platform-neutral reply formatting). Commands NEVER emit `inbound`, never touch `MessageStore`, never become agent turns
- `src/lib/workspace-resolution.ts` — `resolveEffectiveWorkspaceRoot` (conversation → binding → active workspace; a pinned root that left the allowlist FAILS CLOSED) + exact-root-only allowlist membership (deliberately no subpaths, unlike the `rpc-handlers` helper — do not "fix" this). Shared by the command service and `gateway-chat-bridge` so lists, validation, and turns agree
- `src/lib/turn-activity-tracker.ts` — counter-based `begin/end/isBusy` per `ConversationKey`; the bridge marks turns, the command service refuses mutations mid-turn
- `src/lib/session-lister.interface.ts`, `session-activity.interface.ts` — host-implemented ports (Electron registers `GATEWAY_SESSION_LISTER` / `GATEWAY_SESSION_ACTIVITY_PROBE` before `registerMessagingGatewayServices`)
- `src/lib/adapters/{telegram,discord,slack}/` — per-platform adapters behind `IMessagingAdapter`. Discord additionally owns the control-plane boundary: `discord-command.schema.ts` (Zod at the interaction boundary), autocomplete routing, ephemeral defer/editReply + one public audit message on successful mutations, and `discord-command-registration.ts` (bulk-overwrite PUT of all five commands + `/ptah`; global scope has a ~1h propagation caveat)
- **Transport health + reconnect (TASK_2026_271)** — `IMessagingAdapter.isRunning()` means "started AND transport usable", not "start() was called". All three adapters implement it: `DiscordAdapter` listens to discord.js `error` / `shardError` / `shardDisconnect` / `shardReconnecting` / `shardResume` / `shardReady` / `invalidated`; `GrammyTelegramAdapter` awaits the polling promise (a settled loop = `invalidated`, since grammy never restarts it — **except a 401**, see below) and `bot.catch` (reason only, state preserved); `BoltSlackAdapter` wires `app.error` plus the Socket Mode client's `error` / `connected` / `reconnecting` / `disconnected`. All forward through the optional `onConnectionChange(listener)` hook (`AdapterConnectionEvent`). Every adapter's `start()` rebuilds the client when called on a started-but-dead transport (never a silent no-op on a stale `running`). `GatewayService` records the reason in `lastError`, emits `status-changed` (which `GatewayRpcHandlers` pushes to the Gateway tab), and on `'invalidated'` — or on any failed `start()` — restarts the adapter with bounded backoff (`RECONNECT_DELAYS_MS`: 5s → 15s → 45s → 2m → 5m). `stopPlatform` / `stop` cancel the timer. Test seam: `configureForTest({ scheduleTimer })`.
- **A Telegram 401 is `disconnected`, not `invalidated` (TASK_2026_271)** — when the polling loop dies with a grammy `GrammyError`/`HttpError` carrying `error_code: 401` (or whose message matches `/\b401\b|unauthorized/i`), the token itself is rejected. `GrammyTelegramAdapter` still releases `running` / `connected` / `bot` so a later `start()` with a fresh token is not a no-op, but reports `{ state: 'disconnected', reason: TELEGRAM_TOKEN_REJECTED_REASON }` so `GatewayService` records the reason and does NOT arm backoff. Reconnecting would re-send the same rejected token every few minutes forever and can only end in the same 401 — only the operator can fix it, so the reason names the fix. Every other settle cause (`ECONNRESET`, a clean end we did not ask for) stays `'invalidated'` and still backoff-reconnects.
- **Typing + abuse-cap reply (TASK_2026_271)** — `GatewayService.sendTyping(route)` forwards to the optional `IMessagingAdapter.sendTyping` and swallows every failure (`debug`-logged); `gateway-chat-bridge` re-arms it for the life of a turn so a long tool call or an approval wait does not look like a dead bot. The 60/min-per-`allowListId` inbound cap in `handleInbound` still drops, but no longer silently: one `debug` per dropped message, ONE `warn` at onset, and `ABUSE_CAP_NOTICE` ("You're sending messages faster than Ptah can take them") sent to the sender at most once per 60 s window (`abuseNotified` stamp).
- **Outbound delivery is never swallowed (TASK_2026_271)** — `flushOutbound` re-sends a page whose edit failed, retries a failed send once, then throws `OutboundDeliveryError`. `completeOutboundTurn` / `drainOutbound` reset the buffer in `finally` so an undelivered body cannot leak into the next turn; `gateway-chat-bridge` catches the seal failure and tells the user.
- **Inbound survives a restart (TASK_2026_277)** — migration 0038 adds `gateway_messages.turn_state` (`'queued' | 'running' | 'done' | 'failed' | 'interrupted'`; NULL for outbound and pre-0038 rows) and `conversation_id`. `handleInbound` now resolves the conversation BEFORE persisting the row, because the restart notice is batched per conversation and one binding can serve many Discord threads. `gateway-chat-bridge` stamps `'running'` at turn start and `'done'`/`'failed'` in the same `finally` that calls `recordTurnOutcome` — one turn lifecycle, not two — via the façade methods `markInboundTurnState` (best-effort; a bookkeeping failure must never fail a turn) and `claimInterruptedInboundTurns`. The latter is the startup sweep: it marks every still-`queued`/`running` inbound row `'interrupted'` **before** returning routes, so a notice the platform rejects is lost rather than re-swept on every boot forever. Rows with a NULL `conversation_id` (pre-0038) fall back to one notice per binding. **Never replay an interrupted turn** — at `auto-edit`/`yolo` it may already have run `Write`/`Bash`, and repeating those side effects is worse than losing the message. Replay would need a per-turn idempotency record and a user-visible confirmation first.
- `src/lib/stream-coalescer.ts` — buffers assistant token chunks per conversation; two modes: `'stream'` (timer-driven batched edits) and `'complete'` (accumulate-until-drain — flushes the full turn text as ONE message on explicit `drain()`, no streaming edits). `GatewayService` constructs it in `'complete'` mode so each agent turn emits exactly one outbound message.
- `src/lib/token-vault.interface.ts`
- `src/lib/di/{tokens,register}.ts` — includes `GATEWAY_COMMAND_SERVICE`, `GATEWAY_TURN_TRACKER`, the two façade collaborators (`GATEWAY_ADAPTER_LIFECYCLE`, `GATEWAY_OUTBOUND_DELIVERY`), and the two host-precondition tokens (`GATEWAY_SESSION_LISTER`, `GATEWAY_SESSION_ACTIVITY_PROBE`)

## Dependencies

**Internal**: `@ptah-extension/persistence-sqlite`, `@ptah-extension/platform-core`
**External**: `grammy` (Telegram), `discord.js`, `@slack/bolt`, `tsyringe`

## Guidelines

- Adapter implementations stay behind `IMessagingAdapter` — handlers and `GatewayService` use only the interface.
- Credentials always come through `ITokenVault` — never accept raw secrets in code.
- `StreamCoalescer` is the only path for streaming replies — handlers don't post chunks directly.
- Control commands are a separate plane: they terminate in `GatewayCommandService` and must never reach `handleInbound`, `MessageStore`, or the agent. Every chat-supplied pick (session/workspace) is untrusted and re-validated by closed-set membership at execution time — never accept raw paths or session ids from chat.
- The workspace allowlist source is exactly `IWorkspaceProvider.getWorkspaceFolders()`; exact-root matching only (no subpaths, no `rpc-handlers` import).
- Command control plane is Discord-only for now (Telegram/Slack parity deferred — a literal `/sessions` text there stays a plain prompt).
- **Discord is guild-only by design.** `defaultFactory` requests exactly `Guilds` + `GuildMessages` + `MessageContent` — no `DirectMessages`, no partials — so a DM to the bot is a no-op, not a dropped message. The allow-list for Discord is a list of guild ids; a DM carries no guild, so there is nothing to authorize it against. Supporting DMs is a product decision that needs a DM-scoped allow-list first — adding the intent alone would open an unauthenticated inbound path.
- **`attachSession` requires a RUNNING adapter** (TASK_2026_272 #2, `'adapter-not-running'` — the same code `sendTest` uses). Attach is a control hand-off that makes the webview tab read-only, so accepting it against a stopped or disconnected transport produces a tab nobody can type into and a channel nothing arrives from.
- Anything the gateway says on its own behalf — pairing prompt, abuse-cap notice, permission notice, typing — goes straight to the adapter and is throttled at its own call site. It must never travel through `StreamCoalescer`, which belongs to the turn's assistant reply. Typing in particular is cosmetic: it never blocks, delays, or fails a turn.

## Cross-Lib Rules

Used by `rpc-handlers` (`GatewayRpcHandlers`) and `apps/ptah-electron` (vault impl). No frontend imports.
