import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  MessageCircleIcon,
  AlertTriangleIcon,
  InfoIcon,
  CheckCircleIcon,
  SettingsIcon,
} from 'lucide-angular';
import { type ActivityItem } from '@ptah-extension/shared';

/**
 * Dashboard Activity Feed Component - Pure Presentation
 * - Recent activity and event log display
 * - No business logic or state management
 * - Pure VS Code styling with responsive design
 */
@Component({
  selector: 'ptah-dashboard-activity-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, LucideAngularModule],

  template: `
    <section
      class="vscode-activity-feed"
      [attr.aria-label]="'Recent system activity'"
    >
      <header class="vscode-activity-header">
        <h3 class="vscode-activity-title">Recent Activity</h3>
        <span class="vscode-activity-count"
          >{{ activities().length }} events</span
        >
      </header>

      <div class="vscode-activity-content">
        @if (activities().length > 0) {
        <div class="vscode-activity-list">
          @for (activity of activities(); track activity.id) {
          <article
            class="vscode-activity-item"
            [class]="getActivityStatusClass(activity.status)"
          >
            <div class="vscode-activity-icon">
              <lucide-angular
                [img]="getActivityIcon(activity.type)"
                class="vscode-icon"
              ></lucide-angular>
            </div>
            <div class="vscode-activity-content-wrapper">
              <div class="vscode-activity-main">
                <h4 class="vscode-activity-title-text">{{ activity.title }}</h4>
                <p class="vscode-activity-description">
                  {{ activity.description }}
                </p>
              </div>
              <div class="vscode-activity-meta">
                <span class="vscode-activity-time">{{
                  formatRelativeTime(activity.timestamp)
                }}</span>
                <span
                  class="vscode-activity-type"
                  [class]="getTypeClass(activity.type)"
                >
                  {{ activity.type }}
                </span>
              </div>
            </div>
          </article>
          }
        </div>
        } @else {
        <div class="vscode-activity-empty">
          <lucide-angular
            [img]="InfoIcon"
            class="vscode-empty-icon"
          ></lucide-angular>
          <span class="vscode-empty-text">No recent activity</span>
        </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .vscode-activity-feed {
        background-color: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        padding: 16px;
      }

      .vscode-activity-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .vscode-activity-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-editor-foreground);
      }

      .vscode-activity-count {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        padding: 2px 6px;
        background-color: var(--vscode-badge-background);
        border-radius: 10px;
      }

      .vscode-activity-content {
        min-height: 120px;
      }

      .vscode-activity-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .vscode-activity-item {
        display: flex;
        gap: 12px;
        padding: 10px;
        border-radius: 4px;
        border: 1px solid var(--vscode-input-border);
        background-color: var(--vscode-input-background);
        transition: all 0.15s ease;
        position: relative;
        overflow: hidden;
      }

      .vscode-activity-item:hover {
        border-color: var(--vscode-focusBorder);
      }

      .vscode-activity-item::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background-color: var(--vscode-button-background);
      }

      .vscode-activity-icon {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        margin-top: 2px;
      }

      .vscode-icon {
        width: 16px;
        height: 16px;
        color: var(--vscode-button-foreground);
      }

      .vscode-activity-content-wrapper {
        flex: 1;
        min-width: 0;
      }

      .vscode-activity-main {
        margin-bottom: 6px;
      }

      .vscode-activity-title-text {
        margin: 0 0 2px 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--vscode-editor-foreground);
        line-height: 1.3;
      }

      .vscode-activity-description {
        margin: 0;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.4;
      }

      .vscode-activity-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .vscode-activity-time {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        opacity: 0.8;
      }

      .vscode-activity-type {
        font-size: 10px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 2px 4px;
        border-radius: 2px;
      }

      .vscode-activity-type--message {
        background-color: color-mix(
          in srgb,
          var(--vscode-terminal-ansiGreen) 15%,
          transparent
        );
        color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-activity-type--error {
        background-color: var(--vscode-errorBackground);
        color: var(--vscode-errorForeground);
      }

      .vscode-activity-type--system {
        background-color: color-mix(
          in srgb,
          var(--vscode-terminal-ansiBlue) 15%,
          transparent
        );
        color: var(--vscode-terminal-ansiBlue);
      }

      .vscode-activity-type--user {
        background-color: color-mix(
          in srgb,
          var(--vscode-terminal-ansiYellow) 15%,
          transparent
        );
        color: var(--vscode-terminal-ansiYellow);
      }

      /* Status-specific styling */
      .vscode-activity-item--success::before {
        background-color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-activity-item--success .vscode-icon {
        color: var(--vscode-terminal-ansiGreen);
      }

      .vscode-activity-item--warning::before {
        background-color: var(--vscode-terminal-ansiYellow);
      }

      .vscode-activity-item--warning .vscode-icon {
        color: var(--vscode-terminal-ansiYellow);
      }

      .vscode-activity-item--error::before {
        background-color: var(--vscode-errorForeground);
      }

      .vscode-activity-item--error .vscode-icon {
        color: var(--vscode-errorForeground);
      }

      .vscode-activity-item--info::before {
        background-color: var(--vscode-terminal-ansiBlue);
      }

      .vscode-activity-item--info .vscode-icon {
        color: var(--vscode-terminal-ansiBlue);
      }

      .vscode-activity-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 120px;
        gap: 8px;
        color: var(--vscode-descriptionForeground);
      }

      .vscode-empty-icon {
        width: 24px;
        height: 24px;
        opacity: 0.5;
      }

      .vscode-empty-text {
        font-size: 12px;
        opacity: 0.8;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .vscode-activity-feed {
          padding: 12px;
        }

        .vscode-activity-item {
          padding: 8px;
          gap: 8px;
        }

        .vscode-activity-icon {
          width: 20px;
          height: 20px;
        }

        .vscode-icon {
          width: 14px;
          height: 14px;
        }

        .vscode-activity-title-text {
          font-size: 12px;
        }

        .vscode-activity-description {
          font-size: 11px;
        }
      }

      @media (max-width: 480px) {
        .vscode-activity-header {
          margin-bottom: 12px;
        }

        .vscode-activity-meta {
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }

        .vscode-activity-time {
          font-size: 9px;
        }

        .vscode-activity-type {
          font-size: 9px;
          align-self: flex-end;
        }
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-activity-item {
          border-width: 2px;
        }

        .vscode-activity-item::before {
          width: 4px;
        }
      }
    `,
  ],
})
export class DashboardActivityFeedComponent {
  readonly activities = input.required<ActivityItem[]>();

  readonly MessageCircleIcon = MessageCircleIcon;
  readonly AlertTriangleIcon = AlertTriangleIcon;
  readonly InfoIcon = InfoIcon;
  readonly CheckCircleIcon = CheckCircleIcon;
  readonly SettingsIcon = SettingsIcon;

  getActivityIcon(type: string) {
    switch (type) {
      case 'message':
        return MessageCircleIcon;
      case 'error':
        return AlertTriangleIcon;
      case 'system':
        return SettingsIcon;
      case 'user':
        return InfoIcon;
      default:
        return InfoIcon;
    }
  }

  getActivityStatusClass(status: string): string {
    return `vscode-activity-item--${status}`;
  }

  getTypeClass(type: string): string {
    return `vscode-activity-type--${type}`;
  }

  formatRelativeTime(timestamp: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    return timestamp.toLocaleDateString();
  }
}
