import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChatSessionCreatedPayload,
  ChatSessionsUpdatedPayload,
  ChatSessionSwitchedPayload,
  SessionId,
  StrictChatSession,
} from '@ptah-extension/shared';
import { AppStateManager } from './app-state.service';
import { ChatStateService } from './chat-state.service';
import { VSCodeService } from './vscode.service';

/**
 * Agent Option - UI model for agent selection dropdown
 */
export interface AgentOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

/**
 * Chat State Manager Service - Chat-specific UI State Management
 *
 * RESPONSIBILITIES:
 * - Manage session list and session loading states
 * - Handle session manager UI visibility
 * - Manage agent selection and current message input
 * - Provide computed properties for UI state
 *
 * BEFORE: Mixed in chat component with 500+ lines
 * AFTER: Dedicated service following single responsibility principle
 *
 * MODERNIZATIONS APPLIED:
 * - inject() pattern instead of constructor injection
 * - DestroyRef with takeUntilDestroyed() for cleanup
 * - Pure signal-based state (NO RxJS for state)
 * - Computed signals for derived state
 * - readonly modifiers for immutability
 * - Type-safe message handling
 * - Zero any types - strict typing throughout
 */
@Injectable({
  providedIn: 'root',
})
export class ChatStateManagerService {
  // Core service dependencies
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly chatState = inject(ChatStateService);
  private readonly destroyRef = inject(DestroyRef);

  // Private signals - immutable with readonly
  private readonly _availableSessions = signal<readonly StrictChatSession[]>(
    []
  );
  private readonly _isSessionLoading = signal(false);
  private readonly _showSessionManager = signal(false);
  private readonly _selectedAgent = signal('general');
  private readonly _currentMessage = signal('');

  // Public readonly signals
  readonly availableSessions = computed(() => {
    const sessions = this._availableSessions();
    return Array.isArray(sessions) ? sessions : [];
  });
  readonly isSessionLoading = computed(() => this._isSessionLoading());
  readonly showSessionManager = computed(() => this._showSessionManager());
  readonly selectedAgent = computed(() => this._selectedAgent());
  readonly currentMessage = computed(() => this._currentMessage());

  // Computed properties
  readonly agentOptions = computed((): readonly AgentOption[] => [
    {
      value: 'general',
      label: 'General Assistant',
      description: 'Claude 3.5 Sonnet for general tasks',
    },
    {
      value: 'code',
      label: 'Code Expert',
      description: 'Specialized in programming and development',
    },
    {
      value: 'architect',
      label: 'Software Architect',
      description: 'System design and architecture guidance',
    },
    {
      value: 'researcher',
      label: 'Research Expert',
      description: 'Deep analysis and research tasks',
    },
  ]);

  readonly canSendMessage = computed((): boolean => {
    return (
      this.currentMessage().trim().length > 0 && !this.appState.isLoading()
    );
  });

  /**
   * Initialize session management
   * Subscribe to session-related messages from backend
   */
  initialize(): void {
    this.setupSessionHandling();
    this.fetchAvailableSessions();
  }

  // Session management methods

  /**
   * Switch to a different session
   *
   * @param sessionId - The session ID to switch to
   */
  switchToSession(sessionId: string): void {
    const session = this.availableSessions().find((s) => s.id === sessionId);
    if (!session) return;

    this._isSessionLoading.set(true);
    this.vscode.postStrictMessage('chat:switchSession', {
      sessionId: sessionId as SessionId,
    });
  }

  /**
   * Create a new session
   *
   * @param sessionName - Name for the new session
   */
  createNewSession(sessionName: string): void {
    this._isSessionLoading.set(true);
    this.vscode.postStrictMessage('chat:newSession', { name: sessionName });
  }

  /**
   * Delete a session
   *
   * @param sessionId - The session ID to delete
   */
  deleteSession(sessionId: string): void {
    this.vscode.postStrictMessage('chat:deleteSession', {
      sessionId: sessionId as SessionId,
    });
  }

