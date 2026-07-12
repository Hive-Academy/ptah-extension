/**
 * voice-providers DI registration.
 *
 * Prerequisites (host-registered before this call):
 *   - `TOKENS.LOGGER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`.
 *   - Optional `VOICE_TOKENS.VOICE_WORKER_PROCESS_FACTORY` + `VOICE_MODEL_CACHE_DIR`
 *     (Electron host) — absent on VS Code / CLI → local providers degrade to
 *     `available: false`.
 *   - Optional `VOICE_CONTRACT_TOKENS.VOICE_TOKEN_VAULT` (Electron) — absent →
 *     cloud key storage unavailable.
 *
 * Registers the worker client, local providers, secret store, and binds the
 * registry + selector under the `voice-contracts` port tokens. Idempotent.
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { VOICE_CONTRACT_TOKENS } from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from './tokens';
import { VoiceWorkerClient } from '../local/voice-worker-client';
import { LocalSttProvider } from '../local/local-stt-provider';
import { LocalTtsProvider } from '../local/local-tts-provider';
import { VoiceSecretStore } from '../voice-secret-store';
import { VoiceProviderRegistry } from '../voice-provider-registry';
import { VoiceProviderSelector } from '../voice-provider-selector';

export function registerVoiceProviderServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  if (container.isRegistered(VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_SELECTOR)) {
    return;
  }

  container.registerSingleton(
    VOICE_TOKENS.VOICE_WORKER_CLIENT,
    VoiceWorkerClient,
  );
  container.registerSingleton(
    VOICE_TOKENS.LOCAL_STT_PROVIDER,
    LocalSttProvider,
  );
  container.registerSingleton(
    VOICE_TOKENS.LOCAL_TTS_PROVIDER,
    LocalTtsProvider,
  );
  container.registerSingleton(
    VOICE_TOKENS.VOICE_SECRET_STORE,
    VoiceSecretStore,
  );

  container.registerSingleton(
    VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_REGISTRY,
    VoiceProviderRegistry,
  );
  container.registerSingleton(
    VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_SELECTOR,
    VoiceProviderSelector,
  );

  logger.info('[voice-providers] services registered');
}
