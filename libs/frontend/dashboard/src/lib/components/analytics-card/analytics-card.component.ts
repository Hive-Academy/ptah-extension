import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { LucideAngularModule, ChartColumn } from 'lucide-angular';
import {
  SessionAnalyticsStateService,
  SessionDateRange,
  SESSION_DATE_RANGE_OPTIONS,
  DashboardSessionEntry,
} from '../../services/session-analytics-state.service';
import { MetricsCardsComponent } from '../session-analytics/metrics-cards.component';
import { SessionStatsCardComponent } from '../session-analytics/session-stats-card.component';
import { SessionDetailModalComponent } from '../session-analytics/session-detail-modal.component';

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
 * - Date-range filter (1 day / 2 days / 3 days / 1 week)
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
    SessionDetailModalComponent,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analytics-card.component.html',
})
export class AnalyticsCardComponent implements OnInit {
  private readonly analyticsState = inject(SessionAnalyticsStateService);

  readonly ChartColumnIcon = ChartColumn;
  readonly dateRangeOptions = SESSION_DATE_RANGE_OPTIONS;

  readonly isLoading = this.analyticsState.isLoading;
  readonly loadError = this.analyticsState.loadError;
  readonly displayedSessions = this.analyticsState.displayedSessions;
  readonly aggregates = this.analyticsState.aggregates;
  readonly dateRange = this.analyticsState.dateRange;
  readonly totalSessionCount = this.analyticsState.totalSessionCount;

  /** The session shown in the detail modal, or null when closed. */
  readonly selectedSession = signal<DashboardSessionEntry | null>(null);

  ngOnInit(): void {
    this.analyticsState.loadDashboardData();
  }

  retry(): void {
    this.analyticsState.loadDashboardData();
  }

  setDateRange(range: SessionDateRange): void {
    this.analyticsState.setDateRange(range);
  }

  openSession(session: DashboardSessionEntry): void {
    this.selectedSession.set(session);
  }

  closeSession(): void {
    this.selectedSession.set(null);
  }
}
