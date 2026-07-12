import type { VoiceProviderId } from './voice-provider.types';

/**
 * Sentinel code + remediation text for the "local voice assets are missing"
 * condition. Relocated here (from messaging-gateway's `voice-assets-error.ts`)
 * so `rpc-handlers` keeps its existing `code`/`remediation` response contract
 * without importing messaging-gateway. Byte-identical to the originals — the
 * originals are removed in a later batch, not here.
 */
export const VOICE_ASSETS_UNAVAILABLE = 'VOICE_ASSETS_UNAVAILABLE' as const;

export const VOICE_ASSETS_REMEDIATION =
  'Voice transcription requires the Ptah desktop app, or install ffmpeg-static + @huggingface/transformers alongside @hive-academy/ptah-cli.';

/**
 * Provider-agnostic error taxonomy (FR-7.1, NFR security). Every message is
 * pre-sanitized by the throwing adapter — never a raw response body, header,
 * or key material.
 */
export type VoiceErrorCategory =
  | 'auth' // 401/403, invalid/expired key
  | 'quota' // 402/429 or provider quota_exceeded detail
  | 'network' // fetch TypeError, abort/timeout, offline
  | 'assets-unavailable' // local runtime deps missing (keeps VOICE_ASSETS_UNAVAILABLE semantics)
  | 'model-invalid' // FR-4.3/4.4 bad HF repo / local dir
  | 'process-crashed' // FR-2.2 worker died mid-request
  | 'provider-error'; // sanitized other

export class VoiceProviderError extends Error {
  readonly code = 'VOICE_PROVIDER_ERROR';

  constructor(
    readonly category: VoiceErrorCategory,
    readonly providerId: VoiceProviderId,
    message: string, // ALWAYS sanitized — never raw response bodies/headers
    readonly remediation?: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'VoiceProviderError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export function isVoiceProviderError(e: unknown): e is VoiceProviderError {
  return (
    e instanceof VoiceProviderError ||
    (typeof e === 'object' &&
      e !== null &&
      (e as { code?: unknown }).code === 'VOICE_PROVIDER_ERROR')
  );
}
