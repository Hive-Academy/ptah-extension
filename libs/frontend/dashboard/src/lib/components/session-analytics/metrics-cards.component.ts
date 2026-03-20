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
      class="grid grid-cols-2 lg:grid-cols-5 gap-3"
      role="region"
      aria-label="Usage metrics"
    >
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-title text-xs">Total Est. Cost</div>
        <div class="stat-value text-lg">{{ formatCost(totalCost()) }}</div>
      </div>

      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-title text-xs">Input Tokens</div>
        <div class="stat-value text-lg">
          {{ formatTokenCount(totalInputTokens()) }}
        </div>
      </div>

      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-title text-xs">Output Tokens</div>
        <div class="stat-value text-lg">
          {{ formatTokenCount(totalOutputTokens()) }}
        </div>
      </div>

      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-title text-xs">Sessions</div>
        <div class="stat-value text-lg">{{ sessionCount() }}</div>
      </div>

      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-title text-xs">Avg Cost/Session</div>
        <div class="stat-value text-lg">
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
