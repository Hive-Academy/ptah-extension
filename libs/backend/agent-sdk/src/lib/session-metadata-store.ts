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
 * - CLI agent stream events (own key per agent — see {@link PersistedAgentOutput})
 *
 * All sessions live under ONE storage key, so every write re-serializes every
 * session. Two rules keep that affordable, and both were bought the hard way
 * (TASK_2026_323 blocker B5):
 *
 *  1. Nothing unbounded goes in the blob. A `CliSessionReference` carries ids,
 *     status and a short segment tail; the bulk output lives under
 *     `ptah.agentOutput:<agentId>`, written once when the agent exits and read
 *     back only when a session is restored.
 *  2. A burst of writes serializes once. Mutations are staged in memory and
 *     flushed when the write queue drains, so ten CLI agents exiting together
 *     cost one `IStateStorage.update`, not ten.
 */

import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { SdkError } from './errors';
import type {
  CliOutputSegment,
  CliSessionReference,
  FlatStreamEventUnion,
  SessionMetadataChangedNotification,
  SessionMetadataChangeKind,
} from '@ptah-extension/shared';
import { blankToUndefined } from '@ptah-extension/shared';

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
 * Bulk output captured from one CLI agent, stored under its OWN key.
 *
 * `streamEvents` used to be embedded in the `CliSessionReference` inside the
 * all-sessions blob. An agent can accumulate 50 000 of them
 * (`MAX_ACCUMULATED_STREAM_EVENTS`), and every session metadata write
 * re-serializes EVERY session — so N agents spawning and exiting cost
 * O(N² × events) bytes of JSON on the main thread (TASK_2026_323 blocker B5).
 * Splitting them onto a per-agent key makes that cost O(N × events), paid once
 * at exit, and leaves the hot all-sessions blob small enough to rewrite freely.
 */
export interface PersistedAgentOutput {
  /** Agent this output belongs to (same value as `CliSessionReference.agentId`). */
  readonly agentId: string;
  /** When the snapshot was taken (ms epoch). */
  readonly savedAt: number;
  /** Full structured segments (already capped upstream at 500). */
  readonly segments?: readonly CliOutputSegment[];
  /** Rich stream events for the execution-tree renderer (Ptah CLI only). */
  readonly streamEvents?: readonly FlatStreamEventUnion[];
}

/**
 * Storage key for session metadata
 */
const STORAGE_KEY = 'ptah.sessionMetadata';

/** Key prefix for per-agent bulk output. One key per agent, written once. */
const AGENT_OUTPUT_KEY_PREFIX = 'ptah.agentOutput:';

/**
 * Segments retained INLINE on a `CliSessionReference`.
 *
 * The Codex / Copilot agent cards render `segments` directly, so a small tail
 * keeps a restored card useful even before {@link
 * SessionMetadataStore.getCliSessionsForRestore} rehydrates the full set from
 * the per-agent key.
 */
const MAX_PERSISTED_REF_SEGMENTS = 200;

function agentOutputKey(agentId: string): string {
  return `${AGENT_OUTPUT_KEY_PREFIX}${agentId}`;
}

/**
 * Strip the bulk fields from a CLI session reference before it enters the
 * all-sessions blob. `streamEvents` never belongs there; `segments` is trimmed
 * to a tail. Returns the SAME object when nothing needed removing so callers
 * can cheaply detect a no-op.
 */
function leanCliSessionRef(ref: CliSessionReference): CliSessionReference {
  const segmentCount = ref.segments?.length ?? 0;
  if (
    ref.streamEvents === undefined &&
    segmentCount <= MAX_PERSISTED_REF_SEGMENTS
  ) {
    return ref;
  }
  const lean: Record<string, unknown> = { ...ref };
  delete lean['streamEvents'];
  if (ref.segments && segmentCount > MAX_PERSISTED_REF_SEGMENTS) {
    lean['segments'] = ref.segments.slice(-MAX_PERSISTED_REF_SEGMENTS);
  }
  return lean as unknown as CliSessionReference;
}

/** Apply {@link leanCliSessionRef} across a record's `cliSessions`. */
function withLeanCliSessions(metadata: SessionMetadata): SessionMetadata {
  const refs = metadata.cliSessions;
  if (!refs || refs.length === 0) return metadata;
  const lean = refs.map(leanCliSessionRef);
  const unchanged = lean.every((ref, i) => ref === refs[i]);
  return unchanged ? metadata : { ...metadata, cliSessions: lean };
}

/**
 * Session Metadata Store
 *
 * Minimal storage for session UI metadata.
 * Relies on SDK's native ~/.claude/projects/ for message persistence.
 */
@injectable()
export class SessionMetadataStore {
  /**
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
   * Number of write operations currently queued (running or waiting).
   * Only the LAST one to finish flushes {@link pendingAll} to storage — see
   * {@link settleWrite}.
   */
  private queueDepth = 0;

