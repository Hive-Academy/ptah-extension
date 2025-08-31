import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

/**
 * Chat Streaming Status Component - Streaming Feedback Banner
 * Shows streaming status and provides stop streaming action
 * No business logic, only presentation and event emission
 */
@Component({
  selector: 'vscode-chat-streaming-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @if (isVisible) {
      <div class="vscode-streaming-banner">
        <div class="vscode-streaming-banner-content">
          <div class="vscode-streaming-spinner"></div>
          <span class="vscode-streaming-text">{{ streamingMessage }}</span>
          <button
            class="vscode-streaming-stop-button"
            (click)="stopStreaming.emit()"
            title="Stop response"
            type="button"
            [disabled]="!canStop"
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
      .vscode-streaming-banner {
        position: sticky;
        top: 0;
        z-index: 10;
        background-color: var(--vscode-notifications-background);
        border: 1px solid var(--vscode-notifications-border);
        border-radius: 3px;
        margin: 8px 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .vscode-streaming-banner-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        gap: 8px;
      }

      .vscode-streaming-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid transparent;
        border-top: 2px solid var(--vscode-progressBar-background);
        border-radius: 50%;
        animation: vscode-spin 1s linear infinite;
        flex-shrink: 0;
      }

      @keyframes vscode-spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .vscode-streaming-text {
        flex: 1;
        color: var(--vscode-notifications-foreground);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        font-weight: 500;
      }

      .vscode-streaming-stop-button {
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

      .vscode-streaming-stop-button:hover:not(:disabled) {
        background: var(--vscode-button-hoverBackground);
      }

      .vscode-streaming-stop-button:active:not(:disabled) {
        background: var(--vscode-button-background);
        transform: translateY(1px);
      }

      .vscode-streaming-stop-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .vscode-streaming-stop-button svg {
        flex-shrink: 0;
      }
    `,
  ],
})
export class VSCodeChatStreamingStatusComponent {
  @Input() isVisible = false;
  @Input() streamingMessage = 'Claude is responding...';
  @Input() canStop = true;

  @Output() stopStreaming = new EventEmitter<void>();
}
