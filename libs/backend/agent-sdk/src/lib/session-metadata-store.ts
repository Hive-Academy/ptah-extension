/**
 * Session Metadata Store
 *
 * Lightweight storage for session UI metadata ONLY.
 * Session messages and conversation history are managed by the Claude Agent SDK
 * natively in ~/.claude/projects/{sessionId}.jsonl
 *
 * This store ONLY tracks:
 * - Session names (user-friendly labels)
 * - Timestamps (for sorting)
 * - Workspace association
 * - Accumulated cost/tokens (from result messages)
 *
 * It does NOT store:
 * - Messages (SDK handles this)
 * - Conversation history (SDK handles this)
 * - Message content (SDK handles this)
 *
 * @see TASK_2025_088 for migration details
 */

import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { SdkError } from './errors';
import type {
  CliSessionReference,
  SessionMetadataChangedNotification,
  SessionMetadataChangeKind,
} from '@ptah-extension/shared';

/**
 * Session metadata - UI state only, NOT message storage
 */
export interface SessionMetadata {
  /**
   * Real SDK session UUID (from system 'init' message)
   * This is the filename in ~/.claude/projects/
   */
  readonly sessionId: string;

  /**
   * User-friendly session name
   */
  readonly name: string;

  /**
   * Workspace path for this session
   */
  readonly workspaceId: string;

  /**
   * Session creation timestamp
   */
  readonly createdAt: number;

  /**
   * Last activity timestamp (for sorting)
   */
  readonly lastActiveAt: number;

  /**
   * Accumulated cost from result messages (USD)
   */
  readonly totalCost: number;

  /**
   * Accumulated tokens from result messages
   */
  readonly totalTokens: {
    readonly input: number;
    readonly output: number;
  };

  /** CLI agent sessions linked to this parent session. Enables resume. */
  readonly cliSessions?: readonly CliSessionReference[];

  /** When true, this session is a child/subagent session (e.g., Ptah CLI agent spawned
   *  by a parent orchestrator). Child sessions are hidden from the sidebar session list. */
  readonly isChildSession?: boolean;
}

/**
 * Storage key for session metadata
 */
const STORAGE_KEY = 'ptah.sessionMetadata';

/**
 * Session Metadata Store
 *
 * Minimal storage for session UI metadata.
 * Relies on SDK's native ~/.claude/projects/ for message persistence.
 */
@injectable()
export class SessionMetadataStore {
  /**
   * TASK_2025_199: Dependencies are now resolved via @inject() decorators.
   * TASK_2025_208: Uses WORKSPACE_STATE_STORAGE. In Electron, this resolves to
   * WorkspaceAwareStateStorage which delegates to per-workspace storage based
   * on the active workspace. In VS Code, it resolves to the single workspace
   * state storage as before.
   */

