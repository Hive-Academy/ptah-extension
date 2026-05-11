/**
 * SessionRegistry — sole owner of `activeSessions`, `tabIdToRealId`, and
 * `_lastActiveTabId` state for the session-lifecycle subsystem.
 *
 * Wave C7i extracts state ownership out of `SessionLifecycleManager` so that
 * the streaming pump, query executor, and lifecycle-control sub-services all
 * mutate state through this single registry. There is exactly ONE recompute
 * site for `_lastActiveTabId` (`recomputeLastActiveOnRemoval`) shared by both
 * `removeSession` (endSession path) and `removeSessionOnly` (executeQuery
 * init-failure rollback path), eliminating the duplicate fallback logic that
 * previously lived in two places.
 *
 * TASK_2026_118 P1: Dual-index registry added alongside legacy maps.
 * New `byTabId` and `bySessionId` maps hold `SessionRecord` objects.
 * Legacy maps remain intact — all old methods call-through to keep both
 * structures in sync. Legacy maps will be deleted in P6.
 *
 * This is a plain class — NOT @injectable, NOT registered with tsyringe. The
 * facade constructs it eagerly in its constructor body. See WAVE_C7i_DESIGN.md.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionId, AISessionConfig } from '@ptah-extension/shared';

import type {
  ActiveSession,
  Query,
  SDKUserMessage,
} from '../session-lifecycle-manager';

/**
 * A single session record held in the dual-index registry.
 * Replaces ActiveSession in the new API; both maps point at the same object
 * so mutations via either lookup are immediately visible from the other.
 *
 * TASK_2026_118: P1 addition — co-located here to avoid circular imports
 * (sub-services import from the registry, not from session-lifecycle-manager).
 */
export interface SessionRecord {
  /** Immutable tab ID assigned at tile creation. */
  readonly tabId: string;
  /** Null until the SDK system 'init' message fires; set ONCE via bindRealSessionId. */
  realSessionId: string | null;
  /** SDK Query handle; null during pre-registration before executeQuery starts. */
  query: Query | null;
  /** Session configuration (model, workspace, etc.). Immutable after register. */
  readonly config: AISessionConfig;
  /** Abort controller for this session. Immutable after register. */
  readonly abortController: AbortController;
  /** Queued user messages awaiting the streaming pump. */
  messageQueue: SDKUserMessage[];
  /** Callback to wake the streaming iterator when a message arrives. */
  resolveNext: (() => void) | null;
  /** Current model ID (may differ from config.model after setModel calls). */
  currentModel: string;
}

export class SessionRegistry {
  private activeSessions = new Map<string, ActiveSession>();

  /**
   * Mapping from tab ID → real SDK session UUID.
   * Populated by resolveRealSessionId() when the SDK init message arrives.
   * Used by getActiveSessionIds() to return real UUIDs instead of tab IDs.
   */
  private tabIdToRealId = new Map<string, string>();

  /**
   * Tracks the most recently active tab ID.
   * Updated on session registration and message send.
   * Used by getActiveSessionIds() to return the most recently active
   * session first, so MCP tool calls (e.g., ptah_agent_spawn) attribute
   * agents to the correct session in multi-session scenarios.
   */
  private _lastActiveTabId: string | null = null;

  // ── TASK_2026_118 P1: Dual-index maps ─────────────────────────────────────

  /**
   * Primary index: tabId → SessionRecord. Always populated at register().
   * This is the authoritative source for session iteration.
   */
  private byTabId = new Map<string, SessionRecord>();

  /**
   * Secondary index: realSessionId → SessionRecord. Populated when
   * bindRealSessionId() fires (SDK system 'init' message). Both maps
   * point at the SAME object — mutations visible from either lookup.
   */
  private bySessionId = new Map<string, SessionRecord>();

  constructor(private readonly logger: Logger) {}

  // ─── TASK_2026_118 P1: New dual-index API ──────────────────────────────────

