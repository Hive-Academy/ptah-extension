import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  input,
  output,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil, combineLatest, debounceTime, filter } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';

// Core Services
import {
  VSCodeService,
  ChatService,
  LoggingService,
  AnalyticsService,
} from '@ptah-extension/core';

// Types
import { StrictChatSession, SessionId } from '@ptah-extension/shared';

// Child Components
import { SessionSelectorComponent } from '../../components/session-selector/session-selector.component';
import {
  SessionCardComponent,
  SessionAction,
} from '../../components/session-card/session-card.component';

export interface SessionManagerConfig {
  readonly displayMode: 'inline' | 'panel' | 'modal';
  readonly showSessionCards: boolean;
  readonly enableQuickActions: boolean;
  readonly maxVisibleSessions: number;
  readonly autoSave: boolean;
}

/**
 * Session Manager Component - Smart Container Component
 *
 * **Responsibility**: Orchestrates session management UI with backend integration
 * **Pattern**: Smart container with signal-based state management (Angular 20)
 * **Change Detection**: OnPush enforced
 *
 * **Features**:
 * - Manages multiple chat sessions with visual switching
 * - Handles session CRUD operations via VSCodeService
 * - Real-time session state synchronization from extension
 * - Responsive session display with pagination
 * - Integration with analytics for session usage tracking
 * - Debounced backend updates for performance
 *
 * **Architecture Notes**:
 * - Uses SessionSelectorComponent and SessionCardComponent as child components
 * - Maintains session state in signals with computed derived state
 * - Subscribes to backend events for session updates
 * - Implements loading/error states for async operations
 *
 * **⚠️ CODE SIZE WARNING**:
 * This component is 910 lines, violating the <500 line guideline.
 * **TODO**: Create TASK_REFACTOR_001 to split this component:
 *   - Extract session state management service
 *   - Split UI into smaller sub-components (session list, session grid)
 *   - Extract session action handlers
 *
 * **Migration Notes**:
 * - Migrated from: apps/ptah-extension-webview/src/app/features/session/containers/session-manager.component.ts
 * - Already modernized with Angular 20 patterns (signals, effects, OnPush)
 * - Selector: vscode-session-manager → ptah-session-manager
 * - LOC: ~910 lines (needs refactoring)
 */
