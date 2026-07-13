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
import {
  VoiceWorkerClient,
  DEFAULT_IDLE_MS,
} from '../local/voice-worker-client';
import { LocalSttProvider } from '../local/local-stt-provider';
import { LocalTtsProvider } from '../local/local-tts-provider';
import { VoiceSecretStore } from '../voice-secret-store';
import { VoiceProviderRegistry } from '../voice-provider-registry';
import { VoiceProviderSelector } from '../voice-provider-selector';
import { ElevenLabsClient } from '../elevenlabs/elevenlabs-client';
import { ElevenLabsTtsProvider } from '../elevenlabs/elevenlabs-tts-provider';
import { ElevenLabsSttProvider } from '../elevenlabs/elevenlabs-stt-provider';

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

  // Idle-teardown window for the worker client. Injected `{ isOptional: true }`
  // with the same default, but registered explicitly so the DI graph is fully
  // resolvable (di-lint does not honor optional injections).
  container.registerInstance(
    VOICE_TOKENS.VOICE_WORKER_IDLE_MS,
    DEFAULT_IDLE_MS,
  );

  // ElevenLabs cloud adapters (fetch-based). Registered here but unreachable
  // from the UI until Batch 5 — the selector defaults to `local`. The registry
  // injects these two provider tokens `{ isOptional: true }`.
  container.registerSingleton(VOICE_TOKENS.ELEVENLABS_CLIENT, ElevenLabsClient);
  container.registerSingleton(
    VOICE_TOKENS.ELEVENLABS_TTS_PROVIDER,
    ElevenLabsTtsProvider,
  );
  container.registerSingleton(
    VOICE_TOKENS.ELEVENLABS_STT_PROVIDER,
    ElevenLabsSttProvider,
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
