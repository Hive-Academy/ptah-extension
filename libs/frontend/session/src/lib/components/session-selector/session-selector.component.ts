import { Component, input, output, computed, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StrictChatSession, SessionId } from '@ptah-extension/shared';

/**
 * Session Selector Component - Pure Presentation Component
 *
 * **Responsibility**: Session selection dropdown with VS Code native styling
 * **Pattern**: Pure presentation with signal-based APIs (Angular 20)
 * **Change Detection**: OnPush enforced
 *
 * **Features**:
 * - Shows current session with token usage and metadata
 * - Dropdown list of all available sessions with quick switching
 * - Quick session creation (unnamed) and named session creation
 * - Session management actions (delete, manage)
 *
 * **Migration Notes**:
 * - Migrated from: apps/ptah-extension-webview/src/app/features/session/components/session-selector.component.ts
 * - Already modernized with Angular 20 patterns (signals, modern control flow, OnPush)
 * - Selector: vscode-session-selector → ptah-session-selector
 * - LOC: ~628 lines (inline template + styles)
 */
@Component({
  selector: 'ptah-session-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],

  template: `
    <div class="session-selector-container">
      <!-- Current Session Display -->
      <div
        class="session-current-display"
        [class.session-current-expanded]="isExpanded()"
        (click)="toggleExpanded()"
        (keydown.enter)="toggleExpanded()"
        (keydown.space)="toggleExpanded(); $event.preventDefault()"
        tabindex="0"
        role="button"
        [attr.aria-expanded]="isExpanded()"
        aria-label="Session selector"
      >
        <div class="session-current-info">
          <div class="session-current-name">
            {{ currentSessionDisplay().name }}
            @if (currentSessionDisplay().tokenUsage) {
              <span class="session-token-badge">
                {{ currentSessionDisplay().tokenUsage!.total }} tokens
              </span>
            }
          </div>
          <div class="session-current-meta">
            {{ currentSessionDisplay().messageCount }} messages •
            {{ currentSessionDisplay().timeAgo }}
          </div>
        </div>

        <div class="session-toggle-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M6 4l4 4-4 4V4z"
              [style.transform]="isExpanded() ? 'rotate(90deg)' : 'rotate(0deg)'"
            />
          </svg>
        </div>
      </div>

      <!-- Expanded Session List -->
      @if (isExpanded()) {
        <div class="session-dropdown-container">
          <!-- Create New Session -->
          <div class="session-dropdown-section">
            @if (showNameInput()) {
              <!-- Session Name Input -->
              <div class="session-name-input-container">
                <input
                  #nameInput
                  type="text"
                  class="session-name-input"
                  placeholder="Enter session name..."
                  [value]="newSessionName()"
                  (input)="onSessionNameInput($event)"
                  (keydown.enter)="onCreateNamedSession(nameInput.value)"
                  (keydown.escape)="onCancelNameInput()"
                  maxlength="50"
                />
                <div class="session-name-actions">
                  <button
                    class="session-name-action-button session-name-confirm"
                    (click)="onCreateNamedSession(nameInput.value)"
                    [disabled]="!nameInput.value.trim()"
                    type="button"
                  >
                    ✓
                  </button>
                  <button
                    class="session-name-action-button session-name-cancel"
                    (click)="onCancelNameInput()"
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              </div>
            } @else {
              <!-- Create Session Button -->
              <div class="session-create-options">
                <button
                  class="session-create-button session-create-quick"
                  (click)="onCreateSession()"
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path
                      d="M8 3v10M3 8h10"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                  Quick Session
                </button>
                <button
                  class="session-create-button session-create-named"
                  (click)="onShowNameInput()"
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4 9h8v2H4V9zm0-4h8v2H4V5z" />
                  </svg>
                  Named Session
                </button>
              </div>
            }
          </div>

          <!-- Session List -->
          @if (availableSessions().length > 0) {
            <div class="session-dropdown-section">
              <div class="session-dropdown-label">Switch to Session</div>
              @for (session of availableSessions(); track session.id) {
                <div
                  class="session-list-item"
                  [class.session-list-item-current]="session.id === currentSession()?.id"
                  (click)="onSelectSession(session.id)"
                  (keydown.enter)="onSelectSession(session.id)"
                  (keydown.space)="onSelectSession(session.id); $event.preventDefault()"
                  tabindex="0"
                  role="button"
                  [attr.aria-label]="'Select session ' + session.name"
                  [attr.aria-current]="session.id === currentSession()?.id ? 'true' : null"
                >
                  <div class="session-item-info">
                    <div class="session-item-name">{{ session.name }}</div>
                    <div class="session-item-meta">
                      {{ getSessionDisplayInfo(session).messageCount }} messages •
                      {{ getSessionDisplayInfo(session).timeAgo }}
                      @if (session.tokenUsage) {
                        • {{ session.tokenUsage.total }} tokens
                      }
                    </div>
                  </div>

                  <div class="session-item-actions">
                    @if (session.id === currentSession()?.id) {
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path
                          d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"
                        />
                      </svg>
                    } @else {
                      <button
                        class="session-action-button"
                        (click)="onDeleteSession(session.id); $event.stopPropagation()"
                        title="Delete session"
                        type="button"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <path
                            d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5zM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 1.152l.557 10.056A2 2 0 0 0 4.993 16h6.014a2 2 0 0 0 1.94-2.292l.556-10.056A.58.58 0 0 0 13.494 2.5H11z"
                          />
                        </svg>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }

          <!-- Session Management -->
          @if (showSessionManager()) {
            <div class="session-dropdown-section">
              <button class="session-manage-button" (click)="onManageSessions()" type="button">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path
                    d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"
                  />
                </svg>
                Manage Sessions
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .session-selector-container {
        position: relative;
        width: 100%;
        min-width: 280px;
      }

      .session-current-display {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .session-current-display:hover {
        background-color: var(--vscode-inputOption-hoverBackground);
        border-color: var(--vscode-inputOption-activeBorder);
      }

      .session-current-expanded {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        border-bottom-color: transparent;
      }

      .session-current-info {
        flex: 1;
        min-width: 0;
      }

      .session-current-name {
        font-weight: 500;
        color: var(--vscode-foreground);
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 2px;
      }

      .session-token-badge {
        font-size: 11px;
        padding: 2px 6px;
        background-color: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 10px;
        font-weight: normal;
      }

      .session-current-meta {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .session-toggle-icon {
        color: var(--vscode-icon-foreground);
        transition: transform 0.15s ease;
      }

      .session-dropdown-container {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background-color: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        border-top: none;
        border-bottom-left-radius: 4px;
        border-bottom-right-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        max-height: 400px;
        overflow-y: auto;
      }

      .session-dropdown-section {
        padding: 8px 0;
      }

      .session-dropdown-section:not(:last-child) {
        border-bottom: 1px solid var(--vscode-dropdown-border);
      }

      .session-dropdown-label {
        padding: 4px 16px;
        font-size: 11px;
        font-weight: 600;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .session-create-button,
      .session-manage-button {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: none;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.15s ease;
      }

      .session-create-button:hover,
      .session-manage-button:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .session-create-options {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .session-create-quick,
      .session-create-named {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: none;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.15s ease;
        border-radius: 3px;
      }

      .session-create-quick:hover,
      .session-create-named:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .session-name-input-container {
        padding: 8px 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .session-name-input {
        flex: 1;
        padding: 6px 8px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        color: var(--vscode-input-foreground);
        font-size: 13px;
      }

      .session-name-input:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
      }

      .session-name-actions {
        display: flex;
        gap: 4px;
      }

      .session-name-action-button {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        transition: all 0.15s ease;
      }

      .session-name-confirm {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      .session-name-confirm:hover:not(:disabled) {
        background-color: var(--vscode-button-hoverBackground);
      }

      .session-name-confirm:disabled {
        background-color: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        cursor: not-allowed;
      }

      .session-name-cancel {
        background-color: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }

      .session-name-cancel:hover {
        background-color: var(--vscode-inputValidation-errorBackground);
        color: var(--vscode-inputValidation-errorForeground);
      }

      .session-list-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px;
        cursor: pointer;
        transition: background-color 0.15s ease;
      }

      .session-list-item:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .session-list-item-current {
        background-color: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }

      .session-item-info {
        flex: 1;
        min-width: 0;
      }

      .session-item-name {
        font-weight: 500;
        margin-bottom: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .session-item-meta {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .session-item-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
      }

      .session-action-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 3px;
        color: var(--vscode-icon-foreground);
        transition: all 0.15s ease;
      }

      .session-action-button:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
        color: var(--vscode-errorForeground);
      }

      /* Responsive adjustments */
      @media (max-width: 768px) {
        .session-selector-container {
          min-width: 240px;
        }

        .session-current-display {
          padding: 10px 12px;
        }

        .session-list-item {
          padding: 8px 12px;
        }
      }

      /* Loading state */
      .session-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        color: var(--vscode-descriptionForeground);
      }
    `,
  ],
})
export class SessionSelectorComponent {
  // Input properties
  readonly currentSession = input<StrictChatSession | null>(null);
  readonly sessions = input<readonly StrictChatSession[]>([]);
  readonly isLoading = input<boolean>(false);
  readonly showSessionManager = input<boolean>(true);

