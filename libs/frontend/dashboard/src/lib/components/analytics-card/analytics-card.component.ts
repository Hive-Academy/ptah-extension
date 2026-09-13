import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
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
import { ProviderAccountCardComponent } from '../provider-account-card/provider-account-card.component';

/**
 * AnalyticsCardComponent
 *
 * Card-sized analytics surface used inside `DashboardGridComponent`.
 *
 * Composition:
 * - Date-range filter (always visible, so it keeps focus across reloads)
 * - Aggregate `MetricsCardsComponent` (top summary row)
 * - Load/coverage status line: page progress, the session cap, partial
 *   coverage, failed sessions and unknown costs
 * - Per-session `SessionStatsCardComponent` grid
 *
 * Data flow:
 * - An effect loads on mount and again whenever the workspace changes;
 *   destroying the card cancels the load in flight.
 * - Stats arrive in pages and paint as they land. All display data comes from
 *   `SessionAnalyticsStateService` signals.
 */
@Component({
  selector: 'ptah-analytics-card',
  standalone: true,
  imports: [
    MetricsCardsComponent,
    SessionStatsCardComponent,
    SessionDetailModalComponent,
    LucideAngularModule,
    ProviderAccountCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analytics-card.component.html',
})
export class AnalyticsCardComponent {
  private readonly analyticsState = inject(SessionAnalyticsStateService);

  readonly ChartColumnIcon = ChartColumn;
  readonly dateRangeOptions = SESSION_DATE_RANGE_OPTIONS;
  readonly estimateLabel = 'Estimated from recorded usage and current rate card';

  readonly isLoading = this.analyticsState.isLoading;
  readonly isLoadingStats = this.analyticsState.isLoadingStats;
  readonly statsProgress = this.analyticsState.statsProgress;
  readonly loadError = this.analyticsState.loadError;
  readonly displayedSessions = this.analyticsState.displayedSessions;
  readonly aggregates = this.analyticsState.aggregates;
  readonly dateRange = this.analyticsState.dateRange;
  readonly totalSessionCount = this.analyticsState.totalSessionCount;
  readonly hasMoreSessions = this.analyticsState.hasMoreSessions;
  readonly sessionCap = this.analyticsState.sessionCap;

  /** Failed sessions are worth a retry only once the load has settled. */
  readonly canRetryFailed = computed(
    () => !this.isLoadingStats() && this.aggregates().errorSessionCount > 0,
  );

  /** The session shown in the detail modal, or null when closed. */
  readonly selectedSession = signal<DashboardSessionEntry | null>(null);

  constructor() {
    effect(() => {
      this.analyticsState.workspacePath();
      untracked(() => void this.analyticsState.loadDashboardData());
    });
    inject(DestroyRef).onDestroy(() => this.analyticsState.cancelLoad());
  }

  retry(): void {
    void this.analyticsState.loadDashboardData();
  }

  setDateRange(range: SessionDateRange): void {
    void this.analyticsState.setDateRange(range);
  }

  openSession(session: DashboardSessionEntry): void {
    this.selectedSession.set(session);
  }

  closeSession(): void {
    this.selectedSession.set(null);
  }
}
