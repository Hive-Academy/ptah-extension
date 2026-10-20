import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type UsageKpis } from './usage-summary.view-model';
import { formatCompactTokens, formatPercent, formatUsd } from './usage-formatting';

@Component({
  selector: 'ptah-usage-kpi-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    @container (min-width: 900px) {
      .usage-kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @container (min-width: 1300px) {
      .usage-kpi-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    }
  `],
  template: `
    <div class="usage-kpi-grid grid grid-cols-2 gap-3" data-testid="usage-kpis" role="group" aria-label="Usage totals for the selected range">
      <div class="rounded-lg bg-base-200/40 p-3" data-testid="usage-kpi-cost">
        <p class="text-[11px] text-base-content-muted">Raw token cost</p>
        <p class="mt-1 text-xl font-semibold tabular-nums" data-testid="usage-total-cost" [attr.title]="costTooltip()">{{ costLabel() }}</p>
        <p class="mt-0.5 text-[10px] text-base-content-muted">{{ savingsSub() }}</p>
      </div>
      <div class="rounded-lg bg-base-200/40 p-3" data-testid="usage-kpi-processed">
        <p class="text-[11px] text-base-content-muted">Processed tokens</p>
        <p class="mt-1 text-xl font-semibold tabular-nums">{{ compact(kpis().processedTokens) }}</p>
        <p class="mt-0.5 text-[10px] text-base-content-muted">{{ processedSub() }}</p>
        <p class="text-[10px] text-base-content-muted">{{ outputSub() }}</p>
      </div>
      <div class="rounded-lg bg-base-200/40 p-3" data-testid="usage-kpi-cached">
        <p class="text-[11px] text-base-content-muted">Cached %</p>
        <p class="mt-1 text-xl font-semibold tabular-nums" [attr.title]="cachedShareNote()">{{ cachedShareLabel() }}</p>
        <p class="mt-0.5 text-[10px] text-base-content-muted">Cached input {{ compact(kpis().cachedInputTokens) }}</p>
        <p class="text-[10px] text-base-content-muted" data-testid="usage-kpi-uncached">Uncached input {{ compact(kpis().uncachedInputTokens) }} · {{ compact(kpis().cacheWriteTokens) }} cache writes</p>
      </div>
      <div class="rounded-lg bg-base-200/40 p-3" title="Counts include usage sources with session identity in this range">
        <p class="text-[11px] text-base-content-muted">Sessions</p>
        <p class="mt-1 text-xl font-semibold tabular-nums">{{ kpis().sessionCount }}</p>
      </div>
      <div class="rounded-lg bg-base-200/40 p-3" title="Counts include usage sources with session identity in this range">
        <p class="text-[11px] text-base-content-muted">Messages</p>
        <p class="mt-1 text-xl font-semibold tabular-nums">{{ kpis().messageCount }}</p>
      </div>
      <div class="rounded-lg bg-base-200/40 p-3" title="Counts include usage sources with session identity in this range">
        <p class="text-[11px] text-base-content-muted">Subagents</p>
        <p class="mt-1 text-xl font-semibold tabular-nums">{{ kpis().subagentCount }}</p>
      </div>
    </div>
    <p class="mt-1.5 text-[10px] text-base-content-muted">* estimated at API rates; not your bill</p>
  `,
})
export class UsageKpiStripComponent {
  readonly kpis = input.required<UsageKpis>();
  readonly totalCostUsd = input<number | null>(null);
  readonly totalUnpricedFactCount = input(0);
  readonly totalUnpricedTokens = input(0);
  protected readonly compact = formatCompactTokens;

  protected readonly costLabel = computed(() => {
    const cost = this.totalCostUsd();
    return cost === null ? 'Unknown' : `${this.totalUnpricedFactCount() > 0 ? '≥ ' : ''}${formatUsd(cost)}`;
  });

  protected readonly costTooltip = computed(() => {
    const count = this.totalUnpricedFactCount();
    const unpriced = count > 0 ? `${count} ${count === 1 ? 'fact' : 'facts'} unpriced, ${formatCompactTokens(this.totalUnpricedTokens())} tokens. ` : '';
    const savings = this.kpis().cacheSavingsUsd === null ? 'No savings data' : `Cache savings ${this.savingsValue()}`;
    return `${unpriced}${savings}`;
  });

  protected readonly processedSub = computed(() => {
    const perDay = this.kpis().processedPerActiveDay;
    return perDay === null ? 'No active days' : `~${formatCompactTokens(perDay)} per active day`;
  });

  protected readonly cachedShareLabel = computed(() => {
    const share = this.kpis().cachedShareOfInput;
    return share === null ? '—' : formatPercent(share);
  });

  protected readonly cachedShareNote = computed(() =>
    this.kpis().cachedShareOfInput === null ? 'No input observed' : `${this.cachedShareLabel()} of observed input`,
  );

  protected readonly savingsValue = computed(() => {
    const kpis = this.kpis();
    if (kpis.cacheSavingsUsd === null) return '—';
    return `${kpis.cacheSavingsUnknownFactCount > 0 ? '≥ ' : ''}${formatUsd(kpis.cacheSavingsUsd)}`;
  });

  protected readonly savingsSub = computed(() => {
    const kpis = this.kpis();
    if (kpis.savingsMultiple !== null) return `Cost before cache savings: ${kpis.savingsMultiple.toFixed(1)}x raw cost`;
    if (kpis.cacheSavingsUsd === null) return 'No savings data';
    return kpis.cacheSavingsUnknownFactCount > 0 ? 'a lower bound' : 'vs raw token cost';
  });

  protected readonly outputSub = computed(() => `Output ${formatCompactTokens(this.kpis().outputTokens)} tokens`);
}
