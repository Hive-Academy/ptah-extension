import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  ClockIcon,
  TrendingUpIcon,
  MemoryStickIcon,
  ActivityIcon,
  ZapIcon,
  CoinsIcon,
  MessageCircleIcon,
  CalendarIcon,
} from 'lucide-angular';
import { type DashboardMetrics } from '@ptah-extension/shared';

/**
 * VS Code Dashboard Metrics Grid - Pure Presentation Component
 * - Displays performance and usage metrics in a grid layout
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 * - Accessible metrics display with proper semantic structure
 */
@Component({
  selector: 'vscode-dashboard-metrics-grid',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],

  template: `
    <div class="vscode-metrics-grid" [class]="getGridClass()">
      <!-- Current Latency -->
      <article class="vscode-metric-card" [class]="getLatencyStatusClass()">
        <header class="vscode-metric-header">
          <lucide-angular [img]="ClockIcon" class="vscode-metric-icon"></lucide-angular>
          <span class="vscode-metric-label">Response Time</span>
        </header>
        <div class="vscode-metric-content">
          <div class="vscode-metric-value">
            {{ formatLatency(metrics.performance.currentLatency) }}
          </div>
          <div class="vscode-metric-detail">
            Avg: {{ formatLatency(metrics.performance.averageLatency) }}
          </div>
        </div>
      </article>

      <!-- Memory Usage -->
      <article class="vscode-metric-card" [class]="getMemoryStatusClass()">
        <header class="vscode-metric-header">
          <lucide-angular [img]="MemoryStickIcon" class="vscode-metric-icon"></lucide-angular>
          <span class="vscode-metric-label">Memory Usage</span>
        </header>
        <div class="vscode-metric-content">
          <div class="vscode-metric-value">{{ metrics.performance.memoryUsage.toFixed(1) }}MB</div>
          <div class="vscode-metric-detail">{{ getMemoryPercentage() }}% of limit</div>
        </div>
      </article>

      <!-- Throughput -->
      <article class="vscode-metric-card" [class]="getThroughputStatusClass()">
        <header class="vscode-metric-header">
          <lucide-angular [img]="TrendingUpIcon" class="vscode-metric-icon"></lucide-angular>
          <span class="vscode-metric-label">Throughput</span>
        </header>
        <div class="vscode-metric-content">
          <div class="vscode-metric-value">
            {{ metrics.performance.messagesPerMinute.toFixed(1) }}/min
          </div>
          <div class="vscode-metric-detail">Messages per minute</div>
        </div>
      </article>

      <!-- Success Rate -->
      <article class="vscode-metric-card" [class]="getSuccessStatusClass()">
        <header class="vscode-metric-header">
          <lucide-angular [img]="ActivityIcon" class="vscode-metric-icon"></lucide-angular>
          <span class="vscode-metric-label">Success Rate</span>
        </header>
        <div class="vscode-metric-content">
          <div class="vscode-metric-value">{{ metrics.performance.successRate.toFixed(1) }}%</div>
          <div class="vscode-metric-detail">System reliability</div>
        </div>
      </article>

      <!-- Expanded view additional metrics -->
      @if (displayMode === 'expanded') {
        <!-- Commands Run -->
        <article class="vscode-metric-card">
          <header class="vscode-metric-header">
            <lucide-angular [img]="ZapIcon" class="vscode-metric-icon"></lucide-angular>
            <span class="vscode-metric-label">Commands</span>
          </header>
          <div class="vscode-metric-content">
            <div class="vscode-metric-value">{{ formatNumber(metrics.usage.commandsRun) }}</div>
            <div class="vscode-metric-detail">Total executed</div>
          </div>
        </article>

        <!-- Tokens Used -->
        <article class="vscode-metric-card">
          <header class="vscode-metric-header">
            <lucide-angular [img]="CoinsIcon" class="vscode-metric-icon"></lucide-angular>
            <span class="vscode-metric-label">Tokens</span>
          </header>
          <div class="vscode-metric-content">
            <div class="vscode-metric-value">{{ formatNumber(metrics.usage.tokensUsed) }}</div>
            <div class="vscode-metric-detail">Total consumed</div>
          </div>
        </article>

        <!-- Total Messages -->
        <article class="vscode-metric-card">
          <header class="vscode-metric-header">
            <lucide-angular [img]="MessageCircleIcon" class="vscode-metric-icon"></lucide-angular>
            <span class="vscode-metric-label">Messages</span>
          </header>
          <div class="vscode-metric-content">
            <div class="vscode-metric-value">{{ formatNumber(metrics.usage.totalMessages) }}</div>
            <div class="vscode-metric-detail">Total processed</div>
          </div>
        </article>

        <!-- Sessions Today -->
        <article class="vscode-metric-card">
          <header class="vscode-metric-header">
            <lucide-angular [img]="CalendarIcon" class="vscode-metric-icon"></lucide-angular>
            <span class="vscode-metric-label">Sessions</span>
          </header>
          <div class="vscode-metric-content">
            <div class="vscode-metric-value">{{ metrics.usage.sessionsToday }}</div>
            <div class="vscode-metric-detail">Today</div>
          </div>
        </article>
      }
    </div>
  `,
  styles: [
    `
      .vscode-metrics-grid {
        display: grid;
        gap: 12px;
      }

      .vscode-metrics-grid--inline {
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      }

      .vscode-metrics-grid--expanded {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .vscode-metric-card {
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 14px;
        transition: all 0.15s ease;
        position: relative;
        overflow: hidden;
      }

      .vscode-metric-card:hover {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 1px 3px var(--vscode-widget-shadow);
      }

      .vscode-metric-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background-color: var(--vscode-button-background);
        opacity: 0.1;
      }

      .vscode-metric-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }

      .vscode-metric-icon {
        width: 16px;
        height: 16px;
        color: var(--vscode-button-foreground);
      }

      .vscode-metric-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--vscode-editor-foreground);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .vscode-metric-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .vscode-metric-value {
        font-size: 24px;
        font-weight: 700;
        line-height: 1.1;
        color: var(--vscode-editor-foreground);
      }

      .vscode-metric-detail {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
      }

      /* Status-specific styling */
      .vscode-metric-card--excellent::before {
        background-color: var(--vscode-terminal-ansiGreen);
        opacity: 0.6;
      }

      .vscode-metric-card--excellent .vscode-metric-icon {
        color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-metric-card--good::before {
        background-color: var(--vscode-terminal-ansiYellow);
        opacity: 0.6;
      }

      .vscode-metric-card--good .vscode-metric-icon {
        color: var(--vscode-terminal-ansiYellow);
      }

      .vscode-metric-card--warning::before {
        background-color: var(--vscode-terminal-ansiYellow);
        opacity: 0.8;
      }

      .vscode-metric-card--warning .vscode-metric-icon {
        color: var(--vscode-terminal-ansiYellow);
      }

      .vscode-metric-card--critical::before {
        background-color: var(--vscode-errorForeground);
        opacity: 0.8;
      }

      .vscode-metric-card--critical .vscode-metric-icon {
        color: var(--vscode-errorForeground);
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .vscode-metrics-grid--inline {
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 10px;
        }

        .vscode-metrics-grid--expanded {
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 8px;
        }

        .vscode-metric-card {
          padding: 10px;
        }

        .vscode-metric-value {
          font-size: 20px;
        }

        .vscode-metric-label {
          font-size: 11px;
        }
      }

      @media (max-width: 480px) {
        .vscode-metrics-grid--inline,
        .vscode-metrics-grid--expanded {
          grid-template-columns: 1fr 1fr;
        }

        .vscode-metric-card {
          padding: 8px;
        }

        .vscode-metric-value {
          font-size: 18px;
        }

        .vscode-metric-header {
          margin-bottom: 6px;
          gap: 6px;
        }

        .vscode-metric-icon {
          width: 14px;
          height: 14px;
        }

        .vscode-metric-label {
          font-size: 10px;
        }

        .vscode-metric-detail {
          font-size: 10px;
        }
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-metric-card {
          border-width: 2px;
        }
      }
    `,
  ],
})
export class VSCodeDashboardMetricsGridComponent {
  @Input({ required: true }) metrics!: DashboardMetrics;
  @Input() displayMode: 'inline' | 'expanded' = 'inline';

