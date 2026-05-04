/**
 * messaging-gateway DI registration helper.
 *
 * Mirrors the contract of `registerSdkServices` / `registerPersistenceSqliteServices`:
 * callers must already have:
 *   - `TOKENS.LOGGER` registered (vscode-core / electron container Phase 1).
 *   - `PLATFORM_TOKENS.WORKSPACE_PROVIDER` registered.
 *   - `PERSISTENCE_TOKENS.SQLITE_CONNECTION` registered.
 *   - `GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT` registered (Electron host wires
 *     `ElectronSafeStorageVault` in `phase-3-storage.ts`).
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { GATEWAY_TOKENS } from './tokens';
import { GatewayService } from '../gateway.service';
import { BindingStore } from '../binding.store';
import { MessageStore } from '../message.store';
import { FfmpegDecoder } from '../voice/ffmpeg-decoder';
import { WhisperTranscriber } from '../voice/whisper-transcriber';
import { GrammyTelegramAdapter } from '../adapters/telegram/grammy.adapter';
import { DiscordAdapter } from '../adapters/discord/discord.adapter';
import { BoltSlackAdapter } from '../adapters/slack/bolt.adapter';

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

  // Adapters are registered as concrete-class singletons — GatewayService
  // injects them by class (not by token), so only the class registrations
  // are needed.
  container.registerSingleton(GrammyTelegramAdapter);
  container.registerSingleton(DiscordAdapter);
  container.registerSingleton(BoltSlackAdapter);

  container.registerSingleton(GATEWAY_TOKENS.GATEWAY_SERVICE, GatewayService);

  logger.info('[messaging-gateway] services registered', {
    tokens: Object.keys(GATEWAY_TOKENS),
  });
}
