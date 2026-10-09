import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { AggregateTotals } from '../../services/session-analytics-state.service';
import {
  costValueClass,
  formatEstimatedCost,
  formatTokenCount,
} from '../../utils/format.utils';

/**
 * MetricsCardsComponent
 *
 * Presentational aggregate stat row for the session analytics card. Six
 * color-coded tiles: Total Cost, Total Tokens, Messages, Sessions, Subagents,
 * Avg / Session. Driven by a single `AggregateTotals` input.
 *
 * A total that covers only priced usage carries a "≥" (at least) marker, with
 * a tooltip naming the partly priced and unpriced session counts. An unknown
 * total reads "Unknown" in a neutral colour, never a green $0.
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
        class="bg-surface-2 rounded-lg p-3 border border-success/20"
        [title]="totalTitle()"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content-muted mb-1"
        >
          Est. Total Cost
        </div>
        <div
          class="text-xl font-semibold tabular-nums"
          [class]="costValueClass(aggregates().totalCost !== null)"
          data-testid="metrics-total-cost"
        >
          @if (isLowerBound()) {
            <span aria-hidden="true" data-testid="metrics-total-lower-bound"
              >&ge;</span
            >
            <span class="sr-only">At least</span>
          }
          {{ costText(aggregates().totalCost) }}
        </div>
      </div>

      <div class="bg-surface-2 rounded-lg p-3 border border-cyan-600/20">
        <div
          class="text-[10px] uppercase tracking-wider text-base-content-muted mb-1"
        >
          Total Tokens
        </div>
        <div class="text-xl font-semibold text-cyan-400 tabular-nums">
          {{ formatTokenCount(aggregates().totalTokens) }}
        </div>
      </div>

      <div class="bg-surface-2 rounded-lg p-3 border border-info/20">
        <div
          class="text-[10px] uppercase tracking-wider text-base-content-muted mb-1"
        >
          Messages
        </div>
        <div class="text-xl font-semibold text-info tabular-nums">
          {{ aggregates().totalMessages }}
        </div>
      </div>

      <div class="bg-surface-2 rounded-lg p-3 border border-purple-600/20">
        <div
          class="text-[10px] uppercase tracking-wider text-base-content-muted mb-1"
        >
          Sessions
        </div>
        <div class="text-xl font-semibold text-purple-400 tabular-nums">
          {{ aggregates().sessionCount }}
        </div>
      </div>

      <div class="bg-surface-2 rounded-lg p-3 border border-warning/20">
        <div
          class="text-[10px] uppercase tracking-wider text-base-content-muted mb-1"
        >
          Subagents
        </div>
        <div class="text-xl font-semibold text-warning tabular-nums">
          {{ aggregates().totalSubagents }}
        </div>
      </div>

      <div
        class="bg-surface-2 rounded-lg p-3 border border-base-content/15"
        [title]="avgTitle()"
      >
        <div
          class="text-[10px] uppercase tracking-wider text-base-content-muted mb-1"
        >
          Avg / Session
        </div>
        <div
          class="text-xl font-semibold text-base-content-muted tabular-nums"
          data-testid="metrics-avg-cost"
        >
          @if (avgIsLowerBound()) {
            <span aria-hidden="true">&ge;</span>
            <span class="sr-only">At least</span>
          }
          {{ costText(aggregates().avgCostPerSession) }}
        </div>
      </div>
    </div>
  `,
})
export class MetricsCardsComponent {
  readonly aggregates = input.required<AggregateTotals>();

  readonly estimateLabel =
    'Estimated from recorded usage and current rate card';
  readonly formatTokenCount = formatTokenCount;
  readonly costValueClass = costValueClass;

  /** The total covers only priced usage: shown behind a "≥" marker. */
  readonly isLowerBound = computed(
    () =>
      this.aggregates().totalCost !== null &&
      this.aggregates().totalCostIsLowerBound,
  );

  /**
   * The average divides by the sessions that contribute a figure, so an
   * unpriced session left out of the total is left out of the average too
   * and does not make it a lower bound. Only a contributor whose own figure
   * is a priced subtotal does.
   */
  readonly avgIsLowerBound = computed(
    () =>
      this.aggregates().avgCostPerSession !== null &&
      this.aggregates().partiallyPricedSessionCount > 0,
  );

  /** Tooltip naming exactly what the total leaves out or only partly counts. */
  readonly totalTitle = computed(() => {
    const a = this.aggregates();
    if (!this.isLowerBound()) return this.estimateLabel;
    const parts: string[] = [];
    if (a.partiallyPricedSessionCount > 0) parts.push(partlyPriced(a));
    if (a.unknownCostSessionCount > 0) {
      parts.push(
        `${plural(a.unknownCostSessionCount, 'session')} with no price (left out)`,
      );
    }
    return `${this.estimateLabel}. Lower bound: ${parts.join('; ')}.`;
  });

  readonly avgTitle = computed(() =>
    this.avgIsLowerBound()
      ? `${this.estimateLabel}. Lower bound: ${partlyPriced(this.aggregates())}.`
      : this.estimateLabel,
  );

  /**
   * A null estimate is "…" while pages are still arriving and "Unknown" once
   * they have all landed — never $0.
   */
  costText(cost: number | null): string {
    if (cost === null && this.aggregates().pendingSessionCount > 0) return '…';
    return formatEstimatedCost(cost);
  }
}

function partlyPriced(a: AggregateTotals): string {
  return `${plural(a.partiallyPricedSessionCount, 'session')} only partly priced (priced part included)`;
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
