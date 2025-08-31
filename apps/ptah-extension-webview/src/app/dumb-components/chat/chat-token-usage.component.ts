import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface TokenUsage {
  used: number;
  total: number;
  percentage: number;
}

/**
 * VS Code Chat Token Usage Bar - Pure Presentation Component
 * - Visual token consumption indicator
 * - No business logic or state management
 * - Pure VS Code styling with semantic color coding
 * - Accessible with proper ARIA attributes
 */
@Component({
  selector: 'vscode-chat-token-usage',
  standalone: true,
  imports: [CommonModule],

  template: `
    <div class="vscode-token-usage-container" [attr.aria-hidden]="!tokenUsage">
      @if (tokenUsage) {
        <div
          class="vscode-token-usage-bar"
          role="progressbar"
          [attr.aria-valuenow]="tokenUsage.percentage"
          [attr.aria-valuemin]="0"
          [attr.aria-valuemax]="100"
          [attr.aria-label]="getAriaLabel()"
          [title]="getTooltipText()"
        >
          <div
            class="vscode-token-usage-fill"
            [class.vscode-usage-critical]="tokenUsage.percentage > 90"
            [class.vscode-usage-warning]="tokenUsage.percentage > 80 && tokenUsage.percentage <= 90"
            [class.vscode-usage-normal]="tokenUsage.percentage <= 80"
            [style.width.%]="tokenUsage.percentage"
          ></div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .vscode-token-usage-container {
        height: 4px;
        background-color: var(--vscode-editor-background);
        overflow: hidden;
        position: relative;
      }

      .vscode-token-usage-bar {
        width: 100%;
        height: 100%;
        background-color: var(--vscode-progressBar-background);
        position: relative;
        overflow: hidden;
      }

      .vscode-token-usage-fill {
        height: 100%;
        transition: width 0.3s ease-out;
        position: relative;
      }

      .vscode-usage-normal {
        background-color: var(--vscode-progressBar-background);
      }

      .vscode-usage-warning {
        background-color: var(--vscode-charts-orange);
      }

      .vscode-usage-critical {
        background-color: var(--vscode-charts-red);
      }

      /* Animation for critical state */
      .vscode-usage-critical {
        animation: vscode-token-pulse 2s infinite;
      }

      @keyframes vscode-token-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }

      /* High Contrast Mode Support */
      @media (prefers-contrast: high) {
        .vscode-token-usage-container {
          border-top: 1px solid var(--vscode-contrastBorder);
          height: 5px;
        }

        .vscode-token-usage-fill {
          border-top: 1px solid var(--vscode-contrastBorder);
        }
      }

      /* Reduced Motion Support */
      @media (prefers-reduced-motion: reduce) {
        .vscode-token-usage-fill {
          transition: none;
        }

        .vscode-usage-critical {
          animation: none;
        }
      }

      /* Focus state for accessibility */
      .vscode-token-usage-bar:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }
    `,
  ],
})
export class VSCodeChatTokenUsageComponent {
  @Input() tokenUsage: TokenUsage | null = null;

  getAriaLabel(): string {
    if (!this.tokenUsage) return '';

    const percentage = Math.round(this.tokenUsage.percentage);
    const status = percentage > 90 ? 'Critical' : percentage > 80 ? 'Warning' : 'Normal';

    return `Token usage: ${percentage}% (${status})`;
  }

  getTooltipText(): string {
    if (!this.tokenUsage) return '';

    return `Token Usage: ${this.tokenUsage.used.toLocaleString()} / ${this.tokenUsage.total.toLocaleString()} (${Math.round(this.tokenUsage.percentage)}%)`;
  }
}
