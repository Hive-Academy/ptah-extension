import { Injectable, inject, signal } from '@angular/core';
import { ClaudeFileService, ClaudeRpcService } from '@ptah-extension/core';
import {
  SessionSummary,
  StrictChatSession,
  SessionId,
  StrictChatMessage,
} from '@ptah-extension/shared';

/**
 * ChatStoreService - Signal-based chat state management
 *
 * Replaces the old orchestration services + event subscriptions (deleted in Phase 0).
 * Instead of event-driven state updates, we use signals + direct RPC calls.
 *
 * State Flow:
 * 1. Component calls chatStore.loadSessions()
 * 2. chatStore calls rpcService.listSessions()
 * 3. chatStore updates _sessions signal
 * 4. Component signal subscription auto-updates UI
 *
 * Benefits:
 * - No event subscriptions (signals auto-track dependencies)
 * - No caching layers (read .jsonl files directly)
 * - Type-safe (signals are strongly typed)
 * - Simple (no orchestration services)
 */
@Injectable({ providedIn: 'root' })
export class ChatStoreService {
  private readonly fileService = inject(ClaudeFileService);
  private readonly rpcService = inject(ClaudeRpcService);

  // Private writable signals (internal state)
  private readonly _sessions = signal<SessionSummary[]>([]);
  private readonly _currentSession = signal<StrictChatSession | null>(null);
  private readonly _messages = signal<StrictChatMessage[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Public read-only signals (exposed to components)
  readonly sessions = this._sessions.asReadonly();
  readonly currentSession = this._currentSession.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Load all sessions from backend
   * Uses RPC to get session list
   */
  async loadSessions(): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const result = await this.rpcService.listSessions();

      if (result.success && result.data) {
        this._sessions.set(result.data);
      } else {
        this._error.set(result.error || 'Failed to load sessions');
      }
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Switch to a different session
   * Reads messages directly from .jsonl file (no backend cache)
   */
  async switchSession(sessionId: SessionId): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      // Read session messages directly from file
      const messages = await this.fileService.readSessionFile(sessionId);

      // Find session metadata
      const sessionMeta = this._sessions().find((s) => s.id === sessionId);

      // Build session object
      const session: StrictChatSession = {
        id: sessionId,
        name: sessionMeta?.name || 'Untitled Session',
        workspaceId: 'current', // TODO: Get from workspace context
        messages,
        createdAt: sessionMeta?.createdAt || Date.now(),
        lastActiveAt: sessionMeta?.lastActiveAt || Date.now(),
        updatedAt: sessionMeta?.lastActiveAt || Date.now(), // Alias
        messageCount: messages.length,
        tokenUsage: {
          input: 0, // TODO: Calculate from messages
          output: 0,
          total: 0,
          percentage: 0,
        },
      };

      // Update signals
      this._currentSession.set(session);
      this._messages.set(messages);

      // Notify backend of session switch (for state tracking)
      const result = await this.rpcService.switchSession(sessionId);

      if (!result.success) {
        console.warn('Backend session switch failed:', result.error);
        // Don't set error - frontend state is still valid
      }
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Send a message in current session
   * Backend spawns Claude CLI and writes response to .jsonl file
   */
  async sendMessage(content: string, files?: string[]): Promise<void> {
    const currentSession = this._currentSession();
    if (!currentSession) {
      this._error.set('No active session');
      return;
    }

    this._isLoading.set(true);
    this._error.set(null);

    try {
      // Send via RPC (backend will spawn Claude CLI and write to .jsonl)
      const result = await this.rpcService.sendMessage(content, files);

      if (!result.success) {
        this._error.set(result.error || 'Failed to send message');
      }

      // Note: We do NOT update _messages here
      // Backend writes to .jsonl, we'll re-read file to get response
      // TODO: Implement streaming updates in Phase 3
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Create a new session
   * Returns new session ID on success
   */
  async createNewSession(name?: string): Promise<SessionId | null> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const result = await this.rpcService.createSession(name);

      if (result.success && result.data) {
        // Reload sessions to include new one
        await this.loadSessions();
        return result.data;
      } else {
        this._error.set(result.error || 'Failed to create session');
        return null;
      }
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Find session name from session list
   * @param sessionId - Session ID to find
   * @returns Session name or 'Untitled Session'
   */
  private findSessionName(sessionId: SessionId): string {
    const session = this._sessions().find((s) => s.id === sessionId);
    return session?.name || 'Untitled Session';
  }

  /**
   * Clear error state
   */
  clearError(): void {
    this._error.set(null);
  }

  /**
   * Refresh current session (re-read messages from file)
   * Useful after backend writes new messages
   */
  async refreshCurrentSession(): Promise<void> {
    const current = this._currentSession();
    if (current) {
      await this.switchSession(current.id);
    }
  }
}
