import { Component } from '@angular/core';
import { LucideAngularModule, BarChart3Icon } from 'lucide-angular';

/**
 * Analytics Coming Soon Component - Pure Presentation Component
 * - Coming soon section for future analytics features
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 * - Accessible messaging with proper semantic structure
 *
 * Modernizations:
 * - ✅ Selector: vscode-analytics-coming-soon → ptah-analytics-coming-soon
 * - ✅ OnPush change detection (already present)
 * - ✅ Standalone component (already present)
 * - ✅ No inputs - purely presentational
 */
@Component({
  selector: 'ptah-analytics-coming-soon',
  standalone: true,
  imports: [LucideAngularModule],

  template: `
    <section
      class="vscode-coming-soon"
      [attr.aria-label]="'Future analytics features'"
    >
      <div class="vscode-coming-soon-content">
        <div class="vscode-coming-soon-icon">
          <lucide-angular
            [img]="BarChart3Icon"
            class="vscode-icon"
            [attr.aria-hidden]="'true'"
          ></lucide-angular>
        </div>
        <div class="vscode-coming-soon-text">
          <h3 class="vscode-coming-soon-title">More Analytics Coming Soon</h3>
          <p class="vscode-coming-soon-description">
            Detailed usage reports, performance metrics, and insights are being
            developed.
          </p>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .vscode-coming-soon {
        display: flex;
        justify-content: center;
        align-items: center;
        text-align: center;
        padding: 48px 24px;
        margin-top: 32px;
      }

      .vscode-coming-soon-content {
        max-width: 480px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      .vscode-coming-soon-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        background-color: var(--vscode-button-secondaryBackground);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 50%;
        margin-bottom: 8px;
        transition: background-color 0.15s ease, border-color 0.15s ease;
      }

      .vscode-coming-soon-icon:hover {
        background-color: var(--vscode-button-secondaryHoverBackground);
        border-color: var(--vscode-focusBorder);
      }

      .vscode-icon {
        width: 32px;
        height: 32px;
        color: var(--vscode-button-secondaryForeground);
      }

      .vscode-coming-soon-text {
        display: flex;
        flex-direction: column;
        gap: 8px;
        text-align: center;
      }

      .vscode-coming-soon-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--vscode-editor-foreground);
        line-height: 1.3;
      }

      .vscode-coming-soon-description {
        margin: 0;
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.5;
        max-width: 400px;
        text-align: center;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .vscode-coming-soon {
          padding: 32px 16px;
          margin-top: 24px;
        }

        .vscode-coming-soon-content {
          max-width: 320px;
          gap: 12px;
        }

        .vscode-coming-soon-icon {
          width: 56px;
          height: 56px;
          margin-bottom: 4px;
        }

        .vscode-icon {
          width: 28px;
          height: 28px;
        }

        .vscode-coming-soon-title {
          font-size: 16px;
        }

        .vscode-coming-soon-description {
          font-size: 12px;
          max-width: 300px;
        }
      }

      @media (max-width: 480px) {
        .vscode-coming-soon {
          padding: 24px 12px;
          margin-top: 16px;
        }

        .vscode-coming-soon-content {
          max-width: 280px;
          gap: 8px;
        }

        .vscode-coming-soon-icon {
          width: 48px;
          height: 48px;
        }

        .vscode-icon {
          width: 24px;
          height: 24px;
        }

        .vscode-coming-soon-title {
          font-size: 14px;
        }

        .vscode-coming-soon-description {
          font-size: 11px;
          max-width: 260px;
        }
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-coming-soon-icon {
          border-width: 2px;
        }
      }

      /* Animation for engagement */
      .vscode-coming-soon-icon {
        animation: subtle-pulse 3s infinite;
      }

      @keyframes subtle-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.8;
          transform: scale(1.02);
        }
      }

      /* Reduce motion for accessibility */
      @media (prefers-reduced-motion: reduce) {
        .vscode-coming-soon-icon {
          animation: none;
        }
      }
    `,
  ],
})
export class AnalyticsComingSoonComponent {
  readonly BarChart3Icon = BarChart3Icon;
}
