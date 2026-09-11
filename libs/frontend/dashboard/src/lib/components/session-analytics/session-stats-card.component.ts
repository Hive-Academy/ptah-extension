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
  formatEstimatedCost,
  formatSessionCost,
  formatTokenCount,
  formatRelativeTime,
  formatFullDate,
  sessionCoverageNotes,
} from '../../utils/format.utils';
import { computeTokenSegments } from '../../utils/token-segments';

/**
 * SessionStatsCardComponent
 *
 * Rich per-session card: header (name, model, relative time, stats state), a
 * token composition bar with legend, a cost-per-message line, an optional
 * per-model usage breakdown, and a prominent footer row for CLI agents /
 * subagents and cache stats.
 *
 * Stats states: pending (page not arrived — loaders, `aria-busy`), error
 * ("Stats unavailable"), partial coverage (a "Partial" badge whose title says
 * why). Cost is a current-rate-card estimate; an unknown price reads
 * "Unknown", never $0.
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

  readonly estimateLabel = 'Estimated from recorded usage and current rate card';

  readonly formatCost = formatCost;
  readonly formatEstimatedCost = formatEstimatedCost;
  readonly formatTokenCount = formatTokenCount;
  readonly formatRelativeTime = formatRelativeTime;
  readonly formatDate = formatFullDate;

  readonly costText = computed(() => formatSessionCost(this.session()));

  readonly coverageNotes = computed(() =>
    sessionCoverageNotes(this.session()),
  );

  /**
   * "Partial" means some usage was not counted or not priced. A wholly
   * unknown cost is not partial — its tile already reads "Unknown".
   */
  readonly showPartialBadge = computed(() => {
    const s = this.session();
    if (s.status !== 'ok' && s.status !== 'empty') return false;
    return (
      s.coverage === 'partial' ||
      s.untimestampedCount > 0 ||
      s.pricingCoverage === 'partial'
    );
  });

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