@Component({
  selector: 'ptah-session-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, SessionSelectorComponent, SessionCardComponent],
  template: `
    <div
      class="session-manager-container"
      [attr.data-mode]="config().displayMode"
    >
      <!-- Session Manager Header -->
      @if (config().displayMode !== 'inline') {
      <div class="session-manager-header">
        <div class="session-manager-title">
          <h2>Session Management</h2>
          <span class="session-count-badge"
            >{{ allSessions().length }} sessions</span
          >
        </div>

        @if (config().displayMode === 'modal') {
        <button
          class="session-manager-close"
          (click)="onClose()"
          type="button"
          title="Close session manager"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"
            />
          </svg>
        </button>
        }
      </div>
      }

      <!-- Quick Session Selector -->
      <div class="session-selector-section">
        <ptah-session-selector
          [currentSession]="currentSession()"
          [sessions]="allSessions()"
          [isLoading]="isLoading()"
          [showSessionManager]="false"
          (sessionSelected)="onSwitchSession($event)"
          (sessionCreated)="onCreateSession($event)"
          (sessionDeleted)="onDeleteSession($event)"
        >
        </ptah-session-selector>
      </div>

      <!-- Session Statistics -->
      @if (sessionStats().totalMessages > 0) {
      <div class="session-stats-section">
        <div class="session-stats-grid">
          <div class="session-stat-item">
            <span class="session-stat-value">{{
              sessionStats().totalMessages
            }}</span>
            <span class="session-stat-label">Total Messages</span>
          </div>
          <div class="session-stat-item">
            <span class="session-stat-value">{{
              sessionStats().totalTokens
            }}</span>
            <span class="session-stat-label">Total Tokens</span>
          </div>
          <div class="session-stat-item">
            <span class="session-stat-value">{{
              sessionStats().averageMessages
            }}</span>
            <span class="session-stat-label">Avg Messages</span>
          </div>
          <div class="session-stat-item">
            <span class="session-stat-value">{{
              sessionStats().activeSessions
            }}</span>
            <span class="session-stat-label">Active Sessions</span>
          </div>
        </div>
      </div>
      }

      <!-- Session Cards View -->
      @if (config().showSessionCards && visibleSessions().length > 0) {
      <div class="session-cards-section">
        <div class="session-cards-header">
          <h3>All Sessions</h3>

          <!-- View Controls -->
          <div class="session-view-controls">
            <button
              class="session-view-btn"
              [class.active]="sortMode() === 'recent'"
              (click)="setSortMode('recent')"
              type="button"
            >
              Recent
            </button>
            <button
              class="session-view-btn"
              [class.active]="sortMode() === 'alphabetical'"
              (click)="setSortMode('alphabetical')"
              type="button"
            >
              A-Z
            </button>
            <button
              class="session-view-btn"
              [class.active]="sortMode() === 'usage'"
              (click)="setSortMode('usage')"
              type="button"
            >
              Usage
            </button>
          </div>
        </div>

        <!-- Session Cards Grid -->
        <div class="session-cards-grid">
          @for (session of visibleSessions(); track session.id) {
          <ptah-session-card
            [session]="session"
            [isCurrent]="session.id === currentSession()?.id"
            [isLoading]="loadingSessionId() === session.id"
            [showDetails]="selectedSessionId() === session.id"
            [enableQuickSwitch]="config().enableQuickActions"
            (actionRequested)="onSessionAction($event.action, $event.session)"
            (nameChanged)="onRenameSession($event.sessionId, $event.newName)"
          >
          </ptah-session-card>
          }
        </div>

        <!-- Load More Button -->
        @if (hasMoreSessions()) {
        <div class="session-load-more-section">
          <button
            class="session-load-more-btn"
            (click)="loadMoreSessions()"
            type="button"
          >
            Show {{ remainingSessionCount() }} more sessions
          </button>
        </div>
        }
      </div>
      }

      <!-- Empty State -->
      @if (allSessions().length === 0 && !isLoading) {
      <div class="session-empty-state">
        <div class="session-empty-icon">
          <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.51c.206.1.446.1.652 0l6.598-3.185A.755.755 0 0 1 15 5.293V4.5A1.5 1.5 0 0 0 13.5 3h-11Z"
            />
            <path
              d="M15 6.954 8.978 9.86a2.25 2.25 0 0 1-1.956 0L1 6.954V11.5A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.954Z"
            />
          </svg>
        </div>
        <div class="session-empty-title">No Sessions Yet</div>
        <div class="session-empty-description">
          Create your first session to start chatting with Claude
        </div>
        <button
          class="session-create-first-btn"
          (click)="onCreateSession(undefined)"
          type="button"
        >
          Create First Session
        </button>
      </div>
      }

      <!-- Loading State -->
      @if (isLoading() && allSessions().length === 0) {
      <div class="session-loading-state">
        <div class="session-loading-spinner">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2v4M12 18v4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2M2 12h4M18 12h4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <div class="session-loading-text">Loading sessions...</div>
      </div>
      }
    </div>
  `,
  styles: [
    `
      .session-manager-container {
        display: flex;
        flex-direction: column;
        gap: 20px;
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
      }

      .session-manager-container[data-mode='modal'] {
        padding: 24px;
        background-color: var(--vscode-editor-background);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      }

      .session-manager-container[data-mode='panel'] {
        padding: 16px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        background-color: var(--vscode-editor-background);
      }

      .session-manager-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .session-manager-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .session-manager-title h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .session-count-badge {
        font-size: 12px;
        padding: 2px 8px;
        background-color: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 10px;
        font-weight: 500;
      }

      .session-manager-close {
        background: none;
        border: none;
        padding: 8px;
        cursor: pointer;
        color: var(--vscode-icon-foreground);
        border-radius: 4px;
        transition: background-color 0.15s ease;
      }

      .session-manager-close:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
      }

      .session-selector-section {
        width: 100%;
      }

      .session-stats-section {
        padding: 16px;
        background-color: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: 6px;
        border: 1px solid var(--vscode-panel-border);
      }

      .session-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 16px;
      }

      .session-stat-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 4px;
      }

      .session-stat-value {
        font-size: 24px;
        font-weight: 700;
        color: var(--vscode-foreground);
      }

      .session-stat-label {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-weight: 500;
      }

      .session-cards-section {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .session-cards-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .session-cards-header h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .session-view-controls {
        display: flex;
        gap: 4px;
      }

      .session-view-btn {
        padding: 6px 12px;
        background: none;
        border: 1px solid var(--vscode-button-border);
        border-radius: 4px;
        color: var(--vscode-button-foreground);
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.15s ease;
      }

      .session-view-btn:hover {
        background-color: var(--vscode-button-hoverBackground);
      }

      .session-view-btn.active {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-button-background);
      }

      .session-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
      }

      .session-load-more-section {
        display: flex;
        justify-content: center;
        padding: 16px 0;
      }

      .session-load-more-btn {
        padding: 8px 16px;
        background-color: var(--vscode-button-secondaryBackground);
        border: 1px solid var(--vscode-button-secondaryBorder);
        border-radius: 4px;
        color: var(--vscode-button-secondaryForeground);
        cursor: pointer;
        font-size: 13px;
        transition: all 0.15s ease;
      }

      .session-load-more-btn:hover {
        background-color: var(--vscode-button-secondaryHoverBackground);
      }

      .session-empty-state,
      .session-loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 16px;
        text-align: center;
        color: var(--vscode-descriptionForeground);
      }

      .session-empty-icon,
      .session-loading-spinner {
        margin-bottom: 16px;
        opacity: 0.6;
      }

      .session-loading-spinner {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .session-empty-title,
      .session-loading-text {
        font-size: 18px;
        font-weight: 600;
        color: var(--vscode-foreground);
        margin-bottom: 8px;
      }

      .session-empty-description {
        font-size: 14px;
        margin-bottom: 24px;
        max-width: 300px;
      }

      .session-create-first-btn {
        padding: 12px 24px;
        background-color: var(--vscode-button-background);
        border: none;
        border-radius: 6px;
        color: var(--vscode-button-foreground);
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.15s ease;
      }

      .session-create-first-btn:hover {
        background-color: var(--vscode-button-hoverBackground);
      }

      /* Responsive design */
      @media (max-width: 768px) {
        .session-manager-container[data-mode='modal'] {
          padding: 16px;
        }

        .session-stats-grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }

        .session-cards-grid {
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .session-cards-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 12px;
        }

        .session-view-controls {
          width: 100%;
          justify-content: center;
        }
      }
    `,
  ],
})
export class SessionManagerComponent implements OnInit, OnDestroy {
  private readonly vscode = inject(VSCodeService);
  private readonly chatService = inject(ChatService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly logger = inject(LoggingService);
  private readonly destroy$ = new Subject<void>();

  // Configuration input
  readonly config = input<SessionManagerConfig>({
    displayMode: 'panel',
    showSessionCards: true,
    enableQuickActions: true,
    maxVisibleSessions: 12,
    autoSave: true,
  });

  // Output events
  readonly closed = output<void>();
  readonly sessionSwitched = output<SessionId>();

  // Private state signals
  private readonly _isLoading = signal(false);
  private readonly _loadingSessionId = signal<SessionId | null>(null);
  private readonly _selectedSessionId = signal<SessionId | null>(null);
  private readonly _allSessions = signal<readonly StrictChatSession[]>([]);
  private readonly _sortMode = signal<'recent' | 'alphabetical' | 'usage'>(
    'recent'
  );
  private readonly _visibleSessionCount = signal(12);

  // Public readonly signals
  readonly isLoading = this._isLoading.asReadonly();
  readonly loadingSessionId = this._loadingSessionId.asReadonly();
  readonly selectedSessionId = this._selectedSessionId.asReadonly();
  readonly sortMode = this._sortMode.asReadonly();

  // Computed from chat service and local state
  readonly currentSession = this.chatService.currentSession;
  readonly allSessions = computed(() => {
    // Use enhanced chat service sessions if available, fallback to local
    const chatSessions = this.chatService.currentSession();
    if (chatSessions) {
      // If we have a current session from chat service, need to fetch all sessions
      return this._allSessions();
    }
    return this._allSessions();
  });

  readonly visibleSessions = computed(() => {
    const sessions = this.allSessions();
    const sortMode = this._sortMode();
    const maxVisible = Math.min(this._visibleSessionCount(), sessions.length);

    const sorted = [...sessions];

    switch (sortMode) {
      case 'recent':
        sorted.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case 'alphabetical':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'usage':
        sorted.sort((a, b) => {
          const aUsage = a.tokenUsage?.total || 0;
          const bUsage = b.tokenUsage?.total || 0;
          return bUsage - aUsage;
        });
        break;
    }

    return sorted.slice(0, maxVisible);
  });

  readonly hasMoreSessions = computed(() => {
    return this.allSessions().length > this._visibleSessionCount();
  });

  readonly remainingSessionCount = computed(() => {
    return Math.max(0, this.allSessions().length - this._visibleSessionCount());
  });

  readonly sessionStats = computed(() => {
    const sessions = this.allSessions();

    const totalMessages = sessions.reduce(
      (sum, session) => sum + session.messages.length,
      0
    );
    const totalTokens = sessions.reduce(
      (sum, session) => sum + (session.tokenUsage?.total || 0),
      0
    );
    const averageMessages =
      sessions.length > 0 ? Math.round(totalMessages / sessions.length) : 0;
    const activeSessions = sessions.filter(
      (session) => session.messages.length > 0
    ).length;

    return {
      totalMessages,
      totalTokens,
      averageMessages,
      activeSessions,
    };
  });

  constructor() {
    // Auto-fetch sessions when current session changes
    effect(() => {
      const currentSession = this.currentSession();
      if (currentSession) {
        this.fetchAllSessions();
      }
    });
  }

  ngOnInit(): void {
    this.initializeSessionManagement();
    this.setupSessionSynchronization();
    this.trackSessionManagerUsage();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeSessionManagement(): void {
    this.logger.lifecycle('SessionManagerComponent', 'init', {
      config: this.config(),
    });
    this._isLoading.set(true);

    // Initial session fetch
    this.fetchAllSessions();
  }

  private setupSessionSynchronization(): void {
    // Handle initial data from backend
    this.vscode
      .onMessage()
      .pipe(
        filter((msg) => msg.type === 'initialData'),
        takeUntil(this.destroy$)
      )
      .subscribe((initialData: unknown) => {
        const typedData = initialData as {
          data?: { sessions?: readonly StrictChatSession[] };
        };
        const sessions = typedData?.data?.sessions || [];
        this.logger.debug('initialData received', 'SessionManagerComponent', {
          sessionCount: sessions.length,
        });

        if (sessions.length > 0) {
          this.logger.info(
            'Setting initial sessions',
            'SessionManagerComponent',
            {
              count: sessions.length,
            }
          );
          this._allSessions.set(sessions);
          this._isLoading.set(false);
        }
      });

    // Monitor chat service session changes for real-time updates
    combineLatest([
      toObservable(this.chatService.currentSession),
      this.vscode
        .onMessage()
        .pipe(filter((msg) => msg.type === 'chat:sessionsUpdated')),
    ])
      .pipe(debounceTime(100), takeUntil(this.destroy$))
      .subscribe(([currentSession, sessionsUpdate]) => {
        this.logger.info('Session state changed', 'SessionManagerComponent', {
          currentSessionId: currentSession?.id,
          hasSessionsUpdate: !!sessionsUpdate,
        });

        if (sessionsUpdate) {
          const typedUpdate = sessionsUpdate as unknown as {
            data?: { sessions?: readonly StrictChatSession[] };
            payload?: { sessions?: readonly StrictChatSession[] };
          };
          const sessions =
            typedUpdate?.data?.sessions || typedUpdate?.payload?.sessions || [];
          this._allSessions.set(sessions);
        }

        // Refresh session list periodically
        this.fetchAllSessions();
      });
  }

  private trackSessionManagerUsage(): void {
    // Track session manager view
    this.analyticsService.trackEvent('session_manager_opened', {
      displayMode: this.config().displayMode,
      currentSessionCount: this.allSessions().length,
    });
  }

  private async fetchAllSessions(): Promise<void> {
    try {
      this.logger.debug('fetchAllSessions started', 'SessionManagerComponent', {
        loading: this._isLoading(),
      });
      this._isLoading.set(true);

      // Request sessions from backend
      this.vscode.postStrictMessage('chat:requestSessions', {});

      // Listen for response
      this.vscode
        .onMessage()
        .pipe(
          filter((msg) => msg.type === 'chat:sessionsUpdated'),
          takeUntil(this.destroy$)
        )
        .subscribe((response: unknown) => {
          const typedResponse = response as {
            data?: { sessions?: readonly StrictChatSession[] };
            payload?: { sessions?: readonly StrictChatSession[] };
          };
          const sessions =
            typedResponse?.data?.sessions ||
            typedResponse?.payload?.sessions ||
            [];
          this.logger.debug(
            'fetchAllSessions succeeded',
            'SessionManagerComponent',
            { sessionCount: sessions.length }
          );
          this._allSessions.set(sessions);
          this._isLoading.set(false);
        });
    } catch (error) {
      this.logger.error(
        'Failed to fetch sessions',
        'SessionManagerComponent',
        error
      );
      this._isLoading.set(false);
    }
  }

  onSwitchSession(sessionId: SessionId): void {
    this.logger.interaction('switchSession', 'SessionManagerComponent', {
      sessionId,
    });

    this._loadingSessionId.set(sessionId);

    try {
      // Use enhanced chat service for session switching
      this.chatService.switchToSession(sessionId);

      // Track session switch
      this.analyticsService.trackEvent('session_switched', {
        sessionId,
        fromSessionManager: true,
        switchMode: 'selector',
      });

      this.sessionSwitched.emit(sessionId);
    } catch (error) {
      this.logger.error(
        'Failed to switch session',
        'SessionManagerComponent',
        error
      );
    } finally {
      setTimeout(() => this._loadingSessionId.set(null), 500);
    }
  }

  async onCreateSession(name?: string): Promise<void> {
    this.logger.interaction('createSession', 'SessionManagerComponent', {
      name,
    });

    try {
      this._isLoading.set(true);

      // Use enhanced chat service for session creation
      await this.chatService.createNewSession(name);

      // Track session creation
      this.analyticsService.trackEvent('session_created', {
        hasCustomName: !!name,
        fromSessionManager: true,
        totalSessions: this.allSessions().length + 1,
      });

      // Refresh sessions
      setTimeout(() => this.fetchAllSessions(), 500);
    } catch (error) {
      this.logger.error(
        'Failed to create session',
        'SessionManagerComponent',
        error
      );
    } finally {
      this._isLoading.set(false);
    }
  }

  onDeleteSession(sessionId: SessionId): void {
    this.logger.interaction('deleteSession', 'SessionManagerComponent', {
      sessionId,
    });

    // Prevent deleting current session
    if (sessionId === this.currentSession()?.id) {
      this.logger.warn(
        'Cannot delete current session',
        'SessionManagerComponent',
        { sessionId }
      );
      return;
    }

    this._loadingSessionId.set(sessionId);

    try {
      this.vscode.postStrictMessage('chat:deleteSession', { sessionId });

      // Track session deletion
      this.analyticsService.trackEvent('session_deleted', {
        sessionId,
        fromSessionManager: true,
        totalSessions: this.allSessions().length - 1,
      });

      // Refresh sessions
      setTimeout(() => this.fetchAllSessions(), 500);
    } catch (error) {
      this.logger.error(
        'Failed to delete session',
        'SessionManagerComponent',
        error
      );
    } finally {
      setTimeout(() => this._loadingSessionId.set(null), 500);
    }
  }

  onRenameSession(sessionId: SessionId, newName: string): void {
    this.logger.interaction('renameSession', 'SessionManagerComponent', {
      sessionId,
      newName,
    });

    try {
      this.vscode.postStrictMessage('chat:renameSession', {
        sessionId,
        newName,
      });

      // Track session rename
      this.analyticsService.trackEvent('session_renamed', {
        sessionId,
        fromSessionManager: true,
      });

      // Update local state optimistically
      const sessions = this._allSessions();
      const updatedSessions = sessions.map((session) =>
        session.id === sessionId ? { ...session, name: newName } : session
      );
      this._allSessions.set(updatedSessions);
    } catch (error) {
      this.logger.error(
        'Failed to rename session',
        'SessionManagerComponent',
        error
      );
      // Refresh on error to revert optimistic update
      this.fetchAllSessions();
    }
  }

  onSessionAction(
    actionType: SessionAction['type'],
    session: StrictChatSession
  ): void {
    this.logger.interaction('sessionAction', 'SessionManagerComponent', {
      actionType,
      sessionId: session.id,
    });

    switch (actionType) {
      case 'switch':
        this.onSwitchSession(session.id);
        break;
      case 'delete':
        this.onDeleteSession(session.id);
        break;
      case 'duplicate':
        this.duplicateSession(session);
        break;
      case 'export':
        this.exportSession(session);
        break;
      default:
        this.logger.warn(
          'Unhandled session action type',
          'SessionManagerComponent',
          {
            actionType,
          }
        );
    }
  }

  private async duplicateSession(session: StrictChatSession): Promise<void> {
    const newName = `${session.name} (Copy)`;

    // For now, just create a new session with the same name
    // Future enhancement: copy messages
    await this.onCreateSession(newName);

    this.analyticsService.trackEvent('session_duplicated', {
      originalSessionId: session.id,
      newName,
    });
  }

  private exportSession(session: StrictChatSession): void {
    // Create exportable session data
    const exportData = {
      name: session.name,
      messages: session.messages,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      tokenUsage: session.tokenUsage,
      exportedAt: Date.now(),
    };

    // Create and download JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.name
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()}_session.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.analyticsService.trackEvent('session_exported', {
      sessionId: session.id,
      messageCount: session.messages.length,
    });
  }

  setSortMode(mode: 'recent' | 'alphabetical' | 'usage'): void {
    this._sortMode.set(mode);

    this.analyticsService.trackEvent('session_sort_changed', {
      sortMode: mode,
      sessionCount: this.allSessions().length,
    });
  }

  loadMoreSessions(): void {
    const currentVisible = this._visibleSessionCount();
    const maxSessions = this.config().maxVisibleSessions;
    const newVisible = Math.min(
      currentVisible + maxSessions,
      this.allSessions().length
    );

    this._visibleSessionCount.set(newVisible);

    this.analyticsService.trackEvent('session_load_more', {
      previousVisible: currentVisible,
      newVisible: newVisible,
      totalSessions: this.allSessions().length,
    });
  }

  onClose(): void {
    this.analyticsService.trackEvent('session_manager_closed', {
      displayMode: this.config().displayMode,
      sessionInteractions: this.allSessions().length,
    });

    this.closed.emit();
  }
}
