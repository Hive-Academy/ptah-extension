import { CommonModule } from '@angular/common';
import {
  Component,
  input,
  output,
  computed,
  signal,
  inject,
} from '@angular/core';
import { SessionDropdownComponent } from '../session-dropdown/session-dropdown.component';
import { SessionSearchOverlayComponent } from '../session-search-overlay/session-search-overlay.component';
import { ChatService } from '@ptah-extension/core';
import { SessionSummary, SessionId } from '@ptah-extension/shared';

/**
 * Provider Status - Chat header provider display data
 */
export interface ProviderStatus {
  readonly name: string;
  readonly status: 'online' | 'offline' | 'error' | 'loading';
}

/**
 * Chat Header Component - Header Actions & Provider Status
 *
 * **Responsibilities**:
 * - Display header with action buttons (new session, analytics, provider settings)
 * - Show AI provider name and connection status
 * - Emit events for user interactions
 *
 * **Modernizations Applied**:
 * - `@Input()` → `input.required()` for providerStatus
 * - `@Output()` → `output()` for all events
 * - `computed()` for derived display strings
 * - Pure presentation component (no business logic)
 * - OnPush change detection enforced
 * - VS Code theme integration with CSS custom properties
 *
 * **Before**: Used decorator-based inputs/outputs
 * **After**: Signal-based APIs with computed display properties
 *
 * @example
 * ```html
 * <ptah-chat-header
 *   [providerStatus]="{ name: 'Claude', status: 'online' }"
 *   (newSession)="handleNewSession()"
 *   (analytics)="showAnalytics()"
 *   (providerSettings)="openProviderSettings()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-chat-header',
  standalone: true,

  imports: [
    CommonModule,
    SessionDropdownComponent,
    SessionSearchOverlayComponent,
  ],
  template: `
    <div class="header-container">
      <!-- Header with session dropdown and analytics button -->
      <div class="header-main">
        <div class="header-actions">
          <ptah-session-dropdown
            [currentSessionId]="chatService.currentSession()?.id ?? null"
            [recentSessions]="chatService.recentSessions()"
            (sessionSelected)="onSessionSelected($event)"
            (newSessionClicked)="newSession.emit()"
            (searchAllClicked)="showSearchOverlay.set(true)"
          />

          <button
            type="button"
            class="header-action-btn"
            (click)="analytics.emit()"
            title="View Analytics"
            aria-label="View analytics and metrics"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" class="action-icon">
              <path
                d="M1.5 14h13v1h-13v-1zm1-12h2v11h-2v-11zm4 4h2v7h-2v-7zm4-2h2v9h-2v-9z"
                fill="currentColor"
              />
            </svg>
            <span>Analytics</span>
          </button>
        </div>
      </div>

      <!-- Provider Settings Button -->
      <div class="header-provider">
        <button
          type="button"
          class="provider-settings-btn"
          (click)="providerSettings.emit()"
          [title]="providerTitle()"
          [attr.aria-label]="providerAriaLabel()"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" class="provider-icon">
            <path
              d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.5-1.6L13.4 10c.1-.3.1-.6 0-.9l1.1-.4c.3-.1.4-.4.3-.7l-.8-1.4c-.1-.3-.4-.4-.7-.3L12.2 7c-.2-.2-.5-.4-.8-.5l-.2-1.1c-.1-.3-.3-.5-.6-.5h-1.6c-.3 0-.5.2-.6.5l-.2 1.1c-.3.1-.6.3-.8.5L6.3 6.3c-.3-.1-.6 0-.7.3l-.8 1.4c-.1.3 0 .6.3.7L6.2 9c-.1.3-.1.6 0 .9l-1.1.4c-.3.1-.4.4-.3.7l.8 1.4c.1.3.4.4.7.3l1.1-.7c.2.2.5.4.8.5l.2 1.1c.1.3.3.5.6.5h1.6c.3 0 .5-.2.6-.5l.2-1.1c.3-.1.6-.3.8-.5l1.1.7c.3.1.6 0 .7-.3l.8-1.4c.1-.3 0-.6-.3-.7z"
              fill="currentColor"
            />
          </svg>
          <span [class]="'provider-status status-' + providerStatus().status">
            {{ providerStatus().name || 'AI' }}
          </span>
        </button>
      </div>
    </div>

    <!-- Session Search Overlay -->
    @if (showSearchOverlay()) {
    <ptah-session-search-overlay
      [isOpen]="showSearchOverlay()"
      [currentSessionId]="chatService.currentSession()?.id ?? null"
      [sessions]="chatService.sessions()"
      (sessionSelected)="onSessionSelected($event)"
      (closed)="showSearchOverlay.set(false)"
    />
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .header-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        padding: 8px 12px;
      }

      .header-main {
        flex: 1;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .header-action-btn,
      .provider-settings-btn {
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

      .header-action-btn:hover,
      .provider-settings-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .header-action-btn:active,
      .provider-settings-btn:active {
        background: var(--vscode-button-background);
        transform: translateY(1px);
      }

      .action-icon,
      .provider-icon {
        flex-shrink: 0;
        opacity: 0.8;
      }

      .provider-status {
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 2px;
        font-size: 11px;
        text-transform: uppercase;
      }

      .provider-status.status-online {
        background-color: var(--vscode-charts-green);
        color: var(--vscode-editor-background);
      }

      .provider-status.status-offline {
        background-color: var(--vscode-charts-red);
        color: var(--vscode-editor-foreground);
      }

      .provider-status.status-error {
        background-color: var(--vscode-errorForeground);
        color: var(--vscode-editor-background);
      }

      .provider-status.status-loading {
        background-color: var(--vscode-charts-yellow);
        color: var(--vscode-editor-background);
      }

      .header-provider {
        display: flex;
        align-items: center;
      }
    `,
  ],
})
export class ChatHeaderComponent {
  // Services
  protected readonly chatService = inject(ChatService);

  // Signal-based inputs (modern Angular 20+ API)
  readonly providerStatus = input.required<ProviderStatus>();

  // Signal-based outputs (modern Angular 20+ API)
  readonly newSession = output<void>();
  readonly analytics = output<void>();
  readonly providerSettings = output<void>();

  // Internal state
  readonly showSearchOverlay = signal(false);

  // Computed display strings (derived state)
  readonly providerTitle = computed(
    () => `AI Provider Settings (${this.providerStatus().name || 'Unknown'})`
  );

  readonly providerAriaLabel = computed(
    () =>
      `AI Provider Settings. Current provider: ${
        this.providerStatus().name || 'Unknown'
      }. Status: ${this.providerStatus().status}`
  );

  // Methods
  onSessionSelected(sessionId: SessionId): void {
    void this.chatService.switchToSession(sessionId);
    this.showSearchOverlay.set(false);
  }
}
