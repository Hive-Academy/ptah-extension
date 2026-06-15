import { Injectable, signal } from '@angular/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { VoiceModelDownloadProgressPayload } from '@ptah-extension/shared';
import type { MessageHandler } from '@ptah-extension/core';

/**
 * Root-level handler for `voice:modelDownloadProgress` push events. Exposes the
 * latest progress tick as a signal so the voice settings component can render a
 * live download bar. Registered in the webview `MESSAGE_HANDLERS` multi-provider.
 */
@Injectable({ providedIn: 'root' })
export class VoiceDownloadProgressService implements MessageHandler {
  private readonly _progress = signal<VoiceModelDownloadProgressPayload | null>(
    null,
  );

  /** Most recent download progress tick, or `null` between downloads. */
  readonly progress = this._progress.asReadonly();

  readonly handledMessageTypes = [
    MESSAGE_TYPES.VOICE_MODEL_DOWNLOAD_PROGRESS,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== MESSAGE_TYPES.VOICE_MODEL_DOWNLOAD_PROGRESS) return;
    const payload = message.payload as
      | VoiceModelDownloadProgressPayload
      | undefined;
    if (!payload) return;
    this._progress.set(payload);
  }

  /** Clear the tracked progress (call when a download starts or finishes). */
  reset(): void {
    this._progress.set(null);
  }
}