  /**
   * Register a new session into the dual-index registry.
   * Creates a SessionRecord with realSessionId = null and inserts it into
   * byTabId only. bySessionId entry is added later via bindRealSessionId().
   *
   * Also updates _lastActiveTabId so ordering semantics are preserved.
   *
   * @returns The created SessionRecord (same object reference stored in byTabId).
   */
  register(
    tabId: string,
    config: AISessionConfig,
    abortController: AbortController,
  ): SessionRecord {
    const rec: SessionRecord = {
      tabId,
      realSessionId: null,
      query: null,
      config,
      abortController,
      messageQueue: [],
      resolveNext: null,
      currentModel: config.model || '',
    };
    this.byTabId.set(tabId, rec);
    this._lastActiveTabId = tabId;
    return rec;
  }

  /**
   * Bind the real SDK session UUID to an existing record.
   * Adds the record to bySessionId so find(realSessionId) works.
   *
   * Guard: realSessionId must be null on entry (set-once invariant).
   * If it is already set this call is a no-op (logs a warning).
   *
   * Also keeps the legacy tabIdToRealId in sync for backward compatibility.
   */
  bindRealSessionId(tabId: string, realSessionId: string): void {
    const rec = this.byTabId.get(tabId);
    if (!rec) {
      this.logger.warn(
        `[SessionRegistry] bindRealSessionId: no record for tabId ${tabId}`,
      );
      return;
    }
    if (rec.realSessionId !== null) {
      this.logger.warn(
        `[SessionRegistry] bindRealSessionId: realSessionId already set for tabId ${tabId} (${rec.realSessionId}); ignoring`,
      );
      return;
    }
    rec.realSessionId = realSessionId;
    this.bySessionId.set(realSessionId, rec);
    // Keep legacy side-map in sync so existing callers remain intact
    this.tabIdToRealId.set(tabId, realSessionId);
    this.logger.info(
      `[SessionRegistry] Bound real session ID: ${tabId} -> ${realSessionId}`,
    );
  }

  /**
   * Find a session record by either tabId or realSessionId.
   * Checks byTabId first, then bySessionId.
   *
   * Both lookups are O(1) — no scanning.
   */
  find(idOrTabId: string): SessionRecord | undefined {
    return this.byTabId.get(idOrTabId) ?? this.bySessionId.get(idOrTabId);
  }

  /**
   * Remove a session record from both indexes and recompute _lastActiveTabId.
   * Safe to call when rec.realSessionId is null (skips bySessionId delete).
   */
  remove(rec: SessionRecord): void {
    this.byTabId.delete(rec.tabId);
    if (rec.realSessionId !== null) {
      this.bySessionId.delete(rec.realSessionId);
    }
    this.recomputeLastActiveOnRemoval(rec.tabId);
  }

  // ─── Public-API methods (delegated by the facade) ──────────────────

  /**
   * Pre-register active session (before SDK query is created)
   * This allows createUserMessageStream to find the session and queue messages
   * before the SDK query object exists.
   *
   * TASK_2026_118 P1: Also calls register() to populate byTabId so the new
   * API stays in sync with the legacy activeSessions map.
   */
  preRegisterActiveSession(
    sessionId: SessionId,
    config: AISessionConfig,
    abortController: AbortController,
  ): void {
    const session: ActiveSession = {
      sessionId,
      query: null, // Will be set later via setSessionQuery
      config,
      abortController,
      messageQueue: [],
      resolveNext: null,
      currentModel: config.model || '', // Set from SDK via RPC layer
    };

    this.activeSessions.set(sessionId as string, session);
    this._lastActiveTabId = sessionId as string;
    this.logger.info(
      `[SessionLifecycle] Pre-registered active session: ${sessionId}`,
    );

    // TASK_2026_118 P1: Keep dual-index in sync.
    // register() will set _lastActiveTabId again (same value), which is safe.
    this.register(sessionId as string, config, abortController);
  }

