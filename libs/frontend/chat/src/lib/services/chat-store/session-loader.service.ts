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
  CliSessionReference,
  TabId,
  SessionId,
  FlatStreamEventUnion,
  SubagentRecord,
  getModelContextWindow,
  type ChatResumeResult,
} from '@ptah-extension/shared';
import {
  SessionManager,
  StreamingHandlerService,
  AgentMonitorStore,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  createEmptyStreamingState,
  type TabState,
} from '@ptah-extension/chat-types';

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

interface SwitchSessionOptions {
  reason?: 'compaction';
  activate?: boolean;
  targetTabId?: TabId;
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
   * Set of load identities currently being loaded via switchSession() or
   * refreshResumableSubagentsForSession(). Prevents duplicate chat:resume
   * calls when the same destination is requested while a load is already in
   * progress. Targeted loads use `(sessionId, tabId)` so sibling tabs sharing
   * one session can be restored concurrently.
   */
  private readonly _inFlightSessions = new Set<string>();

  /**
   * Sessions whose CLI agent cards have already been pushed into
   * AgentMonitorStore this app run — either from a `chat:resume` payload or a
   * dedicated `session:cli-sessions` fetch. Keeps concurrent surfaces from
   * racing the same fetch and stops a re-hydrate from undoing a manual
   * "Clear completed".
   */
  private readonly _cliSessionsRestored = new Set<string>();
  private static readonly SESSIONS_PAGE_SIZE = 30;

  /**
   * Timeout for `chat:resume`, well above the 30 s RPC default.
   *
   * The handler reads the whole JSONL transcript TWICE (events + legacy
   * messages) and rehydrates every persisted agent's output. Measured on
   * 2026-09-04: a 2.5 MB transcript with 11 restored agents took under a
   * second warm, and a cold read during app start ran past 31 s — long enough
   * for the default to fire. A timeout is not a soft failure here: the reply
   * carries the transcript, the resumable subagents AND the CLI agent cards,
   * so dropping it empties the Agents panel with nothing on screen to say why.
   */
  private static readonly RESUME_TIMEOUT_MS = 120_000;

  /**
   * Maximum workspace entries in sessionCache.
   * LRU eviction: oldest by Map insertion order, but never evict the currentWorkspacePath.
   */
  private static readonly MAX_CACHED_WORKSPACES = 10;
  private loadSessionsTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly LOAD_SESSIONS_DEBOUNCE_MS = 300;

