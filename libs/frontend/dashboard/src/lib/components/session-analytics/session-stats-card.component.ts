import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { LucideAngularModule, Bot, MessageSquare } from 'lucide-angular';
import { DashboardSessionEntry } from '../../services/session-analytics-state.service';
import {
  formatCost,
  formatTokenCount,
  formatRelativeTime,
} from '../../utils/format.utils';

interface TokenSegment {
  readonly key: 'input' | 'output' | 'cacheRead' | 'cacheCreation';
  readonly label: string;
  readonly value: number;
  readonly pct: number;
  readonly barClass: string;
  readonly dotClass: string;
  readonly textClass: string;
}

/**
 * SessionStatsCardComponent
 *
 * Rich per-session card: header (name, model, relative time), a token
 * composition bar with legend, a cost-per-message line, an optional per-model
 * usage breakdown, and a prominent footer row for CLI agents / subagents and
 * cache stats.
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

  readonly BotIcon = Bot;
  readonly MessageSquareIcon = MessageSquare;

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;
  readonly formatRelativeTime = formatRelativeTime;

  readonly costPerMessage = computed(() => {
    const s = this.session();
    return s.messageCount > 0 ? s.totalCost / s.messageCount : 0;
  });

  readonly totalTokens = computed(() => {
    const t = this.session().tokens;
    return t.input + t.output + t.cacheRead + t.cacheCreation;
  });

  readonly segments = computed<readonly TokenSegment[]>(() => {
    const t = this.session().tokens;
    const total = this.totalTokens() || 1;
    const defs: ReadonlyArray<Omit<TokenSegment, 'pct'>> = [
      {
        key: 'input',
        label: 'Input',
        value: t.input,
        barClass: 'bg-cyan-400',
        dotClass: 'bg-cyan-400',
        textClass: 'text-cyan-400',
      },
      {
        key: 'output',
        label: 'Output',
        value: t.output,
        barClass: 'bg-purple-400',
        dotClass: 'bg-purple-400',
        textClass: 'text-purple-400',
      },
      {
        key: 'cacheRead',
        label: 'Cache Read',
        value: t.cacheRead,
        barClass: 'bg-info',
        dotClass: 'bg-info',
        textClass: 'text-info',
      },
      {
        key: 'cacheCreation',
        label: 'Cache Write',
        value: t.cacheCreation,
        barClass: 'bg-warning',
        dotClass: 'bg-warning',
        textClass: 'text-warning',
      },
    ];
    return defs.map((d) => ({ ...d, pct: (d.value / total) * 100 }));
  });

  readonly visibleSegments = computed(() =>
    this.segments().filter((s) => s.value > 0),
  );

  readonly showModelBreakdown = computed(
    () => this.session().modelUsageList.length > 1,
  );

  /**
   * Format a timestamp to an absolute date string.
   * Returns 'Unknown' for falsy, NaN, or epoch-zero timestamps.
   */
  formatDate(timestamp: number): string {
    if (!timestamp || isNaN(timestamp)) return 'Unknown';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
