import { Injectable, inject, signal } from '@angular/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { VoiceProviderErrorPayload } from '@ptah-extension/shared';
import { TabManagerService, workspaceLabelFromPath } from '@ptah-extension/chat-state';
import { ClaudeRpcService, LoggingService, NotificationService, attentionConditionKey, type AttentionActionOutcome, type MessageHandler, type NoticeActionHandler } from '@ptah-extension/core';

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
export class VoiceProviderErrorService implements MessageHandler, NoticeActionHandler {
  private readonly notifications = inject(NotificationService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  private readonly tabs = inject(TabManagerService, { optional: true });
  private generation = 0;
  private latestKey: string | null = null;
  private readonly errors = new Map<string, { generation: number; payload: VoiceProviderErrorPayload; workspacePath: string }>();
  private readonly switching = signal(false);
  readonly isSwitching = this.switching.asReadonly();
  readonly switchError = signal<string | null>(null);
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
    this.switchError.set(null);
    const workspacePath = this.tabs?.activeWorkspacePath ?? '';
    const key = attentionConditionKey(workspacePath, `voice-provider:${payload.direction}`);
    this.generation++;
    this.latestKey = key;
    this.errors.set(key, { generation: this.generation, payload, workspacePath });
    this.notifications.upsert({
      key, generation: this.generation, presentationKey: String(this.generation), source: 'chat', kind: 'failure', severity: 'error',
      workspacePath, workspaceName: workspaceLabelFromPath(workspacePath),
      title: `${payload.direction === 'stt' ? 'Speech-to-text' : 'Text-to-speech'} failed (${payload.providerId})`,
      context: payload.message,
      actions: [{ id: 'switch-to-local', label: 'Switch to local' }],
      actionable: true, soundEligible: false,
    });
  }

  /** Clear the tracked error (call after the user acts on or dismisses it). */
  dismiss(): void {
    this._latestError.set(null);
    if (this.latestKey) this.notifications.dismissPresentation(this.latestKey);
  }

  canHandle(key: string, actionId: string): boolean {
    return actionId === 'switch-to-local' && this.errors.has(key);
  }

  async run(key: string, generation: number, actionId: string): Promise<AttentionActionOutcome> {
    if (!this.canHandle(key, actionId) || this.errors.get(key)?.generation !== generation) return { kind: 'stale' };
    return await this.switchToLocal(key, generation)
      ? { kind: 'completed' }
      : { kind: 'unavailable', reason: this.switchError() ?? 'Could not switch to local provider' };
  }

  /** Called by the attention action dispatcher for the current notice. */
  async switchToLocal(key: string, generation: number): Promise<boolean> {
    const current = this.errors.get(key);
    if (!current || generation !== current.generation || this.switching()) return false;
    if (this.tabs && current.workspacePath !== (this.tabs.activeWorkspacePath ?? '')) {
      this.switchError.set('Open the notice workspace to switch its voice provider');
      return false;
    }
    this.switchError.set(null);
    this.switching.set(true);
    try {
      const result = await this.rpc.call('voice:setProviderConfig', current.payload.direction === 'stt'
        ? { sttProvider: 'local' } : { ttsProvider: 'local' });
      if (!result.isSuccess() || !result.data.ok) {
        this.switchError.set('Could not switch to local provider');
        return false;
      }
      const refreshed = await this.rpc.call('voice:getProviderConfig', {} as Record<string, never>);
      if (!refreshed.isSuccess()) {
        this.switchError.set('Could not switch to local provider');
        return false;
      }
      this.notifications.resolve(key, generation, 'chat');
      if (this.errors.get(key)?.generation === generation) {
        this.errors.delete(key);
        if (this.latestKey === key) {
          this.latestKey = null;
          this._latestError.set(null);
        }
      }
      return true;
    } catch (error) {
      // degradation-audit: reported - a failed provider switch is logged and remains actionable
      this.logger.warn('VoiceProviderErrorService', `Switch to local failed (${error instanceof Error ? error.name : 'unknown'})`);
      this.switchError.set('Could not switch to local provider');
      return false;
    } finally {
      this.switching.set(false);
    }
  }
}
