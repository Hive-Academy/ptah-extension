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

Services: `GatewayService`, `BindingStore`, `MessageStore`, `ConversationStore`, `StreamCoalescer`, `ConversationTurnTracker`.
Adapters: `GrammyTelegramAdapter`, `DiscordAdapter`, `BoltSlackAdapter` + their factory/client-like types.
Interfaces: `ITokenVault`, `IMessagingAdapter` (incl. optional `setCommandHandler?(handler)`), `InboundListener`, `InboundMessage`, `SendResult`, `IGatewaySessionLister`/`GatewaySessionSummary`, `ISessionActivityProbe`.
Command plane: `IGatewayCommandHandler`, `GatewayCommand`, `GatewayCommandInvocation`, `GatewayCommandOutcome`, `GatewayAutocompleteRequest`.
Workspace resolution: `normalizeWorkspacePath`, `isAllowlistedWorkspaceRoot`, `workspaceRootDigest`, `resolveEffectiveWorkspaceRoot`, `EffectiveWorkspace`.
Types: `GatewayInboundEvent`, `GatewayStatus`, `GatewayTestOverrides`, `BindingId`, `ConversationKey`, `GatewayMessageId`, `ApprovalStatus`, `Direction`, `GatewayBinding`, `GatewayConversation` (incl. `workspaceRoot: string | null`), `GatewayMessage`, `GatewayPlatform`.
DI: `GATEWAY_TOKENS`, `GatewayDIToken`, `registerMessagingGatewayServices`.

## Internal Structure

- `src/lib/gateway.service.ts` — façade; `wireAdapter` also calls `adapter.setCommandHandler?.(commandService)` so Discord gets the control plane
- `src/lib/binding.store.ts`, `message.store.ts`, `conversation.store.ts` — SQLite-backed (uses persistence-sqlite). `gateway_conversations.workspace_root` (migration 0028, NULL = inherit binding root) pins a thread to a workspace; transactional writers `setWorkspaceRootAndClearSession` (workspace switch clears the session in one txn) and `setPtahSessionIdAndWorkspaceRoot` (webview attach), plus `findBySessionId` for durable session-ownership checks
- `src/lib/commands/` — the slash-command control plane: `gateway-command.types.ts` (contracts), `gateway-command.service.ts` (`GatewayCommandService implements IGatewayCommandHandler` — rate limit 60/min per allowListId, approved-binding gate, mid-turn refusal via the turn tracker, closed-set pick re-validation for `/sessions`, `/session use`, `/new`, `/workspace list`, `/workspace use`), `command-replies.ts` (pure, platform-neutral reply formatting). Commands NEVER emit `inbound`, never touch `MessageStore`, never become agent turns
- `src/lib/workspace-resolution.ts` — `resolveEffectiveWorkspaceRoot` (conversation → binding → active workspace; a pinned root that left the allowlist FAILS CLOSED) + exact-root-only allowlist membership (deliberately no subpaths, unlike the `rpc-handlers` helper — do not "fix" this). Shared by the command service and `gateway-chat-bridge` so lists, validation, and turns agree
- `src/lib/turn-activity-tracker.ts` — counter-based `begin/end/isBusy` per `ConversationKey`; the bridge marks turns, the command service refuses mutations mid-turn
- `src/lib/session-lister.interface.ts`, `session-activity.interface.ts` — host-implemented ports (Electron registers `GATEWAY_SESSION_LISTER` / `GATEWAY_SESSION_ACTIVITY_PROBE` before `registerMessagingGatewayServices`)
- `src/lib/adapters/{telegram,discord,slack}/` — per-platform adapters behind `IMessagingAdapter`. Discord additionally owns the control-plane boundary: `discord-command.schema.ts` (Zod at the interaction boundary), autocomplete routing, ephemeral defer/editReply + one public audit message on successful mutations, and `discord-command-registration.ts` (bulk-overwrite PUT of all five commands + `/ptah`; global scope has a ~1h propagation caveat)
- `src/lib/stream-coalescer.ts` — buffers assistant token chunks per conversation; two modes: `'stream'` (timer-driven batched edits) and `'complete'` (accumulate-until-drain — flushes the full turn text as ONE message on explicit `drain()`, no streaming edits). `GatewayService` constructs it in `'complete'` mode so each agent turn emits exactly one outbound message.
- `src/lib/token-vault.interface.ts`
- `src/lib/di/{tokens,register}.ts` — includes `GATEWAY_COMMAND_SERVICE`, `GATEWAY_TURN_TRACKER`, and the two host-precondition tokens (`GATEWAY_SESSION_LISTER`, `GATEWAY_SESSION_ACTIVITY_PROBE`)

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

## Cross-Lib Rules

Used by `rpc-handlers` (`GatewayRpcHandlers`) and `apps/ptah-electron` (vault impl). No frontend imports.