  /**
   * The `session:list` round trip currently in flight, or `null`
   * (TASK_2026_383 Batch 10.3).
   *
   * The 300 ms trailing debounce above only coalesces callers that arrive
   * BEFORE the timer fires. `loadSessions()` has five callers
   * (`ChatLifecycleService` x3, `SessionStatsAggregatorService`,
   * `ChatMessageHandlerService`) driven by independent broadcasts, so a caller
   * landing while the RPC is in flight scheduled a second identical read —
   * measured at ~200 ms each. Callers that arrive during a read now share it.
   *
   * A plain field, not a signal: nothing renders from it, and it is written
   * inside the async body its readers already await.
   */
  private loadSessionsInFlight: Promise<void> | null = null;

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
          this.refreshResumableSubagentsForSession(
            sessionId,
            TabId.from(tabId),
          ),
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
   * Debounced (300ms) to coalesce rapid calls (e.g. SESSION_ID_RESOLVED + SESSION_STATS),
   * then single-flighted so a caller whose timer fires while an earlier read is
   * still in flight joins that read instead of issuing a second identical one
   * (see {@link loadSessionsInFlight}).
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
          await this.runLoadSessions();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, SessionLoaderService.LOAD_SESSIONS_DEBOUNCE_MS);
    });
  }

  /**
   * Single-flight wrapper around {@link _loadSessionsImmediate}. Callers that
   * arrive while a read is in flight share it; the next caller after it settles
   * gets a fresh read.
   */
  private runLoadSessions(): Promise<void> {
    const existing = this.loadSessionsInFlight;
    if (existing !== null) {
      return existing;
    }

    const promise = this._loadSessionsImmediate().finally(() => {
      if (this.loadSessionsInFlight === promise) {
        this.loadSessionsInFlight = null;
      }
    });
    this.loadSessionsInFlight = promise;
    return promise;
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
    opts?: SwitchSessionOptions,
  ): Promise<void> {
    const targetTabId = opts?.targetTabId;
    const loadKey = targetTabId ? `${sessionId}:${targetTabId}` : sessionId;
    const targetedTab = targetTabId
      ? this.requireTargetTab(sessionId, targetTabId)
      : null;

    if (this._inFlightSessions.has(loadKey)) {
      console.debug(
        '[SessionLoaderService] Skipping duplicate switchSession for:',
        sessionId,
      );
      return;
    }

    const existingTab =
      targetedTab ?? this.tabManager.findTabBySessionId(sessionId);
    if (opts?.reason !== 'compaction' && existingTab?.hasLiveSession) {
      const inActiveWorkspace = this.tabManager
        .tabs()
        .some((t) => t.id === existingTab.id);
      if (inActiveWorkspace) {
        this.tabManager.switchTab(existingTab.id);
        return;
      }
    }

    this._inFlightSessions.add(loadKey);
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
      const resolvedTabId = targetTabId
        ? this.requireTargetTab(sessionId, targetTabId).id
        : this.tabManager.openSessionTab(sessionId, title);

      // [compaction-diag] TEMPORARY — remove after the 2-tile stale-transcript
      // repro is confirmed. Reveals the explicit reload target so a missing or
      // ownership-drifted tile can be correlated with the lifecycle fan-out.
      if (opts?.reason === 'compaction') {
        console.warn('[compaction-diag] switchSession reload target', {
          requestedSessionId: sessionId,
          resolvedTabId,
          existingTabId: existingTab?.id ?? null,
          openTabsForSession: this.tabManager
            .tabs()
            .filter((t) => t.claudeSessionId === sessionId)
            .map((t) => t.id),
        });
      }
      // A compaction chunk may have queued a live-state write before this
      // targeted reload started. Close/reopen clears that queue through
      // StreamRouter; in-place reload must do the same or history finalization's
      // flush can reinstall the stale two-stub compaction state over the replay.
      if (targetTabId) {
        this.streamingHandler.clearPendingUpdates(resolvedTabId);
      }
      // A targeted compaction reload must keep the compacted transcript visible
      // until its immutable snapshot is known to be boundary-ready. Applying
      // the normal resume initializer here would clear that transcript before a
      // staleSnapshot response can be contained.
      if (opts?.reason !== 'compaction' || !targetTabId) {
        this.tabManager.applyResumingSession(resolvedTabId, {
          sessionId,
          name: title,
          title,
          streamingState: createEmptyStreamingState(),
        });
      }
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
      const resumeResult = await this.claudeRpcService.call(
        'chat:resume',
        {
          sessionId,
          tabId: resolvedTabId,
          workspacePath,
          ...(opts?.activate === true && !targetTabId
            ? { activate: true }
            : {}),
        },
        { timeout: SessionLoaderService.RESUME_TIMEOUT_MS },
      );
      if (
        opts?.activate === true &&
        !targetTabId &&
        resumeResult.data?.activated === true
      ) {
        this.tabManager.markSessionActive(resolvedTabId);
      }

      if (targetTabId) {
        this.requireTargetTab(sessionId, targetTabId);
      }

      if (
        opts?.reason === 'compaction' &&
        targetTabId &&
        resumeResult.data?.staleSnapshot === true
      ) {
        // The backend could not verify this compaction snapshot's boundary.
        // Do not let its stale transcript, stats, or auxiliary state replace
        // the compaction marker and preloaded totals already on this tab.
        this.tabManager.applyResumeFailure(resolvedTabId);
        this.tabManager.markTabIdle(resolvedTabId);
        this.sessionManager.setStatus('loaded');
        return;
      }

      if (opts?.reason === 'compaction' && targetTabId) {
        this.tabManager.applyResumingSession(resolvedTabId, {
          sessionId,
          name: title,
          title,
          streamingState: createEmptyStreamingState(),
        });
      }

      const events = resumeResult.data?.events;
      const messages = resumeResult.data?.messages;
      const stats = resumeResult.data?.stats;
      const resumableSubagents = resumeResult.data?.resumableSubagents;
      const cliSessions = resumeResult.data?.cliSessions;
      // BEFORE the transcript replay, not after it. The agent cards do not
      // depend on a single event below, and this is the ONLY path that
      // restores them on a reopen — `restoreCliSessionsForSession` refuses to
      // fetch twice per session per app run. Anything that throws while
      // replaying 250+ events (or a transcript that yields none at all, the
      // third branch below) therefore cost the whole Agents panel silently.
      this.applyCliSessions(cliSessions, sessionId);
      if (stats) {
        this.applyResumeStats(resolvedTabId, stats, {
          preserveCompactionContextSeed:
            opts?.reason === 'compaction' && targetTabId != null,
        });
      } else if (
        !targetTabId &&
        resumeResult.success &&
        ((events?.length ?? 0) > 0 || (messages?.length ?? 0) > 0)
      ) {
        this.tabManager.setPreloadedStats(resolvedTabId, null);
        this.tabManager.setLiveModelStats(resolvedTabId, null);
        this.tabManager.setModelUsageList(resolvedTabId, []);
      }
      if (resumeResult.success && events && events.length > 0) {
        for (const event of events) {
          this.streamingHandler.processStreamEvent(
            event as FlatStreamEventUnion,
            resolvedTabId,
            sessionId,
            { isReplay: true, fanOut: false },
          );
        }
        this.streamingHandler.finalizeSessionHistory(
          resolvedTabId,
          resumableSubagents,
        );

        this.sessionManager.setStatus('loaded');
        this._resumableSubagents.set(resumableSubagents ?? []);
        this._resumableSubagentsSessionId = sessionId;
      } else if (resumeResult.success && messages && messages.length > 0) {
        const executionMessages = messages.map((msg) => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant',
          timestamp: msg.timestamp,
          streamingState: null,
          rawContent: msg.content,
          sessionId,
        }));
        this.tabManager.applyResumedHistory(resolvedTabId, executionMessages);
        this.sessionManager.setStatus('loaded');
        this._resumableSubagents.set(resumableSubagents ?? []);
        this._resumableSubagentsSessionId = sessionId;
      } else {
        this.tabManager.applyResumeFailure(resolvedTabId);
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
      this._inFlightSessions.delete(loadKey);
    }
  }

  private requireTargetTab(sessionId: SessionId, targetTabId: TabId): TabState {
    const target =
      this.tabManager.findTabByIdAcrossWorkspaces(targetTabId)?.tab;
    const ownsDifferentSession =
      target?.claudeSessionId != null && target.claudeSessionId !== sessionId;
    if (!target || ownsDifferentSession) {
      throw new Error(
        `[SessionLoaderService] Compaction reload target ${targetTabId} no longer owns session ${sessionId}`,
      );
    }
    // A null owner is adoptable. applyResumingSession binds it after the
    // session-load re-check; later checks still reject a competing owner.
    return target;
  }

  /** Apply one persisted resume snapshot without treating lifetime totals as CTX. */
  private applyResumeStats(
    tabId: TabId,
    stats: NonNullable<ChatResumeResult['stats']>,
    options?: { preserveCompactionContextSeed?: boolean },
  ): void {
    // Capture before applying persisted stats: applyLoadedSessionStats creates a
    // zero-valued live-model placeholder, which would otherwise erase the fresh
    // post-compaction seed before this targeted-reload guard can preserve it.
    const compactionContextSeed =
      options?.preserveCompactionContextSeed === true
        ? this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab
            .liveModelStats ?? null
        : null;

    this.tabManager.applyLoadedSessionStats(tabId, stats, stats.model ?? null);
    this.tabManager.setModelUsageList(
      tabId,
      (stats.modelUsageList ?? []).map((entry) => ({
        ...entry,
        contextWindow: getModelContextWindow(entry.model),
      })),
    );

    // A targeted compaction reload reads immutable history, which may still
    // describe the pre-compaction generation. Its context snapshot must never
    // displace the fresh post-compaction seed; the next live usage frame owns
    // that replacement. Ordinary resumes retain their existing behavior.
    if (compactionContextSeed) {
      this.tabManager.setLiveModelStats(tabId, compactionContextSeed);
      return;
    }

    const snapshot = stats.contextSnapshot;
    if (!snapshot) {
      this.tabManager.setLiveModelStats(tabId, null);
      return;
    }

    const contextWindow = getModelContextWindow(snapshot.model);
    this.tabManager.setLiveModelStats(tabId, {
      model: snapshot.model,
      contextUsed: snapshot.contextTokens,
      contextWindow,
      contextPercent:
        contextWindow > 0
          ? Math.round((snapshot.contextTokens / contextWindow) * 1000) / 10
          : 0,
    });
  }

  /**
   * Push a `chat:resume` payload's CLI session references into the agent
   * monitor and record the session as hydrated, so a surface that resolves the
   * same session later skips its own `session:cli-sessions` fetch.
   */
  private applyCliSessions(
    cliSessions: CliSessionReference[] | undefined,
    sessionId: SessionId,
  ): void {
    if (!cliSessions || cliSessions.length === 0) return;
    this._cliSessionsRestored.add(sessionId);
    this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
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
    const sessionId = this.tabManager.activeTab()?.claudeSessionId;
    if (!sessionId) return;
    await this.restoreCliSessionsForSession(sessionId);
  }

  /**
   * Restore CLI agent sessions for one specific session.
   *
   * Every chat surface calls this for its own session as soon as that session
   * resolves, so a canvas tile hydrates its agent panel whether or not it is
   * the active tab. The bootstrap-time active-tab restore only ever covered
   * one surface, which left every other tile permanently showing "No agents"
   * for CLI agents spawned in a prior run.
   *
   * Runs at most once per session per app run: re-fetching would resurrect
   * cards the user cleared by hand via "Clear completed".
   */
  async restoreCliSessionsForSession(sessionId: SessionId): Promise<void> {
    if (this._cliSessionsRestored.has(sessionId)) return;
    this._cliSessionsRestored.add(sessionId);

    try {
      const result = await this.claudeRpcService.call('session:cli-sessions', {
        sessionId,
      });

      const cliSessions = result.data?.cliSessions;
      if (result.success && cliSessions && cliSessions.length > 0) {
        this.agentMonitorStore.loadCliSessions(cliSessions, sessionId);
        return;
      }
      if (!result.success) {
        // A failed RPC RESOLVES here — `ClaudeRpcService.call` reports a
        // timeout or a handler error as `{ success: false }` and never throws.
        // Keeping the guard set on that path retired the session's only
        // retryable restore for the rest of the app run, so the panel stayed
        // empty however many times the user reopened the session.
        this._cliSessionsRestored.delete(sessionId);
        console.warn(
          '[SessionLoaderService] session:cli-sessions failed; will retry',
          { sessionId, error: result.error },
        );
      }
    } catch (error) {
      this._cliSessionsRestored.delete(sessionId);
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
    tabId: TabId,
  ): Promise<void> {
    if (this._inFlightSessions.has(sessionId)) {
      return;
    }

    try {
      this._inFlightSessions.add(sessionId);
      const workspacePath = this.vscodeService.config().workspaceRoot;
      const result = await this.claudeRpcService.call(
        'chat:resume',
        {
          sessionId,
          tabId,
          workspacePath,
        },
        { timeout: SessionLoaderService.RESUME_TIMEOUT_MS },
      );
      if (!result.success) {
        console.warn(
          '[SessionLoaderService] chat:resume failed for a restored session; agent cards and resumable subagents were not recovered',
          { sessionId, error: result.error },
        );
        return;
      }

      const restoredTab =
        this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
      if (!restoredTab || restoredTab.claudeSessionId !== sessionId) {
        return;
      }

      const stats = result.data?.stats;
      if (stats) {
        this.applyResumeStats(tabId, stats);
      } else {
        this.tabManager.setPreloadedStats(tabId, null);
        this.tabManager.setLiveModelStats(tabId, null);
        this.tabManager.setModelUsageList(tabId, []);
      }

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
      this.applyCliSessions(result.data?.cliSessions, sessionId);
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
