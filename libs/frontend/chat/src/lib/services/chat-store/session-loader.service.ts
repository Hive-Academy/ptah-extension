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
import {
  ChatSessionSummary,
  SessionId,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { SessionManager } from '../session-manager.service';
import { TabManagerService } from '../tab-manager.service';
import { StreamingHandlerService } from './streaming-handler.service';
import { AgentMonitorStore } from '../agent-monitor.store';
import { createEmptyStreamingState } from '../chat.types';

@Injectable({ providedIn: 'root' })
export class SessionLoaderService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly agentMonitorStore = inject(AgentMonitorStore);

  // ============================================================================
  // STATE SIGNALS
  // ============================================================================

  private readonly _sessions = signal<readonly ChatSessionSummary[]>([]);
  private readonly _hasMoreSessions = signal(false);
  private readonly _totalSessions = signal(0);
  private readonly _sessionsOffset = signal(0);
  private readonly _isLoadingMoreSessions = signal(false);

  // Page size constant
  private static readonly SESSIONS_PAGE_SIZE = 30;

  // Debounce timer for coalescing rapid loadSessions() calls
  private loadSessionsTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly LOAD_SESSIONS_DEBOUNCE_MS = 300;

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
   * Debounced (300ms) to coalesce rapid calls (e.g. SESSION_ID_RESOLVED + SESSION_STATS).
   * Preserves pagination: reloads all pages up to the current offset instead of resetting to page 1.
   */
  async loadSessions(): Promise<void> {
    // Cancel any pending debounced call
    if (this.loadSessionsTimer) {
      clearTimeout(this.loadSessionsTimer);
    }

    return new Promise<void>((resolve, reject) => {
      this.loadSessionsTimer = setTimeout(async () => {
        this.loadSessionsTimer = null;
        try {
          await this._loadSessionsImmediate();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, SessionLoaderService.LOAD_SESSIONS_DEBOUNCE_MS);
    });
  }

  /**
   * Internal: Perform the actual session list RPC call.
   * Preserves pagination by loading all items up to the current offset.
   */
  private async _loadSessionsImmediate(): Promise<void> {
    try {
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // Preserve pagination: reload all items up to the current offset
      // so users don't lose their scrolled-through pages on refresh.
      const currentOffset = this._sessionsOffset();
      const limit = Math.max(
        SessionLoaderService.SESSIONS_PAGE_SIZE,
        currentOffset
      );

      const result = await this.claudeRpcService.call('session:list', {
        workspacePath,
        limit,
        offset: 0,
      });

      if (result.success && result.data) {
        this._sessions.set(result.data.sessions);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(result.data.sessions.length);
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

      const { success, data, error } = await this.claudeRpcService.call(
        'session:list',
        {
          workspacePath,
          limit: SessionLoaderService.SESSIONS_PAGE_SIZE,
          offset: currentOffset,
        }
      );

      if (success && data) {
        // Append new sessions to existing
        this._sessions.update((current) => [...current, ...data.sessions]);
        this._totalSessions.set(data.total);
        this._hasMoreSessions.set(data.hasMore);
        this._sessionsOffset.set(currentOffset + data.sessions.length);
      } else {
        console.error(
          '[SessionLoaderService] Failed to load more sessions:',
          error
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
  }

  // ============================================================================
  // SESSION SWITCHING
  // ============================================================================

  /**
   * Switch to a different session and load its history
   *
   * TASK_2025_092 FIX: Now processes `events` array through StreamingHandler
   * to build ExecutionNode tree with tool calls, thinking blocks, etc.
   *
   * The backend returns FlatStreamEventUnion[] which we process exactly
   * like live streaming events, building the same execution tree.
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
        streamingState: createEmptyStreamingState(),
        status: 'resuming',
        title,
        name: title,
        claudeSessionId: sessionId,
      });

      // 5. Update SessionManager state
      this.sessionManager.setNodeMaps({
        agents: new Map(),
        tools: new Map(),
      });
      this.sessionManager.setSessionId(sessionId);
      this.sessionManager.setStatus('resuming');

      // 5.1. CRITICAL: Clear deduplication state before processing history events
      // Without this, processedMessageIds/processedToolCallIds from previous loads
      // would cause all events to be rejected as "duplicates"
      this.streamingHandler.cleanupSessionDeduplication(sessionId);

      // 6. Load history via RPC - returns events for execution tree
      const resumeResult = await this.claudeRpcService.call('chat:resume', {
        sessionId: sessionId as SessionId,
        tabId: activeTabId,
        workspacePath,
      });

      const events = resumeResult.data?.events;
      const messages = resumeResult.data?.messages;
      const stats = resumeResult.data?.stats;
      // TASK_2025_103 FIX: Get resumable subagents for marking interrupted agents
      const resumableSubagents = resumeResult.data?.resumableSubagents;
      // TASK_2025_168: Get CLI sessions for agent monitor display
      const cliSessions = resumeResult.data?.cliSessions;

      // Store preloaded stats and session model for display (old sessions)
      if (stats) {
        this.tabManager.updateTab(activeTabId, {
          preloadedStats: stats,
          sessionModel: stats.model ?? null,
        });
      }

      // TASK_2025_092 FIX: Process events to build execution tree with tool calls
      if (resumeResult.success && events && events.length > 0) {
        // Process each event through StreamingHandler to build execution tree
        // This populates the streamingState with all events
        for (const event of events) {
          this.streamingHandler.processStreamEvent(
            event as FlatStreamEventUnion,
            activeTabId,
            sessionId
          );
        }

        // Finalize session history - builds messages for ALL messages in history
        // TASK_2025_103 FIX: Pass resumableSubagents so interrupted agents are marked
        this.streamingHandler.finalizeSessionHistory(
          activeTabId,
          resumableSubagents
        );

        this.sessionManager.setStatus('loaded');

        // TASK_2025_168: Load CLI sessions into agent monitor panel
        if (cliSessions && cliSessions.length > 0) {
          this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
        }
      } else if (resumeResult.success && messages && messages.length > 0) {
        // Fallback: Use simple messages if no events (backward compatibility)
        // Convert simple messages to ExecutionChatMessage format
        const executionMessages = messages.map((msg) => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant',
          timestamp: msg.timestamp,
          streamingState: null, // No execution tree for simple messages
          rawContent: msg.content,
          sessionId,
        }));

        // Set messages directly on tab
        this.tabManager.updateTab(activeTabId, {
          messages: executionMessages,
          status: 'loaded',
          streamingState: null,
        });
        this.sessionManager.setStatus('loaded');

        // TASK_2025_168: Also load CLI sessions in fallback branch
        if (cliSessions && cliSessions.length > 0) {
          this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
        }
      } else {
        console.error(
          '[SessionLoaderService] Failed to resume session:',
          resumeResult.error || 'No messages or events found'
        );
        // Resume failed - revert to loaded state with empty messages
        this.tabManager.updateTab(activeTabId, {
          status: 'loaded',
          streamingState: null,
        });
        this.sessionManager.setStatus('loaded');
      }
    } catch (error) {
      console.error('[SessionLoaderService] Failed to switch session:', error);
    }
  }

  // ============================================================================
  // CLI SESSION RESTORATION (on webview reopen)
  // ============================================================================

  /**
   * Restore CLI agent sessions for the active tab after webview reopens.
   *
   * When the webview is first opened, tabs are restored from localStorage with
   * messages intact, but AgentMonitorStore starts empty. This method fetches
   * CLI sessions from the backend metadata for the active tab's session and
   * loads them into the agent monitor panel.
   */
  async restoreCliSessionsForActiveTab(): Promise<void> {
    try {
      const activeTab = this.tabManager.activeTab();
      const sessionId = activeTab?.claudeSessionId;
      if (!sessionId) return;

      const result = await this.claudeRpcService.call('session:cli-sessions', {
        sessionId,
      });

      const cliSessions = result.data?.cliSessions;
      if (result.success && cliSessions && cliSessions.length > 0) {
        this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
      }
    } catch (error) {
      console.warn(
        '[SessionLoaderService] Failed to restore CLI sessions:',
        error
      );
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
