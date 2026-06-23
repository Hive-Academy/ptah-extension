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

- First inbound for a binding (no `ptahSessionId` / not active) → `startChatSession({ tabId: 'gw-<bindingId>', prompt, projectPath, workspaceId, model, includePartialMessages: true })`. Subsequent turns → `resumeSession`.
- `model` is resolved per-turn from `ModelSettings.selectedModel` (provider-aware: resolves the active provider's `provider.<authKey>.selectedModel`, falling back to `'default'` when unset) — same source the chat RPC path uses. Never hardcode a model so Codex / other providers resolve correctly.
- First non-`tabId` `event.sessionId` is persisted via `BindingStore.setPtahSessionId` (once), then the session is switched to bypass permission (v1 auto-approve).
- `text_delta` → `gateway.appendOutboundChunk`; `message_complete` → `gateway.drainOutbound`.
- Resume failure or a zero-event corrupted stream falls back to a fresh `startChatSession`. Hard failures send a short error reply.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/settings-core`, `@ptah-extension/vscode-core`, `@ptah-extension/messaging-gateway`
**External**: `tsyringe`

## Cross-Lib Rules

Wired only in Electron (`apps/ptah-electron`), next to `registerMessagingGatewayServices`. No frontend imports.
