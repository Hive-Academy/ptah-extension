import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  computed,
} from '@angular/core';
import { LucideAngularModule, ChartColumn } from 'lucide-angular';
import { SessionAnalyticsStateService } from '../../services/session-analytics-state.service';
import { MetricsCardsComponent } from '../session-analytics/metrics-cards.component';
import { SessionStatsCardComponent } from '../session-analytics/session-stats-card.component';

/**
 * AnalyticsCardComponent
 *
 * Card-sized analytics surface used inside `DashboardGridComponent`.
 *
 * History: this is the renamed/shrunk successor of the previous full-screen
 * analytics view component. Page-level chrome (header, padding,
 * "Back" navigation) was hoisted into `DashboardGridComponent`; this component
 * is now a self-contained card that presents the same analytics data.
 *
 * Composition:
 * - Aggregate `MetricsCardsComponent` (top summary row)
 * - Display count toggle (5 / 10 sessions)
 * - Per-session `SessionStatsCardComponent` grid
 *
 * Data flow:
 * - `ngOnInit` calls `analyticsState.loadDashboardData()` to fetch
 *   `session:list` + `session:stats-batch`.
 * - All display data comes from `SessionAnalyticsStateService` computed
 *   signals (no local state).
 */
@Component({
  selector: 'ptah-analytics-card',
  standalone: true,
  imports: [
    MetricsCardsComponent,
    SessionStatsCardComponent,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analytics-card.component.html',
})
export class AnalyticsCardComponent implements OnInit {
  private readonly analyticsState = inject(SessionAnalyticsStateService);

  readonly ChartColumnIcon = ChartColumn;

  readonly isLoading = this.analyticsState.isLoading;
  readonly loadError = this.analyticsState.loadError;
  readonly displayedSessions = this.analyticsState.displayedSessions;
  readonly aggregates = this.analyticsState.aggregates;
  readonly displayCount = this.analyticsState.displayCount;
  readonly allSessionCount = computed(
    () => this.analyticsState.allSessions().length,
  );

  ngOnInit(): void {
    this.analyticsState.loadDashboardData();
  }

  retry(): void {
    this.analyticsState.loadDashboardData();
  }

  setDisplayCount(count: 5 | 10): void {
    this.analyticsState.setDisplayCount(count);
  }
}
