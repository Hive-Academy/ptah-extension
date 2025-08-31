import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil, interval, combineLatest } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';

// Core Services
import {
  EnhancedChatService,
  StreamConsumptionState,
} from '../../core/services/enhanced-chat.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { LoggingService } from '../../core/services/logging.service';

// Child Components (Dumb)
import {
  VSCodeDashboardHeaderComponent,
  VSCodeDashboardMetricsGridComponent,
  VSCodeDashboardPerformanceChartComponent,
  VSCodeDashboardActivityFeedComponent,
  type DashboardMetrics,
  type PerformanceData,
  type ActivityItem,
} from '../../dumb-components';

/**
 * Smart Dashboard Component - Business Logic & State Orchestrator
 * - Manages unified dashboard state combining performance and analytics
 * - Orchestrates child dumb components for metrics display
 * - Handles real-time data collection and historical tracking
 * - Pure VS Code styling with no custom design systems
 */
@Component({
  selector: 'vscode-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    VSCodeDashboardHeaderComponent,
    VSCodeDashboardMetricsGridComponent,
    VSCodeDashboardPerformanceChartComponent,
    VSCodeDashboardActivityFeedComponent,
  ],
  template: `
    <div class="vscode-dashboard-container">
      <!-- Dashboard Header -->
      <vscode-dashboard-header
        [title]="dashboardTitle()"
        [subtitle]="dashboardSubtitle()"
        [isExpanded]="isExpanded()"
        [isRefreshing]="analyticsService.isLoading()"
        (toggleExpanded)="toggleExpanded()"
        (close)="onClose()"
        (refresh)="refreshDashboard()"
      >
      </vscode-dashboard-header>

      <!-- Main Dashboard Content -->
      <div class="vscode-dashboard-content">
        <!-- Metrics Overview Grid -->
        <vscode-dashboard-metrics-grid [metrics]="dashboardMetrics()" [displayMode]="displayMode()">
        </vscode-dashboard-metrics-grid>

        <!-- Expanded Content -->
        @if (isExpanded() || displayMode() === 'expanded') {
          <div class="vscode-dashboard-expanded">
            <!-- Performance Chart -->
            <vscode-dashboard-performance-chart
              [performanceData]="performanceData()"
              [showHistoricalChart]="showHistoricalChart()"
            >
            </vscode-dashboard-performance-chart>

            <!-- Activity Feed -->
            <vscode-dashboard-activity-feed [activities]="recentActivities()">
            </vscode-dashboard-activity-feed>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .vscode-dashboard-container {
        display: flex;
        flex-direction: column;
        background-color: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        overflow: hidden;
      }

      .vscode-dashboard-content {
        display: flex;
        flex-direction: column;
        padding: 16px;
        gap: 16px;
      }

      .vscode-dashboard-expanded {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-top: 8px;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .vscode-dashboard-content {
          padding: 12px;
          gap: 12px;
        }

        .vscode-dashboard-expanded {
          gap: 12px;
        }
      }

      @media (min-width: 1024px) {
        .vscode-dashboard-expanded {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 20px;
        }
      }
    `,
  ],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly enhancedChat = inject(EnhancedChatService);
  readonly analyticsService = inject(AnalyticsService);
  private readonly logger = inject(LoggingService);
  private readonly destroy$ = new Subject<void>();

  // Configuration inputs
  readonly displayMode = input<'inline' | 'expanded'>('inline');
  readonly showHistoricalChart = input<boolean>(true);
  readonly updateInterval = input<number>(1000);
  readonly maxHistoricalPoints = input<number>(600);

  // Output events
  readonly close = output<void>();

  // Component state signals
  private readonly _isExpanded = signal(false);

  // Legacy performance tracking (kept for circuit breaker integration)
  private startTime = Date.now();
  private lastMessageTime = 0;

  // Public readonly signals
  readonly isExpanded = this._isExpanded.asReadonly();
  // Use analytics service signals for real backend data
  readonly dashboardMetrics = this.analyticsService.dashboardMetrics;
  readonly performanceData = this.analyticsService.performanceData;
  readonly recentActivities = this.analyticsService.recentActivities;

  // Computed properties for template
  readonly dashboardTitle = computed(() =>
    this.displayMode() === 'expanded' ? 'System Dashboard' : 'Performance Monitor',
  );

  readonly dashboardSubtitle = computed(() => {
    const metrics = this.dashboardMetrics();
    const uptime = metrics.performance.uptime;
    const isBackendConnected = this.analyticsService.isBackendAvailable();
    const dataAge = this.analyticsService.getDataAge();
    const isDataFresh = this.analyticsService.isDataFresh();

    let statusText = uptime >= 95 ? 'Healthy' : uptime >= 80 ? 'Degraded' : 'Critical';

    if (!isBackendConnected) {
      statusText += ' (Estimated)';
    } else if (!isDataFresh && dataAge > 0) {
      const ageSeconds = Math.floor(dataAge / 1000);
      statusText += ` (${ageSeconds}s ago)`;
    }

    return `System ${statusText} • ${uptime.toFixed(1)}% Uptime`;
  });

  ngOnInit(): void {
    this.initializeAnalyticsIntegration();
    this.setupPerformanceMonitoring();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleExpanded(): void {
    const wasExpanded = this._isExpanded();
    this._isExpanded.set(!wasExpanded);

    // Track expand/collapse events
    this.analyticsService.trackEvent('dashboard_toggled', {
      action: wasExpanded ? 'collapsed' : 'expanded',
      displayMode: this.displayMode(),
    });
  }

  onClose(): void {
    // Track dashboard close event
    this.analyticsService.trackEvent('dashboard_closed', {
      displayMode: this.displayMode(),
      wasExpanded: this._isExpanded(),
      sessionDuration: Date.now() - this.startTime,
    });

    this.close.emit();
  }

  private initializeAnalyticsIntegration(): void {
    this.logger.lifecycle('DashboardComponent', 'init', { hasAnalytics: !!this.analyticsService });

    // Track dashboard view event
    this.analyticsService.trackEvent('dashboard_viewed', {
      displayMode: this.displayMode(),
      showHistoricalChart: this.showHistoricalChart(),
    });

    // Initial data fetch
    this.analyticsService.fetchAnalyticsData();
  }

  private setupPerformanceMonitoring(): void {
    if (!this.enhancedChat) {
      this.logger.warn(
        'EnhancedChatService not available for performance monitoring',
        'DashboardComponent',
      );
      return;
    }

    // Monitor stream consumption state for additional performance insights
    combineLatest([
      toObservable(this.enhancedChat.streamConsumptionState),
      toObservable(this.enhancedChat.messages),
      toObservable(this.enhancedChat.isStreaming),
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([streamState, messages, isStreaming]) => {
        this.trackPerformanceEvents(streamState, messages.length);
      });
  }

  private trackPerformanceEvents(
    streamState: StreamConsumptionState,
    messageCount: number,
  ): void {
    const now = Date.now();

    // Track message processing events for analytics
    if (streamState.lastMessageTimestamp > this.lastMessageTime) {
      const latency = Math.max(0, now - streamState.lastMessageTimestamp);
      this.lastMessageTime = streamState.lastMessageTimestamp;

      // Send analytics event to backend
      this.analyticsService.trackEvent('message_processed', {
        latency,
        messageCount,
        sessionDuration: now - this.startTime,
      });
    }

  }

  /**
   * Refresh dashboard data manually
   */
  refreshDashboard(): void {
    this.logger.interaction('manualRefresh', 'DashboardComponent', { timestamp: Date.now() });
    this.analyticsService.refreshData();

    // Track refresh event
    this.analyticsService.trackEvent('dashboard_refreshed', {
      displayMode: this.displayMode(),
      isExpanded: this._isExpanded(),
    });
  }
}
