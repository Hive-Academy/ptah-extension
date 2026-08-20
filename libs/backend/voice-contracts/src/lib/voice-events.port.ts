import type { VoiceDirection } from './voice-provider.types';

/**
 * FR-1.4 — provider-agnostic download/readiness event surface. Local providers
 * emit these as model assets stream; the selector bridges them to the UI's
 * `voice:modelDownloadProgress` push channel.
 *
 * Consumers subscribe via {@link IVoiceDownloadEventSource.onDownload} and get
 * back a {@link VoiceEventDisposable} (mirrors `EmbedderWorkerClient`'s
 * Disposable-returning progress API — no raw EventEmitter leaks across ports).
 */
export type VoiceDownloadEvent =
  | {
      readonly kind: 'download:start';
      readonly direction: VoiceDirection;
      readonly model: string;
    }
  | {
      readonly kind: 'download:progress';
      readonly direction: VoiceDirection;
      readonly model: string;
      readonly percent: number;
    }
  | {
      readonly kind: 'download:complete';
      readonly direction: VoiceDirection;
      readonly model: string;
    }
  | {
      readonly kind: 'download:error';
      readonly direction: VoiceDirection;
      readonly model: string;
      readonly error: string;
    };

export interface VoiceEventDisposable {
  dispose(): void;
}

export interface IVoiceDownloadEventSource {
  onDownload(listener: (e: VoiceDownloadEvent) => void): VoiceEventDisposable;
}
