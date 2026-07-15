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
export { ConversationStore } from './lib/conversation.store';
export { MessageStore } from './lib/message.store';
export { AttachedSessionRegistry } from './lib/attached-session-registry';
export { JsonlSessionResumabilityChecker } from './lib/session-resumability';
export type { ISessionResumabilityChecker } from './lib/session-resumability';
export { ConversationTurnTracker } from './lib/turn-activity-tracker';
export {
  normalizeWorkspacePath,
  isAllowlistedWorkspaceRoot,
  resolveEffectiveWorkspaceRoot,
  workspaceRootDigest,
} from './lib/workspace-resolution';
export type { EffectiveWorkspace } from './lib/workspace-resolution';
export type {
  IGatewaySessionLister,
  GatewaySessionSummary,
} from './lib/session-lister.interface';
export type { ISessionActivityProbe } from './lib/session-activity.interface';
export type {
  GatewayCommand,
  GatewayCommandInvocation,
  GatewayCommandOutcome,
  GatewayAutocompleteRequest,
  IGatewayCommandHandler,
} from './lib/commands/gateway-command.types';
export { StreamCoalescer } from './lib/stream-coalescer';
export type {
  CoalescerOptions,
  FlushPayload,
  FlushCallback,
  OutboundRoute,
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

export { BindingId, ConversationKey, GatewayMessageId } from './lib/types';
export type {
  ApprovalStatus,
  Direction,
  GatewayBinding,
  GatewayConversation,
  GatewayConversationId,
  GatewayMessage,
  GatewayPlatform,
} from './lib/types';

export { GATEWAY_TOKENS } from './lib/di/tokens';
export type { GatewayDIToken } from './lib/di/tokens';
export { registerMessagingGatewayServices } from './lib/di/register';
