import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  TrendingUpIcon,
  ActivityIcon,
} from 'lucide-angular';
import { type PerformanceData } from '@ptah-extension/shared';

/**
 * Dashboard Performance Chart Component - Pure Presentation
 * - Simple performance visualization with trend indicators
 * - No business logic or state management
 * - Pure VS Code styling with responsive design
 */
@Component({
  selector: 'ptah-dashboard-performance-chart',
  standalone: true,

  imports: [CommonModule, LucideAngularModule],

  template: `
    <section
      class="vscode-performance-chart"
      [attr.aria-label]="'Performance trends'"
    >
      <header class="vscode-chart-header">
        <h3 class="vscode-chart-title">Performance Trends</h3>
        <div class="vscode-trend-indicators">
          <div class="vscode-trend-item" [class]="getTrendClass('latency')">
            <lucide-angular
              [img]="getTrendIcon()"
              class="vscode-trend-icon"
            ></lucide-angular>
            <span class="vscode-trend-label"
              >Latency {{ performanceData().latencyTrend }}</span
            >
          </div>
          <div class="vscode-trend-item" [class]="getTrendClass('memory')">
            <lucide-angular
              [img]="getTrendIcon()"
              class="vscode-trend-icon"
            ></lucide-angular>
            <span class="vscode-trend-label"
              >Memory {{ performanceData().memoryTrend }}</span
            >
          </div>
        </div>
      </header>

      @if (showHistoricalChart() && hasChartData()) {
      <div class="vscode-chart-content">
        <div class="vscode-chart-placeholder">
          <div class="vscode-chart-message">
            <lucide-angular
              [img]="ActivityIcon"
              class="vscode-chart-icon"
            ></lucide-angular>
            <span>{{ getChartMessage() }}</span>
          </div>

          <!-- Simple visual representation -->
          <div class="vscode-simple-chart">
            @for (point of getRecentDataPoints(); track point.timestamp) {
            <div
              class="vscode-chart-bar"
              [style.height.%]="getBarHeight(point.latency)"
              class="vscode-chart-bar--operational"
              [title]="
                'Latency: ' +
                point.latency +
                'ms at ' +
                formatTime(point.timestamp)
              "
            ></div>
            }
          </div>
        </div>
      </div>
      } @else {
      <div class="vscode-chart-empty">
        <div class="vscode-empty-message">
          <lucide-angular
            [img]="ActivityIcon"
            class="vscode-empty-icon"
          ></lucide-angular>
          <span>Collecting performance data...</span>
        </div>
      </div>
      }
    </section>
  `,
  styles: [
    `
      .vscode-performance-chart {
        background-color: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        padding: 16px;
      }

      .vscode-chart-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        gap: 16px;
      }

      .vscode-chart-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-editor-foreground);
      }

      .vscode-trend-indicators {
        display: flex;
        gap: 12px;
      }

      .vscode-trend-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
      }

      .vscode-trend-item--improving {
        background-color: color-mix(
          in srgb,
          var(--vscode-terminal-ansiGreen) 15%,
          transparent
        );
        color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-trend-item--stable {
        background-color: color-mix(
          in srgb,
          var(--vscode-terminal-ansiYellow) 15%,
          transparent
        );
        color: var(--vscode-terminal-ansiYellow);
      }

      .vscode-trend-item--degrading {
        background-color: var(--vscode-errorBackground);
        color: var(--vscode-errorForeground);
      }

      .vscode-trend-icon {
        width: 12px;
        height: 12px;
      }

      .vscode-trend-label {
        text-transform: capitalize;
      }

      .vscode-chart-content {
        min-height: 120px;
      }

      .vscode-chart-placeholder {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .vscode-chart-message {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .vscode-chart-icon {
        width: 14px;
        height: 14px;
      }

      .vscode-simple-chart {
        display: flex;
        align-items: end;
        gap: 2px;
        height: 80px;
        padding: 8px;
        background-color: var(--vscode-input-background);
        border-radius: 4px;
        border: 1px solid var(--vscode-input-border);
      }

      .vscode-chart-bar {
        flex: 1;
        min-height: 2px;
        border-radius: 1px;
        transition: all 0.2s ease;
        opacity: 0.8;
      }

      .vscode-chart-bar--CLOSED {
        background-color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-chart-bar--HALF_OPEN {
        background-color: var(--vscode-terminal-ansiYellow);
      }

      .vscode-chart-bar--OPEN {
        background-color: var(--vscode-errorForeground);
      }

      .vscode-chart-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 120px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
      }

      .vscode-empty-message {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .vscode-empty-icon {
        width: 16px;
        height: 16px;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .vscode-chart-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
        }

        .vscode-trend-indicators {
          gap: 8px;
        }

        .vscode-trend-item {
          font-size: 10px;
          padding: 3px 6px;
        }

        .vscode-simple-chart {
          height: 60px;
        }
      }

      @media (max-width: 480px) {
        .vscode-performance-chart {
          padding: 12px;
        }

        .vscode-chart-header {
          margin-bottom: 12px;
        }

        .vscode-chart-title {
          font-size: 13px;
        }

        .vscode-trend-indicators {
          flex-wrap: wrap;
        }
      }
    `,
  ],
})
export class DashboardPerformanceChartComponent {
  readonly performanceData = input.required<PerformanceData>();
  readonly showHistoricalChart = input<boolean>(true);

  readonly TrendingUpIcon = TrendingUpIcon;
  readonly ActivityIcon = ActivityIcon;

  hasChartData(): boolean {
    return this.performanceData().historicalData.length > 0;
  }

  getChartMessage(): string {
    const dataPoints = this.performanceData().historicalData.length;
    return `Showing ${dataPoints} performance data points over time`;
  }

  getRecentDataPoints() {
    // Show last 20 data points for the simple chart
    return this.performanceData().historicalData.slice(-20);
  }

  getTrendClass(type: 'latency' | 'memory'): string {
    const trend =
      type === 'latency'
        ? this.performanceData().latencyTrend
        : this.performanceData().memoryTrend;
    return `vscode-trend-item--${trend}`;
  }

  getTrendIcon() {
    return TrendingUpIcon; // Could be expanded with different icons per trend
  }

  getBarHeight(latency: number): number {
    // Normalize latency to 0-100% for visual display
    const maxLatency = 2000; // 2 seconds max for scale
    return Math.min(100, (latency / maxLatency) * 100);
  }

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }
}
