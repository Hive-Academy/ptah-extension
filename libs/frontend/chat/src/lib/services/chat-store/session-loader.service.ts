/**
 * SessionLoaderService - Session List Management and Pagination
 *
 * Extracted from ChatStore to handle session-related operations:
 * - Loading sessions list from backend
 * - Pagination of sessions
 * - Switching sessions (loading details)
 * - Managing pending session resolutions
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, signal, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ChatSessionSummary,
  SessionId,
  ExecutionChatMessage,
  ExecutionNode,
  createExecutionChatMessage,
  createExecutionNode,
} from '@ptah-extension/shared';
import { SessionManager } from '../session-manager.service';
import { TabManagerService } from '../tab-manager.service';
import { PendingSessionManagerService } from '../pending-session-manager.service';

/**
 * StoredSessionMessage format from SDK backend storage
 * This is the format returned by session:load RPC when using SDK path
 *
 * Note: This replaces the old JSONLMessage format which was used for CLI-based sessions.
 * With the SDK migration, all session storage uses this format.
 */
interface StoredSessionMessage {
  readonly id: string;
  readonly parentId: string | null;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: ExecutionNode[];
  readonly timestamp: number;
  readonly model: string;
  readonly tokens?: { input: number; output: number };
  readonly cost?: number;
}

