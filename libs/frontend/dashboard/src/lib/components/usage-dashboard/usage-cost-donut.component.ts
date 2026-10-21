import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { ModelBreakdownRow, ProviderUsageRow } from './usage-summary.view-model';
import { formatPercent, formatUsd } from './usage-formatting';
import { buildCostSlices, type CostSliceInput } from './usage-cost-donut.geometry';

const MODEL_COLORS = ['#b583ed', '#56bfc1', '#e8aa67', '#7b9aeb', '#d77fa8'];

@Component({
  selector: 'ptah-usage-cost-donut',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-2" data-testid="usage-cost-donut">
      <div class="flex items-center justify-between gap-2">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-base-content-muted">Cost share</h4>
        <div class="join" role="group" aria-label="Cost share view">
          <button type="button" class="join-item btn btn-xs" [class.btn-active]="mode() === 'provider'" [class.btn-primary]="mode() === 'provider'" [attr.aria-pressed]="mode() === 'provider'" (click)="mode.set('provider')">Provider</button>
          <button type="button" class="join-item btn btn-xs" [class.btn-active]="mode() === 'model'" [class.btn-primary]="mode() === 'model'" [attr.aria-pressed]="mode() === 'model'" (click)="mode.set('model')">Model</button>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <svg viewBox="0 0 120 120" class="h-32 w-32 shrink-0" role="img" [attr.aria-label]="ariaLabel()" data-testid="usage-donut-svg">
          <circle cx="60" cy="60" r="42" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="16" />
          @for (slice of slices(); track slice.id) {
            @if (slice.percent !== null) {
              <circle cx="60" cy="60" r="42" fill="none" [attr.stroke]="slice.color" stroke-width="16"
                [attr.stroke-dasharray]="slice.dash" [attr.stroke-dashoffset]="slice.offset"
                transform="rotate(-90 60 60)" data-testid="usage-donut-arc" />
            }
          }
          <text x="60" y="57" text-anchor="middle" fill="currentColor" class="text-[11px] font-semibold">{{ centerLabel() }}</text>
          <text x="60" y="71" text-anchor="middle" fill="currentColor" class="text-[9px]">known cost</text>
        </svg>
        <ul class="min-w-0 flex-1 space-y-1 text-xs" aria-label="Cost share legend">
          @for (slice of slices(); track slice.id) {
            <li tabindex="0" class="flex items-center gap-1.5 rounded focus-visible:outline-2 focus-visible:outline-primary"
              [attr.aria-label]="legendLabel(slice.label, slice.costUsd, slice.percent, slice.unpriced)">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" [style.background]="slice.color" aria-hidden="true"></span>
              <span class="min-w-0 flex-1 truncate" [title]="slice.label">{{ slice.label }}</span>
              <span class="tabular-nums">{{ costLabel(slice.costUsd, slice.unpriced) }}</span>
              <span class="w-10 text-right tabular-nums text-base-content-muted">{{ slice.percent === null ? '—' : percentLabel(slice.percent) }}</span>
            </li>
          }
        </ul>
      </div>
      @if (hasUnpriced()) {
        <p class="text-[11px] text-base-content-muted">Unpriced usage is excluded from cost share; shown totals are lower bounds.</p>
      }
    </section>
  `,
})
export class UsageCostDonutComponent {
  readonly providers = input<readonly ProviderUsageRow[]>([]);
  readonly models = input<readonly ModelBreakdownRow[]>([]);
  readonly totalCostUsd = input<number | null>(null);
  readonly unpricedFactCount = input(0);
  readonly mode = signal<'provider' | 'model'>('provider');

  readonly slices = computed(() => {
    const items: CostSliceInput[] = this.mode() === 'provider'
      ? this.providers().map((row) => ({ id: row.providerId, label: row.displayName, costUsd: row.costUsd, color: row.accent, unpriced: row.hasUnpricedFacts }))
      : this.models().map((row, i) => ({ id: `${row.providerId}:${row.modelId}`, label: row.modelDisplayName, costUsd: row.costUsd, color: MODEL_COLORS[i % MODEL_COLORS.length]!, unpriced: row.unpriced }));
    return buildCostSlices(items);
  });
  readonly hasUnpriced = computed(() => this.unpricedFactCount() > 0);
  readonly centerLabel = computed(() => {
    const cost = this.totalCostUsd();
    if (cost === null) return 'unpriced';
    return `${this.hasUnpriced() ? '≥ ' : ''}${formatUsd(cost)}`;
  });
  readonly ariaLabel = computed(() => `Cost share by ${this.mode()}. ${this.totalCostUsd() === null ? 'Cost unpriced.' : `${this.centerLabel()} known cost.`} ${this.hasUnpriced() ? 'Unpriced usage excluded from arcs.' : ''}`);
  readonly percentLabel = formatPercent;
  readonly costLabel = (cost: number | null, unpriced: boolean): string => cost === null ? 'unpriced' : `${unpriced ? '≥ ' : ''}${formatUsd(cost)}`;
  readonly legendLabel = (label: string, cost: number | null, percent: number | null, unpriced: boolean): string =>
    `${label}: ${this.costLabel(cost, unpriced)}${percent === null ? '' : `, ${formatPercent(percent)} of known cost`}`;
}
