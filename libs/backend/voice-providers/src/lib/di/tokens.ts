/**
 * DI tokens internal to `voice-providers`. `Symbol.for(...)` with Ptah-prefixed
 * unique descriptions (GATEWAY_TOKENS convention). The port-facing tokens
 * (registry / selector / vault) live in `voice-contracts`
 * (`VOICE_CONTRACT_TOKENS`) — these are the concrete-wiring tokens.
 */
export const VOICE_TOKENS = {
  /** Absolute path to the bundled `voice-worker.mjs` (host-registered). */
  VOICE_WORKER_PATH: Symbol.for('PtahVoiceWorkerPath'),
  /** IVoiceWorkerProcessFactory — host impl (Electron utilityProcess). */
  VOICE_WORKER_PROCESS_FACTORY: Symbol.for('PtahVoiceWorkerProcessFactory'),
  /** VoiceWorkerClient — main-side proxy + download event source. */
  VOICE_WORKER_CLIENT: Symbol.for('PtahVoiceWorkerClient'),
  /** Optional idle-teardown override (ms) — mainly a test seam. */
  VOICE_WORKER_IDLE_MS: Symbol.for('PtahVoiceWorkerIdleMs'),
  /** Writable transformers model cache dir (host-registered, optional). */
  VOICE_MODEL_CACHE_DIR: Symbol.for('PtahVoiceModelCacheDir'),
  /** VoiceSecretStore — ElevenLabs key ciphertext store. */
  VOICE_SECRET_STORE: Symbol.for('PtahVoiceSecretStore'),
  /** Local Whisper STT provider (concrete). */
  LOCAL_STT_PROVIDER: Symbol.for('PtahVoiceLocalSttProvider'),
  /** Local Kokoro TTS provider (concrete). */
  LOCAL_TTS_PROVIDER: Symbol.for('PtahVoiceLocalTtsProvider'),
  /** ElevenLabs TTS provider (concrete, wired in a later batch). */
  ELEVENLABS_TTS_PROVIDER: Symbol.for('PtahVoiceElevenLabsTtsProvider'),
  /** ElevenLabs STT provider (concrete, wired in a later batch). */
  ELEVENLABS_STT_PROVIDER: Symbol.for('PtahVoiceElevenLabsSttProvider'),
} as const;

export type VoiceDIToken = keyof typeof VOICE_TOKENS;
