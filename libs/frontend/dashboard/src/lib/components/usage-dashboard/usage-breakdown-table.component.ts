/**
 * UsageBreakdownTableComponent
 *
 * Breakdown table with a [Model | Day] toggle (requirement 5). Model view:
 * model (provider mark + display name + provider chip), cost, share, tokens —
 * sorted by cost desc then tokens (the view model pre-sorts). Unpriced rows
 * show "—" for cost and carry a title note. Day view: one row per day with
 * cost, share, tokens and that day's top model. While any fact is unpriced,
 * every share is of the known priced cost only, and the heading states that
 * denominator.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { ProviderMarkComponent } from '@ptah-extension/ui';
import { type DayBreakdownRow, type ModelBreakdownRow } from './usage-summary.view-model';
import { formatCompactTokens, formatDayShort, formatPercent, formatUsd, providerDisplayName } from './usage-formatting';

@Component({
  selector: 'ptah-usage-breakdown-table',
  standalone: true,
  imports: [ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2" data-testid="usage-breakdown">
      <div class="flex items-center justify-between gap-2">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-base-content-muted">
          Breakdown
        </h4>
        <div class="join" role="group" aria-label="Breakdown view">
          <button
            type="button"
            class="join-item btn btn-xs"
            [class.btn-active]="mode() === 'model'"
            [attr.aria-pressed]="mode() === 'model'"
            (click)="mode.set('model')"
          >
            Model
          </button>
          <button
            type="button"
            class="join-item btn btn-xs"
            [class.btn-active]="mode() === 'day'"
            [attr.aria-pressed]="mode() === 'day'"
            (click)="mode.set('day')"
          >
            Day
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        @if (mode() === 'model') {
          <table class="table table-xs" data-testid="usage-breakdown-model">
            <thead>
              <tr>
                <th>Model</th>
                <th class="text-right">Cost</th>
                <th class="text-right" [attr.title]="shareTitle()">{{ shareHeading() }}</th>
                <th class="text-right">Tokens</th>
              </tr>
            </thead>
            <tbody>
              @for (row of modelRows(); track row.providerId + row.modelId) {
                <tr data-testid="usage-model-row">
                  <td>
                    <div class="flex items-center gap-2">
                      <ptah-provider-mark
                        [providerId]="row.providerId"
                        class="h-3.5 w-3.5 shrink-0"
                      />
                      <span class="truncate" [attr.title]="row.modelDisplayName">
                        {{ row.modelDisplayName }}
                      </span>
                      <span class="badge badge-ghost badge-xs text-[10px] text-base-content-muted">
                        {{ providerName(row.providerId) }}
                      </span>
                    </div>
                  </td>
                  <td
                    class="text-right tabular-nums"
                    [attr.title]="row.costUsd === null ? 'No price for this model' : row.unpriced ? 'Some usage of this model is unpriced' : null"
                  >
                    {{ modelCostLabel(row) }}
                  </td>
                  <td class="text-right tabular-nums">{{ shareLabel(row.shareOfCost) }}</td>
                  <td class="text-right tabular-nums">{{ compactTokens(row.tokens) }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <table class="table table-xs" data-testid="usage-breakdown-day">
            <thead>
              <tr>
                <th>Day</th>
                <th class="text-right">Cost</th>
                <th class="text-right" [attr.title]="shareTitle()">{{ shareHeading() }}</th>
                <th class="text-right">Tokens</th>
                <th>Top model</th>
              </tr>
            </thead>
            <tbody>
              @for (row of dayRows(); track row.day) {
                <tr data-testid="usage-day-row">
                  <td>{{ dayLabel(row.day) }}</td>
                  <td
                    class="text-right tabular-nums"
                    [attr.title]="dayTitle(row)"
                  >
                    {{ dayCostLabel(row) }}
                  </td>
                  <td class="text-right tabular-nums">{{ shareLabel(row.shareOfCost) }}</td>
                  <td class="text-right tabular-nums">{{ compactTokens(row.tokens) }}</td>
                  <td class="truncate">{{ row.topModelDisplayName ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `,
})
export class UsageBreakdownTableComponent {
  readonly modelRows = input.required<readonly ModelBreakdownRow[]>();
  readonly dayRows = input.required<readonly DayBreakdownRow[]>();
  /** True while any in-window cost fact is unpriced: shares then divide by the known priced cost only. */
  readonly costPartiallyKnown = input(false);

  protected readonly mode = signal<'model' | 'day'>('model');

  /** "Share of known cost" while unpriced facts shrink the denominator; plain "Share" otherwise. */
  protected readonly shareHeading = computed(() =>
    this.costPartiallyKnown() ? 'Share of known cost' : 'Share',
  );

  protected readonly shareTitle = computed<string | null>(() =>
    this.costPartiallyKnown()
      ? 'Some usage in this range is unpriced; shares are of the known priced cost only'
      : null,
  );

  protected readonly providerName = providerDisplayName;
  protected readonly compactTokens = formatCompactTokens;
  protected readonly dayLabel = formatDayShort;

  /** "—", "$3.00", or "≥ $3.00" while some of the model's usage is unpriced. */
  protected readonly modelCostLabel = (row: ModelBreakdownRow): string =>
    row.costUsd === null
      ? '—'
      : row.unpriced
        ? `≥ ${formatUsd(row.costUsd)}`
        : formatUsd(row.costUsd);

  /** "—", "$3.00", or "≥ $3.00" while some of the day's usage is unpriced. */
  protected readonly dayCostLabel = (row: DayBreakdownRow): string =>
    row.costUsd === null
      ? '—'
      : row.unpricedFactCount > 0
        ? `≥ ${formatUsd(row.costUsd)}`
        : formatUsd(row.costUsd);

  protected readonly dayTitle = (row: DayBreakdownRow): string | null => {
    if (row.costUsd === null) return 'No priced usage this day';
    if (row.unpricedFactCount === 0) return null;
    return `${row.unpricedFactCount} ${
      row.unpricedFactCount === 1 ? 'fact' : 'facts'
    } unpriced this day`;
  };

  protected readonly shareLabel = (share: number | null): string =>
    share === null ? '—' : formatPercent(share);
}