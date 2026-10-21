import { Injectable, inject } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import { ArtifactStore } from './artifact.store';

@Injectable({ providedIn: 'root' })
export class ArtifactMessageHandler implements MessageHandler {
  private readonly store = inject(ArtifactStore);
  readonly handledMessageTypes = ['artifact:published'] as const;

  async handleMessage(message: { type: string; payload?: unknown }): Promise<void> {
    if (message.type !== 'artifact:published') return;
    try {
      const { ArtifactPublishedNotificationSchema } = await import('@ptah-extension/shared/mcp-apps-contracts');
      const parsed = ArtifactPublishedNotificationSchema.safeParse(message.payload);
      if (!parsed.success) {
        console.warn('[ArtifactMessageHandler] invalid artifact:published payload');
        return;
      }
      this.store.upsert(parsed.data);
    } catch {
      // degradation-audit: reported — schema loading failure drops the notification.
      console.warn('[ArtifactMessageHandler] invalid artifact:published payload');
    }
  }
}
