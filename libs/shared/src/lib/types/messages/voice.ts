/**
 * Payload for MESSAGE_TYPES.VOICE_MODEL_DOWNLOAD_PROGRESS
 * ('voice:modelDownloadProgress').
 *
 * Emitted by the backend while a Whisper model is being fetched via
 * `voice:downloadModel`, so the settings UI can render a live progress bar.
 * `percent` is the integer download progress: 0-99 during transfer and a
 * final 100 on completion. Failures are signalled by the `voice:downloadModel`
 * RPC result, not this channel.
 */
export interface VoiceModelDownloadProgressPayload {
  model: string;
  percent: number;
}

/**
 * Payload for MESSAGE_TYPES.VOICE_PROVIDER_ERROR ('voice:providerError').
 *
 * Broadcast by the backend (FR-7) when a CLOUD voice provider fails a
 * transcribe/synthesize call with a cloud-category error (auth / quota /
 * network / provider-error). The frontend renders a categorized notice with a
 * one-click "switch to local" affordance. The error result is ALSO returned to
 * the originating RPC caller — this channel does NOT retry or substitute.
 *
 * `message` is the sanitized `VoiceProviderError` message — never a raw response
 * body, header, or key material.
 */
export interface VoiceProviderErrorPayload {
  readonly direction: 'tts' | 'stt';
  readonly providerId: string;
  readonly category: 'auth' | 'quota' | 'network' | 'provider-error';
  readonly message: string;
}
