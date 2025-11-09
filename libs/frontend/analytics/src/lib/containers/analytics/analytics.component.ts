import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

// Core Services - Updated import paths
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { LoggingService } from '@ptah-extension/core';

// Child Components (Modernized)
import { AnalyticsHeaderComponent } from '../../components/analytics-header/analytics-header.component';
import { AnalyticsStatsGridComponent } from '../../components/analytics-stats-grid/analytics-stats-grid.component';
import { AnalyticsComingSoonComponent } from '../../components/analytics-coming-soon/analytics-coming-soon.component';

// Shared UI Components
import { SimpleHeaderComponent } from '@ptah-extension/shared-ui';

/**
 * Smart Analytics Component - Business Logic & State Orchestrator
 * - Manages analytics state and business logic
 * - Orchestrates child dumb components
 * - Handles view navigation and data management
 * - Pure VS Code styling with no custom design systems
 *
 * Modernizations:
 * - ✅ Selector: vscode-analytics → ptah-analytics
 * - ✅ inject() pattern for dependencies
 * - ✅ OnPush change detection (already present)
 * - ✅ Standalone component (already present)
 * - ✅ Modern child component imports
 */
@Component({
  selector: 'ptah-analytics',
  standalone: true,
  imports: [
    CommonModule,
    SimpleHeaderComponent,
    AnalyticsHeaderComponent,
    AnalyticsStatsGridComponent,
    AnalyticsComingSoonComponent,
  ],

  template: `
    <div class="vscode-analytics-container">
      <!-- Header -->
      <ptah-simple-header
        [ptahIconUri]="ptahIconUri"
        (newSession)="onNewSession()"
        (analytics)="onAnalytics()"
      />

      <!-- Analytics Content -->
      <main class="vscode-analytics-content">
        <div class="vscode-analytics-wrapper">
          <!-- Page Title -->
          <ptah-analytics-header />

          <!-- Statistics Grid -->
          <ptah-analytics-stats-grid [statsData]="getStatsData()" />

          <!-- Coming Soon Section -->
          <ptah-analytics-coming-soon />
        </div>
      </main>
    </div>
  `,
  styles: [
    `
      .vscode-analytics-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
        overflow: hidden;
      }

      .vscode-analytics-content {
        flex: 1;
        overflow-y: auto;
        padding: 24px;
        min-height: 0;
      }

      .vscode-analytics-wrapper {
        max-width: 1024px;
        margin: 0 auto;
      }

      /* Ensure proper flex layout for children */
      ptah-simple-header {
        flex-shrink: 0;
      }

      ptah-analytics-header {
        margin-bottom: 24px;
      }

      ptah-analytics-stats-grid {
        margin-bottom: 32px;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .vscode-analytics-content {
          padding: 16px;
        }
      }

      @media (max-width: 480px) {
        .vscode-analytics-content {
          padding: 12px;
        }
      }
    `,
  ],
})
export class AnalyticsComponent {
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  private readonly vscode = inject(VSCodeService);

  // Ptah icon URI for the header
  protected readonly ptahIconUri = this.vscode.getPtahIconUri();

  onNewSession(): void {
    // Navigate back to chat and start new session
    this.appState.setCurrentView('chat');
  }

  onAnalytics(): void {
    // Already on analytics - do nothing or refresh data
    this.logger.info('Already on analytics view', 'AnalyticsComponent');
  }

  getStatsData() {
    // TODO: Replace with real analytics data from service
    return {
      todayStats: {
        sessions: 12,
        label: 'Chat Sessions',
        timeframe: 'Today',
      },
      weekStats: {
        messages: 47,
        label: 'Messages Sent',
        timeframe: 'This Week',
      },
      totalStats: {
        tokens: 1234,
        label: 'Tokens Used',
        timeframe: 'Total',
      },
    };
  }
}
