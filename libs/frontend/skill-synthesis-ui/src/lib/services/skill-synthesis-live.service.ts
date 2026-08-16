import { Injectable, inject, signal } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type SkillSynthesisEventKind,
  type SkillSynthesisEventPayload,
} from '@ptah-extension/shared';

import { SkillDiagnosticsStateService } from './skill-diagnostics-state.service';
import { SkillSynthesisStateService } from './skill-synthesis-state.service';

/**
 * Event kinds after which the weekly digest may say something new.
 *
 * Each one moves a table a digest sweep reads: `analyze-run` and
 * `edit-then-test` add session verdicts (missed triggers, friction),
 * `curator-pass` changes the promoted-skill set, and `backfill-complete`
 * changes what the memory-signal sweep can find.
 *
 * `ineligible`, `rate-limited` and `error` are deliberately ABSENT: they report
 * that nothing was recorded, so re-sweeping on them would spend a week-long
 * scan to produce the digest that is already on screen.
 */
const DIGEST_INVALIDATING_KINDS: ReadonlySet<SkillSynthesisEventKind> = new Set(
  ['analyze-run', 'curator-pass', 'backfill-complete', 'edit-then-test'],
);

/**
 * How long the digest refresh waits for the burst to settle. One curator pass
 * emits several invalidating events in quick succession and each sweep reads a
 * week of sessions, so coalescing them into one call is the difference between
 * one scan and five.
 */
const DIGEST_REFRESH_DEBOUNCE_MS = 2_000;

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
 *   backfill, updated stats, a stale weekly digest).
 *
 * Registered at bootstrap via the `MESSAGE_HANDLERS` multi-token, so it is safe
 * even if the Skills tab was never opened — it only touches root-provided state
 * services and never assumes any component is mounted.
 *
 * ### Nudges ride THIS channel and no other (TASK_2026_180 B4.5.2)
 *
 * The weekly digest is the nudge surface, and it stays current by riding the
 * `pushEvent` → `MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT` broadcast that already
 * exists. No new event kind and no second notification channel were added, for
 * two reasons:
 *
 *  - The digest is a PULL (`skillSynthesis:digest`). The only thing a push
 *    needs to say is "the data underneath the digest moved", and every event in
 *    {@link DIGEST_INVALIDATING_KINDS} already says exactly that.
 *  - A dedicated nudge channel would be a second source of truth for when the
 *    digest is stale, and the two would drift the first time either side grew a
 *    new trigger.
 *
 * The refresh is DEBOUNCED because a single curator pass can emit several of
 * these kinds within a second, and each one would otherwise cost a full
 * week-long sweep on the backend.
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

  /** Pending debounced digest sweep, or `null` when none is scheduled. */
  private digestRefreshHandle: ReturnType<typeof setTimeout> | null = null;

  public handleMessage(msg: { type: string; payload?: unknown }): void {
    if (msg.type !== MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT) return;
    const event = (msg.payload as SkillSynthesisEventPayload | undefined)
      ?.event;
    if (!event) return;

    this.diagnostics.pushLiveEvent(event);

    // The nudge path: same broadcast, no extra channel. Scheduled BEFORE the
    // switch so a kind that also refreshes something else cannot fall through a
    // `break` and skip it.
    if (DIGEST_INVALIDATING_KINDS.has(event.kind)) {
      this.scheduleDigestRefresh();
    }

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

  /**
   * Coalesce a burst of invalidating events into one digest sweep.
   *
   * A pending timer is restarted rather than left to fire, so a long burst
   * refreshes once after it ends instead of once in the middle of it.
   */
  private scheduleDigestRefresh(): void {
    if (this.digestRefreshHandle !== null) {
      clearTimeout(this.digestRefreshHandle);
    }
    this.digestRefreshHandle = setTimeout(() => {
      this.digestRefreshHandle = null;
      void this.skillState.refreshDigest();
    }, DIGEST_REFRESH_DEBOUNCE_MS);
  }
}
