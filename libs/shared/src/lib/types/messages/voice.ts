/**
 * Payload for MESSAGE_TYPES.VOICE_MODEL_DOWNLOAD_PROGRESS
 * ('voice:modelDownloadProgress').
 *
 * Emitted by the backend while a Whisper model is being fetched via
 * `voice:downloadModel`, so the settings UI can render a live progress bar.
 * `percent` is the integer download progress (0-99 during transfer); the
 * `voice:downloadModel` RPC result signals final completion/failure.
 */
export interface VoiceModelDownloadProgressPayload {
  model: string;
  percent: number;
}