  /**
   * Open session manager UI
   */
  openSessionManager(): void {
    this._showSessionManager.set(true);
  }

  /**
   * Close session manager UI
   */
  closeSessionManager(): void {
    this._showSessionManager.set(false);
  }

  // Message handling methods

  /**
   * Update current message input
   *
   * @param message - The message content
   */
  updateCurrentMessage(message: string): void {
    this._currentMessage.set(message);
  }

  /**
   * Clear current message input
   */
  clearCurrentMessage(): void {
    this._currentMessage.set('');
  }

  /**
   * Update selected agent
   *
   * @param agent - The agent type
   */
  updateSelectedAgent(agent: string): void {
    this._selectedAgent.set(agent);
  }

  /**
   * Get input placeholder text based on selected agent
   *
   * @returns Placeholder text for message input
   */
  getInputPlaceholder(): string {
    const agent = this.selectedAgent();
    switch (agent) {
      case 'code':
        return 'Ask your code expert...';
      case 'architect':
        return 'Discuss system architecture...';
      case 'researcher':
        return 'Request research and analysis...';
      default:
        return 'Ask Claude anything...';
    }
  }

  // Private methods

  /**
   * Setup session handling subscriptions
   */
  private setupSessionHandling(): void {
    // Handle initial data from backend
    this.vscode
      .onMessageType('initialData')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((initialData) => {
        // Type guard for state data
        const stateData = initialData.state as
          | { sessions?: unknown }
          | undefined;
        if (stateData?.sessions && Array.isArray(stateData.sessions)) {
          this._availableSessions.set(
            stateData.sessions as StrictChatSession[]
          );
        }
      });

    // Handle session updates
    this.vscode
      .onMessageType('chat:sessionsUpdated')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload: ChatSessionsUpdatedPayload) => {
        try {
          const sessions = payload.sessions;
          if (!sessions || !Array.isArray(sessions)) {
            this._availableSessions.set([]);
            return;
          }

          // Validate session data
          const safeSessions = sessions.filter((session) => {
            return (
              session &&
              typeof session.id === 'string' &&
              typeof session.name === 'string'
            );
          });

          this._availableSessions.set(safeSessions);

          // Auto-select most recent session if no current session
          const currentSession = this.chatState.currentSession();
          if (!currentSession && safeSessions.length > 0) {
            const mostRecent = safeSessions.reduce((latest, session) => {
              const sessionTime =
                session.lastActiveAt || session.createdAt || 0;
              const latestTime = latest.lastActiveAt || latest.createdAt || 0;
              return sessionTime > latestTime ? session : latest;
            });
            this.switchToSession(mostRecent.id);
          }
        } finally {
          this._isSessionLoading.set(false);
        }
      });

    // Handle session creation
    this.vscode
      .onMessageType('chat:sessionCreated')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload: ChatSessionCreatedPayload) => {
        try {
          const newSession = payload.session;
          if (!newSession || typeof newSession.id !== 'string') {
            return;
          }

          // Add to available sessions
          const currentSessions = this._availableSessions();
          this._availableSessions.set([...currentSessions, newSession]);

          // Switch to the new session
          this.switchToSession(newSession.id);
        } finally {
          this._isSessionLoading.set(false);
        }
      });

    // Handle session switching
    this.vscode
      .onMessageType('chat:sessionSwitched')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload: ChatSessionSwitchedPayload) => {
        // Session switching handled by AppStateManager
        // We just need to update loading state
        this._isSessionLoading.set(false);

        // Close session manager after successful switch
        if (payload.session) {
          this._showSessionManager.set(false);
        }
      });
  }

  /**
   * Fetch available sessions from backend
   * NOTE: There's no 'chat:getSessions' message type in shared
   * Sessions are loaded via 'initialData' message
   */
  private fetchAvailableSessions(): void {
    this._isSessionLoading.set(true);
    // Request initial data which includes sessions
    this.vscode.postStrictMessage('requestInitialData', {});
  }
}