  /**
   * The all-sessions array as mutated by writes that have not yet reached
   * storage. Non-null only between a staged mutation and its flush, which is
   * always within the same write-queue drain, so a workspace switch cannot
   * slip in between. Reads consult it so a caller never observes its own write
   * as missing.
   */
  private pendingAll: SessionMetadata[] | null = null;

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
      const existing = all[index];
      all[index] = withLeanCliSessions({
        ...metadata,
        ...(existing.isChildSession && !metadata.isChildSession
          ? { isChildSession: true }
          : {}),
        ...(existing.cliSessions && !metadata.cliSessions
          ? { cliSessions: existing.cliSessions }
          : {}),
      });
    } else {
      all.push(withLeanCliSessions(metadata));
    }

    this.stage(all);
    this.logger.debug(
      `[SessionMetadataStore] Staged metadata for session ${metadata.sessionId}`,
    );
  }

  /**
   * Record the new all-sessions array without touching storage. The flush is
   * deferred to the end of the write-queue drain ({@link settleWrite}), so a
   * burst of writes — ten CLI agents exiting at once, or the re-persist pass
   * that runs for every exited agent when a session id resolves — serializes
   * the blob ONCE instead of once per event (TASK_2026_323 blocker B5).
   *
   * This is a coalesce, not a write-behind: `await save()` still resolves only
   * after the value has reached `IStateStorage`, because the flush happens
   * inside the awaited queue entry. Nothing is lost if the process exits.
   */
  private stage(all: SessionMetadata[]): void {
    this.pendingAll = all;
  }

  /**
   * Write the staged snapshot, if any. Public so a host can force durability
   * at a checkpoint; normally called for you when the write queue drains.
   *
   * `pendingAll` is cleared only AFTER the update resolves, and only when it is
   * still the snapshot we wrote — otherwise an unqueued reader would fall back
   * to storage that has not caught up yet, and a write landing mid-flush would
   * be discarded.
   */
  async flush(): Promise<void> {
    const snapshot = this.pendingAll;
    if (!snapshot) return;
    await this.storage.update(STORAGE_KEY, snapshot);
    if (this.pendingAll === snapshot) {
      this.pendingAll = null;
    }
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
   * Get all session metadata.
   *
   * Served from the staged snapshot while a write-queue drain is in progress
   * so a read never observes a mutation that has been applied but not yet
   * flushed. Always a fresh array — `_saveInternal` mutates what it gets back.
   */
  async getAll(): Promise<SessionMetadata[]> {
    if (this.pendingAll) return [...this.pendingAll];
    return (await this.storage.get<SessionMetadata[]>(STORAGE_KEY)) || [];
  }

  /**
   * Persist one agent's bulk output under its OWN storage key.
   *
   * Called once, when the agent exits. Nothing here ever reaches the
   * all-sessions blob — that is the entire point of the split. A snapshot with
   * neither segments nor stream events writes nothing.
   */
  async saveAgentOutput(
    agentId: string,
    output: {
      segments?: readonly CliOutputSegment[];
      streamEvents?: readonly FlatStreamEventUnion[];
    },
  ): Promise<void> {
    if (blankToUndefined(agentId) === undefined) return;
    const hasSegments = (output.segments?.length ?? 0) > 0;
    const hasStreamEvents = (output.streamEvents?.length ?? 0) > 0;
    if (!hasSegments && !hasStreamEvents) return;

    const record: PersistedAgentOutput = {
      agentId,
      savedAt: Date.now(),
      ...(hasSegments ? { segments: output.segments } : {}),
      ...(hasStreamEvents ? { streamEvents: output.streamEvents } : {}),
    };
    await this.storage.update(agentOutputKey(agentId), record);
    this.logger.debug(
      `[SessionMetadataStore] Stored agent output for ${agentId}`,
      {
        segments: output.segments?.length ?? 0,
        streamEvents: output.streamEvents?.length ?? 0,
      },
    );
  }

  /** Read one agent's bulk output, or null when nothing was stored. */
  async getAgentOutput(agentId: string): Promise<PersistedAgentOutput | null> {
    if (blankToUndefined(agentId) === undefined) return null;
    return (
      (await this.storage.get<PersistedAgentOutput>(agentOutputKey(agentId))) ??
      null
    );
  }

  /** Drop one agent's bulk output. Silent when there is nothing stored. */
  async deleteAgentOutput(agentId: string): Promise<void> {
    if (blankToUndefined(agentId) === undefined) return;
    await this.storage.update(agentOutputKey(agentId), undefined);
  }

  /**
   * CLI session references for a session, rehydrated with the bulk output the
   * blob no longer carries.
   *
   * This is the LAZY read half of the split: the restore path (RPC
   * `session:cli-sessions`, and the `cliSessions` payload of `chat:resume`)
   * calls this instead of spreading `metadata.cliSessions`, so the agent cards
   * still get their `streamEvents` execution tree and full `segments` — but
   * only when someone actually asks to restore a session, rather than on every
   * agent spawn and exit.
   */
  async getCliSessionsForRestore(
    sessionId: string,
  ): Promise<CliSessionReference[]> {
    const metadata = await this.get(sessionId);
    const refs = metadata?.cliSessions;
    if (!refs || refs.length === 0) return [];

    const hydrated: CliSessionReference[] = [];
    for (const ref of refs) {
      const output = await this.getAgentOutput(ref.agentId);
      if (!output) {
        hydrated.push(ref);
        continue;
      }
      hydrated.push({
        ...ref,
        ...(output.segments?.length ? { segments: output.segments } : {}),
        ...(output.streamEvents?.length
          ? { streamEvents: output.streamEvents }
          : {}),
      });
    }
    return hydrated;
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
      const existingIndex = existing.findIndex(
        (s) => s.cliSessionId === cliSession.cliSessionId,
      );
      // Bulk output goes to its own key (`saveAgentOutput`), never into the
      // all-sessions blob. Callers that hand us a fat reference are trimmed
      // here rather than trusted.
      const lean = leanCliSessionRef(cliSession);

      let updated: readonly CliSessionReference[];
      if (existingIndex >= 0) {
        const mutable = [...existing];
        mutable[existingIndex] = lean;
        updated = mutable;
        this.logger.info(
          `[SessionMetadataStore] Updated CLI session ${cliSession.cliSessionId} (${cliSession.cli}) in session ${sessionId}`,
        );
      } else {
        updated = [...existing, lean];
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
    const removed = all.filter((m) => m.sessionId === sessionId);
    const filtered = all.filter((m) => m.sessionId !== sessionId);

    if (filtered.length !== all.length) {
      this.stage(filtered);
      // The per-agent output keys are only reachable through this session's
      // references, so dropping the session without them would leak a key per
      // agent forever.
      for (const record of removed) {
        for (const ref of record.cliSessions ?? []) {
          await this.deleteAgentOutput(ref.agentId);
        }
      }
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
    // Same invariant SessionRegistry.bindRealSessionId enforces on the same
    // value three lines away in SdkAgentAdapter. A record keyed by '' is not a
    // session anyone can address: the sidebar, the resume path and the
    // authorization layer all look sessions up by id, and there is no sensible
    // metadata to return for a session that has no identity (TASK_2026_295).
    if (blankToUndefined(sessionId) === undefined) {
      throw new SdkError(
        'Cannot create session metadata with an empty sessionId — the SDK session UUID from the system init message is the only valid key.',
      );
    }

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
   * Flag a session as a hidden child WITHOUT clobbering its existing name,
   * cost, or timestamps.
   *
   * Unlike {@link createChild} (which writes a fresh zero-cost record and is
   * meant to pre-empt import), this is safe to call on a session that may
   * already have been imported as a top-level sidebar entry: it upgrades the
   * existing record in place, or creates a minimal child record when none
   * exists yet. Idempotent — a no-op once `isChildSession` is set.
   *
   * Used by the CLI-agent persist path so a spawned Ptah CLI agent's own SDK
   * session is guaranteed to be hidden from the sidebar even when the live
   * `createChild`-on-resolve hook was never wired (e.g. MCP-spawned agents).
   */
  async markChildSession(
    sessionId: string,
    workspaceId: string,
    name = 'CLI Agent Session',
  ): Promise<void> {
    let emitKind: SessionMetadataChangeKind | null = null;
    await this.enqueueWrite(async () => {
      const existing = await this.get(sessionId);
      if (existing?.isChildSession) return;
      const now = Date.now();
      const metadata: SessionMetadata = existing
        ? { ...existing, isChildSession: true }
        : {
            sessionId,
            name,
            workspaceId,
            createdAt: now,
            lastActiveAt: now,
            totalCost: 0,
            totalTokens: { input: 0, output: 0 },
            isChildSession: true,
          };
      await this._saveInternal(metadata);
      emitKind = existing ? 'updated' : 'created';
    });
    if (emitKind) {
      this.emitChange(emitKind, sessionId, workspaceId);
    }
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
   *
   * The operation stages its result in memory; the storage write happens in
   * {@link settleWrite} once no further operation is queued behind it. The
   * caller still awaits the storage write, so `save()` keeps its durability
   * contract while a burst costs one serialize instead of N.
   */
  private enqueueWrite(fn: () => Promise<void>): Promise<void> {
    this.queueDepth++;
    const next = this.writeQueue
      .then(fn, () => fn())
      .then(
        () => this.settleWrite(),
        async (error: unknown) => {
          // The operation's own failure is what the caller is waiting to hear —
          // `addCliSession` callers branch on "Parent session not found". A
          // flush failure on top of it is logged inside settleWrite, not
          // substituted for the original.
          await this.settleWrite().catch(() => undefined);
          throw error;
        },
      );
    this.writeQueue = next.catch(() => {
      /* swallow to keep chain alive */
    });
    return next;
  }

  /**
   * Leave the write queue. The last operation out flushes what the whole burst
   * staged; the others return immediately, having contributed their mutation
   * to the snapshot the last one writes.
   *
   * A failed flush keeps the snapshot staged, so the value stays visible to
   * readers and the next write retries it rather than silently dropping it.
   */
  private async settleWrite(): Promise<void> {
    this.queueDepth--;
    if (this.queueDepth > 0) return;
    try {
      await this.flush();
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionMetadataStore] Failed to flush session metadata',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }
}
