/**
 * SessionRegistry — sole owner of `byTabId`, `bySessionId`, and
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
 * TASK_2026_118 Batch 1.5: Collapsed to single-storage.
 * `activeSessions` and `tabIdToRealId` removed. All methods now read/write
 * through `byTabId` and `bySessionId` only. Both indexes point at the SAME
 * `SessionRecord` object — mutations via either lookup are immediately visible.
 *
 * This is a plain class — NOT @injectable, NOT registered with tsyringe. The
 * facade constructs it eagerly in its constructor body. See WAVE_C7i_DESIGN.md.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionId, AISessionConfig } from '@ptah-extension/shared';

import type { Query, SDKUserMessage } from '../session-lifecycle-manager';

/**
 * A single session record held in the dual-index registry.
 * Both `byTabId` and `bySessionId` point at the SAME object so mutations
 * via either lookup are immediately visible from the other.
 *
 * TASK_2026_118: canonical session type replacing the old ActiveSession.
 * Co-located here to avoid circular imports (sub-services import from the
 * registry, not from session-lifecycle-manager).
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

  /**
   * Tracks the most recently active tab ID.
   * Updated on session registration and message send.
   * Used by getActiveSessionIds() to return the most recently active
   * session first, so MCP tool calls (e.g., ptah_agent_spawn) attribute
   * agents to the correct session in multi-session scenarios.
   */
  private _lastActiveTabId: string | null = null;

  constructor(private readonly logger: Logger) {}

  // ─── Core dual-index API ───────────────────────────────────────────────────

  /**
   * Register a new session into the registry.
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

  // ─── Public-API methods (delegated by the facade) ─────────────────────────

  /**
   * Set the SDK query for a pre-registered session.
   * Mutates the single SessionRecord stored in byTabId (and referenced by
   * bySessionId once bound), so the mutation is visible from either lookup.
   */
  setSessionQuery(sessionId: SessionId, query: Query): void {
    const rec = this.byTabId.get(sessionId as string);
    if (!rec) {
      this.logger.error(
        `[SessionLifecycle] Cannot set query - session not found: ${sessionId}`,
      );
      return;
    }

    rec.query = query;
    this.logger.debug(`[SessionLifecycle] Set query for session: ${sessionId}`);
  }

  /**
   * Get all active session IDs, most recently active first.
   * Returns real SDK UUIDs when resolved, tab IDs otherwise.
   * The ordering ensures that getActiveSessionIds()[0] returns the session
   * the user most recently interacted with, which is critical for MCP tools
   * like ptah_agent_spawn that pick ids[0] as the parentSessionId.
   */
  getActiveSessionIds(): SessionId[] {
    const keys = Array.from(this.byTabId.keys());

    // Sort so that the most recently active tab ID comes first
    if (this._lastActiveTabId && keys.length > 1) {
      const idx = keys.indexOf(this._lastActiveTabId);
      if (idx > 0) {
        keys.splice(idx, 1);
        keys.unshift(this._lastActiveTabId);
      }
    }

    return keys.map(
      (key) => (this.byTabId.get(key)?.realSessionId ?? key) as SessionId,
    );
  }

  /**
   * Get the workspace root (projectPath) for the most recently active session.
   * Used by MCP tools to resolve workspace per-session instead of globally.
   */
  getActiveSessionWorkspace(): string | undefined {
    if (this._lastActiveTabId) {
      const rec = this.byTabId.get(this._lastActiveTabId);
      if (rec?.config?.projectPath) {
        return rec.config.projectPath;
      }
    }
    // Fallback: check any active session
    for (const rec of this.byTabId.values()) {
      if (rec.config?.projectPath) {
        return rec.config.projectPath;
      }
    }
    return undefined;
  }

  /**
   * Get session count.
   */
  getActiveSessionCount(): number {
    return this.byTabId.size;
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
  entries(): IterableIterator<[string, SessionRecord]> {
    return this.byTabId.entries();
  }

  /**
   * Atomic reset of all state fields. Used by `disposeAllSessions`.
   */
  clearAll(): void {
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
      const remaining = Array.from(this.byTabId.keys());
      this._lastActiveTabId =
        remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  }
}
