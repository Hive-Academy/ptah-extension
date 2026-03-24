import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  computed,
} from '@angular/core';
import { SessionAnalyticsStateService } from '../../services/session-analytics-state.service';
import { MetricsCardsComponent } from './metrics-cards.component';
import { SessionStatsCardComponent } from './session-stats-card.component';
import { AppStateManager } from '@ptah-extension/core';
import { LucideAngularModule, ChartColumn, ArrowLeft } from 'lucide-angular';

/**
 * SessionAnalyticsDashboardViewComponent
 *
 * Main layout component for the session analytics dashboard. Composes:
 * - Aggregate MetricsCards (top summary row)
 * - Display count toggle (5 / 10 sessions)
 * - Per-session SessionStatsCard grid
 *
 * Data flow:
 * - ngOnInit calls analyticsState.loadDashboardData() to fetch session:list + session:stats-batch
 * - All display data comes from SessionAnalyticsStateService computed signals
 * - No sort logic needed (sessions pre-sorted by lastActiveAt desc from backend)
 *
 * TASK_2025_206 v2: Replaces flat table layout with card-based per-session display.
 */
@Component({
  selector: 'ptah-session-analytics-dashboard',
  standalone: true,
  imports: [
    MetricsCardsComponent,
    SessionStatsCardComponent,
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
            Real costs from JSONL
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
        <p class="text-sm text-base-content/50 mt-4">
          Reading session history...
        </p>
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
      } @else if (displayedSessions().length === 0) {
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
      <!-- Aggregate Metrics Cards -->
      <ptah-session-metrics-cards [aggregates]="aggregates()" />

      <!-- Display Count Toggle -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-base-content/50">Show:</span>
        <div class="join">
          <button
            class="join-item btn btn-xs"
            [class.btn-active]="displayCount() === 5"
            (click)="setDisplayCount(5)"
          >
            5
          </button>
          <button
            class="join-item btn btn-xs"
            [class.btn-active]="displayCount() === 10"
            (click)="setDisplayCount(10)"
          >
            10
          </button>
        </div>
        <span class="text-[10px] text-base-content/40">
          of {{ allSessionCount() }} sessions
        </span>
      </div>

      <!-- Session Stats Cards Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        @for (session of displayedSessions(); track session.sessionId) {
        <ptah-session-stats-card [session]="session" />
        }
      </div>
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
  readonly displayedSessions = this.analyticsState.displayedSessions;
  readonly aggregates = this.analyticsState.aggregates;
  readonly displayCount = this.analyticsState.displayCount;
  readonly allSessionCount = computed(
    () => this.analyticsState.allSessions().length
  );

  ngOnInit(): void {
    this.analyticsState.loadDashboardData();
  }

  navigateBack(): void {
    this.appState.setCurrentView('chat');
  }

  retry(): void {
    this.analyticsState.loadDashboardData();
  }

  setDisplayCount(count: 5 | 10): void {
    this.analyticsState.setDisplayCount(count);
  }
}
