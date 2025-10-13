import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Token usage metrics for chat conversations
 */
export interface TokenUsage {
  readonly used: number;
  readonly total: number;
  readonly percentage: number;
}

/**
 * Chat Token Usage Component - Token Consumption Progress Bar
 *
 * **Purpose**: Visual indicator for token consumption with semantic color coding
 *
 * **Modernizations**:
 * - `@Input()` → `input()` for tokenUsage
 * - Added `computed()` for derived accessibility strings
 * - Already has OnPush change detection ✅
 * - Already has modern control flow (@if) ✅
 * - Selector: vscode-chat-token-usage → ptah-chat-token-usage
 * - TokenUsage interface with readonly properties for immutability
 *
 * **Architecture**:
 * - Pure presentation component (zero business logic)
 * - VS Code theme integration with semantic color variables
 * - Accessibility: Full ARIA attributes and proper progressbar role
 * - Responsive: Reduced motion and high contrast mode support
 * - Visual feedback: Color-coded states (normal/warning/critical)
 *
 * **Color Coding**:
 * - Normal (0-80%): Standard progress bar color
 * - Warning (81-90%): Orange indicator
 * - Critical (91-100%): Red with pulsing animation
 *
 * @example
 * ```html
 * <ptah-chat-token-usage
 *   [tokenUsage]="{ used: 7500, total: 10000, percentage: 75 }"
 * />
 * ```
 */
@Component({
  selector: 'ptah-chat-token-usage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="token-usage-container" [attr.aria-hidden]="!tokenUsage()">
      @if (tokenUsage()) {
      <div
        class="token-usage-bar"
        role="progressbar"
        [attr.aria-valuenow]="tokenUsage()!.percentage"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="100"
        [attr.aria-label]="ariaLabel()"
        [title]="tooltipText()"
      >
        <!-- eslint-disable-next-line @angular-eslint/template/no-inline-styles -->
        <div
          class="token-usage-fill"
          [class.usage-critical]="tokenUsage()!.percentage > 90"
          [class.usage-warning]="
            tokenUsage()!.percentage > 80 && tokenUsage()!.percentage <= 90
          "
          [class.usage-normal]="tokenUsage()!.percentage <= 80"
          [style.width.%]="tokenUsage()!.percentage"
        ></div>
      </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .token-usage-container {
        height: 4px;
        background-color: var(--vscode-editor-background);
        overflow: hidden;
        position: relative;
      }

      .token-usage-bar {
        width: 100%;
        height: 100%;
        background-color: var(--vscode-progressBar-background);
        position: relative;
        overflow: hidden;
      }

      .token-usage-fill {
        height: 100%;
        transition: width 0.3s ease-out;
        position: relative;
      }

      .usage-normal {
        background-color: var(--vscode-progressBar-background);
      }

      .usage-warning {
        background-color: var(--vscode-charts-orange);
      }

      .usage-critical {
        background-color: var(--vscode-charts-red);
      }

      /* Animation for critical state */
      .usage-critical {
        animation: token-pulse 2s infinite;
      }

      @keyframes token-pulse {
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
        .token-usage-container {
          border-top: 1px solid var(--vscode-contrastBorder);
          height: 5px;
        }

        .token-usage-fill {
          border-top: 1px solid var(--vscode-contrastBorder);
        }
      }

      /* Reduced Motion Support */
      @media (prefers-reduced-motion: reduce) {
        .token-usage-fill {
          transition: none;
        }

        .usage-critical {
          animation: none;
        }
      }

      /* Focus state for accessibility */
      .token-usage-bar:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }
    `,
  ],
})
export class ChatTokenUsageComponent {
  /**
   * Token usage metrics (used, total, percentage)
   * Null when no token data available
   */
  readonly tokenUsage = input<TokenUsage | null>(null);

  /**
   * Computed accessibility label with usage status
   * @example "Token usage: 75% (Normal)"
   */
  readonly ariaLabel = computed(() => {
    const usage = this.tokenUsage();
    if (!usage) return '';

    const percentage = Math.round(usage.percentage);
    const status =
      percentage > 90 ? 'Critical' : percentage > 80 ? 'Warning' : 'Normal';

    return `Token usage: ${percentage}% (${status})`;
  });

  /**
   * Computed tooltip text with detailed metrics
   * @example "Token Usage: 7,500 / 10,000 (75%)"
   */
  readonly tooltipText = computed(() => {
    const usage = this.tokenUsage();
    if (!usage) return '';

    return `Token Usage: ${usage.used.toLocaleString()} / ${usage.total.toLocaleString()} (${Math.round(
      usage.percentage
    )}%)`;
  });
}
