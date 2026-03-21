import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { formatCost, formatTokenCount } from '../../utils/format.utils';

/**
 * MetricsCardsComponent
 *
 * Presentational component displaying 5 stat cards for session analytics:
 * Total Estimated Cost, Input Tokens, Output Tokens, Sessions, and Avg Cost/Session.
 *
 * Uses DaisyUI stat classes in a responsive grid layout.
 * No service injection -- purely presentational.
 */
@Component({
  selector: 'ptah-session-metrics-cards',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
      role="region"
      aria-label="Usage metrics"
    >
      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-success/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Total Est. Cost
        </div>
        <div class="text-lg font-semibold text-success tabular-nums">
          {{ formatCost(totalCost()) }}
        </div>
      </div>

      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-cyan-600/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Input Tokens
        </div>
        <div class="text-lg font-semibold text-cyan-400 tabular-nums">
          {{ formatTokenCount(totalInputTokens()) }}
        </div>
      </div>

      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-purple-600/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Output Tokens
        </div>
        <div class="text-lg font-semibold text-purple-400 tabular-nums">
          {{ formatTokenCount(totalOutputTokens()) }}
        </div>
      </div>

      <div class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-info/20">
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Sessions
        </div>
        <div class="text-lg font-semibold text-info tabular-nums">
          {{ sessionCount() }}
        </div>
      </div>

      <div
        class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-success/20"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1"
        >
          Avg Cost/Session
        </div>
        <div class="text-lg font-semibold text-success tabular-nums">
          {{ formatCost(avgCostPerSession()) }}
        </div>
      </div>
    </div>
  `,
})
export class MetricsCardsComponent {
  readonly totalCost = input.required<number>();
  readonly totalInputTokens = input.required<number>();
  readonly totalOutputTokens = input.required<number>();
  readonly sessionCount = input.required<number>();
  readonly avgCostPerSession = input.required<number>();

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;
}
