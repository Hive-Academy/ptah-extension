import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { StrictChatSession, SessionId } from '@ptah-extension/shared';

export interface SessionAction {
  readonly type: 'switch' | 'rename' | 'delete' | 'duplicate' | 'export';
  readonly label: string;
  readonly icon: string;
  readonly dangerous?: boolean;
}

/**
 * Session Card Component - Pure Presentation Component
 *
 * **Responsibility**: Individual session display card with action buttons
 * **Pattern**: Pure presentation with signal-based APIs (Angular 20)
 * **Change Detection**: OnPush enforced
 *
 * **Features**:
 * - Session info with token usage and message count
 * - Quick action buttons (switch, rename, delete, duplicate, export)
 * - Visual indicators for current/active session
 * - Responsive card layout with VS Code native styling
 * - Loading states and disabled interactions
 *
 * **Migration Notes**:
 * - Migrated from: apps/ptah-extension-webview/src/app/features/session/components/session-card.component.ts
 * - Already modernized with Angular 20 patterns (signals, modern control flow, OnPush)
 * - Selector: vscode-session-card → ptah-session-card
 * - LOC: ~639 lines (inline template + styles)
 */
@Component({
  selector: 'ptah-session-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],

  template: `
    <div
      class="session-card"
      [class.session-card-current]="isCurrent()"
      [class.session-card-loading]="isLoading()"
    >
      <!-- Session Header -->
      <div class="session-card-header">
        <div class="session-card-info">
          <div class="session-card-name">
            @if (isEditing()) {
            <input
              #nameInput
              class="session-name-input"
              [value]="session().name"
              (blur)="onNameSave(nameInput.value)"
              (keydown.enter)="onNameSave(nameInput.value)"
              (keydown.escape)="onCancelEdit()"
              type="text"
              maxlength="50"
            />
            } @else {
            <span (dblclick)="onStartEdit()">{{ sessionDisplayName() }}</span>
            } @if (isCurrent()) {
            <span class="session-current-badge">CURRENT</span>
            }
          </div>

          <div class="session-card-meta">
            <span class="session-meta-item">
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path
                  d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.51c.206.1.446.1.652 0l6.598-3.185A.755.755 0 0 1 15 5.293V4.5A1.5 1.5 0 0 0 13.5 3h-11Z"
                />
                <path
                  d="M15 6.954 8.978 9.86a2.25 2.25 0 0 1-1.956 0L1 6.954V11.5A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.954Z"
                />
              </svg>
              {{ sessionStats().messageCount }} messages
            </span>

            @if (sessionStats().tokenUsage) {
            <span class="session-meta-item">
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path
                  d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"
                />
                <path
                  d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"
                />
              </svg>
              {{ sessionStats().tokenUsage.total }} tokens
            </span>
            }

            <span class="session-meta-item session-meta-time">
              {{ sessionStats().timeAgo }}
            </span>
          </div>
        </div>

        @if (!isLoading()) {
        <div class="session-card-actions">
          @if (!isCurrent() && enableQuickSwitch()) {
          <button
            class="session-action-btn session-action-primary"
            (click)="onAction('switch')"
            title="Switch to this session"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"
              />
            </svg>
          </button>
          }

          <button
            class="session-action-btn"
            (click)="onToggleActions()"
            title="Session actions"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
              />
            </svg>
          </button>
        </div>
        } @else {
        <div class="session-loading-spinner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2v4M12 18v4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2M2 12h4M18 12h4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </div>
        }
      </div>

      <!-- Session Details (expanded view) -->
      @if (showDetails()) {
      <div class="session-card-details">
        <!-- Session Statistics -->
        <div class="session-details-stats">
          @if (sessionStats().tokenUsage) {
          <div class="session-stat">
            <span class="session-stat-label">Input Tokens</span>
            <span class="session-stat-value">{{
              sessionStats().tokenUsage!.input
            }}</span>
          </div>
          <div class="session-stat">
            <span class="session-stat-label">Output Tokens</span>
            <span class="session-stat-value">{{
              sessionStats().tokenUsage!.output
            }}</span>
          </div>
          <div class="session-stat">
            <span class="session-stat-label">Usage</span>
            <span class="session-stat-value"
              >{{ sessionStats().tokenUsage!.percentage.toFixed(1) }}%</span
            >
          </div>
          }

          <div class="session-stat">
            <span class="session-stat-label">Created</span>
            <span class="session-stat-value">{{
              getFormattedDate(session().createdAt)
            }}</span>
          </div>
          <div class="session-stat">
            <span class="session-stat-label">Updated</span>
            <span class="session-stat-value">{{
              getFormattedDate(session().lastActiveAt || session().updatedAt)
            }}</span>
          </div>
        </div>

        <!-- Recent Messages Preview -->
        @if (recentMessages().length > 0) {
        <div class="session-recent-messages">
          <div class="session-recent-title">Recent Messages</div>
          @for (message of recentMessages(); track message.id) {
          <div class="session-message-preview">
            <span
              class="message-type-badge"
              [class]="'message-type-' + message.type"
            >
              {{ message.type }}
            </span>
            <span class="message-content-preview">
              {{ getMessagePreview(message.content) }}
            </span>
          </div>
          }
        </div>
        }
      </div>
      }

      <!-- Action Menu (when expanded) -->
      @if (showActionsMenu()) {
      <div class="session-actions-menu">
        @for (action of availableActions(); track action.type) {
        <button
          class="session-action-item"
          [class.session-action-dangerous]="action.dangerous"
          (click)="onAction(action.type)"
          type="button"
        >
          <span class="session-action-icon" [innerHTML]="action.icon"></span>
          <span class="session-action-label">{{ action.label }}</span>
        </button>
        }
      </div>
      }
    </div>
  `,
  styles: [
    `
      .session-card {
        background-color: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        transition: all 0.2s ease;
        overflow: hidden;
      }

      .session-card:hover {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .session-card-current {
        border-color: var(--vscode-progressBar-background);
        background-color: var(--vscode-list-activeSelectionBackground);
      }

      .session-card-loading {
        opacity: 0.7;
        pointer-events: none;
      }

      .session-card-header {
        padding: 16px;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .session-card-info {
        flex: 1;
        min-width: 0;
      }

      .session-card-name {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 15px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .session-name-input {
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        padding: 4px 6px;
        font-size: inherit;
        font-weight: inherit;
        color: var(--vscode-input-foreground);
        outline: none;
      }

      .session-name-input:focus {
        border-color: var(--vscode-focusBorder);
      }

      .session-current-badge {
        font-size: 10px;
        font-weight: 500;
        padding: 2px 6px;
        background-color: var(--vscode-progressBar-background);
        color: white;
        border-radius: 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .session-card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .session-meta-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .session-meta-time {
        margin-left: auto;
        font-weight: 500;
      }

      .session-card-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .session-action-btn {
        background: none;
        border: 1px solid var(--vscode-button-secondaryBorder);
        border-radius: 4px;
        padding: 8px;
        cursor: pointer;
        color: var(--vscode-button-secondaryForeground);
        transition: all 0.15s ease;
      }

      .session-action-btn:hover {
        background-color: var(--vscode-button-secondaryHoverBackground);
      }

      .session-action-primary {
        background-color: var(--vscode-button-background);
        border-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      .session-action-primary:hover {
        background-color: var(--vscode-button-hoverBackground);
      }

      .session-loading-spinner {
        animation: spin 1s linear infinite;
        color: var(--vscode-progressBar-background);
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .session-card-details {
        border-top: 1px solid var(--vscode-panel-border);
        padding: 16px;
        background-color: var(--vscode-editor-inactiveSelectionBackground);
      }

      .session-details-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }

      .session-stat {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .session-stat-label {
        font-size: 11px;
        font-weight: 500;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .session-stat-value {
        font-size: 13px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .session-recent-messages {
        margin-top: 16px;
      }

      .session-recent-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--vscode-foreground);
        margin-bottom: 8px;
      }

      .session-message-preview {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .message-type-badge {
        font-size: 9px;
        font-weight: 500;
        padding: 2px 4px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        min-width: 40px;
        text-align: center;
      }

      .message-type-user {
        background-color: var(--vscode-terminal-ansiBlue);
        color: white;
      }

      .message-type-assistant {
        background-color: var(--vscode-terminal-ansiGreen);
        color: white;
      }

      .message-type-system {
        background-color: var(--vscode-terminal-ansiYellow);
        color: black;
      }

      .message-content-preview {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .session-actions-menu {
        border-top: 1px solid var(--vscode-panel-border);
        padding: 8px;
        background-color: var(--vscode-menu-background);
      }

      .session-action-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: none;
        border: none;
        color: var(--vscode-menu-foreground);
        cursor: pointer;
        font-size: 13px;
        border-radius: 3px;
        transition: background-color 0.15s ease;
      }

      .session-action-item:hover {
        background-color: var(--vscode-menu-selectionBackground);
        color: var(--vscode-menu-selectionForeground);
      }

      .session-action-dangerous {
        color: var(--vscode-errorForeground);
      }

      .session-action-dangerous:hover {
        background-color: var(--vscode-inputValidation-errorBackground);
      }

      .session-action-icon {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Responsive adjustments */
      @media (max-width: 768px) {
        .session-card-header {
          padding: 12px;
        }

        .session-card-meta {
          gap: 8px;
        }

        .session-details-stats {
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `,
  ],
})
export class SessionCardComponent {
  // Input properties
  readonly session = input.required<StrictChatSession>();
  readonly isCurrent = input<boolean>(false);
  readonly isLoading = input<boolean>(false);
  readonly showDetails = input<boolean>(false);
  readonly enableQuickSwitch = input<boolean>(true);

