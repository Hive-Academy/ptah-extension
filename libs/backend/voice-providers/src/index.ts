/**
 * @ptah-extension/voice-providers — public API.
 *
 * Local (Whisper/Kokoro) provider adapters behind the FR-1 ports, the
 * utilityProcess worker client + host port, the registry/selector, the vault-
 * backed secret store, and the DI wiring. Cloud (ElevenLabs) adapters land in a
 * later batch. The `voice-worker.ts` entry is NOT exported — it is bundled
 * separately by ptah-electron's `build-voice-worker` target.
 */

// DI
export { VOICE_TOKENS } from './lib/di/tokens';
export type { VoiceDIToken } from './lib/di/tokens';
export { registerVoiceProviderServices } from './lib/di/register';

// Registry / selector / secret store
export { VoiceProviderRegistry } from './lib/voice-provider-registry';
export { VoiceProviderSelector } from './lib/voice-provider-selector';
export { VoiceSecretStore } from './lib/voice-secret-store';

// Local adapters + worker client
export { LocalSttProvider } from './lib/local/local-stt-provider';
export { LocalTtsProvider } from './lib/local/local-tts-provider';
export { VoiceWorkerClient } from './lib/local/voice-worker-client';

// ElevenLabs cloud adapters
export {
  ElevenLabsClient,
  mapElevenLabsError,
} from './lib/elevenlabs/elevenlabs-client';
export {
  ElevenLabsTtsProvider,
  mimeTypeForFormat,
} from './lib/elevenlabs/elevenlabs-tts-provider';
export { ElevenLabsSttProvider } from './lib/elevenlabs/elevenlabs-stt-provider';
export type {
  IVoiceWorkerProcess,
  IVoiceWorkerProcessFactory,
} from './lib/local/worker-process.port';

// Worker protocol (shared by the Electron factory that sends `init`)
export type {
  VoiceWorkerInbound,
  VoiceWorkerInitMessage,
  VoiceWorkerRequest,
  VoiceWorkerResponse,
  VoiceWorkerOutbound,
  VoiceDownloadProgressMessage,
} from './lib/worker/voice-worker-protocol';

// Settings resolution helpers (consumed by rpc-handlers)
export {
  resolveWhisperModel,
  resolveTtsVoice,
  resolveSttModelSpec,
  resolveTtsModelSpec,
  VOICE_WHISPER_MODEL_KEY,
  VOICE_WHISPER_MODEL_SOURCE_KEY,
  VOICE_WHISPER_CUSTOM_MODEL_KEY,
  VOICE_TTS_VOICE_KEY,
  VOICE_KOKORO_MODEL_SOURCE_KEY,
  VOICE_KOKORO_CUSTOM_MODEL_KEY,
  DEFAULT_WHISPER_MODEL,
} from './lib/local/model-settings';
export type { VoiceSettingsReader } from './lib/local/model-settings';
