/**
 * UsageCostSummaryComponent
 *
 * Left column of the Usage tab (requirement 2): the big raw token cost with
 * its "estimated at API rates; not your bill" footnote, a "partial" mark when
 * any source did not report complete coverage (tooltip lists sources and
 * reasons), quiet one-line source notes that never read as errors, and one
 * row per provider: mark, name, cost, thin share bar in the provider accent,
 * "NN% of cost · NN tokens".
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { ProviderMarkComponent } from '@ptah-extension/ui';
import type { UsageSourceStatus } from '@ptah-extension/shared';
import { type ProviderUsageRow } from './usage-summary.view-model';
import { formatCompactTokens, formatPercent, formatUsd, providerDisplayName } from './usage-formatting';

@Component({
  selector: 'ptah-usage-cost-summary',
  standalone: true,
  imports: [ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3" data-testid="usage-cost-summary">
      <div>
        <p class="text-[11px] uppercase tracking-wide text-base-content-muted">
          Raw token cost
        </p>
        <div class="flex flex-wrap items-baseline gap-2">
          <p
            class="text-3xl font-semibold tabular-nums"
            data-testid="usage-total-cost"
            [class.tooltip]="totalTooltip() !== null"
            [attr.data-tip]="totalTooltip()"
          >
            {{ totalLabel() }}
          </p>
          @if (isPartial()) {
            <span
              class="badge badge-warning badge-sm tooltip tooltip-top"
              [attr.data-tip]="sourceTip()"
              data-testid="usage-partial-badge"
            >
              partial
            </span>
          }
        </div>
        <p class="mt-1 text-[10px] text-base-content-muted">
          * estimated at API rates; not your bill
        </p>
      </div>

      @if (incompleteSources().length > 0) {
        <ul
          class="space-y-0.5 text-[10px] text-base-content-muted"
          aria-live="polite"
          data-testid="usage-source-notes"
        >
          @for (source of incompleteSources(); track source.sourceId) {
            <li>
              {{ nameOf(source.sourceId) }}: {{ source.reason ?? source.status }}
            </li>
          }
        </ul>
      }

      <ul class="flex flex-col gap-2">
        @for (row of providers(); track row.providerId) {
          <li
            class="flex items-center gap-2"
            data-testid="usage-provider-row"
            [attr.data-provider]="row.providerId"
          >
            <ptah-provider-mark
              [providerId]="row.providerId"
              size="sm"
              class="h-4 w-4 shrink-0"
            />
            <span class="w-24 shrink-0 truncate text-xs" [attr.title]="row.displayName">
              {{ row.displayName }}
            </span>
            <span
              class="w-16 shrink-0 text-right text-xs font-medium tabular-nums"
              [attr.title]="rowTitle(row)"
            >
              {{ costLabel(row) }}
            </span>
            <span
              class="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-base-content/10"
              aria-hidden="true"
            >
              <span
                class="block h-full rounded-full"
                [style.width.%]="barWidth(row)"
                [style.background]="row.accent"
              ></span>
            </span>
            <span
              class="w-40 shrink-0 text-right text-[10px] text-base-content-muted tabular-nums"
            >
              {{ shareLabel(row) }}
            </span>
          </li>
        }
      </ul>
    </div>
  `,
})
export class UsageCostSummaryComponent {
  readonly totalCostUsd = input<number | null>(null);
  readonly isPartial = input(false);
  readonly providers = input<readonly ProviderUsageRow[]>([]);
  readonly sources = input<readonly UsageSourceStatus[]>([]);
  /** In-window facts without a price; above zero the total is a lower bound. */
  readonly totalUnpricedFactCount = input(0);
  /** Tokens of those unpriced facts, for the lower-bound tooltip. */
  readonly totalUnpricedTokens = input(0);

  /** "Unknown", "$5.00", or "≥ $5.00" while some facts are unpriced. */
  protected readonly totalLabel = computed(() => {
    const total = this.totalCostUsd();
    if (total === null) return 'Unknown';
    return this.totalUnpricedFactCount() > 0
      ? `≥ ${formatUsd(total)}`
      : formatUsd(total);
  });

  /** Tooltip naming the unpriced facts behind a lower-bound total. */
  protected readonly totalTooltip = computed(() => {
    const count = this.totalUnpricedFactCount();
    if (count === 0) return null;
    return `${count} ${count === 1 ? 'fact' : 'facts'} unpriced, ${formatCompactTokens(
      this.totalUnpricedTokens(),
    )} tokens`;
  });

  protected readonly incompleteSources = computed(() =>
    this.sources().filter((source) => source.status !== 'complete'),
  );

  protected readonly sourceTip = computed(() =>
    this.incompleteSources()
      .map(
        (source) =>
          `${providerDisplayName(source.sourceId)}: ${source.reason ?? source.status}`,
      )
      .join('; '),
  );

  protected readonly nameOf = providerDisplayName;

  protected readonly costLabel = (row: ProviderUsageRow): string => {
    if (row.costUsd === null) return '—';
    // A provider with priced and unpriced facts shows a lower bound.
    return row.unpricedFactCount > 0
      ? `≥ ${formatUsd(row.costUsd)}`
      : formatUsd(row.costUsd);
  };

  protected readonly rowTitle = (row: ProviderUsageRow): string | null => {
    if (row.costUsd === null) return 'No price for this provider';
    if (row.unpricedFactCount === 0) return null;
    return `${row.unpricedFactCount} ${
      row.unpricedFactCount === 1 ? 'fact' : 'facts'
    } unpriced, ${formatCompactTokens(row.unpricedTokens)} tokens`;
  };

  protected readonly shareLabel = (row: ProviderUsageRow): string => {
    const share =
      row.shareOfCost === null ? '—' : formatPercent(row.shareOfCost);
    // When the range holds unpriced facts, the denominator is the known
    // priced cost only — say so instead of implying the full cost.
    const denominator =
      this.totalUnpricedFactCount() > 0 ? 'of known cost' : 'of cost';
    return `${share} ${denominator} · ${formatCompactTokens(row.tokens)} tokens`;
  };

  protected readonly barWidth = (row: ProviderUsageRow): number =>
    row.shareOfCost === null ? 0 : Math.min(100, row.shareOfCost * 100);
}
