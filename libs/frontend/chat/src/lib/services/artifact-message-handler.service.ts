import { Injectable, inject } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import { ArtifactPublishedNotificationSchema } from '@ptah-extension/shared/mcp-apps-contracts';
import { ArtifactStore } from './artifact.store';

@Injectable({ providedIn: 'root' })
export class ArtifactMessageHandler implements MessageHandler {
  private readonly store = inject(ArtifactStore);
  readonly handledMessageTypes = ['artifact:published'] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== 'artifact:published') return;
    const parsed = ArtifactPublishedNotificationSchema.safeParse(message.payload);
    if (!parsed.success) {
      console.warn('[ArtifactMessageHandler] invalid artifact:published payload');
      return;
    }
    this.store.upsert(parsed.data);
  }
}
