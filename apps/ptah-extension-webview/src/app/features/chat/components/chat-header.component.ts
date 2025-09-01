import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

export interface ProviderStatus {
  name: string;
  status: 'online' | 'offline' | 'error' | 'loading';
}

/**
 * Chat Header Component - Header Actions & Provider Status
 * Displays header with new session, analytics, and provider settings buttons
 * No business logic, only presentation and event emission
 */
@Component({
  selector: 'vscode-chat-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="vscode-header-container">
      <vscode-simple-header (newSession)="newSession.emit()" (analytics)="analytics.emit()">
      </vscode-simple-header>

      <!-- Provider Settings Button -->
      <div class="vscode-header-actions">
        <button
          type="button"
          class="vscode-header-action-button"
          (click)="providerSettings.emit()"
          [title]="getProviderTitle()"
          [attr.aria-label]="getProviderAriaLabel()"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" class="vscode-header-action-icon">
            <path
              d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.5-1.6L13.4 10c.1-.3.1-.6 0-.9l1.1-.4c.3-.1.4-.4.3-.7l-.8-1.4c-.1-.3-.4-.4-.7-.3L12.2 7c-.2-.2-.5-.4-.8-.5l-.2-1.1c-.1-.3-.3-.5-.6-.5h-1.6c-.3 0-.5.2-.6.5l-.2 1.1c-.3.1-.6.3-.8.5L6.3 6.3c-.3-.1-.6 0-.7.3l-.8 1.4c-.1.3 0 .6.3.7L6.2 9c-.1.3-.1.6 0 .9l-1.1.4c-.3.1-.4.4-.3.7l.8 1.4c.1.3.4.4.7.3l1.1-.7c.2.2.5.4.8.5l.2 1.1c.1.3.3.5.6.5h1.6c.3 0 .5-.2.6-.5l.2-1.1c.3-.1.6-.3.8-.5l1.1.7c.3.1.6 0 .7-.3l.8-1.4c.1-.3 0-.6-.3-.7z"
              fill="currentColor"
            />
          </svg>
          <span class="vscode-provider-status" [class]="'status-' + providerStatus.status">
            {{ providerStatus.name || 'AI' }}
          </span>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .vscode-header-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .vscode-header-actions {
        display: flex;
        align-items: center;
        padding: 8px 12px;
      }

      .vscode-header-action-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: var(--vscode-button-background);
        border: 1px solid var(--vscode-button-border);
        border-radius: 3px;
        color: var(--vscode-button-foreground);
        font-family: var(--vscode-font-family);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .vscode-header-action-button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .vscode-header-action-button:active {
        background: var(--vscode-button-background);
        transform: translateY(1px);
      }

      .vscode-header-action-icon {
        flex-shrink: 0;
        opacity: 0.8;
      }

      .vscode-provider-status {
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 2px;
        font-size: 11px;
        text-transform: uppercase;
      }

      .vscode-provider-status.status-online {
        background-color: var(--vscode-charts-green);
        color: var(--vscode-editor-background);
      }

      .vscode-provider-status.status-offline {
        background-color: var(--vscode-charts-red);
        color: var(--vscode-editor-foreground);
      }

      .vscode-provider-status.status-error {
        background-color: var(--vscode-errorForeground);
        color: var(--vscode-editor-background);
      }

      .vscode-provider-status.status-loading {
        background-color: var(--vscode-charts-yellow);
        color: var(--vscode-editor-background);
      }
    `,
  ],
})
export class VSCodeChatHeaderComponent {
  @Input({ required: true }) providerStatus!: ProviderStatus;

  @Output() newSession = new EventEmitter<void>();
  @Output() analytics = new EventEmitter<void>();
  @Output() providerSettings = new EventEmitter<void>();

  getProviderTitle(): string {
    return `AI Provider Settings (${this.providerStatus.name || 'Unknown'})`;
  }

  getProviderAriaLabel(): string {
    return `AI Provider Settings. Current provider: ${this.providerStatus.name || 'Unknown'}. Status: ${this.providerStatus.status}`;
  }
}
