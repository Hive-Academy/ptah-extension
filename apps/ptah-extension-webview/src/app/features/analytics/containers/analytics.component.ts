import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

// Core Services
import { AppStateManager } from '../../core/services/app-state.service';
import { LoggingService } from '../../core/services/logging.service';

// Child Components (Dumb)
import {
  VSCodeAnalyticsHeaderComponent,
  VSCodeAnalyticsStatsGridComponent,
  VSCodeAnalyticsComingSoonComponent,
} from '../../dumb-components';

// Smart Layout Components
import { VSCodeSimpleHeaderComponent } from '../layout/simple-header.component';

/**
 * Smart Analytics Component - Business Logic & State Orchestrator
 * - Manages analytics state and business logic
 * - Orchestrates child dumb components
 * - Handles view navigation and data management
 * - Pure VS Code styling with no custom design systems
 */
@Component({
  selector: 'vscode-analytics',
  standalone: true,
  imports: [
    CommonModule,
    VSCodeSimpleHeaderComponent,
    VSCodeAnalyticsHeaderComponent,
    VSCodeAnalyticsStatsGridComponent,
    VSCodeAnalyticsComingSoonComponent,
  ],
  template: `
    <div class="vscode-analytics-container">
      <!-- Header -->
      <vscode-simple-header (newSession)="onNewSession()" (analytics)="onAnalytics()">
      </vscode-simple-header>

      <!-- Analytics Content -->
      <main class="vscode-analytics-content">
        <div class="vscode-analytics-wrapper">
          <!-- Page Title -->
          <vscode-analytics-header></vscode-analytics-header>

          <!-- Statistics Grid -->
          <vscode-analytics-stats-grid [statsData]="getStatsData()"> </vscode-analytics-stats-grid>

          <!-- Coming Soon Section -->
          <vscode-analytics-coming-soon></vscode-analytics-coming-soon>
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
      vscode-simple-header {
        flex-shrink: 0;
      }

      vscode-analytics-header {
        margin-bottom: 24px;
      }

      vscode-analytics-stats-grid {
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
  private appState = inject(AppStateManager);
  private logger = inject(LoggingService);

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
