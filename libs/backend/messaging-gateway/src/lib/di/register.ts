/**
 * messaging-gateway DI registration helper.
 *
 * Mirrors the contract of `registerSdkServices` / `registerPersistenceSqliteServices`:
 * callers must already have:
 *   - `TOKENS.LOGGER` registered.
 *   - `PLATFORM_TOKENS.WORKSPACE_PROVIDER` registered.
 *   - `PERSISTENCE_TOKENS.SQLITE_CONNECTION` registered.
 *   - `GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT` registered (Electron host wires
 *     `ElectronSafeStorageVault`).
 *   - `GATEWAY_TOKENS.GATEWAY_SESSION_LISTER` registered (Electron host wires
 *     `MetadataGatewaySessionLister` — required once the command control
 *     plane is resolved).
 *   - `GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE` registered (Electron
 *     host wires a factory over `TOKENS.AGENT_ADAPTER.isSessionActive`).
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type ISessionAttachmentGuard,
} from '@ptah-extension/platform-core';
import { GATEWAY_TOKENS } from './tokens';
import { GatewayService } from '../gateway.service';
import { BindingStore } from '../binding.store';
import { ConversationStore } from '../conversation.store';
import { MessageStore } from '../message.store';
import { FfmpegDecoder } from '../voice/ffmpeg-decoder';
import { WhisperTranscriber } from '../voice/whisper-transcriber';
import { KokoroSynthesizer } from '../voice/kokoro-synthesizer';
import { GrammyTelegramAdapter } from '../adapters/telegram/grammy.adapter';
import { DiscordAdapter } from '../adapters/discord/discord.adapter';
import { BoltSlackAdapter } from '../adapters/slack/bolt.adapter';
import { AttachedSessionRegistry } from '../attached-session-registry';
import { JsonlSessionResumabilityChecker } from '../session-resumability';
import { ConversationTurnTracker } from '../turn-activity-tracker';
import { GatewayCommandService } from '../commands/gateway-command.service';

export function registerMessagingGatewayServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[messaging-gateway] registering services');

  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_BINDING_STORE,
    BindingStore,
  );
  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_CONVERSATION_STORE,
    ConversationStore,
  );
  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_MESSAGE_STORE,
    MessageStore,
  );
  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_FFMPEG_DECODER,
    FfmpegDecoder,
  );
  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_WHISPER_TRANSCRIBER,
    WhisperTranscriber,
  );
  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_KOKORO_SYNTHESIZER,
    KokoroSynthesizer,
  );
  container.registerSingleton(GrammyTelegramAdapter);
  container.registerSingleton(DiscordAdapter);
  container.registerSingleton(BoltSlackAdapter);

  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_ATTACHED_SESSION_REGISTRY,
    AttachedSessionRegistry,
  );
  // Bind the platform-core port to the SAME registry singleton so the shared
  // chat RPC handler (`chat:resume`) can consult attach state via the
  // gateway-agnostic `ISessionAttachmentGuard` token. This overrides the
  // `NullSessionAttachmentGuard` default registered by vscode-core's
  // platform-agnostic bootstrap (Electron host only — the VS Code host keeps
  // the no-op default).
  container.register<ISessionAttachmentGuard>(
    PLATFORM_TOKENS.SESSION_ATTACHMENT_GUARD,
    {
      useFactory: (c) =>
        c.resolve<AttachedSessionRegistry>(
          GATEWAY_TOKENS.GATEWAY_ATTACHED_SESSION_REGISTRY,
        ),
    },
  );
  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_SESSION_RESUMABILITY_CHECKER,
    JsonlSessionResumabilityChecker,
  );
  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_TURN_TRACKER,
    ConversationTurnTracker,
  );
  // Resolution requires the two host-registered collaborators documented in
  // the header (GATEWAY_SESSION_LISTER, GATEWAY_SESSION_ACTIVITY_PROBE).
  container.registerSingleton(
    GATEWAY_TOKENS.GATEWAY_COMMAND_SERVICE,
    GatewayCommandService,
  );

  container.registerSingleton(GATEWAY_TOKENS.GATEWAY_SERVICE, GatewayService);

  logger.info('[messaging-gateway] services registered', {
    tokens: Object.keys(GATEWAY_TOKENS),
  });
}
