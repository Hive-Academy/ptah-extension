/**
 * Typed message protocol shared by the voice worker entry
 * (`voice-worker.ts`) and the main-side client (`voice-worker-client.ts`).
 * Importing the same types on both sides guarantees compile-level contract
 * parity (mirrors the embedder worker's id-correlated protocol).
 *
 * All requests carry a numeric `id` (except `init`, which is fire-and-forget
 * and arrives before any request). Responses echo the `id`; download progress
 * is an out-of-band stream keyed by `direction` + `model`, not by `id`.
 */
import type {
  VoiceDirection,
  VoiceErrorCategory,
  VoiceModelSpec,
} from '@ptah-extension/voice-contracts';

/** Config delivered once, immediately after spawn, before any request. */
export interface VoiceWorkerInitMessage {
  readonly type: 'init';
  /** Absolute path to the ffmpeg binary (null → decode unavailable). */
  readonly ffmpegPath: string | null;
  /** Writable transformers model cache dir (null → library default). */
  readonly modelCacheDir: string | null;
}

export interface VoiceTranscribeRequest {
  readonly id: number;
  readonly type: 'stt:transcribe';
  /** Absolute path to the encoded recording; decoded inside the worker. */
  readonly audioPath: string;
  readonly model: VoiceModelSpec;
}

export interface VoiceSynthesizeRequest {
  readonly id: number;
  readonly type: 'tts:synthesize';
  readonly text: string;
  readonly voice: string;
  readonly model: VoiceModelSpec;
  readonly dtype: string;
}

export interface VoiceSttDownloadRequest {
  readonly id: number;
  readonly type: 'stt:download';
  readonly model: VoiceModelSpec;
}

export interface VoiceTtsDownloadRequest {
  readonly id: number;
  readonly type: 'tts:download';
  readonly model: VoiceModelSpec;
  readonly dtype: string;
}

export interface VoiceDisposeRequest {
  readonly id: number;
  readonly type: 'dispose';
}

export type VoiceWorkerRequest =
  | VoiceTranscribeRequest
  | VoiceSynthesizeRequest
  | VoiceSttDownloadRequest
  | VoiceTtsDownloadRequest
  | VoiceDisposeRequest;

export type VoiceWorkerInbound = VoiceWorkerInitMessage | VoiceWorkerRequest;

export interface VoiceTranscribeResponse {
  readonly id: number;
  readonly ok: true;
  readonly text: string;
}

export interface VoiceSynthesizeResponse {
  readonly id: number;
  readonly ok: true;
  readonly wav: Uint8Array;
  readonly sampleRate: number;
}

export interface VoiceDownloadResponse {
  readonly id: number;
  readonly ok: true;
  readonly alreadyPresent: boolean;
}

export interface VoiceErrorResponse {
  readonly id: number;
  readonly ok: false;
  /** Sanitized message — never a raw response body/header/key material. */
  readonly error: string;
  readonly category: VoiceErrorCategory;
}

export type VoiceWorkerResponse =
  | VoiceTranscribeResponse
  | VoiceSynthesizeResponse
  | VoiceDownloadResponse
  | VoiceErrorResponse;

/**
 * Out-of-band download-lifecycle stream. Keyed by `direction` + `model` so the
 * client can fan it out to the provider-agnostic `IVoiceDownloadEventSource`
 * (preserves the UI's `voice:modelDownloadProgress` `{model, percent}` payload
 * + `'tts'` sentinel via the handler mapping).
 */
export interface VoiceDownloadProgressMessage {
  readonly type: 'download-progress';
  readonly direction: VoiceDirection;
  readonly model: string;
  readonly kind:
    | 'download:start'
    | 'download:progress'
    | 'download:complete'
    | 'download:error';
  readonly percent?: number;
  readonly error?: string;
}

export type VoiceWorkerOutbound =
  | VoiceWorkerResponse
  | VoiceDownloadProgressMessage;

export function isDownloadProgressMessage(
  msg: unknown,
): msg is VoiceDownloadProgressMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'download-progress'
  );
}
