import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ActivityIcon, TrendingUpIcon, BarChart3Icon } from 'lucide-angular';

export interface StatsData {
  todayStats: {
    sessions: number;
    label: string;
    timeframe: string;
  };
  weekStats: {
    messages: number;
    label: string;
    timeframe: string;
  };
  totalStats: {
    tokens: number;
    label: string;
    timeframe: string;
  };
}

/**
 * VS Code Analytics Stats Grid - Pure Presentation Component
 * - Statistics cards with usage metrics
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 * - Accessible statistics display with proper semantics
 */
@Component({
  selector: 'vscode-analytics-stats-grid',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],

  template: `
    <div class="vscode-stats-grid" [attr.aria-label]="'Usage statistics'">
      <!-- Chat Sessions Card -->
      <article class="vscode-stats-card vscode-stats-card--sessions">
        <header class="vscode-stats-card-header">
          <lucide-angular
            [img]="ActivityIcon"
            class="vscode-stats-icon"
            [attr.aria-hidden]="'true'"
          ></lucide-angular>
          <span class="vscode-stats-badge vscode-stats-badge--today">{{
            statsData.todayStats.timeframe
          }}</span>
        </header>
        <div class="vscode-stats-content">
          <div
            class="vscode-stats-value"
            [attr.aria-label]="statsData.todayStats.sessions + ' ' + statsData.todayStats.label"
          >
            {{ statsData.todayStats.sessions }}
          </div>
          <div class="vscode-stats-label">{{ statsData.todayStats.label }}</div>
        </div>
      </article>

      <!-- Messages Sent Card -->
      <article class="vscode-stats-card vscode-stats-card--messages">
        <header class="vscode-stats-card-header">
          <lucide-angular
            [img]="TrendingUpIcon"
            class="vscode-stats-icon"
            [attr.aria-hidden]="'true'"
          ></lucide-angular>
          <span class="vscode-stats-badge vscode-stats-badge--week">{{
            statsData.weekStats.timeframe
          }}</span>
        </header>
        <div class="vscode-stats-content">
          <div
            class="vscode-stats-value"
            [attr.aria-label]="statsData.weekStats.messages + ' ' + statsData.weekStats.label"
          >
            {{ statsData.weekStats.messages }}
          </div>
          <div class="vscode-stats-label">{{ statsData.weekStats.label }}</div>
        </div>
      </article>

      <!-- Tokens Used Card -->
      <article class="vscode-stats-card vscode-stats-card--tokens">
        <header class="vscode-stats-card-header">
          <lucide-angular
            [img]="BarChart3Icon"
            class="vscode-stats-icon"
            [attr.aria-hidden]="'true'"
          ></lucide-angular>
          <span class="vscode-stats-badge vscode-stats-badge--total">{{
            statsData.totalStats.timeframe
          }}</span>
        </header>
        <div class="vscode-stats-content">
          <div
            class="vscode-stats-value"
            [attr.aria-label]="statsData.totalStats.tokens + ' ' + statsData.totalStats.label"
          >
            {{ statsData.totalStats.tokens | number }}
          </div>
          <div class="vscode-stats-label">{{ statsData.totalStats.label }}</div>
        </div>
      </article>
    </div>
  `,
  styles: [
    `
      .vscode-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
        margin-bottom: 32px;
      }

      .vscode-stats-card {
        background-color: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        padding: 20px;
        position: relative;
        overflow: hidden;
        transition: border-color 0.15s ease;
      }

      .vscode-stats-card:hover {
        border-color: var(--vscode-focusBorder);
      }

      .vscode-stats-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background-color: var(--vscode-button-background);
        opacity: 0.1;
      }

      .vscode-stats-card--sessions::before {
        background-color: var(--vscode-button-background);
      }

      .vscode-stats-card--messages::before {
        background-color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-stats-card--tokens::before {
        background-color: var(--vscode-terminal-ansiMagenta);
      }

      .vscode-stats-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .vscode-stats-icon {
        width: 24px;
        height: 24px;
        color: var(--vscode-button-foreground);
      }

      .vscode-stats-card--sessions .vscode-stats-icon {
        color: var(--vscode-button-foreground);
      }

      .vscode-stats-card--messages .vscode-stats-icon {
        color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-stats-card--tokens .vscode-stats-icon {
        color: var(--vscode-terminal-ansiMagenta);
      }

      .vscode-stats-badge {
        font-size: 11px;
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background-color: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border: 1px solid var(--vscode-widget-border);
      }

      .vscode-stats-badge--today {
        background-color: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }

      .vscode-stats-badge--week {
        background-color: rgba(46, 160, 67, 0.15);
        color: var(--vscode-terminal-ansiGreen);
        border-color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-stats-badge--total {
        background-color: rgba(188, 63, 188, 0.15);
        color: var(--vscode-terminal-ansiMagenta);
        border-color: var(--vscode-terminal-ansiMagenta);
      }

      .vscode-stats-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .vscode-stats-value {
        font-size: 32px;
        font-weight: 700;
        line-height: 1.1;
        color: var(--vscode-editor-foreground);
        margin-bottom: 4px;
      }

      .vscode-stats-label {
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        font-weight: 400;
        line-height: 1.3;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .vscode-stats-grid {
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 16px;
        }

        .vscode-stats-card {
          padding: 16px;
        }

        .vscode-stats-value {
          font-size: 28px;
        }
      }

      @media (max-width: 480px) {
        .vscode-stats-grid {
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .vscode-stats-card {
          padding: 12px;
        }

        .vscode-stats-card-header {
          margin-bottom: 12px;
        }

        .vscode-stats-icon {
          width: 20px;
          height: 20px;
        }

        .vscode-stats-value {
          font-size: 24px;
        }

        .vscode-stats-badge {
          font-size: 10px;
          padding: 3px 6px;
        }
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-stats-card {
          border-width: 2px;
        }

        .vscode-stats-badge {
          border-width: 2px;
        }
      }

      /* Focus Management for Accessibility */
      .vscode-stats-card:focus-within {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
    `,
  ],
})
export class VSCodeAnalyticsStatsGridComponent {
  @Input({ required: true }) statsData!: StatsData;

  readonly ActivityIcon = ActivityIcon;
  readonly TrendingUpIcon = TrendingUpIcon;
  readonly BarChart3Icon = BarChart3Icon;
}
