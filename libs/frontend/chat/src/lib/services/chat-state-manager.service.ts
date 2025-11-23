import { computed, inject, Injectable, signal } from '@angular/core';
import { AppStateManager, ChatStateService } from '@ptah-extension/core';
import { StrictChatSession } from '@ptah-extension/shared';

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
  private readonly appState = inject(AppStateManager);
  private readonly chatState = inject(ChatStateService);

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
}
