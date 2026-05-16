/**
 * @ptah-extension/messaging-gateway — public API.
 *
 * Exposes the GatewayService façade plus the subset of stores / interfaces
 * needed by:
 *   - `apps/ptah-electron/src/services/platform/electron-safe-storage-vault.ts`
 *     (implements `ITokenVault`).
 *   - `libs/backend/rpc-handlers/src/lib/handlers/gateway-rpc.handlers.ts`
 *     (drives `gateway:*` RPC methods through the service).
 */
export { GatewayService } from './lib/gateway.service';
export type {
  GatewayInboundEvent,
  GatewayStatus,
  GatewayTestOverrides,
} from './lib/gateway.service';

export { BindingStore } from './lib/binding.store';
export { MessageStore } from './lib/message.store';
export { StreamCoalescer } from './lib/stream-coalescer';
export type {
  CoalescerOptions,
  FlushPayload,
  FlushCallback,
} from './lib/stream-coalescer';

export type { ITokenVault } from './lib/token-vault.interface';
export type {
  IMessagingAdapter,
  InboundListener,
  InboundMessage,
  SendResult,
} from './lib/adapters/adapter.interface';

export { GrammyTelegramAdapter } from './lib/adapters/telegram/grammy.adapter';
export type {
  TelegramBotLike,
  TelegramContext,
  TelegramBotFactory,
} from './lib/adapters/telegram/grammy.adapter';

export { DiscordAdapter } from './lib/adapters/discord/discord.adapter';
export type {
  DiscordClientLike,
  DiscordInteractionLike,
  DiscordClientFactory,
} from './lib/adapters/discord/discord.adapter';

export { BoltSlackAdapter } from './lib/adapters/slack/bolt.adapter';
export type {
  SlackBoltAppLike,
  SlackEvent,
  SlackEventHandlerArgs,
  SlackAppFactory,
} from './lib/adapters/slack/bolt.adapter';

export { FfmpegDecoder } from './lib/voice/ffmpeg-decoder';
export type { FfmpegBinaryResolver } from './lib/voice/ffmpeg-decoder';
export { WhisperTranscriber } from './lib/voice/whisper-transcriber';
export type {
  NodejsWhisperApi,
  NodejsWhisperLoader,
} from './lib/voice/whisper-transcriber';

export { BindingId, ConversationKey, GatewayMessageId } from './lib/types';
export type {
  ApprovalStatus,
  Direction,
  GatewayBinding,
  GatewayMessage,
  GatewayPlatform,
} from './lib/types';

export { GATEWAY_TOKENS } from './lib/di/tokens';
export type { GatewayDIToken } from './lib/di/tokens';
export { registerMessagingGatewayServices } from './lib/di/register';