  // Output events
  readonly sessionSelected = output<SessionId>();
  readonly sessionCreated = output<string | undefined>();
  readonly sessionDeleted = output<SessionId>();
  readonly sessionManagerRequested = output<void>();

  // Internal state
  private readonly _isExpanded = signal(false);
  private readonly _showNameInput = signal(false);
  private readonly _newSessionName = signal('');

  // Public readonly signals
  readonly isExpanded = this._isExpanded.asReadonly();
  readonly showNameInput = this._showNameInput.asReadonly();
  readonly newSessionName = this._newSessionName.asReadonly();

  // Computed properties
  readonly availableSessions = computed(() => {
    const current = this.currentSession();
    const sessions = this.sessions();

    // Handle undefined/null sessions gracefully
    if (!sessions || !Array.isArray(sessions)) {
      console.warn('SessionSelectorComponent: sessions is not an array:', sessions);
      return [];
    }

    // If no current session, show all sessions
    if (!current) {
      return sessions.filter((session) => session);
    }

    // If there's a current session, filter it out
    return sessions.filter((session) => session && session.id !== current.id);
  });

  readonly currentSessionDisplay = computed(() => {
    const session = this.currentSession();
    const allSessions = this.sessions();

    if (!session) {
      // Show available session count when no current session
      const sessionCount = Array.isArray(allSessions) ? allSessions.length : 0;
      return {
        name:
          sessionCount > 0
            ? `${sessionCount} Session${sessionCount === 1 ? '' : 's'}`
            : 'No Sessions',
        messageCount: 0,
        timeAgo: sessionCount > 0 ? 'Select a session' : 'Create a session to start',
        tokenUsage: null,
      };
    }

    return {
      name: session.name || 'Unnamed Session',
      messageCount: session.messageCount || session.messages?.length || 0,
      timeAgo: session.lastActiveAt ? this.getTimeAgo(session.lastActiveAt) : 'Unknown',
      tokenUsage: session.tokenUsage || null,
    };
  });

