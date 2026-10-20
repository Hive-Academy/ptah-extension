/**
 * UsageKpiStripComponent
 *
 * The five compact KPI tiles under the usage header (requirement 4):
 * processed tokens (with per-active-day), cached input (share of observed
 * input), uncached input (with cache writes), output, and cache savings.
 * Every `null` renders as an honest "unknown" note — a null share never
 * becomes a fabricated 0%.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { type UsageKpis } from './usage-summary.view-model';
import { formatCompactTokens, formatPercent, formatUsd } from './usage-formatting';

@Component({
  selector: 'ptah-usage-kpi-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
      data-testid="usage-kpis"
    >
      <div class="rounded-lg bg-base-200/40 p-3" data-testid="usage-kpi-processed">
        <p class="text-[11px] text-base-content-muted">Processed tokens</p>
        <p class="mt-1 text-lg font-semibold tabular-nums">
          {{ compact(kpis().processedTokens) }}
        </p>
        <p class="mt-0.5 text-[10px] text-base-content-muted">
          {{ processedSub() }}
        </p>
      </div>

      <div class="rounded-lg bg-base-200/40 p-3" data-testid="usage-kpi-cached">
        <p class="text-[11px] text-base-content-muted">Cached input</p>
        <p class="mt-1 text-lg font-semibold tabular-nums">
          {{ compact(kpis().cachedInputTokens) }}
        </p>
        <p class="mt-0.5 text-[10px] text-base-content-muted">
          {{ cachedShareSub() }}
        </p>
      </div>

      <div class="rounded-lg bg-base-200/40 p-3" data-testid="usage-kpi-uncached">
        <p class="text-[11px] text-base-content-muted">Uncached input</p>
        <p class="mt-1 text-lg font-semibold tabular-nums">
          {{ compact(kpis().uncachedInputTokens) }}
        </p>
        <p class="mt-0.5 text-[10px] text-base-content-muted">
          {{ cacheWritesSub() }}
        </p>
      </div>

      <div class="rounded-lg bg-base-200/40 p-3" data-testid="usage-kpi-output">
        <p class="text-[11px] text-base-content-muted">Output</p>
        <p class="mt-1 text-lg font-semibold tabular-nums">
          {{ compact(kpis().outputTokens) }}
        </p>
      </div>

      <div
        class="rounded-lg bg-base-200/40 p-3"
        data-testid="usage-kpi-savings"
        [class.tooltip]="savingsTooltip() !== null"
        [attr.data-tip]="savingsTooltip()"
      >
        <p class="text-[11px] text-base-content-muted">Cache savings</p>
        <p class="mt-1 text-lg font-semibold tabular-nums">{{ savingsValue() }}</p>
        <p class="mt-0.5 text-[10px] text-base-content-muted">
          {{ savingsSub() }}
        </p>
      </div>
    </div>
  `,
})
export class UsageKpiStripComponent {
  readonly kpis = input.required<UsageKpis>();

  protected readonly compact = formatCompactTokens;

  protected readonly processedSub = computed(() => {
    const perDay = this.kpis().processedPerActiveDay;
    return perDay === null
      ? 'No active days'
      : `~${formatCompactTokens(perDay)} per active day`;
  });

  protected readonly cachedShareSub = computed(() => {
    const share = this.kpis().cachedShareOfInput;
    return share === null
      ? 'No input observed'
      : `${formatPercent(share)} of observed input`;
  });

  protected readonly cacheWritesSub = computed(() =>
    `${formatCompactTokens(this.kpis().cacheWriteTokens)} cache writes`,
  );

  /** "—", "$12.40", or "≥ $12.40" while some facts withhold savings. */
  protected readonly savingsValue = computed(() => {
    const kpis = this.kpis();
    if (kpis.cacheSavingsUsd === null) return '—';
    return kpis.cacheSavingsUnknownFactCount > 0
      ? `≥ ${formatUsd(kpis.cacheSavingsUsd)}`
      : formatUsd(kpis.cacheSavingsUsd);
  });

  /** Tooltip text while the tile shows a lower bound; `null` hides it. */
  protected readonly savingsTooltip = computed(() => {
    const unknown = this.kpis().cacheSavingsUnknownFactCount;
    return unknown > 0
      ? `${unknown} ${unknown === 1 ? 'fact' : 'facts'} without savings data`
      : null;
  });

  protected readonly savingsSub = computed(() => {
    const kpis = this.kpis();
    if (kpis.savingsMultiple !== null) {
      return `Cost before cache savings: ${kpis.savingsMultiple.toFixed(1)}x raw cost`;
    }
    if (kpis.cacheSavingsUsd === null) return 'No savings data';
    return kpis.cacheSavingsUnknownFactCount > 0
      ? 'a lower bound'
      : 'vs raw token cost';
  });
}
