import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ProviderMarkComponent } from '@ptah-extension/ui';
import { type ProviderUsageRow } from './usage-summary.view-model';
import { formatCompactTokens, formatPercent, formatUsd } from './usage-formatting';

@Component({
  selector: 'ptah-usage-cost-summary',
  standalone: true,
  imports: [ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="min-w-0" data-testid="usage-cost-summary" aria-label="By provider">
      <h4 class="mb-3 text-xs font-semibold uppercase tracking-wide text-base-content-muted">By provider</h4>
      <ul class="flex flex-col gap-3">
        @for (row of providers(); track row.providerId) {
          <li class="min-w-0" data-testid="usage-provider-row" [attr.data-provider]="row.providerId">
            <div class="flex items-center gap-2">
              <ptah-provider-mark [providerId]="row.providerId" size="sm" class="h-4 w-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-xs" [attr.title]="row.displayName">{{ row.displayName }}</span>
              <span class="text-xs font-medium tabular-nums" [attr.title]="rowTitle(row)">{{ costLabel(row) }}</span>
            </div>
            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-base-content/10" aria-hidden="true">
              <span class="block h-full rounded-full" [style.width.%]="barWidth(row)" [style.background]="row.accent"></span>
            </div>
            <p class="mt-1 text-right text-[10px] text-base-content-muted tabular-nums">{{ shareLabel(row) }}</p>
          </li>
        }
      </ul>
    </section>
  `,
})
export class UsageCostSummaryComponent {
  readonly providers = input<readonly ProviderUsageRow[]>([]);
  readonly totalUnpricedFactCount = input(0);

  protected costLabel(row: ProviderUsageRow): string {
    if (row.costUsd === null) return '—';
    return row.unpricedFactCount > 0 ? `≥ ${formatUsd(row.costUsd)}` : formatUsd(row.costUsd);
  }

  protected rowTitle(row: ProviderUsageRow): string | null {
    if (row.costUsd === null) return 'No price for this provider';
    if (row.unpricedFactCount === 0) return null;
    return `${row.unpricedFactCount} ${row.unpricedFactCount === 1 ? 'fact' : 'facts'} unpriced, ${formatCompactTokens(row.unpricedTokens)} tokens`;
  }

  protected shareLabel(row: ProviderUsageRow): string {
    const share = row.shareOfCost === null ? '—' : formatPercent(row.shareOfCost);
    const denominator = this.totalUnpricedFactCount() > 0 ? 'of known cost' : 'of cost';
    return `${share} ${denominator} · ${formatCompactTokens(row.tokens)} tokens`;
  }

  protected barWidth(row: ProviderUsageRow): number {
    return row.shareOfCost === null ? 0 : Math.min(100, row.shareOfCost * 100);
  }
}
