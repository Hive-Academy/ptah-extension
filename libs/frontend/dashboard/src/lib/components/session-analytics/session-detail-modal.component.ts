import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LucideAngularModule, Bot, X } from 'lucide-angular';
import { DashboardSessionEntry } from '../../services/session-analytics-state.service';
import {
  formatCost,
  formatTokenCount,
  formatRelativeTime,
  formatFullDate,
  formatDuration,
} from '../../utils/format.utils';
import { computeTokenSegments } from '../../utils/token-segments';

/**
 * SessionDetailModalComponent
 *
 * Full-detail view for a single session, surfaced when a
 * `SessionStatsCardComponent` is activated. Follows the daisyUI
 * `<dialog class="modal">` pattern used across the app (see
 * `ConfirmationDialogComponent`): visibility is driven by `modal-open`, which
 * toggles whenever a non-null `session` is bound.
 *
 * Shows everything the compact card shows plus: untruncated name, session id,
 * absolute created / last-activity timestamps, active duration, the full token
 * composition with absolute counts + percentages, and the per-model usage
 * breakdown unconditionally (the card only shows it for multi-model sessions).
 */
@Component({
  selector: 'ptah-session-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, DecimalPipe],
  templateUrl: './session-detail-modal.component.html',
})
export class SessionDetailModalComponent {
  /** The session to detail, or `null` when the modal is closed. */
  readonly session = input<DashboardSessionEntry | null>(null);

  /** Emitted when the user dismisses the modal (close button or backdrop). */
  readonly closed = output<void>();

  readonly BotIcon = Bot;
  readonly XIcon = X;

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;
  readonly formatRelativeTime = formatRelativeTime;
  readonly formatFullDate = formatFullDate;
  readonly formatDuration = formatDuration;

  readonly totalTokens = computed(() => {
    const s = this.session();
    if (!s) return 0;
    const t = s.tokens;
    return t.input + t.output + t.cacheRead + t.cacheCreation;
  });

  readonly costPerMessage = computed(() => {
    const s = this.session();
    if (!s || s.totalCost === null || s.messageCount <= 0) return null;
    return s.totalCost / s.messageCount;
  });

  /** Milliseconds between the session's creation and last activity. */
  readonly durationMs = computed(() => {
    const s = this.session();
    if (!s) return 0;
    return s.lastActivityAt - s.createdAt;
  });

  readonly visibleSegments = computed(() => {
    const s = this.session();
    if (!s) return [];
    return computeTokenSegments(s.tokens).filter((seg) => seg.value > 0);
  });

  onClose(): void {
    this.closed.emit();
  }
}
