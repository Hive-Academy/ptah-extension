/**
 * UsageDashboardComponent
 *
 * Smart container for the Usage tab of the analytics card (TASK_2026_707
 * PR 2, T3-Code-style): range segmented control (7/30/90 days), refresh, the
 * raw-token-cost summary with provider share rows, the daily stacked bar
 * chart with a cost/tokens toggle, the KPI strip, the model/day breakdown
 * table and the cost-quality panel.
 *
 * Data flow: `AnalyticsUsageStore` owns the RPC request, range and
 * loading/error state; this component folds the summary through the pure
 * `buildUsageViewModel` inside a `computed` and hands the pieces to
 * presentational children. An effect reloads when the workspace changes;
 * destroying the component cancels the request in flight.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';
import { ModelStateService } from '@ptah-extension/core';
import type { UsageRangeDays } from '@ptah-extension/shared';
import {
  AnalyticsUsageStore,
  USAGE_RANGE_OPTIONS,
} from '../../services/analytics-usage.store';
import { buildUsageViewModel, type UsageViewModel } from './usage-summary.view-model';
import { formatChartUsd, formatCompactTokens } from './usage-formatting';
import {
  StackedBarChartComponent,
  type StackedBarSeries,
} from './stacked-bar-chart.component';
import { UsageCostSummaryComponent } from './usage-cost-summary.component';
import { UsageCostDonutComponent } from './usage-cost-donut.component';
import { UsageKpiStripComponent } from './usage-kpi-strip.component';
import { UsageBreakdownTableComponent } from './usage-breakdown-table.component';
import { UsageCostQualityComponent } from './usage-cost-quality.component';
import { UsageTopSessionsComponent } from './usage-top-sessions.component';

@Component({
  selector: 'ptah-usage-dashboard',
  standalone: true,
  imports: [
    LucideAngularModule,
    StackedBarChartComponent,
    UsageCostSummaryComponent,
    UsageCostDonutComponent,
    UsageKpiStripComponent,
    UsageBreakdownTableComponent,
    UsageCostQualityComponent,
    UsageTopSessionsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './usage-dashboard.component.html',
})
export class UsageDashboardComponent {
  private readonly usageStore = inject(AnalyticsUsageStore);
  private readonly modelState = inject(ModelStateService);

  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly rangeOptions = USAGE_RANGE_OPTIONS;
  protected readonly range = this.usageStore.range;
  protected readonly isLoading = this.usageStore.isLoading;
  protected readonly loadError = this.usageStore.loadError;
  /** True while a same-scope refresh runs and the old summary stays visible. */
  protected readonly isStale = this.usageStore.isSummaryStale;
  protected readonly summaryGeneratedAt = computed(() => this.usageStore.summary()?.generatedAt ?? '');

  /** Folded summary; `null` while nothing has loaded. */
  protected readonly viewModel = computed<UsageViewModel | null>(() =>
    buildUsageViewModel(
      this.usageStore.summary(),
      this.modelState.availableModels(),
    ),
  );

  protected readonly chartMode = signal<'cost' | 'tokens'>('cost');

  protected readonly chartSeries = computed<readonly StackedBarSeries[]>(
    () => {
      const vm = this.viewModel();
      if (!vm) return [];
      const mode = this.chartMode();
      return vm.providerSeries.map((provider) => ({
        id: provider.providerId,
        label: provider.displayName,
        color: provider.accent,
        values: mode === 'cost' ? provider.costValues : provider.tokenValues,
      }));
    },
  );

  protected readonly chartValueFormat = computed<(value: number) => string>(
    () => (this.chartMode() === 'cost' ? formatChartUsd : formatCompactTokens),
  );

  /**
   * Per day: the plotted cost is a lower bound because the day has unpriced
   * facts. Token counts are always known, so token mode passes no flags.
   */
  protected readonly chartUnknownDays = computed<readonly boolean[]>(() => {
    const vm = this.viewModel();
    if (!vm || this.chartMode() === 'tokens') return [];
    return vm.dayCostUnknown;
  });

  constructor() {
    effect(() => {
      this.usageStore.workspacePath();
      untracked(() => void this.usageStore.load());
    });
    inject(DestroyRef).onDestroy(() => this.usageStore.cancelLoad());
  }

  protected setRange(range: UsageRangeDays): void {
    this.usageStore.setRange(range);
  }

  protected retry(): void {
    this.usageStore.refresh();
  }

  protected setChartMode(mode: 'cost' | 'tokens'): void {
    this.chartMode.set(mode);
  }
}