  toggleExpanded(): void {
    this._isExpanded.set(!this._isExpanded());
  }

  onSelectSession(sessionId: SessionId): void {
    this.sessionSelected.emit(sessionId);
    this._isExpanded.set(false);
  }

  onCreateSession(): void {
    // Could prompt for name in future enhancement
    this.sessionCreated.emit(undefined);
    this._isExpanded.set(false);
  }

  onDeleteSession(sessionId: SessionId): void {
    this.sessionDeleted.emit(sessionId);
  }

  onManageSessions(): void {
    this.sessionManagerRequested.emit();
    this._isExpanded.set(false);
  }

  onShowNameInput(): void {
    this._showNameInput.set(true);
    this._newSessionName.set('');
  }

  onCancelNameInput(): void {
    this._showNameInput.set(false);
    this._newSessionName.set('');
  }

  onSessionNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this._newSessionName.set(input.value);
  }

  onCreateNamedSession(name: string): void {
    const trimmedName = name?.trim();
    if (!trimmedName) return;

    this.sessionCreated.emit(trimmedName);
    this._showNameInput.set(false);
    this._newSessionName.set('');
    this._isExpanded.set(false);
  }

  getSessionDisplayInfo(session: StrictChatSession) {
    if (!session) {
      return {
        messageCount: 0,
        timeAgo: 'Unknown',
      };
    }

    return {
      messageCount: session.messageCount || session.messages?.length || 0,
      timeAgo: session.lastActiveAt ? this.getTimeAgo(session.lastActiveAt) : 'Unknown',
    };
  }

  private getTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }
}
