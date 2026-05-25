import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { AggregateTotals } from '../../services/session-analytics-state.service';
import { formatCost, formatTokenCount } from '../../utils/format.utils';

/**
 * MetricsCardsComponent
 *
 * Presentational aggregate stat row for the session analytics card. Six
 * color-coded tiles: Total Cost, Total Tokens, Messages, Sessions, Subagents,
 * Avg / Session. Driven by a single `AggregateTotals` input.
 */
@Component({
  selector: 'ptah-session-metrics-cards',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3"
      role="region"
      aria-label="Aggregate session metrics"
    >
      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-success/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Total Cost
        </div>
        <div class="text-xl font-semibold text-success tabular-nums">
          {{ formatCost(aggregates().totalCost) }}
        </div>
      </div>

      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-cyan-600/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Total Tokens
        </div>
        <div class="text-xl font-semibold text-cyan-400 tabular-nums">
          {{ formatTokenCount(aggregates().totalTokens) }}
        </div>
      </div>

      <div class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-info/20">
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Messages
        </div>
        <div class="text-xl font-semibold text-info tabular-nums">
          {{ aggregates().totalMessages }}
        </div>
      </div>

      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-purple-600/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Sessions
        </div>
        <div class="text-xl font-semibold text-purple-400 tabular-nums">
          {{ aggregates().sessionCount }}
        </div>
      </div>

      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-warning/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Subagents
        </div>
        <div class="text-xl font-semibold text-warning tabular-nums">
          {{ aggregates().totalSubagents }}
        </div>
      </div>

      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-base-content/15"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Avg / Session
        </div>
        <div class="text-xl font-semibold text-base-content/80 tabular-nums">
          {{ formatCost(aggregates().avgCostPerSession) }}
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
