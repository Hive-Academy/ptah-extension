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
import { ChatSessionSummary, JSONLMessage } from '@ptah-extension/shared';
import { SessionReplayService } from '../session-replay.service';
import { SessionManager } from '../session-manager.service';
import { TabManagerService } from '../tab-manager.service';
import { PendingSessionManagerService } from '../pending-session-manager.service';

@Injectable({ providedIn: 'root' })
export class SessionLoaderService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly sessionReplay = inject(SessionReplayService);
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
   */
  async switchSession(sessionId: string): Promise<void> {
    try {
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // Load messages for this session via RPC
      const result = await this.claudeRpcService.call<{
        sessionId: string;
        messages: JSONLMessage[];
        agentSessions?: Array<{ agentId: string; messages: JSONLMessage[] }>;
      }>('session:load', { sessionId, workspacePath });

      if (result.success && result.data) {
        console.log(
          '[SessionLoaderService] Loaded session:',
          result.data.messages.length,
          'messages,',
          result.data.agentSessions?.length ?? 0,
          'agent sessions'
        );

        // Use SessionReplayService to process JSONL messages
        const { messages, nodeMaps } = this.sessionReplay.replaySession(
          result.data.messages,
          result.data.agentSessions ?? []
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

        // Update SessionManager with node maps and state
        this.sessionManager.setNodeMaps(nodeMaps);
        this.sessionManager.setSessionId(sessionId);
        this.sessionManager.setStatus('loaded');

        console.log(
          '[SessionLoaderService] Processed into',
          messages.length,
          'chat messages,',
          nodeMaps.agents.size,
          'agents registered,',
          nodeMaps.tools.size,
          'tools registered'
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

  // ============================================================================
  // SESSION ID RESOLUTION
  // ============================================================================

  /**
   * Handle session ID resolution from backend
   * Called when backend extracts real Claude CLI session UUID from JSONL stream
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

    // Update tab with real session ID
    this.tabManager.resolveSessionId(targetTabId, actualSessionId);

    // Update messages with real session ID
    const updatedMessages = targetTab.messages.map((msg) => ({
      ...msg,
      sessionId: msg.sessionId === null ? actualSessionId : msg.sessionId,
    }));

    this.tabManager.updateTab(targetTabId, {
      messages: updatedMessages,
    });

    // Update SessionManager - use new confirmSessionId() API
    this.sessionManager.confirmSessionId(actualSessionId as any);

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
