/**
 * ChatStoreService - PURGED for TASK_2025_023
 *
 * Will be rebuilt in Batch 5 with:
 * - 4 signals: sessions, currentSessionId, executionTree, isStreaming
 * - JSONL → ExecutionNode mapping
 * - Simple actions: loadSessions, switchSession, sendMessage
 */

import { Injectable, signal, computed } from '@angular/core';
import {
  SessionSummary,
  SessionId,
  StrictChatMessage,
} from '@ptah-extension/shared';

/**
 * TEMPORARY: Minimal ChatStoreService shell
 * Full implementation in Batch 5
 */
@Injectable({ providedIn: 'root' })
export class ChatStoreService {
  // Minimal signals for build compatibility
  private readonly _sessions = signal<readonly SessionSummary[]>([]);
  private readonly _currentSessionId = signal<SessionId | null>(null);
  private readonly _messages = signal<readonly StrictChatMessage[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Public read-only signals
  readonly sessions = this._sessions.asReadonly();
  readonly currentSession = computed(() => {
    const id = this._currentSessionId();
    return id ? this._sessions().find((s) => s.id === id) ?? null : null;
  });
  readonly messages = this._messages.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  // STUB methods - will be implemented in Batch 5
  async loadSessions(): Promise<void> {
    console.warn(
      '[ChatStoreService] STUB - loadSessions() not implemented (TASK_2025_023)'
    );
    this._sessions.set([]);
  }

  async switchSession(sessionId: SessionId): Promise<void> {
    console.warn(
      '[ChatStoreService] STUB - switchSession() not implemented (TASK_2025_023)',
      { sessionId }
    );
    this._currentSessionId.set(sessionId);
  }

  async sendMessage(content: string, files?: string[]): Promise<void> {
    console.warn(
      '[ChatStoreService] STUB - sendMessage() not implemented (TASK_2025_023)',
      { content, files }
    );
  }

  async createNewSession(name?: string): Promise<SessionId | null> {
    console.warn(
      '[ChatStoreService] STUB - createNewSession() not implemented (TASK_2025_023)',
      { name }
    );
    return null;
  }

  clearError(): void {
    this._error.set(null);
  }
}
