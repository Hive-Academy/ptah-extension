/**
 * UsageCostQualityComponent
 *
 * Cost-quality panel (requirement 6): how much of the observed tokens is
 * backed by provider-reported spend, priced from the model rate card, or
 * unpriced — plus the cache-savings dollar figure when it is computable.
 * Shares are shares of tokens by `costSource`; `null` renders as "—".
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { type UsageCostQuality } from './usage-summary.view-model';
import { formatPercent, formatUsd } from './usage-formatting';

@Component({
  selector: 'ptah-usage-cost-quality',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="grid grid-cols-2 gap-3 rounded-lg bg-base-200/40 p-3 sm:grid-cols-4"
      data-testid="usage-cost-quality"
    >
      <div data-testid="usage-quality-reported">
        <p class="text-[11px] text-base-content-muted">Provider reported</p>
        <p class="mt-1 text-sm font-semibold tabular-nums">
          {{ percentLabel(quality().providerReportedTokenShare) }}
        </p>
        <p class="text-[10px] text-base-content-muted">share of tokens</p>
      </div>
      <div data-testid="usage-quality-priced">
        <p class="text-[11px] text-base-content-muted">Model priced</p>
        <p class="mt-1 text-sm font-semibold tabular-nums">
          {{ percentLabel(quality().modelPricedTokenShare) }}
        </p>
        <p class="text-[10px] text-base-content-muted">share of tokens</p>
      </div>
      <div data-testid="usage-quality-unpriced">
        <p class="text-[11px] text-base-content-muted">Unpriced</p>
        <p class="mt-1 text-sm font-semibold tabular-nums">
          {{ percentLabel(quality().unpricedTokenShare) }}
        </p>
        <p class="text-[10px] text-base-content-muted">share of tokens</p>
      </div>
      <div
        data-testid="usage-quality-savings"
        [class.tooltip]="savingsTooltip() !== null"
        [attr.data-tip]="savingsTooltip()"
      >
        <p class="text-[11px] text-base-content-muted">Cache savings</p>
        <p class="mt-1 text-sm font-semibold tabular-nums">{{ savingsLabel() }}</p>
        <p class="text-[10px] text-base-content-muted">vs raw token cost</p>
      </div>
    </div>
  `,
})
export class UsageCostQualityComponent {
  readonly quality = input.required<UsageCostQuality>();

  protected readonly percentLabel = (share: number | null): string =>
    share === null ? '—' : formatPercent(share);

  /** "—", "$12.40", or "≥ $12.40" while some facts withhold savings. */
  protected readonly savingsLabel = computed(() => {
    const quality = this.quality();
    if (quality.cacheSavingsUsd === null) return '—';
    return quality.cacheSavingsUnknownFactCount > 0
      ? `≥ ${formatUsd(quality.cacheSavingsUsd)}`
      : formatUsd(quality.cacheSavingsUsd);
  });

  /** Tooltip text while the figure is a lower bound; `null` hides it. */
  protected readonly savingsTooltip = computed(() => {
    const unknown = this.quality().cacheSavingsUnknownFactCount;
    return unknown > 0
      ? `${unknown} ${unknown === 1 ? 'fact' : 'facts'} without savings data`
      : null;
  });
}