@Injectable({ providedIn: 'root' })
export class SessionLoaderService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly pendingSessionManager = inject(PendingSessionManagerService);

  // ============================================================================
  // STATE SIGNALS
  // ============================================================================

  private readonly _sessions = signal<readonly ChatSessionSummary[]>([]);
  private readonly _hasMoreSessions = signal(false);
  private readonly _totalSessions = signal(0);
  private readonly _sessionsOffset = signal(0);
  private readonly _isLoadingMoreSessions = signal(false);

  // Page size constant
  private static readonly SESSIONS_PAGE_SIZE = 10;

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly sessions = this._sessions.asReadonly();
  readonly hasMoreSessions = this._hasMoreSessions.asReadonly();
  readonly totalSessions = this._totalSessions.asReadonly();
  readonly isLoadingMoreSessions = this._isLoadingMoreSessions.asReadonly();

  // ============================================================================
  // SESSION LOADING & PAGINATION
  // ============================================================================

  /**
   * Load sessions from backend via RPC (with pagination)
   * Resets pagination and loads first page
   */
  async loadSessions(): Promise<void> {
    try {
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // Reset pagination state
      this._sessionsOffset.set(0);

      const result = await this.claudeRpcService.call<{
        sessions: ChatSessionSummary[];
        total: number;
        hasMore: boolean;
      }>('session:list', {
        workspacePath,
        limit: SessionLoaderService.SESSIONS_PAGE_SIZE,
        offset: 0,
      });

      if (result.success && result.data) {
        this._sessions.set(result.data.sessions);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(result.data.sessions.length);
        console.log(
          '[SessionLoaderService] Loaded sessions:',
          result.data.sessions.length,
          'of',
          result.data.total
        );
      } else {
        console.error(
          '[SessionLoaderService] Failed to load sessions:',
          result.error
        );
      }
    } catch (error) {
      console.error('[SessionLoaderService] Failed to load sessions:', error);
    }
  }

  /**
   * Load more sessions (pagination)
   */
  async loadMoreSessions(): Promise<void> {
    if (!this._hasMoreSessions() || this._isLoadingMoreSessions()) {
      return;
    }

    try {
      this._isLoadingMoreSessions.set(true);

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      const currentOffset = this._sessionsOffset();

      const result = await this.claudeRpcService.call<{
        sessions: ChatSessionSummary[];
        total: number;
        hasMore: boolean;
      }>('session:list', {
        workspacePath,
        limit: SessionLoaderService.SESSIONS_PAGE_SIZE,
        offset: currentOffset,
      });

      if (result.success && result.data) {
        // Append new sessions to existing
        this._sessions.update((current) => [
          ...current,
          ...result.data!.sessions,
        ]);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(currentOffset + result.data.sessions.length);
        console.log(
          '[SessionLoaderService] Loaded more sessions:',
          result.data.sessions.length,
          ', total now:',
          this._sessions().length
        );
      } else {
        console.error(
          '[SessionLoaderService] Failed to load more sessions:',
          result.error
        );
      }
    } catch (error) {
      console.error(
        '[SessionLoaderService] Failed to load more sessions:',
        error
      );
    } finally {
      this._isLoadingMoreSessions.set(false);
    }
  }

  // ============================================================================
  // SESSION SWITCHING
  // ============================================================================

  /**
   * Switch to a different session and load its messages via RPC
   *
   * Uses SDK storage format (StoredSessionMessage[]) which contains
   * already processed ExecutionNodes. This is the only supported format
   * since the SDK migration - the old JSONL format is no longer used.
   */
  async switchSession(sessionId: string): Promise<void> {
    try {
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // Load messages for this session via RPC
      // SDK storage returns StoredSessionMessage[] format
      const result = await this.claudeRpcService.call<{
        sessionId: string;
        messages: StoredSessionMessage[];
        agentSessions?: unknown[]; // Kept for backward compatibility, not used
      }>('session:load', { sessionId, workspacePath });

      if (result.success && result.data) {
        console.log(
          '[SessionLoaderService] Loaded session:',
          result.data.messages.length,
          'messages'
        );

        // Convert SDK storage format to UI display format
        const messages = this.convertStoredMessages(
          result.data.messages,
          sessionId
        );

        // Open or switch to tab for this session (prevents duplicate tabs)
        const title =
          messages[0]?.rawContent?.substring(0, 50) ||
          sessionId.substring(0, 50);
        const activeTabId = this.tabManager.openSessionTab(sessionId, title);

        // Update tab with loaded messages
        this.tabManager.updateTab(activeTabId, {
          messages,
          executionTree: null,
          status: 'loaded',
          title,
        });

        // Update SessionManager state (no node maps needed for SDK storage format)
        this.sessionManager.setNodeMaps({
          agents: new Map(),
          tools: new Map(),
        });
        this.sessionManager.setSessionId(sessionId);
        this.sessionManager.setStatus('loaded');

        console.log(
          '[SessionLoaderService] Loaded',
          messages.length,
          'chat messages'
        );
      } else {
        console.error(
          '[SessionLoaderService] Failed to load session:',
          result.error
        );
      }
    } catch (error) {
      console.error('[SessionLoaderService] Failed to switch session:', error);
    }
  }

  /**
   * Convert StoredSessionMessage[] to ExecutionChatMessage[]
   *
   * StoredSessionMessage format (from SDK storage):
   * - content: ExecutionNode[] (already processed nodes)
   * - role: 'user' | 'assistant' | 'system'
   *
   * ExecutionChatMessage format (for UI display):
   * - executionTree: ExecutionNode | null (single root for assistant)
   * - rawContent: string (for user messages)
   */
  private convertStoredMessages(
    storedMessages: StoredSessionMessage[],
    sessionId: string
  ): ExecutionChatMessage[] {
    // Filter out system role messages (metadata, not chat content)
    const chatMessages = storedMessages.filter(
      (msg) => msg.role === 'user' || msg.role === 'assistant'
    );

    return chatMessages
      .map((stored) => {
        if (stored.role === 'user') {
          // User message: extract text content from ExecutionNode[]
          const textContent = stored.content
            .filter((node) => node.type === 'text')
            .map((node) => node.content || '')
            .join('\n');

          return createExecutionChatMessage({
            id: stored.id,
            role: 'user',
            rawContent: textContent,
            sessionId,
            timestamp: stored.timestamp,
          });
        } else {
          // Assistant message: filter out system type nodes from content
          const filteredContent = stored.content.filter(
            (node) => node.type !== 'system'
          );

          // Only create message if there's actual content
          if (filteredContent.length === 0) {
            return null;
          }

          // Wrap ExecutionNode[] in a root node
          const executionTree = createExecutionNode({
            id: stored.id,
            type: 'message',
            status: 'complete',
            children: filteredContent,
          });

          return createExecutionChatMessage({
            id: stored.id,
            role: 'assistant',
            executionTree,
            sessionId,
            timestamp: stored.timestamp,
            tokens: stored.tokens,
            cost: stored.cost,
          });
        }
      })
      .filter((msg): msg is ExecutionChatMessage => msg !== null);
  }

  // ============================================================================
  // SESSION ID RESOLUTION
  // ============================================================================

  /**
   * Handle session ID resolution from backend
   * Called when backend resolves the real Claude session UUID from SDK streaming
   *
   * Uses PendingSessionManagerService to find the correct tab for resolution.
   * This ensures session:id-resolved goes to the correct tab even if user switches tabs.
   */
  handleSessionIdResolved(
    placeholderSessionId: string,
    actualSessionId: string
  ): void {
    console.log('[SessionLoaderService] Session ID resolved:', {
      placeholderSessionId,
      actualSessionId,
    });

    // Find the tab that initiated this conversation using the pending session manager
    let targetTabId = this.pendingSessionManager.get(placeholderSessionId);

    if (targetTabId) {
      // Remove from pending resolutions (clears timeout)
      this.pendingSessionManager.remove(placeholderSessionId);
      console.log(
        '[SessionLoaderService] Found pending resolution for tab:',
        targetTabId
      );
    } else {
      // Fall back to active tab (for backwards compatibility)
      targetTabId = this.tabManager.activeTabId() ?? undefined;
      console.log(
        '[SessionLoaderService] No pending resolution found, using active tab:',
        targetTabId
      );
    }

    if (!targetTabId) {
      console.warn(
        '[SessionLoaderService] No target tab for session ID resolution'
      );
      return;
    }

    // Get the target tab
    const targetTab = this.tabManager.tabs().find((t) => t.id === targetTabId);
    if (!targetTab) {
      console.warn('[SessionLoaderService] Target tab not found:', targetTabId);
      return;
    }

    if (targetTab.status !== 'draft') {
      console.warn(
        '[SessionLoaderService] Ignoring session ID resolution for non-draft tab',
        { tabId: targetTabId, status: targetTab.status }
      );
      return;
    }

    // Update tab with real session ID AND store placeholder for chunk routing
    this.tabManager.resolveSessionId(targetTabId, actualSessionId);

    // Store placeholder session ID so chunks can still be matched during streaming
    this.tabManager.updateTab(targetTabId, {
      placeholderSessionId: placeholderSessionId,
    });

    // Update messages with real session ID
    const updatedMessages = targetTab.messages.map((msg) => ({
      ...msg,
      sessionId: msg.sessionId === null ? actualSessionId : msg.sessionId,
    }));

    this.tabManager.updateTab(targetTabId, {
      messages: updatedMessages,
    });

    // Update SessionManager - use new confirmSessionId() API
    // Type assertion safe here: actualSessionId is validated by backend and originates from Claude CLI
    this.sessionManager.confirmSessionId(actualSessionId as SessionId);

    console.log('[SessionLoaderService] Session ID resolved for tab:', {
      tabId: targetTabId,
      placeholderSessionId,
      actualSessionId,
    });

    // Refresh session list to show new session in sidebar
    this.loadSessions().catch((err) => {
      console.warn(
        '[SessionLoaderService] Failed to refresh sessions after ID resolution:',
        err
      );
    });
  }
}
