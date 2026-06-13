export const VOICE_ASSETS_UNAVAILABLE = 'VOICE_ASSETS_UNAVAILABLE' as const;

export const VOICE_ASSETS_REMEDIATION =
  'Voice transcription requires the Ptah desktop app, or install ffmpeg-static + nodejs-whisper alongside @hive-academy/ptah-cli.';

export class VoiceAssetsUnavailableError extends Error {
  readonly code = VOICE_ASSETS_UNAVAILABLE;
  readonly remediation = VOICE_ASSETS_REMEDIATION;

  constructor(asset: string, cause?: unknown) {
    super(
      `Voice asset "${asset}" is not available. ${VOICE_ASSETS_REMEDIATION}`,
    );
    this.name = 'VoiceAssetsUnavailableError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export function isModuleNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

export function isVoiceAssetsUnavailable(
  error: unknown,
): error is VoiceAssetsUnavailableError {
  return (
    error instanceof VoiceAssetsUnavailableError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === VOICE_ASSETS_UNAVAILABLE)
  );
}
