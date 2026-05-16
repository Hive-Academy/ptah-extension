/**
 * SessionLoaderService - Session List Management and Session Switching
 *
 * Extracted from ChatStore to handle session-related operations:
 * - Loading sessions list from backend (with pagination)
 * - Switching sessions via SDK resume flow
 * - Managing session UI state (tabs, loading indicators)
 * - Per-workspace session caching for instant workspace switching
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 *
 * Cleanup note: all message conversion logic has been removed.
 * Session switching now uses SDK resume flow (chat:resume RPC), which streams
 * replayed events via chat:chunk. The existing ExecutionTreeBuilder handles
 * all message reconstruction.
 */

import { Injectable, signal, inject, effect, untracked } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ChatSessionSummary,
  SessionId,
  FlatStreamEventUnion,
  SubagentRecord,
  getModelContextWindow,
} from '@ptah-extension/shared';
import {
  SessionManager,
  StreamingHandlerService,
  AgentMonitorStore,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';

/**
 * Cached session list state for a single workspace.
 * Stored in a per-workspace map so switching between workspaces is instant.
 */
interface CachedSessionState {
  sessions: readonly ChatSessionSummary[];
  totalSessions: number;
  hasMoreSessions: boolean;
  sessionsOffset: number;
}

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
  private readonly _resumableSubagents = signal<SubagentRecord[]>([]);

  /**
   * Tracks which session ID the current _resumableSubagents belong to.
   * Used to clear stale subagents when the active tab changes to a different session.
   */
  private _resumableSubagentsSessionId: string | null = null;

  /**
   * Set of sessionIds currently being loaded via switchSession() or
   * refreshResumableSubagentsForSession(). Prevents duplicate chat:resume
   * calls when the same session is requested while a load is already in
   * progress (e.g., from restored-session effect firing alongside switchSession).
   */
  private readonly _inFlightSessions = new Set<string>();

  // Page size constant
  private static readonly SESSIONS_PAGE_SIZE = 30;

  /**
   * Maximum workspace entries in sessionCache.
   * LRU eviction: oldest by Map insertion order, but never evict the currentWorkspacePath.
   */
  private static readonly MAX_CACHED_WORKSPACES = 10;

  // Debounce timer for coalescing rapid loadSessions() calls
  private loadSessionsTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly LOAD_SESSIONS_DEBOUNCE_MS = 300;

  // ============================================================================
  // PER-WORKSPACE SESSION CACHE
  // ============================================================================

  /**
   * Per-workspace session list cache.
   * Keyed by workspace folder path. Populated on load and updated on mutations.
   * Enables instant workspace switching without backend RPC round-trips.
   */
  private readonly sessionCache = new Map<string, CachedSessionState>();

  /** The workspace path whose sessions are currently displayed in the UI signals. */
  private currentWorkspacePath: string | null = null;

  /**
   * Normalize a workspace path for use as a cache key.
   * Converts backslashes to forward slashes for consistent lookups on Windows
   * where paths may arrive as either `C:\foo` or `C:/foo` from different sources.
   */
  private static normalizeCacheKey(path: string): string {
    return path.replace(/\\/g, '/');
  }

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly sessions = this._sessions.asReadonly();
  readonly hasMoreSessions = this._hasMoreSessions.asReadonly();
  readonly totalSessions = this._totalSessions.asReadonly();
  readonly isLoadingMoreSessions = this._isLoadingMoreSessions.asReadonly();
  readonly resumableSubagents = this._resumableSubagents.asReadonly();

  /** Guard to ensure the restored-session check runs only once */
  private restoredSessionChecked = false;

  constructor() {
    // React to pop-out panel session load requests from TabManagerService.
    // This effect breaks the circular dependency: TabManager emits a signal,
    // SessionLoader consumes it â€” no import from SessionLoader in TabManager.
    effect(() => {
      const sessionId = this.tabManager.pendingSessionLoad();
      if (sessionId) {
        this.tabManager.clearPendingSessionLoad();
        this.switchSession(sessionId);
      }
    });

    // Check for resumable subagents on restored sessions.
    // When VS Code restores the webview from localStorage, TabManager restores
    // tabs + messages without calling switchSession() (no chat:resume fires).
    // This means the backend registry is empty and resumableSubagents is never
    // populated. This one-shot effect fires chat:resume in the background to
    // populate the signal without reloading messages (those are already cached).
    // Use fine-grained selectors instead of activeTab() to avoid re-evaluating
    // ~60 times/sec during streaming (only streamingState changes, not sessionId/status).
    effect(() => {
      const sessionId = this.tabManager.activeTabSessionId();
      const status = this.tabManager.activeTabStatus();
      const tabId = this.tabManager.activeTabId();
      if (
        !this.restoredSessionChecked &&
        sessionId &&
        status === 'loaded' &&
        tabId
      ) {
        this.restoredSessionChecked = true;
        untracked(() =>
          this.refreshResumableSubagentsForSession(sessionId, tabId),
        );
      }
    });

    // Clear stale resumable subagents when the active tab switches to a different session.
    // Without this, interrupted agents from session A leak into session B's banner
    // because _resumableSubagents is a global signal, not tab-scoped.
    effect(() => {
      const activeSessionId = this.tabManager.activeTabSessionId();
      untracked(() => {
        if (activeSessionId !== this._resumableSubagentsSessionId) {
          this._resumableSubagents.set([]);
          this._resumableSubagentsSessionId = activeSessionId ?? null;
        }
      });
    });
  }

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
   * Updates the per-workspace cache after a successful load.
   *
   * Uses currentWorkspacePath (set by switchWorkspace) with a fallback to
   * vscodeService.config().workspaceRoot for backward compatibility (VS Code extension).
   * After the RPC resolves, guards against stale responses: if the active
   * workspace changed during the RPC, the result is discarded.
   */
  private async _loadSessionsImmediate(): Promise<void> {
    try {
      const workspacePath =
        this.currentWorkspacePath || this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // Preserve pagination: reload all items up to the current offset
      // so users don't lose their scrolled-through pages on refresh.
      const currentOffset = this._sessionsOffset();
      const limit = Math.max(
        SessionLoaderService.SESSIONS_PAGE_SIZE,
        currentOffset,
      );

      const result = await this.claudeRpcService.call('session:list', {
        workspacePath,
        limit,
        offset: 0,
      });

      // Guard: if the active workspace changed while the RPC was in flight,
      // discard the stale result to avoid overwriting the correct workspace's data.
      const activeNow =
        this.currentWorkspacePath || this.vscodeService.config().workspaceRoot;
      if (
        activeNow &&
        SessionLoaderService.normalizeCacheKey(activeNow) !==
          SessionLoaderService.normalizeCacheKey(workspacePath)
      ) {
        return;
      }

      if (result.success && result.data) {
        this._sessions.set(result.data.sessions);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(result.data.sessions.length);

        // Update cache for the active workspace
        this.updateCache(workspacePath);
      } else {
        console.error(
          '[SessionLoaderService] Failed to load sessions:',
          result.error,
        );
      }
    } catch (error) {
      console.error('[SessionLoaderService] Failed to load sessions:', error);
    }
  }

  /**
   * Load more sessions (pagination).
   * Updates the per-workspace cache after a successful load.
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
        },
      );

      if (success && data) {
        // Append new sessions to existing
        this._sessions.update((current) => [...current, ...data.sessions]);
        this._totalSessions.set(data.total);
        this._hasMoreSessions.set(data.hasMore);
        this._sessionsOffset.set(currentOffset + data.sessions.length);

        // Update cache with the expanded session list
        this.updateCache(workspacePath);
      } else {
        console.error(
          '[SessionLoaderService] Failed to load more sessions:',
          error,
        );
      }
    } catch (error) {
      console.error(
        '[SessionLoaderService] Failed to load more sessions:',
        error,
      );
    } finally {
      this._isLoadingMoreSessions.set(false);
    }
  }

  // ============================================================================
  // SESSION REMOVAL
  // ============================================================================

  /**
   * Remove a session from the local list (UI only)
   * Called after successful backend deletion to update UI state.
   * Also updates the per-workspace cache.
   */
  removeSessionFromList(sessionId: SessionId): void {
    this._sessions.update((current) =>
      current.filter((s) => s.id !== sessionId),
    );
    this._totalSessions.update((count) => Math.max(0, count - 1));

    // Update cache for the active workspace
    const workspacePath =
      this.currentWorkspacePath || this.vscodeService.config().workspaceRoot;
    if (workspacePath) {
      this.updateCache(workspacePath);
    }
  }

  // ============================================================================
  // SESSION RENAME
  // ============================================================================

  /**
   * Update a session's name in the local list (UI only)
   * Called after successful backend rename to update UI state.
   */
  updateSessionName(sessionId: SessionId, name: string): void {
    this._sessions.update((current) =>
      current.map((s) => (s.id === sessionId ? { ...s, name } : s)),
    );

    // Update cache for the active workspace
    const workspacePath =
      this.currentWorkspacePath || this.vscodeService.config().workspaceRoot;
    if (workspacePath) {
      this.updateCache(workspacePath);
    }
  }

  // ============================================================================
  // WORKSPACE SWITCHING (per-workspace session cache)
  // ============================================================================

  /**
   * Switch the session list to a different workspace.
   *
   * Saves the current session state to the cache under the old workspace path,
   * then either restores from cache (instant, no RPC) or loads from the backend
   * if this workspace hasn't been visited yet.
   *
   * Called by WorkspaceCoordinatorService during workspace switch orchestration.
   *
   * @param newPath - The workspace folder path to switch to
   */
  switchWorkspace(newPath: string): void {
    const normalizedNew = SessionLoaderService.normalizeCacheKey(newPath);

    // No-op if already on this workspace
    if (this.currentWorkspacePath === normalizedNew) return;

    // Save current session state to cache under the old workspace path
    if (this.currentWorkspacePath) {
      this.updateCache(this.currentWorkspacePath);
    }

    this.currentWorkspacePath = normalizedNew;

    // Check cache for the target workspace
    const cached = this.sessionCache.get(normalizedNew);
    if (cached) {
      // LRU refresh — move entry to end of Map insertion order
      this.sessionCache.delete(normalizedNew);
      this.sessionCache.set(normalizedNew, cached);

      // Cache hit â€” restore instantly without RPC
      this._sessions.set(cached.sessions);
      this._totalSessions.set(cached.totalSessions);
      this._hasMoreSessions.set(cached.hasMoreSessions);
      this._sessionsOffset.set(cached.sessionsOffset);
      return;
    }

    // Cache miss â€” clear signals and load from backend using explicit path
    this._sessions.set([]);
    this._totalSessions.set(0);
    this._hasMoreSessions.set(false);
    this._sessionsOffset.set(0);

    // Pass the original (non-normalized) path to the RPC since the backend
    // uses the raw path for filesystem lookups. The cache key is normalized.
    this.loadSessionsForWorkspace(newPath).catch((err) => {
      console.error(
        '[SessionLoaderService] Failed to load sessions for workspace switch:',
        err,
      );
    });
  }

  /**
   * Remove cached session state for a workspace.
   * Called when a workspace folder is removed from the layout.
   */
  removeWorkspaceCache(workspacePath: string): void {
    this.sessionCache.delete(
      SessionLoaderService.normalizeCacheKey(workspacePath),
    );
  }

  // ============================================================================
  // PRIVATE CACHE HELPERS
  // ============================================================================

  /**
   * Snapshot current signal values into the cache for the given workspace path.
   * The path is normalized before use as a cache key.
   *
   * Enforces LRU eviction when cache exceeds MAX_CACHED_WORKSPACES.
   * The currentWorkspacePath is never evicted. On cache hit (re-insert), the entry
   * is moved to the end of Map insertion order (most recently used).
   */
  private updateCache(workspacePath: string): void {
    const key = SessionLoaderService.normalizeCacheKey(workspacePath);

    // Delete-then-set moves the entry to the end of Map insertion order (LRU refresh)
    this.sessionCache.delete(key);
    this.sessionCache.set(key, {
      sessions: this._sessions(),
      totalSessions: this._totalSessions(),
      hasMoreSessions: this._hasMoreSessions(),
      sessionsOffset: this._sessionsOffset(),
    });

    // Evict oldest entries beyond the limit (never evict currentWorkspacePath)
    while (
      this.sessionCache.size > SessionLoaderService.MAX_CACHED_WORKSPACES
    ) {
      let evicted = false;
      for (const candidateKey of this.sessionCache.keys()) {
        if (candidateKey !== this.currentWorkspacePath) {
          this.sessionCache.delete(candidateKey);
          evicted = true;
          break;
        }
      }
      if (!evicted) break; // All remaining entries are protected
    }
  }

  /**
   * Load sessions from backend for a specific workspace path.
   * Used during workspace switch when no cache exists.
   * Uses the explicit path rather than reading from vscodeService.config()
   * because the config may not have been updated yet during switch coordination.
   */
  private async loadSessionsForWorkspace(workspacePath: string): Promise<void> {
    try {
      const normalizedPath =
        SessionLoaderService.normalizeCacheKey(workspacePath);

      const result = await this.claudeRpcService.call('session:list', {
        workspacePath,
        limit: SessionLoaderService.SESSIONS_PAGE_SIZE,
        offset: 0,
      });

      // Guard: if the user switched workspace again while this RPC was in flight,
      // discard the stale result to avoid overwriting the correct workspace's data.
      if (this.currentWorkspacePath !== normalizedPath) return;

      if (result.success && result.data) {
        this._sessions.set(result.data.sessions);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(result.data.sessions.length);

        // Cache the newly loaded data
        this.updateCache(workspacePath);
      } else {
        console.error(
          '[SessionLoaderService] Failed to load sessions for workspace:',
          result.error,
        );
      }
    } catch (error) {
      console.error(
        '[SessionLoaderService] Failed to load sessions for workspace:',
        error,
      );
    }
  }

  // ============================================================================
  // SESSION SWITCHING
  // ============================================================================

  /**
   * Switch to a different session and load its history
   *
   * Processes the `events` array through StreamingHandler to build an
   * ExecutionNode tree with tool calls, thinking blocks, etc.
   *
   * The backend returns FlatStreamEventUnion[] which we process exactly
   * like live streaming events, building the same execution tree.
   */
  async switchSession(sessionId: SessionId): Promise<void> {
    // Guard: prevent duplicate loads of the same session
    if (this._inFlightSessions.has(sessionId)) {
      console.debug(
        '[SessionLoaderService] Skipping duplicate switchSession for:',
        sessionId,
      );
      return;
    }

    try {
      this._inFlightSessions.add(sessionId);
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[SessionLoaderService] No workspace path available');
        return;
      }

      // 1. Validate session exists (metadata only)
      const loadResult = await this.claudeRpcService.call('session:load', {
        sessionId,
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
      this.tabManager.applyResumingSession(activeTabId, {
        sessionId,
        name: title,
        title,
        streamingState: createEmptyStreamingState(),
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
        sessionId,
        tabId: activeTabId,
        workspacePath,
      });

      const events = resumeResult.data?.events;
      const messages = resumeResult.data?.messages;
      const stats = resumeResult.data?.stats;
      // Get resumable subagents for marking interrupted agents
      const resumableSubagents = resumeResult.data?.resumableSubagents;
      // Get CLI sessions for agent monitor display
      const cliSessions = resumeResult.data?.cliSessions;

      // Store preloaded stats and session model for display (old sessions)
      if (stats) {
        this.tabManager.applyLoadedSessionStats(
          activeTabId,
          stats,
          stats.model ?? null,
        );

        // Populate liveModelStats for context usage display.
        // During live streaming this comes from SDK's modelUsage, but when loading
        // from JSONL we compute it from aggregate stats + known context window sizes.
        //
        // IMPORTANT: stats.tokens here are cumulative across the entire session
        // history, not per-turn context fill. For long sessions the cumulative
        // sum will exceed the context window, producing >100% CTX badges.
        // Since lastTurnContextTokens is not available in the resume response,
        // we skip setting liveModelStats when the cumulative sum exceeds the
        // window — the same guard used in session-stats-aggregator.service.ts.
        if (stats.model) {
          const contextWindow = getModelContextWindow(stats.model);
          const contextUsed =
            stats.tokens.input +
            (stats.tokens.cacheRead ?? 0) +
            stats.tokens.output;
          const cumulativeExceedsWindow =
            contextWindow > 0 && contextUsed > contextWindow;

          if (!cumulativeExceedsWindow) {
            const contextPercent =
              contextWindow > 0
                ? Math.round((contextUsed / contextWindow) * 1000) / 10
                : 0;
            this.tabManager.setLiveModelStats(activeTabId, {
              model: stats.model,
              contextUsed,
              contextWindow,
              contextPercent,
            });
          }
        }

        // Populate modelUsageList from backend per-model breakdown.
        // This enables the per-model breakdown table in SessionStatsSummary for old sessions.
        if (stats.modelUsageList && stats.modelUsageList.length > 0) {
          const backendModelList = stats.modelUsageList;
          this.tabManager.setModelUsageList(
            activeTabId,
            backendModelList.map((entry) => ({
              ...entry,
              contextWindow: getModelContextWindow(entry.model),
            })),
          );
        }
      }

      // Process events to build execution tree with tool calls
      if (resumeResult.success && events && events.length > 0) {
        // Process each event through StreamingHandler to build execution tree
        // This populates the streamingState with all events
        for (const event of events) {
          this.streamingHandler.processStreamEvent(
            event as FlatStreamEventUnion,
            activeTabId,
            sessionId,
          );
        }

        // Finalize session history - builds messages for ALL messages in history.
        // Pass resumableSubagents so interrupted agents are marked.
        this.streamingHandler.finalizeSessionHistory(
          activeTabId,
          resumableSubagents,
        );

        this.sessionManager.setStatus('loaded');

        // Populate resumableSubagents signal for the banner UI
        this._resumableSubagents.set(resumableSubagents ?? []);
        this._resumableSubagentsSessionId = sessionId;

        // Load CLI sessions into agent monitor panel
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
        this.tabManager.applyResumedHistory(activeTabId, executionMessages);
        this.sessionManager.setStatus('loaded');

        // Set resumableSubagents from chat:resume response (empty for simple-message sessions)
        this._resumableSubagents.set(resumableSubagents ?? []);
        this._resumableSubagentsSessionId = sessionId;

        // Also load CLI sessions in fallback branch
        if (cliSessions && cliSessions.length > 0) {
          this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
        }
      } else {
        console.error(
          '[SessionLoaderService] Failed to resume session:',
          resumeResult.error || 'No messages or events found',
        );
        // Resume failed - revert to loaded state with empty messages
        this.tabManager.applyResumeFailure(activeTabId);
        this.sessionManager.setStatus('loaded');

        // No resumable subagents on error/empty session
        this._resumableSubagents.set([]);
        this._resumableSubagentsSessionId = sessionId;
      }
    } catch (error) {
      console.error('[SessionLoaderService] Failed to switch session:', error);
      // Clear stale resumable subagents from previous session on switch failure
      this._resumableSubagents.set([]);
      this._resumableSubagentsSessionId = null;
    } finally {
      this._inFlightSessions.delete(sessionId);
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
        error,
      );
    }
  }

  // ============================================================================
  // RESUMABLE SUBAGENTS
  // ============================================================================

  /**
   * Clear the resumable subagents signal.
   *
   * Called when the user sends a message that triggers context injection
   * (chat:continue), so the banner dismisses immediately at turn start.
   * The backend auto-injects interrupted agent context into the prompt
   * and clears them from the registry, so the frontend should mirror this.
   */
  clearResumableSubagents(): void {
    this._resumableSubagents.set([]);
  }

  /**
   * Remove a single resumable subagent by toolCallId.
   *
   * Called when the user resumes one specific agent so that only that
   * agent is removed from the banner while others remain visible.
   */
  removeResumableSubagent(toolCallId: string): void {
    this._resumableSubagents.update((agents) =>
      agents.filter((a) => a.toolCallId !== toolCallId),
    );
  }

  /**
   * Lightweight check for resumable subagents on a restored session.
   * Calls chat:resume to populate the backend registry and extract resumableSubagents
   * without reloading the tab's messages (already cached from localStorage).
   */
  private async refreshResumableSubagentsForSession(
    sessionId: SessionId,
    tabId: string,
  ): Promise<void> {
    // Skip if switchSession is already loading this session
    if (this._inFlightSessions.has(sessionId)) {
      return;
    }

    try {
      this._inFlightSessions.add(sessionId);
      const workspacePath = this.vscodeService.config().workspaceRoot;
      const result = await this.claudeRpcService.call('chat:resume', {
        sessionId,
        tabId,
        workspacePath,
      });

      const resumableSubagents = result.data?.resumableSubagents;
      if (resumableSubagents && resumableSubagents.length > 0) {
        this._resumableSubagents.set(resumableSubagents);
        this._resumableSubagentsSessionId = sessionId;
        console.log(
          '[SessionLoaderService] Populated resumableSubagents for restored session',
          { sessionId, count: resumableSubagents.length },
        );
      }
    } catch (error) {
      console.warn(
        '[SessionLoaderService] Failed to check resumable subagents for restored session',
        error,
      );
    } finally {
      this._inFlightSessions.delete(sessionId);
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