  // Output events
  readonly actionRequested = output<{
    action: SessionAction['type'];
    session: StrictChatSession;
  }>();
  readonly nameChanged = output<{ sessionId: SessionId; newName: string }>();

  // Internal state
  private readonly _isEditing = signal(false);
  private readonly _showActionsMenu = signal(false);

  // Public readonly signals
  readonly isEditing = this._isEditing.asReadonly();
  readonly showActionsMenu = this._showActionsMenu.asReadonly();

  // Computed properties
  readonly sessionDisplayName = computed(() => {
    const session = this.session();
    return session.name || `Session ${session.id.slice(0, 8)}`;
  });

  readonly sessionStats = computed(() => {
    const session = this.session();
    return {
      messageCount: session.messageCount || session.messages?.length || 0,
      tokenUsage: session.tokenUsage,
      timeAgo: this.getTimeAgo(session.lastActiveAt || session.updatedAt),
    };
  });

  readonly recentMessages = computed(() => {
    const messages = this.session().messages || [];
    return messages.slice(-3).reverse();
  });

  readonly availableActions = computed((): SessionAction[] => {
    const actions: SessionAction[] = [];

    if (!this.isCurrent()) {
      actions.push({
        type: 'switch',
        label: 'Switch to Session',
        icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/></svg>',
      });
    }

    actions.push(
      {
        type: 'rename',
        label: 'Rename Session',
        icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708L14.5 5.207l-3-3L12.146.146zm-.793 1.793l3 3L11.207 8l-3-3 3.146-3.147zM4.5 13.5A1.5 1.5 0 0 1 3 12V4.5A1.5 1.5 0 0 1 4.5 3h5.379a.5.5 0 0 1 0 1H4.5a.5.5 0 0 0-.5.5V12a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V7.621a.5.5 0 0 1 1 0V12a1.5 1.5 0 0 1-1.5 1.5h-7z"/></svg>',
      },
      {
        type: 'duplicate',
        label: 'Duplicate Session',
        icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>',
      },
      {
        type: 'export',
        label: 'Export Session',
        icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 1.5A1.5 1.5 0 0 1 10 0h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h6c-.314.418-.5.937-.5 1.5v6h-2a.5.5 0 0 0-.354.854l2.5 2.5a.5.5 0 0 0 .708 0l2.5-2.5A.5.5 0 0 0 10 7.5H8.5v-6z"/></svg>',
      }
    );

    if (!this.isCurrent()) {
      actions.push({
        type: 'delete',
        label: 'Delete Session',
        icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5zM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 1.152l.557 10.056A2 2 0 0 0 4.993 16h6.014a2 2 0 0 0 1.94-2.292l.556-10.056A.58.58 0 0 0 13.494 2.5H11z"/></svg>',
        dangerous: true,
      });
    }

    return actions;
  });

  onStartEdit(): void {
    this._isEditing.set(true);
    // Auto-focus the input after template updates
    setTimeout(() => {
      const input = document.querySelector(
        '.session-name-input'
      ) as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  onCancelEdit(): void {
    this._isEditing.set(false);
  }

  onNameSave(newName: string): void {
    const trimmedName = newName.trim();
    if (trimmedName && trimmedName !== this.session().name) {
      this.nameChanged.emit({
        sessionId: this.session().id,
        newName: trimmedName,
      });
    }
    this._isEditing.set(false);
  }

  onToggleActions(): void {
    this._showActionsMenu.set(!this._showActionsMenu());
  }

  onAction(actionType: SessionAction['type']): void {
    if (actionType === 'rename') {
      this.onStartEdit();
    } else {
      this.actionRequested.emit({
        action: actionType,
        session: this.session(),
      });
    }
    this._showActionsMenu.set(false);
  }

  getMessagePreview(content: string): string {
    return content.length > 80 ? content.substring(0, 80) + '...' : content;
  }

  getFormattedDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
