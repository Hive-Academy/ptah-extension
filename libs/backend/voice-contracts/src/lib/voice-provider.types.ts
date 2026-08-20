/**
 * Core voice-provider value types shared across the TTS/STT ports, the
 * registry/selector, and the RPC surface. Pure data — no behaviour, no deps.
 */

/** The set of supported voice providers (FR-1). */
export type VoiceProviderId = 'local' | 'elevenlabs';

/** Voice direction: text-to-speech (synthesis) or speech-to-text (transcription). */
export type VoiceDirection = 'tts' | 'stt';

/**
 * Static + runtime capability descriptor for a provider. `available` is
 * computed at wiring time (false on runtimes missing prerequisites, e.g. no
 * worker factory on VS Code/CLI, or no vault for a cloud key).
 */
export interface VoiceProviderCapability {
  readonly id: VoiceProviderId;
  /** Human label, e.g. 'Local (Whisper / Kokoro)', 'ElevenLabs'. */
  readonly label: string;
  readonly kind: 'local' | 'cloud';
  readonly requiresDownload: boolean;
  readonly requiresApiKey: boolean;
  readonly supports: { readonly tts: boolean; readonly stt: boolean };
  /** False on runtimes missing prerequisites (no worker factory / no vault). NFR: VS Code/CLI degrade. */
  readonly available: boolean;
  /** Human reason when available=false (e.g. VOICE_ASSETS_REMEDIATION text). */
  readonly unavailableReason?: string;
}

/** FR-4 — user-selected model source, per direction. */
export type VoiceModelSpec =
  | { readonly kind: 'curated'; readonly name: string } // e.g. 'base.en', default Kokoro repo
  | { readonly kind: 'hf'; readonly repoId: string } // user HF repo id
  | { readonly kind: 'dir'; readonly path: string }; // local model directory (absolute)

export interface SynthesizeRequest {
  readonly text: string;
  /** Provider-interpreted voice id (Kokoro 'af_heart' / ElevenLabs voice_id). */
  readonly voice?: string;
}

export interface SynthesizeResult {
  readonly audio: Uint8Array;
  /** 'audio/wav' local, 'audio/mpeg' ElevenLabs mp3, 'audio/ogg' opus. */
  readonly mimeType: string;
  readonly sampleRate?: number;
}

export interface TranscribeRequest {
  /** Absolute path to the encoded recording (webm/ogg/mp4/wav). Providers own decode. */
  readonly audioPath: string;
  readonly mimeType: string;
}

export interface TranscribeResult {
  readonly text: string;
}

/** FR-5.3 voice list entry. */
export interface VoiceInfo {
  readonly id: string;
  readonly label: string;
  readonly category?: string;
}

export interface VoiceReadiness {
  readonly ready: boolean;
  /** 'model-not-downloaded' | 'api-key-missing' | 'unavailable' | undefined when ready. */
  readonly reason?: string;
}