  /**
   * Set the SDK query for a pre-registered session
   */
  setSessionQuery(sessionId: SessionId, query: Query): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.error(
        `[SessionLifecycle] Cannot set query - session not found: ${sessionId}`,
      );
      return;
    }

    session.query = query;
    this.logger.debug(`[SessionLifecycle] Set query for session: ${sessionId}`);
  }

  /**
   * Register active session (legacy - combines pre-register and set query)
   */
  registerActiveSession(
    sessionId: SessionId,
    query: Query,
    config: AISessionConfig,
    abortController: AbortController,
  ): void {
    const session: ActiveSession = {
      sessionId,
      query,
      config,
      abortController,
      messageQueue: [],
      resolveNext: null,
      currentModel: config.model || '', // Set from SDK via RPC layer
    };

    this.activeSessions.set(sessionId as string, session);
    this._lastActiveTabId = sessionId as string;
    this.logger.info(
      `[SessionLifecycle] Registered active session: ${sessionId}`,
    );

    // TASK_2026_118 P1: Keep dual-index in sync.
    const rec = this.register(sessionId as string, config, abortController);
    rec.query = query;
  }

  /**
   * Get active session by sessionId
   */
  getActiveSession(sessionId: SessionId): ActiveSession | undefined {
    return this.activeSessions.get(sessionId as string);
  }

  /**
   * Record the mapping from tab ID to real SDK session UUID.
   * Called when the SDK system 'init' message resolves the real session ID.
   * After this, getActiveSessionIds() returns the real UUID instead of the tab ID.
   *
   * TASK_2026_118 P1: Also calls bindRealSessionId() to populate bySessionId.
   */
  resolveRealSessionId(tabId: string, realSessionId: string): void {
    if (this.activeSessions.has(tabId)) {
      this.tabIdToRealId.set(tabId, realSessionId);
      this.logger.info(
        `[SessionLifecycle] Resolved real session ID: ${tabId} -> ${realSessionId}`,
      );
    }
    // TASK_2026_118 P1: Keep dual-index in sync.
    // bindRealSessionId handles the case where byTabId may not have the entry
    // yet (emits a warning) — safe to call unconditionally.
    this.bindRealSessionId(tabId, realSessionId);
  }

  /**
   * Get all active session IDs, most recently active first.
   * Returns real SDK UUIDs when resolved, tab IDs otherwise.
   * The ordering ensures that getActiveSessionIds()[0] returns the session
   * the user most recently interacted with, which is critical for MCP tools
   * like ptah_agent_spawn that pick ids[0] as the parentSessionId.
   */
  getActiveSessionIds(): SessionId[] {
    const keys = Array.from(this.activeSessions.keys());

    // Sort so that the most recently active tab ID comes first
    if (this._lastActiveTabId && keys.length > 1) {
      const idx = keys.indexOf(this._lastActiveTabId);
      if (idx > 0) {
        keys.splice(idx, 1);
        keys.unshift(this._lastActiveTabId);
      }
    }

    return keys.map((key) => (this.tabIdToRealId.get(key) || key) as SessionId);
  }

  /**
   * Get the workspace root (projectPath) for the most recently active session.
   * Used by MCP tools to resolve workspace per-session instead of globally.
   * In multi-workspace scenarios (e.g., Electron with multiple folders open),
   * this ensures CLI agents and subagents inherit the correct workspace
   * from the session that spawned them, not whichever workspace is globally active.
   */
  getActiveSessionWorkspace(): string | undefined {
    if (this._lastActiveTabId) {
      const session = this.activeSessions.get(this._lastActiveTabId);
      if (session?.config?.projectPath) {
        return session.config.projectPath;
      }
    }
    // Fallback: check any active session
    for (const session of this.activeSessions.values()) {
      if (session.config?.projectPath) {
        return session.config.projectPath;
      }
    }
    return undefined;
  }

  /**
   * Resolve a tab ID or session ID to the real SDK UUID.
   * If the input is a known tab ID, returns the resolved real UUID.
   * Otherwise returns the input as-is (it may already be a real UUID).
   */
  getResolvedSessionId(tabIdOrSessionId: string): string {
    return this.tabIdToRealId.get(tabIdOrSessionId) ?? tabIdOrSessionId;
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: SessionId): boolean {
    return this.activeSessions.has(sessionId as string);
  }

  /**
   * Get session count
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  // ─── Internal coordination helpers (used by other sub-services only) ─

  /**
   * Reverse-lookup: given a sessionId that may be a tab ID OR a real UUID,
   * find the entry. Used by interruptCurrentTurn, endSession, setSessionModel
   * (originally dup'd at 3 source sites — extracted ONCE here).
   *
   * Returns the resolved tab ID alongside the session, or undefined if neither
   * a direct tab-ID hit nor a reverse-lookup hit succeeds.
   */
  findByTabOrRealId(
    sessionId: SessionId,
  ): { session: ActiveSession; tabId: string } | undefined {
    const direct = this.activeSessions.get(sessionId as string);
    if (direct) {
      return { session: direct, tabId: sessionId as string };
    }
    for (const [tabId, realId] of this.tabIdToRealId.entries()) {
      if (realId === (sessionId as string)) {
        const session = this.activeSessions.get(tabId);
        if (session) {
          return { session, tabId };
        }
      }
    }
    return undefined;
  }

  /**
   * Direct tabIdToRealId mapping read (for endSession's registrySessionId
   * computation and executeSlashCommandQuery's resume-id resolution).
   * Returns the real UUID if mapped, otherwise echoes the input.
   */
  getRealOrTabId(tabId: string): string {
    return this.tabIdToRealId.get(tabId) || tabId;
  }

  /**
   * Removes a session entry AND its tab→real mapping AND recomputes
   * `_lastActiveTabId` if the removed session was the most recent.
   * Used by `endSession`.
   *
   * TASK_2026_118 P1: Also calls remove() to clean up dual-index maps.
   */
  removeSession(tabId: string): void {
    this.activeSessions.delete(tabId);
    this.tabIdToRealId.delete(tabId);
    // recomputeLastActiveOnRemoval is called inside remove() via the rec path.
    // Call it here too for the legacy activeSessions path to stay in sync.
    this.recomputeLastActiveOnRemoval(tabId);
    // TASK_2026_118 P1: Keep dual-index in sync.
    const rec = this.byTabId.get(tabId);
    if (rec) {
      // remove() calls recomputeLastActiveOnRemoval which uses byTabId.
      // byTabId still has the entry at this point — remove() will delete it.
      this.remove(rec);
    }
  }

  /**
   * Removes only the session entry (no tab-real cleanup) AND recomputes
   * `_lastActiveTabId`. Used by `executeQuery` init-failure rollback —
   * preserves the original behavior of NOT touching `tabIdToRealId` on
   * orphan-rollback (the mapping was never created in that path).
   *
   * TASK_2026_118 P1: Also calls remove() to clean up dual-index maps.
   */
  removeSessionOnly(tabId: string): void {
    this.activeSessions.delete(tabId);
    this.recomputeLastActiveOnRemoval(tabId);
    // TASK_2026_118 P1: Keep dual-index in sync.
    const rec = this.byTabId.get(tabId);
    if (rec) {
      this.remove(rec);
    }
  }

  /**
   * Mark a tab as the most recently active. Used by `sendMessage` so that
   * MCP tool calls attribute spawned agents to the correct session in
   * multi-session scenarios.
   */
  markActive(tabId: string): void {
    this._lastActiveTabId = tabId;
  }

  /**
   * Iterate all session entries — for `disposeAllSessions`.
   */
  entries(): IterableIterator<[string, ActiveSession]> {
    return this.activeSessions.entries();
  }

  /**
   * Atomic reset of all state fields. Used by `disposeAllSessions`.
   *
   * TASK_2026_118 P1: Also clears dual-index maps.
   */
  clearAll(): void {
    this.activeSessions.clear();
    this.tabIdToRealId.clear();
    this.byTabId.clear();
    this.bySessionId.clear();
    this._lastActiveTabId = null;
  }

  /**
   * Recompute `_lastActiveTabId` after a session removal: if the removed tab
   * was the most-recent, fall back to the last entry of the remaining keys
   * (or null if the registry is now empty). Single source of truth for the
   * fallback semantics.
   */
  private recomputeLastActiveOnRemoval(removedTabId: string): void {
    if (this._lastActiveTabId === removedTabId) {
      const remaining = Array.from(this.activeSessions.keys());
      this._lastActiveTabId =
        remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  }
}
