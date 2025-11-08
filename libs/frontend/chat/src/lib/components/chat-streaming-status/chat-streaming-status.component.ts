import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';

/**
 * Chat Streaming Status Component - Streaming Feedback Banner
 *
 * **Purpose**: Visual feedback for active streaming responses with stop control
 *
 * **Modernizations**:
 * - `@Input()` → `input()` for all inputs (isVisible, streamingMessage, canStop)
 * - `@Output()` → `output<void>()` for stopStreaming event
 * - Already has OnPush change detection ✅
 * - Already has modern control flow (@if) ✅
 * - Selector: vscode-chat-streaming-status → ptah-chat-streaming-status
 *
 * **Architecture**:
 * - Pure presentation component (zero business logic)
 * - VS Code theme integration with CSS custom properties
 * - Accessibility: Proper button semantics and disabled states
 * - Animation: Spinner with reduced motion support
 *
 * @example
 * ```html
 * <ptah-chat-streaming-status
 *   [isVisible]="isStreaming()"
 *   [streamingMessage]="'Claude is thinking...'"
 *   [canStop]="true"
 *   (stopStreaming)="handleStopStreaming()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-chat-streaming-status',
  standalone: true,

  imports: [CommonModule],
  template: `
    @if (isVisible()) {
    <div class="streaming-banner">
      <div class="streaming-banner-content">
        <div class="streaming-spinner"></div>
        <span class="streaming-text">{{ streamingMessage() }}</span>
        <button
          class="streaming-stop-button"
          (click)="stopStreaming.emit()"
          title="Stop response"
          type="button"
          [disabled]="!canStop()"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <rect x="6" y="6" width="4" height="4" rx="1" />
          </svg>
          Stop
        </button>
      </div>
    </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .streaming-banner {
        position: sticky;
        top: 0;
        z-index: 10;
        background-color: var(--vscode-notifications-background);
        border: 1px solid var(--vscode-notifications-border);
        border-radius: 3px;
        margin: 8px 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .streaming-banner-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        gap: 8px;
      }

      .streaming-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid transparent;
        border-top: 2px solid var(--vscode-progressBar-background);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        flex-shrink: 0;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      /* Reduced Motion Support */
      @media (prefers-reduced-motion: reduce) {
        .streaming-spinner {
          animation: none;
          border: 2px solid var(--vscode-progressBar-background);
        }
      }

      .streaming-text {
        flex: 1;
        color: var(--vscode-notifications-foreground);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        font-weight: 500;
      }

      .streaming-stop-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--vscode-button-background);
        border: 1px solid var(--vscode-button-border);
        border-radius: 2px;
        color: var(--vscode-button-foreground);
        font-family: var(--vscode-font-family);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .streaming-stop-button:hover:not(:disabled) {
        background: var(--vscode-button-hoverBackground);
      }

      .streaming-stop-button:active:not(:disabled) {
        background: var(--vscode-button-background);
        transform: translateY(1px);
      }

      .streaming-stop-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .streaming-stop-button svg {
        flex-shrink: 0;
      }

      /* High Contrast Mode Support */
      @media (prefers-contrast: high) {
        .streaming-banner {
          border-width: 2px;
        }

        .streaming-stop-button {
          border-width: 2px;
        }
      }
    `,
  ],
})
export class ChatStreamingStatusComponent {
  /**
   * Controls visibility of streaming banner
   */
  readonly isVisible = input<boolean>(false);

  /**
   * Message displayed during streaming
   * @default 'Claude is responding...'
   */
  readonly streamingMessage = input<string>('Claude is responding...');

  /**
   * Whether stop button is enabled
   * @default true
   */
  readonly canStop = input<boolean>(true);

  /**
   * Emitted when user clicks stop button
   */
  readonly stopStreaming = output<void>();
}