  /**
   * Write serialization queue. Prevents concurrent read-modify-write races
   * when multiple CLI agents exit simultaneously and call addCliSession().
   * Each write waits for the previous one to complete before reading fresh data.
   */
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Emits `session:metadataChanged` events after each successful mutation
   * (create / save / rename / delete). The wiring layer
   * ({@link wireSessionMetadataChangeBroadcast}) subscribes to this and
   * broadcasts the payload to all open webviews so sidebars refresh
   * without needing imperative `loadSessions()` calls everywhere.
   *
   * Stat-only updates from `addStats()` intentionally do NOT emit — they
   * fire on every assistant turn and would flood the webview channel.
   */
  private readonly events = new EventEmitter<{
    metadataChanged: (payload: SessionMetadataChangedNotification) => void;
  }>();

  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)
    private storage: IStateStorage,
    @inject(TOKENS.LOGGER) private logger: Logger,
  ) {}

  /**
   * Subscribe to session metadata change events.
   * Returns an unsubscribe function for symmetric teardown.
   */
  onMetadataChanged(
    listener: (payload: SessionMetadataChangedNotification) => void,
  ): () => void {
    this.events.on('metadataChanged', listener);
    return () => this.events.off('metadataChanged', listener);
  }

  private emitChange(
    kind: SessionMetadataChangeKind,
    sessionId: string,
    workspaceId: string,
  ): void {
    try {
      this.events.emit('metadataChanged', { kind, sessionId, workspaceId });
    } catch (err) {
      // Listener errors must not poison the write path.
      this.logger.warn(
        '[SessionMetadataStore] metadataChanged listener threw',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  /**
   * Save or update session metadata.
   * Serialized through writeQueue to prevent concurrent read-modify-write races.
   *
   * Emits `metadataChanged` with `kind: 'updated'`. Callers that need a
   * different kind (e.g. `create()` → `'created'` / `'forked'`) bypass this
   * method and call {@link _saveInternal} directly so they own the emission.
   */
  async save(metadata: SessionMetadata): Promise<void> {
    await this.enqueueWrite(() => this._saveInternal(metadata));
    this.emitChange('updated', metadata.sessionId, metadata.workspaceId);
  }

  /**
   * Internal save implementation (NOT serialized).
   * Called directly by addStats()/addCliSession() which already enqueue their own writes.
   * Public callers must use save() which wraps this in enqueueWrite().
   */
  private async _saveInternal(metadata: SessionMetadata): Promise<void> {
    const all = await this.getAll();
    const index = all.findIndex((m) => m.sessionId === metadata.sessionId);

    if (index >= 0) {
      // Preserve isChildSession and cliSessions from existing metadata.
      // Once a session is marked as a child (by createChild()), it must stay
      // hidden from the sidebar even if create() is later called without the
      // flag (e.g., when the main SdkAgentAdapter resumes a ptah-cli session).
      const existing = all[index];
      all[index] = {
        ...metadata,
        ...(existing.isChildSession && !metadata.isChildSession
          ? { isChildSession: true }
          : {}),
        ...(existing.cliSessions && !metadata.cliSessions
          ? { cliSessions: existing.cliSessions }
          : {}),
      };
    } else {
      all.push(metadata);
    }

    await this.storage.update(STORAGE_KEY, all);
    this.logger.debug(
      `[SessionMetadataStore] Saved metadata for session ${metadata.sessionId}`,
    );
  }

  /**
   * Get metadata by session ID
   */
  async get(sessionId: string): Promise<SessionMetadata | null> {
    const all = await this.getAll();
    return all.find((m) => m.sessionId === sessionId) || null;
  }

  /**
   * Get all session metadata for a workspace.
   * Excludes child sessions (Ptah CLI agents) by default — these only
   * appear within their parent session's context, not in the sidebar.
   */
  async getForWorkspace(
    workspaceId: string,
    includeChildren = false,
  ): Promise<SessionMetadata[]> {
    const all = await this.getAll();
    // Normalize path separators for cross-platform comparison.
    // Frontend may send forward slashes (normalizeCacheKey) while
    // stored workspaceId uses OS-native backslashes on Windows.
    const normalizedQuery = workspaceId.replace(/\\/g, '/');
    return all
      .filter(
        (m) =>
          m.workspaceId.replace(/\\/g, '/') === normalizedQuery &&
          (includeChildren || !m.isChildSession),
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /**
   * Get all session metadata
   */
  async getAll(): Promise<SessionMetadata[]> {
    return (await this.storage.get<SessionMetadata[]>(STORAGE_KEY)) || [];
  }

  /**
   * Update session activity timestamp
   */
  async touch(sessionId: string): Promise<void> {
    const metadata = await this.get(sessionId);
    if (metadata) {
      await this.save({
        ...metadata,
        lastActiveAt: Date.now(),
      });
    }
  }

  /**
   * Update session stats (cost, tokens) from result message.
   * Serialized through writeQueue to prevent lost updates from concurrent writes.
   */
  async addStats(
    sessionId: string,
    stats: { cost: number; tokens: { input: number; output: number } },
  ): Promise<void> {
    return this.enqueueWrite(async () => {
      const metadata = await this.get(sessionId);
      if (metadata) {
        await this._saveInternal({
          ...metadata,
          lastActiveAt: Date.now(),
          totalCost: metadata.totalCost + stats.cost,
          totalTokens: {
            input: metadata.totalTokens.input + stats.tokens.input,
            output: metadata.totalTokens.output + stats.tokens.output,
          },
        });

        // If this is a child session, propagate stats to the parent
        if (metadata.isChildSession) {
          await this.propagateStatsToParent(sessionId, stats);
        }
      }
    });
  }

  /**
   * Propagate child session stats to the parent session.
   * Finds the parent by scanning all sessions' cliSessions arrays for a reference
   * whose sdkSessionId matches the child's sessionId.
   *
   * Called within enqueueWrite, so concurrent updates are safe.
   * Silently skips if no parent is found (orphan child or timing issue).
   */
  private async propagateStatsToParent(
    childSessionId: string,
    stats: { cost: number; tokens: { input: number; output: number } },
  ): Promise<void> {
    const all = await this.getAll();
    for (const session of all) {
      if (
        session.cliSessions?.some((ref) => ref.sdkSessionId === childSessionId)
      ) {
        await this._saveInternal({
          ...session,
          lastActiveAt: Date.now(),
          totalCost: session.totalCost + stats.cost,
          totalTokens: {
            input: session.totalTokens.input + stats.tokens.input,
            output: session.totalTokens.output + stats.tokens.output,
          },
        });
        this.logger.debug(
          `[SessionMetadataStore] Propagated subagent stats to parent ${session.sessionId}`,
        );
        break;
      }
    }
  }

  /**
   * Add a CLI session reference to a parent session's metadata.
   * Called when a CLI agent exits with a captured cliSessionId.
   *
   * Serialized through writeQueue to prevent race conditions when
   * multiple CLI agents exit simultaneously and try to add their
   * references concurrently (each would read stale cliSessions=[],
   * and only the last save would survive).
   */
  async addCliSession(
    sessionId: string,
    cliSession: CliSessionReference,
  ): Promise<void> {
    return this.enqueueWrite(async () => {
      const metadata = await this.get(sessionId);
      if (!metadata) {
        throw new SdkError(`Parent session not found: ${sessionId}`);
      }

      const existing = metadata.cliSessions ?? [];
      // Upsert by cliSessionId: if a reference with the same cliSessionId already
      // exists, replace it with the new one (preserves updated status, stdout, and
      // segments from resumed sessions). Otherwise append.
      const existingIndex = existing.findIndex(
        (s) => s.cliSessionId === cliSession.cliSessionId,
      );

      let updated: readonly CliSessionReference[];
      if (existingIndex >= 0) {
        // Replace existing reference with updated data (resume scenario)
        const mutable = [...existing];
        mutable[existingIndex] = cliSession;
        updated = mutable;
        this.logger.info(
          `[SessionMetadataStore] Updated CLI session ${cliSession.cliSessionId} (${cliSession.cli}) in session ${sessionId}`,
        );
      } else {
        updated = [...existing, cliSession];
        this.logger.info(
          `[SessionMetadataStore] Linked CLI session ${cliSession.cliSessionId} (${cliSession.cli}) to session ${sessionId}`,
        );
      }

      await this._saveInternal({
        ...metadata,
        lastActiveAt: Date.now(),
        cliSessions: updated,
      });
      this.emitChange('updated', sessionId, metadata.workspaceId);
    });
  }

  /**
   * Delete session metadata.
   * Serialized through writeQueue to prevent concurrent read-modify-write races.
   */
  async delete(sessionId: string): Promise<void> {
    // Capture workspaceId BEFORE deletion so the emitted event still carries it.
    // After _deleteInternal, get() returns null, so we'd lose the workspace context.
    const existing = await this.get(sessionId);
    await this.enqueueWrite(() => this._deleteInternal(sessionId));
    if (existing) {
      this.emitChange('deleted', sessionId, existing.workspaceId);
    }
  }

  /**
   * Internal delete implementation (NOT serialized).
   * Public callers must use delete() which wraps this in enqueueWrite().
   */
  private async _deleteInternal(sessionId: string): Promise<void> {
    const all = await this.getAll();
    const filtered = all.filter((m) => m.sessionId !== sessionId);

    if (filtered.length !== all.length) {
      await this.storage.update(STORAGE_KEY, filtered);
      this.logger.info(
        `[SessionMetadataStore] Deleted metadata for session ${sessionId}`,
      );
    }
  }

  /**
   * Create initial metadata for a new session.
   * Called when SDK returns the real session ID from system 'init' message.
   * If metadata already exists (e.g., from a user rename), preserves the existing name.
   *
   * Emits `metadataChanged` with the supplied {@link kind} (default `'created'`).
   * Callers forking an existing session pass `'forked'` so the webview can
   * distinguish brand-new sessions from forked ones (e.g. for highlight UX).
   * When metadata already exists, the kind is downgraded to `'updated'` —
   * a duplicate `create()` is semantically just an activity touch.
   */
  async create(
    sessionId: string,
    workspaceId: string,
    name: string,
    kind: SessionMetadataChangeKind = 'created',
  ): Promise<SessionMetadata> {
    // Check if metadata already exists — preserve user-renamed name
    const existing = await this.get(sessionId);
    if (existing) {
      this.logger.info(
        `[SessionMetadataStore] Metadata already exists for ${sessionId}, preserving name "${existing.name}"`,
      );
      const updated = { ...existing, lastActiveAt: Date.now() };
      await this.enqueueWrite(() => this._saveInternal(updated));
      this.emitChange('updated', updated.sessionId, updated.workspaceId);
      return updated;
    }

    const now = Date.now();
    const metadata: SessionMetadata = {
      sessionId,
      name,
      workspaceId,
      createdAt: now,
      lastActiveAt: now,
      totalCost: 0,
      totalTokens: { input: 0, output: 0 },
    };

    await this.enqueueWrite(() => this._saveInternal(metadata));
    this.logger.info(
      `[SessionMetadataStore] Created metadata for session ${sessionId}: "${name}"`,
    );
    this.emitChange(kind, sessionId, workspaceId);

    return metadata;
  }

  /**
   * Create metadata for a child session (hidden from sidebar).
   * Called when a Ptah CLI agent's real SDK session ID is resolved.
   * Creating this entry early prevents SessionImporterService from
   * re-importing the session as a top-level sidebar item.
   */
  async createChild(
    sessionId: string,
    workspaceId: string,
    name: string,
  ): Promise<SessionMetadata> {
    const now = Date.now();
    const metadata: SessionMetadata = {
      sessionId,
      name,
      workspaceId,
      createdAt: now,
      lastActiveAt: now,
      totalCost: 0,
      totalTokens: { input: 0, output: 0 },
      isChildSession: true,
    };

    await this.enqueueWrite(() => this._saveInternal(metadata));
    this.logger.info(
      `[SessionMetadataStore] Created child session metadata: ${sessionId} "${name}"`,
    );
    this.emitChange('created', sessionId, workspaceId);

    return metadata;
  }

  /**
   * Rename session.
   * Serialized through writeQueue to prevent lost updates from concurrent writes.
   */
  async rename(sessionId: string, newName: string): Promise<void> {
    let renamed: SessionMetadata | null = null;
    await this.enqueueWrite(async () => {
      const metadata = await this.get(sessionId);
      if (metadata) {
        const next: SessionMetadata = { ...metadata, name: newName };
        await this._saveInternal(next);
        this.logger.info(
          `[SessionMetadataStore] Renamed session ${sessionId} to "${newName}"`,
        );
        renamed = next;
      }
    });
    if (renamed) {
      const m = renamed as SessionMetadata;
      this.emitChange('updated', m.sessionId, m.workspaceId);
    }
  }

  /**
   * Check if a given SDK session UUID is referenced as a child session
   * by any parent session's cliSessions array.
   *
   * Used by SessionImporterService to detect child sessions that weren't
   * properly marked with isChildSession (e.g., createChild failed or
   * was never called).
   */
  async isReferencedAsChildSession(sdkSessionId: string): Promise<boolean> {
    const all = await this.getAll();
    for (const session of all) {
      if (session.cliSessions) {
        for (const ref of session.cliSessions) {
          if (ref.sdkSessionId === sdkSessionId) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Enqueue a write operation. Each write waits for the previous one to finish
   * before executing, ensuring read-modify-write cycles see fresh data.
   * Errors are propagated to the caller but don't break the queue chain.
   */
  private enqueueWrite(fn: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(fn, () => fn());
    // Update queue head — always resolves so next write can proceed even if this one fails
    this.writeQueue = next.catch(() => {
      /* swallow to keep chain alive */
    });
    return next;
  }
}
