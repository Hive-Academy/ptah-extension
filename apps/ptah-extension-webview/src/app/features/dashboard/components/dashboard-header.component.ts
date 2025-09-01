import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import {
  LucideAngularModule,
  BarChart3Icon,
  ExpandIcon,
  MinimizeIcon,
  XIcon,
  RefreshCwIcon,
} from 'lucide-angular';

/**
 * VS Code Dashboard Header - Pure Presentation Component
 * - Dashboard title, subtitle, and controls
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 * - Accessible header with proper semantic structure
 */
@Component({
  selector: 'vscode-dashboard-header',
  standalone: true,
  imports: [LucideAngularModule],

  template: `
    <header class="vscode-dashboard-header">
      <div class="vscode-header-content">
        <div class="vscode-header-info">
          <div class="vscode-header-icon">
            <lucide-angular [img]="BarChart3Icon" class="vscode-icon"></lucide-angular>
          </div>
          <div class="vscode-header-text">
            <h2 class="vscode-header-title">{{ title }}</h2>
            <p class="vscode-header-subtitle">{{ subtitle }}</p>
          </div>
        </div>

        <div class="vscode-header-actions">
          <button
            class="vscode-header-button"
            (click)="refresh.emit()"
            [attr.aria-label]="'Refresh dashboard data'"
            [title]="'Refresh data'"
            [class.refreshing]="isRefreshing"
          >
            <lucide-angular
              [img]="RefreshCwIcon"
              class="vscode-button-icon"
              [class.spinning]="isRefreshing"
            >
            </lucide-angular>
          </button>

          <button
            class="vscode-header-button"
            (click)="toggleExpanded.emit()"
            [attr.aria-label]="isExpanded ? 'Minimize dashboard' : 'Expand dashboard'"
            [title]="isExpanded ? 'Minimize' : 'Expand'"
          >
            <lucide-angular
              [img]="isExpanded ? MinimizeIcon : ExpandIcon"
              class="vscode-button-icon"
            >
            </lucide-angular>
          </button>

          <button
            class="vscode-header-button"
            (click)="close.emit()"
            [attr.aria-label]="'Close dashboard'"
            title="Close"
          >
            <lucide-angular [img]="XIcon" class="vscode-button-icon"></lucide-angular>
          </button>
        </div>
      </div>
    </header>
  `,
  styles: [
    `
      .vscode-dashboard-header {
        background-color: var(--vscode-titleBar-activeBackground);
        color: var(--vscode-titleBar-activeForeground);
        border-bottom: 1px solid var(--vscode-panel-border);
        padding: 12px 16px;
        flex-shrink: 0;
      }

      .vscode-header-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      .vscode-header-info {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        min-width: 0;
      }

      .vscode-header-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background-color: var(--vscode-button-secondaryBackground);
        border-radius: 4px;
        border: 1px solid var(--vscode-widget-border);
        flex-shrink: 0;
      }

      .vscode-icon {
        width: 18px;
        height: 18px;
        color: var(--vscode-button-secondaryForeground);
      }

      .vscode-header-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }

      .vscode-header-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--vscode-titleBar-activeForeground);
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .vscode-header-subtitle {
        margin: 0;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .vscode-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .vscode-header-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        min-width: 28px;
        min-height: 28px;
        background-color: transparent;
        color: var(--vscode-titleBar-activeForeground);
        border: none;
        border-radius: 3px;
        cursor: pointer;
        transition: background-color 0.15s ease;
      }

      .vscode-header-button:hover {
        background-color: var(--vscode-titleBar-inactiveBackground);
      }

      .vscode-header-button:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .vscode-button-icon {
        width: 14px;
        height: 14px;
      }

      .vscode-button-icon.spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .vscode-header-button.refreshing {
        opacity: 0.7;
        pointer-events: none;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .vscode-dashboard-header {
          padding: 8px 12px;
        }

        .vscode-header-content {
          gap: 8px;
        }

        .vscode-header-info {
          gap: 8px;
        }

        .vscode-header-icon {
          width: 28px;
          height: 28px;
        }

        .vscode-icon {
          width: 16px;
          height: 16px;
        }

        .vscode-header-title {
          font-size: 14px;
        }

        .vscode-header-subtitle {
          font-size: 11px;
        }

        .vscode-header-button {
          width: 24px;
          height: 24px;
          min-width: 24px;
          min-height: 24px;
        }

        .vscode-button-icon {
          width: 12px;
          height: 12px;
        }
      }

      @media (max-width: 480px) {
        .vscode-header-text {
          gap: 1px;
        }

        .vscode-header-subtitle {
          display: none; /* Hide subtitle on very small screens */
        }
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-dashboard-header {
          border-bottom-width: 2px;
        }

        .vscode-header-icon {
          border-width: 2px;
        }
      }
    `,
  ],
})
export class VSCodeDashboardHeaderComponent {
  @Input({ required: true }) title!: string;
  @Input({ required: true }) subtitle!: string;
  @Input() isExpanded: boolean = false;
  @Input() isRefreshing: boolean = false;

  @Output() toggleExpanded = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();

  readonly BarChart3Icon = BarChart3Icon;
  readonly ExpandIcon = ExpandIcon;
  readonly MinimizeIcon = MinimizeIcon;
  readonly XIcon = XIcon;
  readonly RefreshCwIcon = RefreshCwIcon;
}
