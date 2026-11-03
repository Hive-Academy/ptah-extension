import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, type MessageHandler } from '@ptah-extension/core';
import { type ArtifactRecord } from '@ptah-extension/shared';
import { ArtifactStore } from './artifact.store';

/** The advanced setting that opens the Display panel on publish (default on). */
const AUTO_OPEN_SETTING_KEY = 'display.autoOpenArtifacts';
const AUTO_OPEN_DEFAULT = true;
const SETTING_READ_TIMEOUT_MS = 5000;

@Injectable({ providedIn: 'root' })
export class ArtifactMessageHandler implements MessageHandler {
  private readonly store = inject(ArtifactStore);
  private readonly rpc = inject(ClaudeRpcService);
  readonly handledMessageTypes = ['artifact:published'] as const;
  /** Arrival number of the last message; each publish takes the next one. */
  private arrivals = 0;
  /** Arrival number of the last publish that requested an auto-open. */
  private lastOpened = 0;

  async handleMessage(message: {
    type: string;
    payload?: unknown;
  }): Promise<void> {
    if (message.type !== 'artifact:published') return;
    const arrival = ++this.arrivals;
    let record: ArtifactRecord;
    try {
      const { ArtifactPublishedNotificationSchema } =
        await import('@ptah-extension/shared/mcp-apps-contracts');
      const parsed = ArtifactPublishedNotificationSchema.safeParse(
        message.payload,
      );
      if (!parsed.success) {
        console.warn(
          '[ArtifactMessageHandler] invalid artifact:published payload',
        );
        return;
      }
      record = parsed.data;
    } catch {
      // degradation-audit: reported — schema loading failure drops the notification.
      console.warn(
        '[ArtifactMessageHandler] invalid artifact:published payload',
      );
      return;
    }
    // The card and the count update whatever the setting says.
    this.store.upsert(record);
    if (!(await this.autoOpenEnabled())) return;
    // The latest publish wins: a settings read that finishes after a newer
    // publish already opened must not pull the panel back to an older one.
    if (arrival < this.lastOpened) return;
    this.lastOpened = arrival;
    this.store.requestAutoOpen(record);
  }

  /** Reads the setting on each publish so a change applies live; a failed read uses the default. */
  private async autoOpenEnabled(): Promise<boolean> {
    try {
      const result = await this.rpc.call(
        'settings:get',
        { key: AUTO_OPEN_SETTING_KEY },
        { timeout: SETTING_READ_TIMEOUT_MS },
      );
      const value =
        result.success && result.data?.success ? result.data.value : undefined;
      return typeof value === 'boolean' ? value : AUTO_OPEN_DEFAULT;
    } catch {
      // degradation-audit: optional-capability - an unreadable setting falls back to its default (on).
      return AUTO_OPEN_DEFAULT;
    }
  }
}
