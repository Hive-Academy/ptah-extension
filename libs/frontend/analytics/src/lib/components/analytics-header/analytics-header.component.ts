import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, BarChart3Icon } from 'lucide-angular';

/**
 * Analytics Header Component - Pure Presentation Component
 * - Page title and description for analytics view
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 * - Accessible header with proper semantic markup
 *
 * Modernizations:
 * - ✅ Selector: vscode-analytics-header → ptah-analytics-header
 * - ✅ OnPush change detection (already present)
 * - ✅ Standalone component (already present)
 * - ✅ No inputs - purely presentational
 */
@Component({
  selector: 'ptah-analytics-header',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="vscode-analytics-header">
      <div class="vscode-header-content">
        <div class="vscode-header-icon">
          <lucide-angular
            [img]="BarChart3Icon"
            class="vscode-icon"
          ></lucide-angular>
        </div>
        <div class="vscode-header-text">
          <h1 class="vscode-header-title">Analytics</h1>
          <p class="vscode-header-description">Usage statistics and insights</p>
        </div>
      </div>
    </header>
  `,
  styles: [
    `
      .vscode-analytics-header {
        display: flex;
        align-items: center;
        margin-bottom: 24px;
      }

      .vscode-header-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .vscode-header-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background-color: var(--vscode-button-secondaryBackground);
        border-radius: 4px;
        border: 1px solid var(--vscode-widget-border);
      }

      .vscode-icon {
        width: 20px;
        height: 20px;
        color: var(--vscode-button-secondaryForeground);
      }

      .vscode-header-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .vscode-header-title {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        color: var(--vscode-editor-foreground);
        line-height: 1.2;
      }

      .vscode-header-description {
        margin: 0;
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-header-icon {
          border-width: 2px;
        }
      }

      /* Responsive Design */
      @media (max-width: 480px) {
        .vscode-header-content {
          gap: 8px;
        }

        .vscode-header-icon {
          width: 32px;
          height: 32px;
        }

        .vscode-icon {
          width: 16px;
          height: 16px;
        }

        .vscode-header-title {
          font-size: 20px;
        }

        .vscode-header-description {
          font-size: 12px;
        }
      }
    `,
  ],
})
export class AnalyticsHeaderComponent {
  readonly BarChart3Icon = BarChart3Icon;
}
