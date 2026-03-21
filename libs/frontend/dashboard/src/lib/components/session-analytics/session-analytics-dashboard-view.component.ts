import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
} from '@angular/core';
import {
  SessionAnalyticsStateService,
  SortField,
} from '../../services/session-analytics-state.service';
import { MetricsCardsComponent } from './metrics-cards.component';
import { SessionHistoryTableComponent } from './session-history-table.component';
import { TokenUsageBreakdownComponent } from './token-usage-breakdown.component';
import { AppStateManager } from '@ptah-extension/core';
import { LucideAngularModule, ChartColumn, ArrowLeft } from 'lucide-angular';

/**
 * SessionAnalyticsDashboardViewComponent
 *
 * Main layout component for the session analytics dashboard. Composes all
 * child components into a responsive layout and wires the state service.
 *
 * Responsibilities:
 * - Initialize session loading on mount
 * - Compose MetricsCards, TokenUsageBreakdown, and SessionHistoryTable
 * - Provide navigation back to chat view
 * - Wire sort/loadMore events to state service
 * - Display loading/error states during data fetch
 *
 * Component Hierarchy:
 *   SessionAnalyticsDashboardViewComponent
 *   +-- MetricsCardsComponent (5 stat cards)
 *   +-- TokenUsageBreakdownComponent (progress bars)
 *   +-- SessionHistoryTableComponent (sortable table)
 */
@Component({
  selector: 'ptah-session-analytics-dashboard',
  standalone: true,
  imports: [
    MetricsCardsComponent,
    SessionHistoryTableComponent,
    TokenUsageBreakdownComponent,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-base-100 min-h-full p-4 space-y-6">
      <!-- Header -->
      <div class="flex justify-between items-center">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold">Session Analytics</h2>
          <span
            class="badge badge-outline badge-sm gap-1 text-[10px] text-base-content/50 border-base-content/20"
          >
            Estimated costs (default pricing)
          </span>
        </div>
        <button
          class="btn btn-sm btn-ghost gap-1"
          (click)="navigateBack()"
          aria-label="Back to chat"
        >
          <lucide-angular
            [img]="ArrowLeftIcon"
            class="w-4 h-4"
            aria-hidden="true"
          ></lucide-angular>
          Back
        </button>
      </div>

      @if (isLoading()) {
      <!-- Loading state -->
      <div
        class="flex flex-col items-center justify-center p-12"
        aria-label="Loading session analytics"
      >
        <span class="loading loading-spinner loading-lg"></span>
        <p class="text-sm text-base-content/50 mt-4">Loading session data...</p>
      </div>
      } @else if (loadError()) {
      <!-- Error state -->
      <div class="alert alert-error" role="alert">
        <span>{{ loadError() }}</span>
        <button
          class="btn btn-sm"
          (click)="retry()"
          aria-label="Retry loading sessions"
        >
          Retry
        </button>
      </div>
      } @else if (sessions().length === 0) {
      <!-- Empty state -->
      <div
        class="flex flex-col items-center justify-center p-12 text-base-content/50"
      >
        <lucide-angular
          [img]="ChartColumnIcon"
          class="w-12 h-12 mb-4"
          aria-hidden="true"
        ></lucide-angular>
        <p class="text-sm">No sessions found. Start a chat to see analytics.</p>
      </div>
      } @else {
      <!-- Metrics Cards -->
      <ptah-session-metrics-cards
        [totalCost]="totalEstimatedCost()"
        [totalInputTokens]="totalInputTokens()"
        [totalOutputTokens]="totalOutputTokens()"
        [sessionCount]="totalSessions()"
        [avgCostPerSession]="avgCostPerSession()"
      />

      <!-- Token Usage Breakdown -->
      <ptah-token-usage-breakdown [breakdown]="tokenBreakdown()" />

      <!-- Session History Table -->
      <ptah-session-history-table
        [sessions]="sortedSessions()"
        [sortField]="sortField()"
        [sortDirection]="sortDirection()"
        [hasMore]="hasMoreSessions()"
        [isLoadingMore]="isLoadingMore()"
        (sortChanged)="onSortChanged($event)"
        (loadMore)="onLoadMore()"
      />
      }
    </div>
  `,
})
export class SessionAnalyticsDashboardViewComponent implements OnInit {
  private readonly analyticsState = inject(SessionAnalyticsStateService);
  private readonly appState = inject(AppStateManager);

  // Lucide icon references
  readonly ChartColumnIcon = ChartColumn;
  readonly ArrowLeftIcon = ArrowLeft;

  // Local signal delegates from state service
  readonly isLoading = this.analyticsState.isLoading;
  readonly loadError = this.analyticsState.loadError;
  readonly sessions = this.analyticsState.sessions;
  readonly totalEstimatedCost = this.analyticsState.totalEstimatedCost;
  readonly totalInputTokens = this.analyticsState.totalInputTokens;
  readonly totalOutputTokens = this.analyticsState.totalOutputTokens;
  readonly totalSessions = this.analyticsState.totalSessions;
  readonly avgCostPerSession = this.analyticsState.avgCostPerSession;
  readonly tokenBreakdown = this.analyticsState.tokenBreakdown;
  readonly sortedSessions = this.analyticsState.sortedSessions;
  readonly sortField = this.analyticsState.sortField;
  readonly sortDirection = this.analyticsState.sortDirection;
  readonly hasMoreSessions = this.analyticsState.hasMoreSessions;
  readonly isLoadingMore = this.analyticsState.isLoadingMore;

  ngOnInit(): void {
    this.analyticsState.ensureSessionsLoaded();
  }

  navigateBack(): void {
    this.appState.setCurrentView('chat');
  }

  retry(): void {
    this.analyticsState.ensureSessionsLoaded();
  }

  onSortChanged(field: SortField): void {
    this.analyticsState.setSortField(field);
  }

  async onLoadMore(): Promise<void> {
    try {
      await this.analyticsState.loadMoreSessions();
    } catch {
      // ChatStore handles errors internally
    }
  }
}
