import { Injectable, signal } from '@angular/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { VoiceProviderErrorPayload } from '@ptah-extension/shared';
import type { MessageHandler } from '@ptah-extension/core';

/**
 * Root-level handler for `voice:providerError` push events (FR-7). When a CLOUD
 * voice provider fails a transcribe/synthesize call with a cloud-category error,
 * the backend broadcasts a sanitized `VoiceProviderErrorPayload`. This service
 * captures the latest one as a signal so the switch-to-local toast can render a
 * categorized notice with a one-click recovery action.
 *
 * Mirrors `VoiceDownloadProgressService`: it implements `MessageHandler` and is
 * registered in the webview `MESSAGE_HANDLERS` multi-provider. The channel never
 * retries or substitutes a provider — the failing RPC still returns its error to
 * the caller; this surface only offers the user an explicit switch (FR-7.3).
 */
@Injectable({ providedIn: 'root' })
export class VoiceProviderErrorService implements MessageHandler {
  private readonly _latestError = signal<VoiceProviderErrorPayload | null>(
    null,
  );

  /** Most recent cloud-provider error, or `null` once dismissed. */
  readonly latestError = this._latestError.asReadonly();

  readonly handledMessageTypes = [MESSAGE_TYPES.VOICE_PROVIDER_ERROR] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== MESSAGE_TYPES.VOICE_PROVIDER_ERROR) return;
    const payload = message.payload as VoiceProviderErrorPayload | undefined;
    if (!payload) return;
    this._latestError.set(payload);
  }

  /** Clear the tracked error (call after the user acts on or dismisses it). */
  dismiss(): void {
    this._latestError.set(null);
  }
}
