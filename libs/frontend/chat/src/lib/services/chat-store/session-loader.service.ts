/**
 * SessionLoaderService - Session List Management and Session Switching
 *
 * Extracted from ChatStore to handle session-related operations:
 * - Loading sessions list from backend (with pagination)
 * - Switching sessions via SDK resume flow
 * - Managing session UI state (tabs, loading indicators)
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 *
 * TASK_2025_089 CLEANUP: Removed all message conversion logic.
 * Session switching now uses SDK resume flow (chat:resume RPC), which streams
 * replayed events via chat:chunk. The existing ExecutionTreeBuilder handles
 * all message reconstruction.
 */

import { Injectable, signal, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { ChatSessionSummary, SessionId } from '@ptah-extension/shared';
import { SessionManager } from '../session-manager.service';
import { TabManagerService } from '../tab-manager.service';

@Injectable({ providedIn: 'root' })
export class SessionLoaderService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

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

      const result = await this.claudeRpcService.call('session:list', {
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

      const result = await this.claudeRpcService.call('session:list', {
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
  // SESSION REMOVAL (TASK_2025_086)
  // ============================================================================

  /**
   * Remove a session from the local list (UI only)
   * Called after successful backend deletion to update UI state
   */
  removeSessionFromList(sessionId: SessionId): void {
    this._sessions.update((current) =>
      current.filter((s) => s.id !== sessionId)
    );
    this._totalSessions.update((count) => Math.max(0, count - 1));
    console.log('[SessionLoaderService] Removed session from list:', sessionId);
  }

  // ============================================================================
  // SESSION SWITCHING
  // ============================================================================

  /**
   * Switch to a different session and trigger SDK resume to load history
   *
   * TASK_2025_089: Fixed to use SDK resume flow instead of trying to load
   * messages from session:load. The SDK will stream replayed events via
   * chat:chunk, which the existing ExecutionTreeBuilder will process.
   */
  async switchSession(sessionId: string): Promise<void> {
    try {
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // 1. Validate session exists (metadata only)
      const loadResult = await this.claudeRpcService.call('session:load', {
        sessionId: sessionId as SessionId,
      });

      if (!loadResult.success) {
        console.error('[SessionLoaderService] Session not found:', sessionId);
        return;
      }

      // 2. Get session name from the sessions list (global store)
      const session = this._sessions().find((s) => s.id === sessionId);
      const title = session?.name || sessionId.substring(0, 50);

      // 3. Open/find tab for this session
      const activeTabId = this.tabManager.openSessionTab(sessionId, title);

      // 4. Set tab to resuming state (show loading indicator)
      this.tabManager.updateTab(activeTabId, {
        messages: [],
        streamingState: null,
        status: 'resuming',
        title,
        name: title,
      });

      // 5. Update SessionManager state
      this.sessionManager.setNodeMaps({
        agents: new Map(),
        tools: new Map(),
      });
      this.sessionManager.setSessionId(sessionId);
      this.sessionManager.setStatus('resuming');

      console.log(
        '[SessionLoaderService] Triggering SDK resume for session:',
        sessionId
      );

      // 6. Trigger SDK resume - this streams replayed messages via chat:chunk
      // The existing ExecutionTreeBuilder → ChatStore flow will process them
      const resumeResult = await this.claudeRpcService.call('chat:resume', {
        sessionId: sessionId as SessionId,
        workspacePath,
      });

      if (resumeResult.success) {
        console.log('[SessionLoaderService] SDK resume triggered successfully');
        // Messages will arrive via chat:chunk events and be processed by
        // the existing streaming infrastructure (ExecutionTreeBuilder → ChatStore)
      } else {
        console.error(
          '[SessionLoaderService] Failed to resume session:',
          resumeResult.error
        );
        // Resume failed - revert to loaded state with empty messages
        this.tabManager.updateTab(activeTabId, {
          status: 'loaded',
        });
        this.sessionManager.setStatus('loaded');
      }
    } catch (error) {
      console.error('[SessionLoaderService] Failed to switch session:', error);
    }
  }

  // ============================================================================
  // SESSION CREATION
  // ============================================================================

  /**
   * Create a new session
   * Delegates to SessionManager for session creation logic
   */
  async createNewSession(): Promise<void> {
    // Implementation would go here if needed
    // Currently handled by SessionManager
  }
}
