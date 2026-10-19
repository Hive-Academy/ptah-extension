import { Injectable, effect, inject, untracked } from '@angular/core';
import { MODEL_REFRESH_CONTROL, TabManagerService, workspaceLabelFromPath } from '@ptah-extension/chat-state';
import { attentionConditionKey, NotificationService, type AttentionItem } from '@ptah-extension/core';

/** Drains terminal turn pulses and retains only bounded failure notices in the core model. */
@Injectable({ providedIn: 'root' })
export class ChatFailedTurnAttentionService {
  private readonly tabs = inject(MODEL_REFRESH_CONTROL, { optional: true })
    ? inject(TabManagerService)
    : null;
  private readonly notifications = inject(NotificationService);

  constructor() {
    if (!this.tabs) return;
    effect(() => {
      this.tabs?.terminalTurnPulses?.();
      untracked(() => this.drain());
    });
  }

  private drain(): void {
    for (const pulse of this.tabs?.takeTerminalTurnPulses?.() ?? []) {
      if (pulse.classification !== 'error' ||
          (pulse.phase !== 'failed' && (!pulse.terminalReason || pulse.terminalReason.startsWith('aborted_')))) continue;
      const item: AttentionItem = {
        key: attentionConditionKey(pulse.workspacePath, `turn:${pulse.sessionId}:${pulse.revision}`),
        generation: pulse.seq,
        source: 'chat-turn',
        kind: 'failure',
        severity: 'error',
        workspacePath: pulse.workspacePath,
        workspaceName: workspaceLabelFromPath(pulse.workspacePath),
        sessionId: pulse.sessionId,
        tabId: pulse.tabId,
        title: `Session failed: ${pulse.title}`,
        actions: [{ id: 'open', label: 'Open' }],
        actionable: true,
        soundEligible: false,
      };
      this.notifications.upsert(item);
    }
  }
}