  readonly ClockIcon = ClockIcon;
  readonly TrendingUpIcon = TrendingUpIcon;
  readonly MemoryStickIcon = MemoryStickIcon;
  readonly ActivityIcon = ActivityIcon;
  readonly ZapIcon = ZapIcon;
  readonly CoinsIcon = CoinsIcon;
  readonly MessageCircleIcon = MessageCircleIcon;
  readonly CalendarIcon = CalendarIcon;

  getGridClass(): string {
    return `vscode-metrics-grid--${this.displayMode}`;
  }

  getLatencyStatusClass(): string {
    const latency = this.metrics.performance.currentLatency;
    if (latency === 0) return '';
    if (latency < 500) return 'vscode-metric-card--excellent';
    if (latency < 1000) return 'vscode-metric-card--good';
    if (latency < 2000) return 'vscode-metric-card--warning';
    return 'vscode-metric-card--critical';
  }

  getMemoryStatusClass(): string {
    const usage = this.metrics.performance.memoryUsage;
    const percentage = (usage / 30) * 100; // Assuming 30MB target limit
    if (percentage < 50) return 'vscode-metric-card--excellent';
    if (percentage < 70) return 'vscode-metric-card--good';
    if (percentage < 85) return 'vscode-metric-card--warning';
    return 'vscode-metric-card--critical';
  }

  getThroughputStatusClass(): string {
    const throughput = this.metrics.performance.messagesPerMinute;
    if (throughput > 10) return 'vscode-metric-card--excellent';
    if (throughput > 5) return 'vscode-metric-card--good';
    if (throughput > 1) return 'vscode-metric-card--warning';
    return '';
  }

  getSuccessStatusClass(): string {
    const successRate = this.metrics.performance.successRate;
    if (successRate >= 99) return 'vscode-metric-card--excellent';
    if (successRate >= 95) return 'vscode-metric-card--good';
    if (successRate >= 85) return 'vscode-metric-card--warning';
    return 'vscode-metric-card--critical';
  }

  getMemoryPercentage(): number {
    return Math.round((this.metrics.performance.memoryUsage / 30) * 100);
  }

  formatLatency(ms: number): string {
    if (ms === 0) return '0ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  formatNumber(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    }
    if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toString();
  }
}
