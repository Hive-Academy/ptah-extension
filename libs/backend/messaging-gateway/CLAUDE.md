# @ptah-extension/messaging-gateway

[Back to Main](../../../CLAUDE.md)

## Purpose

Track 4 of TASK_2026_HERMES. `GatewayService` façade routes inbound messages from Telegram / Discord / Slack into Ptah, with token-vault credential storage and FFmpeg/Whisper voice transcription.

## Boundaries

**Belongs here**:

- `GatewayService` orchestrator
- Per-platform `IMessagingAdapter` implementations (`GrammyTelegramAdapter`, `DiscordAdapter`, `BoltSlackAdapter`)
- Stores: `BindingStore`, `MessageStore`
- `StreamCoalescer` (response chunk batching)
- Voice: `FfmpegDecoder`, `WhisperTranscriber`
- `ITokenVault` port (impl in `apps/ptah-electron`)

**Does NOT belong**:

- RPC surface (`gateway-rpc.handlers.ts` in `rpc-handlers`)
- Token vault implementation (each platform provides its own — Electron uses safeStorage)

## Public API

Services: `GatewayService`, `BindingStore`, `MessageStore`, `StreamCoalescer`, `FfmpegDecoder`, `WhisperTranscriber`.
Adapters: `GrammyTelegramAdapter`, `DiscordAdapter`, `BoltSlackAdapter` + their factory/client-like types.
Interfaces: `ITokenVault`, `IMessagingAdapter`, `InboundListener`, `InboundMessage`, `SendResult`.
Types: `GatewayInboundEvent`, `GatewayStatus`, `GatewayTestOverrides`, `BindingId`, `ConversationKey`, `GatewayMessageId`, `ApprovalStatus`, `Direction`, `GatewayBinding`, `GatewayMessage`, `GatewayPlatform`.
DI: `GATEWAY_TOKENS`, `GatewayDIToken`, `registerMessagingGatewayServices`.

## Internal Structure

- `src/lib/gateway.service.ts` — façade
- `src/lib/binding.store.ts`, `message.store.ts` — SQLite-backed (uses persistence-sqlite)
- `src/lib/adapters/{telegram,discord,slack}/` — per-platform adapters behind `IMessagingAdapter`
- `src/lib/voice/` — `ffmpeg-decoder.ts`, `whisper-transcriber.ts`
- `src/lib/stream-coalescer.ts` — flushes streamed AI output in batched chunks
- `src/lib/token-vault.interface.ts`
- `src/lib/di/{tokens,register}.ts`

## Dependencies

**Internal**: `@ptah-extension/persistence-sqlite`, `@ptah-extension/platform-core`
**External**: `grammy` (Telegram), `discord.js`, `@slack/bolt`, `nodejs-whisper`, FFmpeg binary resolver, `tsyringe`

## Guidelines

- Adapter implementations stay behind `IMessagingAdapter` — handlers and `GatewayService` use only the interface.
- Whisper/FFmpeg loaders are injected as factories so tests can stub them.
- Credentials always come through `ITokenVault` — never accept raw secrets in code.
- `StreamCoalescer` is the only path for streaming replies — handlers don't post chunks directly.

## Cross-Lib Rules

Used by `rpc-handlers` (`GatewayRpcHandlers`) and `apps/ptah-electron` (vault impl). No frontend imports.
