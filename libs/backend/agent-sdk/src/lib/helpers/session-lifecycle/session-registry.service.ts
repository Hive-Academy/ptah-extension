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
 * This is a plain class — NOT @injectable, NOT registered with tsyringe. The
 * facade constructs it eagerly in its constructor body. See WAVE_C7i_DESIGN.md.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionId, AISessionConfig } from '@ptah-extension/shared';

import type { ActiveSession, Query } from '../session-lifecycle-manager';

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

  constructor(private readonly logger: Logger) {}

  // ─── Public-API methods (delegated by the facade) ──────────────────

  /**
   * Pre-register active session (before SDK query is created)
   * This allows createUserMessageStream to find the session and queue messages
   * before the SDK query object exists.
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
   */
  resolveRealSessionId(tabId: string, realSessionId: string): void {
    if (this.activeSessions.has(tabId)) {
      this.tabIdToRealId.set(tabId, realSessionId);
      this.logger.info(
        `[SessionLifecycle] Resolved real session ID: ${tabId} -> ${realSessionId}`,
      );
    }
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
   */
  removeSession(tabId: string): void {
    this.activeSessions.delete(tabId);
    this.tabIdToRealId.delete(tabId);
    this.recomputeLastActiveOnRemoval(tabId);
  }

  /**
   * Removes only the session entry (no tab-real cleanup) AND recomputes
   * `_lastActiveTabId`. Used by `executeQuery` init-failure rollback —
   * preserves the original behavior of NOT touching `tabIdToRealId` on
   * orphan-rollback (the mapping was never created in that path).
   */
  removeSessionOnly(tabId: string): void {
    this.activeSessions.delete(tabId);
    this.recomputeLastActiveOnRemoval(tabId);
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
   * Atomic reset of all three state fields. Used by `disposeAllSessions`.
   */
  clearAll(): void {
    this.activeSessions.clear();
    this.tabIdToRealId.clear();
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
