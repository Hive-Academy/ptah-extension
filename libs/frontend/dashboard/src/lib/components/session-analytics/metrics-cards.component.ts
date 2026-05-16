import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { AggregateTotals } from '../../services/session-analytics-state.service';
import { formatCost, formatTokenCount } from '../../utils/format.utils';

/**
 * MetricsCardsComponent
 *
 * Presentational component displaying 4 aggregate stat cards:
 * Total Cost, Total Tokens, Messages, and Sessions.
 *
 * Accepts a single `AggregateTotals` input (from SessionAnalyticsStateService).
 * Uses the same design system as SessionStatsSummaryComponent.
 */
@Component({
  selector: 'ptah-session-metrics-cards',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="grid grid-cols-2 sm:grid-cols-4 gap-3"
      role="region"
      aria-label="Aggregate session metrics"
    >
      <!-- Total Cost -->
      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-success/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Total Cost
        </div>
        <div class="text-lg font-semibold text-success tabular-nums">
          {{ formatCost(aggregates().totalCost) }}
        </div>
      </div>

      <!-- Total Tokens -->
      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-cyan-600/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Total Tokens
        </div>
        <div class="text-lg font-semibold text-cyan-400 tabular-nums">
          {{ formatTokenCount(aggregates().totalTokens) }}
        </div>
      </div>

      <!-- Total Messages -->
      <div class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-info/20">
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Messages
        </div>
        <div class="text-lg font-semibold text-info tabular-nums">
          {{ aggregates().totalMessages }}
        </div>
      </div>

      <!-- Sessions Shown -->
      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-purple-600/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Sessions
        </div>
        <div class="text-lg font-semibold text-purple-400 tabular-nums">
          {{ aggregates().sessionCount }}
        </div>
      </div>
    </div>
  `,
})
export class MetricsCardsComponent {
  readonly aggregates = input.required<AggregateTotals>();

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;
}
