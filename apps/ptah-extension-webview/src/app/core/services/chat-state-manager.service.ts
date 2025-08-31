import { Injectable, signal, computed, inject } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { StrictChatSession, SessionId } from '@ptah-extension/shared';

/**
 * Chat State Manager Service - Chat-specific State Management
 * Manages sessions, loading states, and chat-specific business logic
 * Extracted from chat component to follow single responsibility principle
 */
@Injectable({
  providedIn: 'root',
})
export class ChatStateManagerService {
  private vscode = inject(VSCodeService);
  private appState = inject(AppStateManager);
  private destroy$ = new Subject<void>();

  // Private signals
  private _availableSessions = signal<StrictChatSession[]>([]);
  private _isSessionLoading = signal(false);
  private _showSessionManager = signal(false);
  private _selectedAgent = signal<string>('general');
  private _currentMessage = signal<string>('');

  // Public readonly signals
  readonly availableSessions = computed(() => {
    const sessions = this._availableSessions();
    return Array.isArray(sessions) ? sessions : [];
  });
  readonly isSessionLoading = this._isSessionLoading.asReadonly();
  readonly showSessionManager = this._showSessionManager.asReadonly();
  readonly selectedAgent = this._selectedAgent.asReadonly();
  readonly currentMessage = this._currentMessage.asReadonly();

  // Computed properties
  readonly agentOptions = computed(() => [
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
    return this.currentMessage().trim().length > 0 && !this.appState.isLoading();
  });

  // Initialize session management
  initialize(): void {
    this.setupSessionHandling();
    this.fetchAvailableSessions();
  }

  // Session management methods
  switchToSession(sessionId: string): void {
    const session = this.availableSessions().find((s) => s.id === sessionId);
    if (!session) return;

    this._isSessionLoading.set(true);
    this.vscode.postMessage({
      type: 'chat:switchSession',
      data: { sessionId },
    });
  }

  createNewSession(sessionName: string): void {
    this._isSessionLoading.set(true);
    this.vscode.postMessage({
      type: 'chat:createSession',
      data: { name: sessionName },
    });
  }

  deleteSession(sessionId: string): void {
    this.vscode.postMessage({
      type: 'chat:deleteSession',
      data: { sessionId },
    });
  }

  openSessionManager(): void {
    this._showSessionManager.set(true);
  }

  closeSessionManager(): void {
    this._showSessionManager.set(false);
  }

  // Message handling
  updateCurrentMessage(message: string): void {
    this._currentMessage.set(message);
  }

  clearCurrentMessage(): void {
    this._currentMessage.set('');
  }

  updateSelectedAgent(agent: string): void {
    this._selectedAgent.set(agent);
  }

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
  private setupSessionHandling(): void {
    // Handle initial data from backend
    this.vscode.onMessageType('initialData').subscribe((initialData) => {
      if (initialData?.data?.sessions) {
        this._availableSessions.set(initialData.data.sessions);
      }
    });

    // Handle session updates
    this.vscode
      .onMessageType('chat:sessionsUpdated')
      .pipe(takeUntil(this.destroy$))
      .subscribe((response) => {
        try {
          const sessions = response?.data?.sessions;
          if (!sessions || !Array.isArray(sessions)) {
            this._availableSessions.set([]);
            return;
          }

          // Validate session data
          const safeSessions = sessions.filter((session) => {
            return session && typeof session.id === 'string' && typeof session.name === 'string';
          });

          this._availableSessions.set(safeSessions);

          // Auto-select most recent session if no current session
          const currentSession = this.appState.currentSession();
          if (!currentSession && safeSessions.length > 0) {
            const mostRecent = safeSessions.reduce((latest, session) => {
              const sessionTime = session.lastActivity || session.createdAt || 0;
              const latestTime = latest.lastActivity || latest.createdAt || 0;
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
      .pipe(takeUntil(this.destroy$))
      .subscribe((response) => {
        try {
          const newSession = response?.data?.session;
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
      .pipe(takeUntil(this.destroy$))
      .subscribe((response) => {
        try {
          const switchedSession = response?.data?.session;
          if (switchedSession) {
            // Session switching handled by AppStateManager
            // We just need to update loading state
          }
        } finally {
          this._isSessionLoading.set(false);
        }
      });
  }

  private fetchAvailableSessions(): void {
    this._isSessionLoading.set(true);
    this.vscode.postMessage({
      type: 'chat:getSessions',
      data: {},
    });
  }

  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
