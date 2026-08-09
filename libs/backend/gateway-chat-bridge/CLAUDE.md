# @ptah-extension/gateway-chat-bridge

[Back to Main](../../../CLAUDE.md)

## Purpose

The link between `messaging-gateway` and the agent runtime. Subscribes to `GatewayService`'s `inbound` events, runs each approved message through a Ptah agent session (`IAgentAdapter`), and streams the assistant reply back to the chat platform via the gateway's outbound primitives.

## Boundaries

**Belongs here**:

- `GatewayChatBridge` — inbound → session → outbound orchestrator
- `ConversationQueue` — per-conversation serial turn execution

**Does NOT belong**:

- Adapter/transport logic (lives in `messaging-gateway`)
- Agent/session lifecycle internals (lives in `agent-sdk` behind `IAgentAdapter`)
- RPC surface, UI, persistence

## Public API

Services: `GatewayChatBridge`, `ConversationQueue`.
DI: `GATEWAY_CHAT_BRIDGE_TOKENS`, `GatewayChatBridgeDIToken`, `registerGatewayChatBridge`.

## Internal Structure

- `src/lib/gateway-chat-bridge.ts` — orchestrator (`start()` / `stop()` / per-turn streaming)
- `src/lib/conversation-queue.ts` — per-key serial promise chain (concurrency 1 per conversation)
- `src/lib/di/{tokens,register}.ts`

## Behavior

- **Workspace resolution is conversation-first** (TASK_2026_156): `runTurn` calls `resolveEffectiveWorkspaceRoot` (from `messaging-gateway`) — `conversation.workspaceRoot` → `binding.workspaceRoot` → active workspace. A conversation-pinned root that left the allowlist FAILS CLOSED with a "run /workspace use" error reply (no silent fallback to the binding root), and every resolved root is `fs.access`-checked before a turn starts. Same resolver as `/sessions` / `/workspace use`, so lists and turns always agree.
- **Turn tracker**: `onInbound` wraps the whole enqueue in `ConversationTurnTracker.begin/end` (`GATEWAY_TOKENS.GATEWAY_TURN_TRACKER`) so the command service can refuse mutating commands while a turn is running or queued for that conversation. `end()` runs in a `.finally` on the enqueue promise — the watchdog guarantees settlement, so busy-state can't leak.
- First inbound for a binding (no `ptahSessionId` / not active) → `startChatSession({ tabId: 'gw-<bindingId>', prompt, projectPath, workspaceId, model, includePartialMessages: true })`. Subsequent turns → `resumeSession`.
- `model` is resolved per-turn from `ModelSettings.selectedModel` (provider-aware: resolves the active provider's `provider.<authKey>.selectedModel`, falling back to `'default'` when unset) — same source the chat RPC path uses. Never hardcode a model so Codex / other providers resolve correctly.
- First non-`tabId` `event.sessionId` is persisted to the conversation row via `ConversationStore.setPtahSessionId` (once). This first-turn bind path is also what makes `/new` work: the command clears the link, the next turn binds a fresh uuid.
- **Inbound permission gate (TASK_2026_192)**: gateway inbound is a REMOTE, non-interactive path, so every start/resume seeds `permissionLevel` from `ptah.gateway.permissionLevel` (read per turn via `IWorkspaceProvider.getConfiguration`, validated against `['ask','auto-edit','yolo']`), defaulting to the safe `'ask'`. At `'ask'` the SDK gate auto-approves only read-only SAFE tools; `Write`/`Edit`/`Bash`, network, and MCP tools are NOT auto-approved — they route to the local Ptah approval surface (`ptah.main` webview) and fail closed when it is absent. Raising the setting to `'auto-edit'` or `'yolo'` is an explicit operator opt-in to autonomous edits/exec from chat. The level is seeded at start/resume, never flipped post-hoc (`setSessionPermissionLevel` is never called).
- `text_delta` → `gateway.appendOutboundChunk` (accumulates only — no send). The coalescer runs in accumulate-until-drain mode, so `message_complete` is NOT a flush point. The turn's full assistant text is emitted as exactly ONE outbound `sendMessage` at end-of-turn via `sealTurn()` → `gateway.completeOutboundTurn` in the `finally` (success and error paths alike). No mid-turn flush, no live `editMessage` streaming.
- Resume failure or a zero-event corrupted stream falls back to a fresh `startChatSession`. Hard failures send a short error reply.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/settings-core`, `@ptah-extension/vscode-core`, `@ptah-extension/messaging-gateway` (incl. `resolveEffectiveWorkspaceRoot` + `ConversationTurnTracker`), `@ptah-extension/agent-sdk`, `@ptah-extension/agent-generation`, `@ptah-extension/vscode-lm-tools`
**External**: `tsyringe`

## Cross-Lib Rules

Wired only in Electron (`apps/ptah-electron`), next to `registerMessagingGatewayServices`. No frontend imports.
