import { Injectable, inject, signal } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type SkillSynthesisEventPayload,
} from '@ptah-extension/shared';

import { SkillDiagnosticsStateService } from './skill-diagnostics-state.service';
import { SkillSynthesisStateService } from './skill-synthesis-state.service';

/**
 * SkillSynthesisLiveService
 *
 * MessageHandler that consumes `skillSynthesis:event` push events broadcast
 * from the backend and reflects them in the Skills tab in real time:
 *
 * - records every event into the diagnostics recent-events log (via
 *   {@link SkillDiagnosticsStateService.pushLiveEvent});
 * - surfaces a short human-readable {@link activity} label so scheduled /
 *   background curator passes and the embedding backfill are visible even
 *   when the user didn't click anything;
 * - refreshes the relevant slices of {@link SkillSynthesisStateService} when an
 *   event implies the underlying data changed (new suggestions, completed
 *   backfill, updated stats).
 *
 * Registered at bootstrap via the `MESSAGE_HANDLERS` multi-token, so it is safe
 * even if the Skills tab was never opened — it only touches root-provided state
 * services and never assumes any component is mounted.
 */
@Injectable({ providedIn: 'root' })
export class SkillSynthesisLiveService implements MessageHandler {
  private readonly diagnostics = inject(SkillDiagnosticsStateService);
  private readonly skillState = inject(SkillSynthesisStateService);

  /** Message types this service handles via MessageRouterService. */
  public readonly handledMessageTypes = [
    MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT,
  ] as const;

  /**
   * Short human label shown in the Skills tab header while background work is
   * in flight. `null` means idle (the indicator is hidden).
   */
  public readonly activity = signal<string | null>(null);

  public handleMessage(msg: { type: string; payload?: unknown }): void {
    if (msg.type !== MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT) return;
    const event = (msg.payload as SkillSynthesisEventPayload | undefined)
      ?.event;
    if (!event) return;

    this.diagnostics.pushLiveEvent(event);

    switch (event.kind) {
      case 'curator-pass-start':
        this.activity.set('Curator analyzing candidates…');
        break;
      case 'curator-pass': {
        this.activity.set(null);
        const created = Number(event.stats?.['suggestionsCreated'] ?? 0);
        if (created > 0) void this.skillState.refreshSuggestions();
        void this.skillState.loadStats();
        break;
      }
      case 'backfill-progress': {
        const done = Number(event.stats?.['done'] ?? 0);
        const total = Number(event.stats?.['total'] ?? 0);
        this.activity.set('Embedding candidates ' + done + '/' + total + '…');
        break;
      }
      case 'backfill-complete':
        this.activity.set(null);
        void this.skillState.refreshCandidates();
        void this.skillState.loadStats();
        break;
      case 'analyze-run':
        // A new candidate was registered. Do NOT refreshCandidates here — it
        // would disrupt row selection/scroll. loadStats keeps counts live.
        void this.skillState.loadStats();
        break;
      default:
        // Already recorded via pushLiveEvent; no extra action.
        break;
    }
  }
}
