export const VOICE_ASSETS_UNAVAILABLE = 'VOICE_ASSETS_UNAVAILABLE' as const;

export const VOICE_ASSETS_REMEDIATION =
  'Voice transcription requires the Ptah desktop app, or install ffmpeg-static + @huggingface/transformers alongside @hive-academy/ptah-cli.';

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

/**
 * Detects an ENOENT for a Kokoro per-voice style vector (`voices/<name>.bin`).
 * `kokoro-js` resolves these files relative to its own package dir and reads
 * them with `fs.readFile`, ignoring the transformers cache dir — so in a
 * packaged app where the `voices/` folder is missing they surface as a raw
 * fs ENOENT. Narrowing on both the code and the `voices/*.bin` shape (path
 * or message, separator-agnostic) lets callers convert them into a typed
 * {@link VoiceAssetsUnavailableError} instead of leaking the fs path.
 */
export function isVoiceBinNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code !== 'ENOENT') return false;
  const rawPath = (error as { path?: unknown }).path;
  const target =
    typeof rawPath === 'string'
      ? rawPath
      : error instanceof Error
        ? error.message
        : '';
  return /voices[\\/][^\\/]+\.bin/i.test(target);
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
