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
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <rect x="4" y="4" width="8" height="8" rx="1.5" />
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
        background-color: var(
          --vscode-editor-selectionBackground,
          rgba(0, 122, 204, 0.15)
        );
        border: 1px solid var(--vscode-focusBorder, rgba(0, 122, 204, 0.5));
        border-left: 3px solid var(--vscode-progressBar-background, #0078d4);
        border-radius: 3px;
        margin: 8px 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        backdrop-filter: blur(8px);
      }

      .streaming-banner-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        gap: 12px;
      }

      .streaming-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--vscode-editor-foreground, #cccccc);
        border-top-color: var(--vscode-progressBar-background, #0078d4);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
        opacity: 0.9;
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
          border-top-color: var(--vscode-progressBar-background, #0078d4);
        }
      }

      .streaming-text {
        flex: 1;
        color: var(--vscode-editor-foreground, #cccccc);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.2px;
      }

      .streaming-stop-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: var(--vscode-button-background, #0078d4);
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 3px;
        color: var(--vscode-button-foreground, #ffffff);
        font-family: var(--vscode-font-family);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
      }

      .streaming-stop-button:hover:not(:disabled) {
        background: var(--vscode-button-hoverBackground, #005a9e);
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .streaming-stop-button:active:not(:disabled) {
        background: var(--vscode-button-background, #0078d4);
        transform: translateY(0);
        box-shadow: none;
      }

      .streaming-stop-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .streaming-stop-button svg {
        flex-shrink: 0;
        width: 14px;
        height: 14px;
      }

      /* High Contrast Mode Support */
      @media (prefers-contrast: high) {
        .streaming-banner {
          border-width: 2px;
          background-color: var(--vscode-editor-background);
        }

        .streaming-stop-button {
          border-width: 2px;
        }

        .streaming-spinner {
          border-width: 3px;
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
