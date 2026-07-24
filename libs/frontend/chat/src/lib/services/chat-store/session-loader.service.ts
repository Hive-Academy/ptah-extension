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
  private static readonly SESSIONS_PAGE_SIZE = 30;

  /**
   * Maximum workspace entries in sessionCache.
   * LRU eviction: oldest by Map insertion order, but never evict the currentWorkspacePath.
   */
  private static readonly MAX_CACHED_WORKSPACES = 10;
  private loadSessionsTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly LOAD_SESSIONS_DEBOUNCE_MS = 300;

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

  readonly sessions = this._sessions.asReadonly();
  readonly hasMoreSessions = this._hasMoreSessions.asReadonly();
  readonly totalSessions = this._totalSessions.asReadonly();
  readonly isLoadingMoreSessions = this._isLoadingMoreSessions.asReadonly();
  readonly resumableSubagents = this._resumableSubagents.asReadonly();

  /** Guard to ensure the restored-session check runs only once */
  private restoredSessionChecked = false;

  constructor() {
    effect(() => {
      const sessionId = this.tabManager.pendingSessionLoad();
      if (sessionId) {
        this.tabManager.clearPendingSessionLoad();
        this.switchSession(sessionId);
      }
    });
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

  /**
   * Load sessions from backend via RPC (with pagination)
   * Debounced (300ms) to coalesce rapid calls (e.g. SESSION_ID_RESOLVED + SESSION_STATS).
   * Preserves pagination: reloads all pages up to the current offset instead of resetting to page 1.
   */
  async loadSessions(): Promise<void> {
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
        this._sessions.update((current) => [...current, ...data.sessions]);
        this._totalSessions.set(data.total);
        this._hasMoreSessions.set(data.hasMore);
        this._sessionsOffset.set(currentOffset + data.sessions.length);
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
    const workspacePath =
      this.currentWorkspacePath || this.vscodeService.config().workspaceRoot;
    if (workspacePath) {
      this.updateCache(workspacePath);
    }
  }

  /**
   * Update a session's name in the local list (UI only)
   * Called after successful backend rename to update UI state.
   */
  updateSessionName(sessionId: SessionId, name: string): void {
    this._sessions.update((current) =>
      current.map((s) => (s.id === sessionId ? { ...s, name } : s)),
    );
    const workspacePath =
      this.currentWorkspacePath || this.vscodeService.config().workspaceRoot;
    if (workspacePath) {
      this.updateCache(workspacePath);
    }
  }

  /**
   * Insert or replace a session summary in the local list (UI only), without
   * an RPC round-trip. Used by the rewind flow to surface the freshly-forked
   * session in the sidebar immediately — the debounced
   * `session:metadataChanged` → `loadSessions()` broadcast can otherwise race
   * and run before the fork is listable by `session:list`, leaving the sidebar
   * empty until an app restart. The subsequent broadcast-driven `loadSessions()`
   * reconciles with the persisted truth (same id, refreshed counts).
   *
   * Replaces an existing entry with the same id in place; otherwise prepends
   * the new entry and increments the total. Mirrors `updateSessionName` /
   * `removeSessionFromList`.
   */
  upsertSessionSummary(summary: ChatSessionSummary): void {
    let inserted = false;
    this._sessions.update((current) => {
      const idx = current.findIndex((s) => s.id === summary.id);
      if (idx === -1) {
        inserted = true;
        return [summary, ...current];
      }
      const next = current.slice();
      next[idx] = summary;
      return next;
    });
    if (inserted) {
      this._totalSessions.update((count) => count + 1);
    }
    const workspacePath =
      this.currentWorkspacePath || this.vscodeService.config().workspaceRoot;
    if (workspacePath) {
      this.updateCache(workspacePath);
    }
  }

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
    if (this.currentWorkspacePath === normalizedNew) return;
    if (this.currentWorkspacePath) {
      this.updateCache(this.currentWorkspacePath);
    }

    this.currentWorkspacePath = normalizedNew;
    const cached = this.sessionCache.get(normalizedNew);
    if (cached) {
      this.sessionCache.delete(normalizedNew);
      this.sessionCache.set(normalizedNew, cached);
      this._sessions.set(cached.sessions);
      this._totalSessions.set(cached.totalSessions);
      this._hasMoreSessions.set(cached.hasMoreSessions);
      this._sessionsOffset.set(cached.sessionsOffset);
      return;
    }
    this._sessions.set([]);
    this._totalSessions.set(0);
    this._hasMoreSessions.set(false);
    this._sessionsOffset.set(0);
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
    this.sessionCache.delete(key);
    this.sessionCache.set(key, {
      sessions: this._sessions(),
      totalSessions: this._totalSessions(),
      hasMoreSessions: this._hasMoreSessions(),
      sessionsOffset: this._sessionsOffset(),
    });
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
      if (this.currentWorkspacePath !== normalizedPath) return;

      if (result.success && result.data) {
        this._sessions.set(result.data.sessions);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(result.data.sessions.length);
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

  /**
   * Switch to a different session and load its history
   *
   * Processes the `events` array through StreamingHandler to build an
   * ExecutionNode tree with tool calls, thinking blocks, etc.
   *
   * The backend returns FlatStreamEventUnion[] which we process exactly
   * like live streaming events, building the same execution tree.
   */
  async switchSession(
    sessionId: SessionId,
    opts?: { reason?: 'compaction'; activate?: boolean },
  ): Promise<void> {
    if (this._inFlightSessions.has(sessionId)) {
      console.debug(
        '[SessionLoaderService] Skipping duplicate switchSession for:',
        sessionId,
      );
      return;
    }

    const existingTab = this.tabManager.findTabBySessionId(sessionId);
    if (opts?.reason !== 'compaction' && existingTab?.hasLiveSession) {
      const inActiveWorkspace = this.tabManager
        .tabs()
        .some((t) => t.id === existingTab.id);
      if (inActiveWorkspace) {
        this.tabManager.switchTab(existingTab.id);
        return;
      }
    }

    this._inFlightSessions.add(sessionId);
    try {
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        throw new Error(
          '[SessionLoaderService] No workspace path available for switchSession',
        );
      }
      const loadResult = await this.claudeRpcService.call('session:load', {
        sessionId,
      });

      if (!loadResult.success) {
        throw new Error(
          `[SessionLoaderService] session:load failed for ${sessionId}: ${
            loadResult.error ?? 'session not found'
          }`,
        );
      }
      const session = this._sessions().find((s) => s.id === sessionId);
      // Prefer the session-list name, then the existing tab's name (set by the
      // rewind rebind before this call), and only fall back to the raw session
      // id as a last resort. The bare-id fallback was the source of the
      // raw-UUID tab/tile title after a rewind fork (the forked session is not
      // yet in `_sessions()`).
      const title =
        session?.name || existingTab?.name || sessionId.substring(0, 50);
      const activeTabId = this.tabManager.openSessionTab(sessionId, title);

      // [compaction-diag] TEMPORARY — remove after the 2-tile stale-transcript
      // repro is confirmed. Reveals the RELOAD TARGET: for a compaction reload,
      // `openSessionTab(sessionId)` re-derives the tab from the session id. If
      // `activeTabId` here does NOT equal the tile that was cleared in
      // `handleCompactionComplete`, the reload is writing history into the
      // wrong tab and the compacted tile stays stale.
      if (opts?.reason === 'compaction') {
        console.warn('[compaction-diag] switchSession reload target', {
          requestedSessionId: sessionId,
          resolvedTabId: activeTabId,
          existingTabId: existingTab?.id ?? null,
          openTabsForSession: this.tabManager
            .tabs()
            .filter((t) => t.claudeSessionId === sessionId)
            .map((t) => t.id),
        });
      }
      this.tabManager.applyResumingSession(activeTabId, {
        sessionId,
        name: title,
        title,
        streamingState: createEmptyStreamingState(),
      });
      this.sessionManager.setNodeMaps(
        {
          agents: new Map(),
          tools: new Map(),
        },
        sessionId,
      );
      this.sessionManager.setSessionId(sessionId);
      this.sessionManager.setStatus('resuming');
      this.streamingHandler.cleanupSessionDeduplication(sessionId);
      const resumeResult = await this.claudeRpcService.call('chat:resume', {
        sessionId,
        tabId: activeTabId,
        workspacePath,
        ...(opts?.activate === true ? { activate: true } : {}),
      });
      if (opts?.activate === true && resumeResult.data?.activated === true) {
        this.tabManager.markSessionActive(activeTabId);
      }

      const events = resumeResult.data?.events;
      const messages = resumeResult.data?.messages;
      const stats = resumeResult.data?.stats;
      const resumableSubagents = resumeResult.data?.resumableSubagents;
      const cliSessions = resumeResult.data?.cliSessions;
      if (stats) {
        this.tabManager.applyLoadedSessionStats(
          activeTabId,
          stats,
          stats.model ?? null,
        );
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
      } else {
        this.tabManager.setPreloadedStats(activeTabId, null);
        this.tabManager.setLiveModelStats(activeTabId, null);
        this.tabManager.setModelUsageList(activeTabId, []);
      }
      if (resumeResult.success && events && events.length > 0) {
        for (const event of events) {
          this.streamingHandler.processStreamEvent(
            event as FlatStreamEventUnion,
            activeTabId,
            sessionId,
            { isReplay: true },
          );
        }
        this.streamingHandler.finalizeSessionHistory(
          activeTabId,
          resumableSubagents,
        );

        this.sessionManager.setStatus('loaded');
        this._resumableSubagents.set(resumableSubagents ?? []);
        this._resumableSubagentsSessionId = sessionId;
        if (cliSessions && cliSessions.length > 0) {
          this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
        }
      } else if (resumeResult.success && messages && messages.length > 0) {
        const executionMessages = messages.map((msg) => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant',
          timestamp: msg.timestamp,
          streamingState: null,
          rawContent: msg.content,
          sessionId,
        }));
        this.tabManager.applyResumedHistory(activeTabId, executionMessages);
        this.sessionManager.setStatus('loaded');
        this._resumableSubagents.set(resumableSubagents ?? []);
        this._resumableSubagentsSessionId = sessionId;
        if (cliSessions && cliSessions.length > 0) {
          this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
        }
      } else {
        this.tabManager.applyResumeFailure(activeTabId);
        this.sessionManager.setStatus('loaded');
        this._resumableSubagents.set([]);
        this._resumableSubagentsSessionId = sessionId;
        throw new Error(
          `[SessionLoaderService] chat:resume failed for ${sessionId}: ${
            resumeResult.error ?? 'No messages or events found'
          }`,
        );
      }
    } catch (error: unknown) {
      this._resumableSubagents.set([]);
      this._resumableSubagentsSessionId = null;
      throw error;
    } finally {
      this._inFlightSessions.delete(sessionId);
    }
  }

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
   * Replace the resumable subagents signal for a session.
   *
   * Called after a live abort (chat:abort) returns the subagents it
   * interrupted, so the resume banner appears without reloading the session.
   */
  setResumableSubagents(agents: SubagentRecord[], sessionId: string): void {
    this._resumableSubagents.set(agents);
    this._resumableSubagentsSessionId = sessionId;
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

      // Repopulate the agent-monitor sidebar for a restored session. The
      // chat:resume payload carries the full (unfiltered) CLI session list,
      // unlike the session:cli-sessions endpoint used by
      // restoreCliSessionsForActiveTab() which drops ptah-cli refs lacking a
      // ptahCliId. Without this, CLI agents spawned in a prior run never
      // reappear in the sidebar after a webview/app reopen even though they
      // are persisted and returned by the backend.
      const cliSessions = result.data?.cliSessions;
      if (cliSessions && cliSessions.length > 0) {
        this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
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

  /**
   * Create a new session
   * Delegates to SessionManager for session creation logic
   */
  async createNewSession(): Promise<void> {}
}
