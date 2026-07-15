import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Bot, MessageSquare } from 'lucide-angular';
import { DashboardSessionEntry } from '../../services/session-analytics-state.service';
import {
  formatCost,
  formatTokenCount,
  formatRelativeTime,
  formatFullDate,
} from '../../utils/format.utils';
import { computeTokenSegments } from '../../utils/token-segments';

/**
 * SessionStatsCardComponent
 *
 * Rich per-session card: header (name, model, relative time), a token
 * composition bar with legend, a cost-per-message line, an optional per-model
 * usage breakdown, and a prominent footer row for CLI agents / subagents and
 * cache stats.
 *
 * The whole card is a button that emits `open` so the parent can surface the
 * full session-detail modal.
 */
@Component({
  selector: 'ptah-session-stats-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './session-stats-card.component.html',
})
export class SessionStatsCardComponent {
  readonly session = input.required<DashboardSessionEntry>();

  /** Emitted when the card is activated (click / Enter / Space). */
  readonly open = output<DashboardSessionEntry>();

  readonly BotIcon = Bot;
  readonly MessageSquareIcon = MessageSquare;

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;
  readonly formatRelativeTime = formatRelativeTime;
  readonly formatDate = formatFullDate;

  readonly costPerMessage = computed(() => {
    const s = this.session();
    if (s.totalCost === null || s.messageCount <= 0) return null;
    return s.totalCost / s.messageCount;
  });

  readonly totalTokens = computed(() => {
    const t = this.session().tokens;
    return t.input + t.output + t.cacheRead + t.cacheCreation;
  });

  readonly visibleSegments = computed(() =>
    computeTokenSegments(this.session().tokens).filter((s) => s.value > 0),
  );

  readonly showModelBreakdown = computed(
    () => this.session().modelUsageList.length > 1,
  );

  activate(): void {
    this.open.emit(this.session());
  }
}
