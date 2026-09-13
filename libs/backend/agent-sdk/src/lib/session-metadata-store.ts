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
import {
  PLATFORM_TOKENS,
  isAsyncStateStorage,
  type IAsyncStateStorage,
  type IStateStorage,
  type StateStorageArraySplitPlan,
} from '@ptah-extension/platform-core';
import { SdkError } from './errors';
import type {
  CliOutputSegment,
  CliSessionReference,
  FlatStreamEventUnion,
  SessionMetadataChangedNotification,
  SessionMetadataChangeKind,
  SubagentRecord,
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

  /**
   * Exact process working directory used by the SDK session. This can differ
   * from workspaceId when the session runs in a git worktree.
   */
  readonly workingDirectory?: string;

  /**
   * Interrupted SDK subagents that can be resumed after host restart.
   * Rival CLI/background/running/completed records never belong here.
   */
  readonly resumableSdkSubagents?: readonly SubagentRecord[];

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
const SESSION_DETAIL_KEY_PREFIX = 'ptah.session:';

/** Key prefix for per-agent bulk output. One key per agent, written once. */
const AGENT_OUTPUT_KEY_PREFIX = 'ptah.agentOutput:';

const SESSION_INDEX_SCHEMA_VERSION = 1;

interface SessionMetadataIndex {
  readonly schemaVersion: typeof SESSION_INDEX_SCHEMA_VERSION;
  readonly items: readonly SessionMetadata[];
}

export type TaggedAgentOutputItem =
  | { readonly tag: 'segment'; readonly value: CliOutputSegment }
  | { readonly tag: 'streamEvent'; readonly value: FlatStreamEventUnion };

/** Declarative recipe executed by Electron's generic storage worker. */
export const SESSION_METADATA_MIGRATION: StateStorageArraySplitPlan = {
  kind: 'split-array-value',
  planVersion: 1,
  sourceKey: STORAGE_KEY,
  itemIdPath: ['sessionId'],
  detailKeyPrefix: SESSION_DETAIL_KEY_PREFIX,
  indexKey: STORAGE_KEY,
  indexSchemaVersion: SESSION_INDEX_SCHEMA_VERSION,
  summaryFields: [
    { sourcePath: ['sessionId'] },
    { sourcePath: ['name'] },
    { sourcePath: ['workspaceId'] },
    { sourcePath: ['createdAt'] },
    { sourcePath: ['lastActiveAt'] },
    { sourcePath: ['totalCost'] },
    { sourcePath: ['totalTokens'] },
    { sourcePath: ['isChildSession'] },
  ],
  nestedExtractions: [
    {
      sourceArrayPath: ['cliSessions'],
      itemIdPath: ['agentId'],
      destinationKeyPrefix: AGENT_OUTPUT_KEY_PREFIX,
      fields: [
        { sourcePath: ['segments'] },
        { sourcePath: ['streamEvents'] },
      ],
      destinationFormat: {
        kind: 'tagged-sequence',
        fields: [
          { sourcePath: ['segments'], tag: 'segment' },
          { sourcePath: ['streamEvents'], tag: 'streamEvent' },
        ],
      },
      onMissingId: 'retain-source',
      conflictPolicy: {
        kind: 'prefer-longer-arrays',
        fields: ['segments', 'streamEvents'],
      },
    },
  ],
};

export const SESSION_METADATA_WORKER_CACHE_EXCLUSIONS = [
  SESSION_DETAIL_KEY_PREFIX,
  AGENT_OUTPUT_KEY_PREFIX,
] as const;

function sessionDetailKey(sessionId: string): string {
  return `${SESSION_DETAIL_KEY_PREFIX}${sessionId}`;
}

/**
 * Segments retained INLINE on a `CliSessionReference`.
 *
 * A short tail is retained only in persisted metadata for compatibility with
 * older writers. Restore/list callers receive a fully lean reference; all
 * historical output is fetched through bounded output pages.
 */
const MAX_PERSISTED_REF_SEGMENTS = 200;
const MAX_RPC_RESPONSE_BYTES = 256 * 1024;
const RPC_CORRELATION_ID_BUDGET = '0'.repeat(64);
/** Stands in for the continuation cursor when reserving the RPC envelope. */
const RPC_CURSOR_RESERVATION = '0'.repeat(32);
/**
 * The worker bounds its own protocol envelope, which is not the RPC envelope.
 * The first budget sent to it is half the RPC budget, and never more than what
 * fits in the RPC budget after the envelope reservation. The exact serializer
 * shape is still checked after the page returns.
 */
const WORKER_PAGE_BUDGET_DIVISOR = 2;
/**
 * The worker's estimate is not UTF-8: a string costs 8 plus 2 per UTF-16 unit
 * and a number costs 8, so a page that encodes to N bytes can estimate at up to
 * about 8N. Bounds how far a budget the worker refused may be widened.
 */
const WORKER_ESTIMATE_MAX_RATIO = 8;

function agentOutputKey(agentId: string): string {
  return `${AGENT_OUTPUT_KEY_PREFIX}${agentId}`;
}

function parseAgentOutputCursor(
  cursor: string | undefined,
  itemCount: number,
): number {
  if (cursor === undefined) return 0;
  if (!/^(0|[1-9]\d*)$/.test(cursor)) {
    throw new SdkError('Invalid agent output cursor');
  }
  const index = Number(cursor);
  if (!Number.isSafeInteger(index) || index < 0 || index > itemCount) {
    throw new SdkError('Invalid agent output cursor');
  }
  return index;
}

interface AgentOutputPage {
  items: readonly TaggedAgentOutputItem[];
  nextCursor: string | null;
  done: boolean;
}

function rpcOutputPageBytes(
  items: readonly TaggedAgentOutputItem[],
  nextCursor: string | null,
  done: boolean,
): number {
  return new TextEncoder().encode(
    JSON.stringify({
      success: true,
      data: { items, nextCursor, done },
      correlationId: RPC_CORRELATION_ID_BUDGET,
    }),
  ).byteLength;
}

/**
 * Strip the bulk fields from a CLI session reference before it enters the
 * all-sessions blob. `streamEvents` never belongs there; `segments` is trimmed
 * to a tail. Returns the SAME object when nothing needed removing so callers
 * can cheaply detect a no-op.
 *
 * Leaning is DESTRUCTIVE — the removed events exist nowhere else once the blob
 * is rewritten — so nothing calls this directly on a reference that may still
 * be the only copy. {@link SessionMetadataStore.leanCliSessions} migrates the
 * bulk to `ptah.agentOutput:<agentId>` first and only leans what it has
 * safely written.
 */
function leanCliSessionRef(
  ref: CliSessionReference,
  retainSegmentTail: boolean,
): CliSessionReference {
  const segmentCount = ref.segments?.length ?? 0;
  if (
    ref.streamEvents === undefined &&
    (retainSegmentTail
      ? segmentCount <= MAX_PERSISTED_REF_SEGMENTS
      : ref.segments === undefined)
  ) {
    return ref;
  }
  const lean: Record<string, unknown> = { ...ref };
  delete lean['streamEvents'];
  if (retainSegmentTail) {
    if (ref.segments && segmentCount > MAX_PERSISTED_REF_SEGMENTS) {
      lean['segments'] = ref.segments.slice(-MAX_PERSISTED_REF_SEGMENTS);
    }
  } else {
    delete lean['segments'];
  }
  return lean as unknown as CliSessionReference;
}

/**
 * Every live store, so a host's shutdown path can drain the coalesced write
 * queue without holding a container reference.
 *
 * `apps/ptah-cli/src/main.ts` installs its signal handlers before any container
 * exists — `withEngine` owns every container it builds — which is the same
 * reason `CliDIContainer` keeps its `flushSync` target in a static. Weak
 * references so a discarded container's store is still collectable.
 */
const LIVE_STORES = new Set<WeakRef<SessionMetadataStore>>();

/**
 * Flush every live {@link SessionMetadataStore}'s staged snapshot.
 *
 * The store coalesces a burst of mutations into one `IStateStorage.update` at
 * the end of the write-queue drain. That is durable for anything awaited, but a
 * failed flush stays staged and a mutation made by a fire-and-forget caller can
 * still be in flight when the host is told to quit — so every shutdown path
 * calls this (TASK_2026_324 finding 3). Never throws: a host teardown must not
 * be derailed by a storage that is already going away.
 */
export async function flushSessionMetadataStores(): Promise<void> {
  const live: SessionMetadataStore[] = [];
  for (const weak of LIVE_STORES) {
    const store = weak.deref();
    if (store) live.push(store);
    else LIVE_STORES.delete(weak);
  }
  await Promise.all(live.map((store) => store.flushForShutdown()));
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

  private async readStorage<T>(key: string): Promise<T | undefined> {
    return isAsyncStateStorage(this.storage)
      ? await this.storage.getAsync<T>(key)
      : this.storage.get<T>(key);
  }

  private indexEntry(metadata: SessionMetadata): SessionMetadata {
    const entry: Record<string, unknown> = { ...metadata };
    delete entry['cliSessions'];
    return entry as unknown as SessionMetadata;
  }

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
  ) {
    LIVE_STORES.add(new WeakRef(this));
  }

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
    const existing = await this.get(metadata.sessionId);
    const detail = await this.leanCliSessions({
      ...metadata,
      ...(existing?.isChildSession && !metadata.isChildSession
        ? { isChildSession: true }
        : {}),
      ...(existing?.cliSessions && !metadata.cliSessions
        ? { cliSessions: existing.cliSessions }
        : {}),
      ...(existing?.workingDirectory && !metadata.workingDirectory
        ? { workingDirectory: existing.workingDirectory }
        : {}),
      ...(existing?.resumableSdkSubagents &&
      metadata.resumableSdkSubagents === undefined
        ? { resumableSdkSubagents: existing.resumableSdkSubagents }
        : {}),
    });

    if (isAsyncStateStorage(this.storage)) {
      // Detail first, lean index second. Readers never observe an index entry
      // whose authoritative detail has not reached durable storage.
      await this.storage.update(sessionDetailKey(metadata.sessionId), detail);
      const all = await this.getAll();
      const index = all.findIndex((m) => m.sessionId === metadata.sessionId);
      const summary = this.indexEntry(detail);
      if (index >= 0) all[index] = summary;
      else all.push(summary);
      this.stage(all);
    } else {
      const all = await this.getAll();
      const index = all.findIndex((m) => m.sessionId === metadata.sessionId);
      if (index >= 0) all[index] = detail;
      else all.push(detail);
      this.stage(all);
    }
    this.logger.debug(
      `[SessionMetadataStore] Staged metadata for session ${metadata.sessionId}`,
    );
  }

  /**
   * Lean a record's `cliSessions` for the blob, MIGRATING whatever leaning
   * removes to `ptah.agentOutput:<agentId>` first.
   *
   * This is the one place a fat reference can be made lean, and the order is
   * the whole point. `addCliSession` is not the only way a reference gets into
   * a record: a blob written before the per-agent split still carries inline
   * `streamEvents`, and `save` / `addStats` / `rename` /
   * `propagateStatsToParent` all round-trip that record. Leaning first and
   * writing the bulk never (the shape this replaces) meant the first
   * incidental write — a cost update on an unrelated turn — silently deleted
   * an agent's entire execution tree (TASK_2026_324 finding 1).
   *
   * Two refs are left fat on purpose:
   *  - one with no `agentId`, because `ptah.agentOutput:<agentId>` IS the
   *    destination and there is no id to key it by;
   *  - one whose migration failed, so the only copy stays where readers can
   *    still see it and the next write retries.
   */
  private async leanCliSessions(
    metadata: SessionMetadata,
  ): Promise<SessionMetadata> {
    const refs = metadata.cliSessions;
    if (!refs || refs.length === 0) return metadata;

    const lean: CliSessionReference[] = [];
    let changed = false;
    for (const ref of refs) {
      const leanRef = leanCliSessionRef(
        ref,
        !isAsyncStateStorage(this.storage),
      );
      if (leanRef === ref) {
        lean.push(ref);
        continue;
      }
      if (blankToUndefined(ref.agentId) === undefined) {
        this.logger.warn(
          '[SessionMetadataStore] CLI session reference carries bulk output but no agentId — left inline',
          { cliSessionId: ref.cliSessionId, cli: ref.cli },
        );
        lean.push(ref);
        continue;
      }
      if (!(await this.migrateRefOutput(ref))) {
        lean.push(ref);
        continue;
      }
      lean.push(leanRef);
      changed = true;
    }
    return changed ? { ...metadata, cliSessions: lean } : metadata;
  }

  /**
   * Move one fat reference's bulk output onto its per-agent key.
   *
   * Returns true only when the bulk is durable there — either because this
   * call wrote it, or because the stored snapshot already holds at least as
   * much. Agent output is append-only, so "longer wins" per field can only
   * ever ADD: a re-persist that arrives with a truncated tail cannot overwrite
   * the complete snapshot an earlier `saveAgentOutput` stored.
   *
   * False means the caller must keep the reference fat. A failed migration is
   * a warning, not a throw — the write it is part of carries other mutations
   * (stats, a rename) that are still worth persisting.
   */
  private async migrateRefOutput(ref: CliSessionReference): Promise<boolean> {
    const agentId = ref.agentId;
    try {
      const stored = await this.getAgentOutput(agentId);
      const refSegments = ref.segments ?? [];
      const refStreamEvents = ref.streamEvents ?? [];
      const storedSegments = stored?.segments ?? [];
      const storedStreamEvents = stored?.streamEvents ?? [];

      const segmentsWin = refSegments.length > storedSegments.length;
      const streamEventsWin =
        refStreamEvents.length > storedStreamEvents.length;
      if (!segmentsWin && !streamEventsWin) return true;

      await this.saveAgentOutput(agentId, {
        segments: segmentsWin ? refSegments : storedSegments,
        streamEvents: streamEventsWin ? refStreamEvents : storedStreamEvents,
      });
      this.logger.info(
        `[SessionMetadataStore] Migrated inline CLI output for agent ${agentId} to its own key`,
        {
          segments: segmentsWin ? refSegments.length : storedSegments.length,
          streamEvents: streamEventsWin
            ? refStreamEvents.length
            : storedStreamEvents.length,
        },
      );
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - moving inline CLI output to
      // its own key is a size optimisation; false leaves the fat reference in
      // place, which still holds the output, and a later pass retries.
      this.logger.warn(
        `[SessionMetadataStore] Could not migrate inline CLI output for agent ${agentId} — reference kept fat`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return false;
    }
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
    await this.storage.update(
      STORAGE_KEY,
      isAsyncStateStorage(this.storage)
        ? {
            schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
            items: snapshot.map((item) => this.indexEntry(item)),
          }
        : snapshot,
    );
    if (this.pendingAll === snapshot) {
      this.pendingAll = null;
    }
  }

  /**
   * {@link flush} for a host teardown: never throws, always logs.
   *
   * The three shutdown paths reach this through
   * {@link flushSessionMetadataStores}. A quit must not be turned into a crash
   * by a storage that is already closing, and there is no caller left to hand
   * the rejection to.
   */
  async flushForShutdown(): Promise<void> {
    try {
      await this.flush();
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionMetadataStore] Shutdown flush failed — staged session metadata lost',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Get metadata by session ID
   */
  async get(sessionId: string): Promise<SessionMetadata | null> {
    if (isAsyncStateStorage(this.storage)) {
      const detail = await this.readStorage<SessionMetadata>(
        sessionDetailKey(sessionId),
      );
      if (detail) return detail;
    }
    const all = await this.getAll();
    return all.find((m) => m.sessionId === sessionId) || null;
  }

  /**
   * Persist the process-resume state owned by chat orchestration.
   *
   * The filter is deliberately repeated at the storage boundary: callers may
   * pass a registry snapshot, but only interrupted foreground SDK subagents
   * belonging to this canonical session are durable.
   */
  async saveResumeState(
    sessionId: string,
    state: {
      workingDirectory?: string;
      resumableSdkSubagents: readonly SubagentRecord[];
    },
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      const metadata = await this.get(sessionId);
      if (!metadata) {
        this.logger.warn(
          `[SessionMetadataStore] Cannot save resume state for missing session ${sessionId}`,
        );
        return;
      }

      const resumableSdkSubagents = state.resumableSdkSubagents
        .filter(
          (record) =>
            record.status === 'interrupted' &&
            record.parentSessionId === sessionId &&
            !record.isBackground &&
            !record.isCliAgent &&
            blankToUndefined(record.toolCallId) !== undefined &&
            blankToUndefined(record.agentId) !== undefined,
        )
        .map((record) => ({ ...record }));

      await this._saveInternal({
        ...metadata,
        ...(blankToUndefined(state.workingDirectory)
          ? { workingDirectory: state.workingDirectory }
          : {}),
        resumableSdkSubagents,
      });
    });
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
    // Copied, not handed through. `_saveInternal` replaces entries in what it
    // gets back, and `IStateStorage.get` returns the adapter's own cached
    // array (`vscode.Memento` included) — so returning it directly let a
    // staged-but-unflushed mutation appear as if it had been stored, and a
    // failed flush left the "unwritten" value already in place.
    const stored = await this.readStorage<SessionMetadata[] | SessionMetadataIndex>(
      STORAGE_KEY,
    );
    const items = Array.isArray(stored) ? stored : stored?.items;
    return [...(items ?? [])];
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
    if (isAsyncStateStorage(this.storage)) {
      await this.storage.replaceJsonSequence(
        agentOutputKey(agentId),
        (async function* (): AsyncGenerator<{
          items: readonly TaggedAgentOutputItem[];
        }> {
          for (const value of output.segments ?? []) {
            yield { items: [{ tag: 'segment', value }] };
          }
          for (const value of output.streamEvents ?? []) {
            yield { items: [{ tag: 'streamEvent', value }] };
          }
        })(),
      );
    } else {
      await this.storage.update(agentOutputKey(agentId), record);
    }
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
    if (isAsyncStateStorage(this.storage)) {
      const segments: CliOutputSegment[] = [];
      const streamEvents: FlatStreamEventUnion[] = [];
      for await (const page of this.storage.readJsonSequence<TaggedAgentOutputItem>(
        agentOutputKey(agentId),
      )) {
        for (const item of page.items) {
          if (item.tag === 'segment')
            segments.push(item.value as CliOutputSegment);
          else streamEvents.push(item.value as FlatStreamEventUnion);
        }
      }
      if (segments.length === 0 && streamEvents.length === 0) return null;
      return {
        agentId,
        savedAt: 0,
        ...(segments.length ? { segments } : {}),
        ...(streamEvents.length ? { streamEvents } : {}),
      };
    }
    return (
      (await this.readStorage<PersistedAgentOutput>(agentOutputKey(agentId))) ??
      null
    );
  }

  /** Return one bounded page without assembling historical output. */
  async getAgentOutputPage(
    agentId: string,
    cursor?: string,
    maxBytes = 128 * 1024,
  ): Promise<{
    items: readonly TaggedAgentOutputItem[];
    nextCursor: string | null;
    done: boolean;
  }> {
    if (blankToUndefined(agentId) === undefined) {
      return { items: [], nextCursor: null, done: true };
    }
    if (isAsyncStateStorage(this.storage)) {
      return this.readWorkerOutputPage(this.storage, agentId, cursor, maxBytes);
    }
    const output =
      (await this.readStorage<PersistedAgentOutput>(agentOutputKey(agentId))) ??
      null;
    const outputSegments = output?.segments ?? [];
    const outputEvents = output?.streamEvents ?? [];
    const itemCount = outputSegments.length + outputEvents.length;
    const start = parseAgentOutputCursor(cursor, itemCount);
    const pageBudget = Math.min(maxBytes, MAX_RPC_RESPONSE_BYTES);
    const items: TaggedAgentOutputItem[] = [];
    let index = start;
    while (index < itemCount) {
      const nextItem: TaggedAgentOutputItem =
        index < outputSegments.length
          ? { tag: 'segment', value: outputSegments[index] }
          : {
              tag: 'streamEvent',
              value: outputEvents[index - outputSegments.length],
            };
      const candidateItems = [...items, nextItem];
      const candidateNextCursor = String(index + 1);
      const candidateDone = index + 1 >= itemCount;
      if (
        rpcOutputPageBytes(
          candidateItems,
          candidateDone ? null : candidateNextCursor,
          candidateDone,
        ) > pageBudget
      ) {
        if (items.length === 0) {
          throw new SdkError('Agent output item exceeds page budget');
        }
        break;
      }
      items.push(nextItem);
      index++;
    }
    const done = index >= itemCount;
    return {
      items,
      nextCursor: done ? null : String(index),
      done,
    };
  }

  /**
   * One worker-backed page that fits the RPC budget. The worker packs pages by
   * its own estimate, which can over- or under-count UTF-8, so the budget sent
   * to it is searched: widened when it cannot fit even one item, narrowed when
   * its page encodes past the RPC budget. Every successful call returns at
   * least one item; only an item that cannot fit on its own is an error.
   */
  private async readWorkerOutputPage(
    storage: IAsyncStateStorage,
    agentId: string,
    cursor: string | undefined,
    maxBytes: number,
  ): Promise<AgentOutputPage> {
    const rpcBudget = Math.min(maxBytes, MAX_RPC_RESPONSE_BYTES);
    const itemBudget =
      rpcBudget - rpcOutputPageBytes([], RPC_CURSOR_RESERVATION, false);
    if (itemBudget <= 0) {
      throw new SdkError('Agent output page budget cannot fit the RPC envelope');
    }
    const initial = Math.max(
      1,
      Math.min(itemBudget, Math.floor(rpcBudget / WORKER_PAGE_BUDGET_DIVISOR)),
    );
    const ceiling = Math.max(
      initial,
      Math.min(MAX_RPC_RESPONSE_BYTES, itemBudget * WORKER_ESTIMATE_MAX_RATIO),
    );
    let refused = 0; // largest budget the worker could not fit one item into
    let overflowed = ceiling + 1; // smallest budget whose page was too large
    let budget = initial;
    for (;;) {
      let page: AgentOutputPage;
      try {
        page = await this.readFirstOutputPage(storage, agentId, cursor, budget);
      } catch (error: unknown) {
        if (budget >= ceiling) throw error;
        refused = budget;
        budget =
          overflowed > ceiling
            ? ceiling
            : Math.floor((refused + overflowed) / 2);
        if (budget <= refused) throw error;
        continue;
      }
      if (
        rpcOutputPageBytes(page.items, page.nextCursor, page.done) <= rpcBudget
      ) {
        return page;
      }
      if (page.items.length <= 1) {
        throw new SdkError('Agent output item exceeds RPC page budget');
      }
      overflowed = budget;
      budget = Math.floor((refused + overflowed) / 2);
      if (budget <= refused) {
        throw new SdkError('Agent output page exceeds RPC budget');
      }
    }
  }

  private async readFirstOutputPage(
    storage: IAsyncStateStorage,
    agentId: string,
    cursor: string | undefined,
    maxBytes: number,
  ): Promise<AgentOutputPage> {
    // Take-first, stated as such. The caller searches for a budget by calling
    // this again with a new one, so only the first page is ever wanted.
    // Iterating by hand means the cleanup `for await`'s early exit performed
    // implicitly has to be explicit: implementations are async generators over
    // a file or a worker channel, and abandoning one without `return()` leaves
    // its `finally` unrun.
    const sequence = storage.readJsonSequence<TaggedAgentOutputItem>(
      agentOutputKey(agentId),
      { cursor, maxBytes },
    );
    const pages = sequence[Symbol.asyncIterator]();
    try {
      const first = await pages.next();
      if (first.done) return { items: [], nextCursor: null, done: true };
      const { items, nextCursor, done } = first.value;
      return { items, nextCursor, done };
    } finally {
      await pages.return?.(undefined);
    }
  }

  /** Drop one agent's bulk output. Silent when there is nothing stored. */
  async deleteAgentOutput(agentId: string): Promise<void> {
    if (blankToUndefined(agentId) === undefined) return;
    await this.storage.update(agentOutputKey(agentId), undefined);
  }

  /**
   * Lean CLI references for startup and resume. Historical output remains in
   * per-agent sequences and is requested through bounded pages.
   */
  async getCliSessionsForRestore(
    sessionId: string,
  ): Promise<CliSessionReference[]> {
    const metadata = await this.get(sessionId);
    const refs = metadata?.cliSessions;
    if (!refs || refs.length === 0) return [];
    return refs.map((ref) => leanCliSessionRef(ref, false));
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
    for (const summary of all) {
      const session = isAsyncStateStorage(this.storage)
        ? await this.get(summary.sessionId)
        : summary;
      if (
        session?.cliSessions?.some((ref) => ref.sdkSessionId === childSessionId)
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

      // The reference goes in as handed to us. Bulk output belongs on its own
      // key, and `_saveInternal` is the single place that moves it there and
      // leans what it has written — trimming here as well would delete the
      // only copy before anything had a chance to migrate it.
      let updated: readonly CliSessionReference[];
      // Re-association: the same `cliSessionId` resumed under a NEW agent. The
      // slot is the only route to `ptah.agentOutput:<agentId>`, so the
      // displaced agent's key becomes unreachable — a leak per resume, and
      // `_deleteInternal` can never collect it either (TASK_2026_324
      // finding 4). Collected here, deleted only once the replacement
      // reference is durable: see the note at the delete site below.
      let displacedAgentId: string | undefined;
      if (existingIndex >= 0) {
        const previous = existing[existingIndex];
        const mutable = [...existing];
        mutable[existingIndex] = cliSession;
        updated = mutable;
        if (
          blankToUndefined(previous.agentId) !== undefined &&
          previous.agentId !== cliSession.agentId
        ) {
          displacedAgentId = previous.agentId;
        }
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

      // AFTER the replacement reference is DURABLE, never before. Deleting
      // first leaves stored metadata pointing at an agent whose output key is
      // already gone — the reference survives and its content does not, which
      // reads to every consumer as an agent that produced nothing. Deleting
      // second can only leak the key it was already leaking, and the next
      // successful re-association collects it.
      //
      // `_saveInternal` only STAGES (see `stage`), so the flush has to be
      // forced here: the queue drain that normally flushes runs after this
      // callback returns, which is after the delete. Coalescing is untouched
      // on every other path — a re-association under a new agent id happens
      // once per resume, not once per event.
      if (displacedAgentId !== undefined) {
        await this.flush();
        await this.deleteAgentOutput(displacedAgentId);
        this.logger.info(
          `[SessionMetadataStore] Dropped orphaned output key for re-associated agent ${displacedAgentId}`,
          { cliSessionId: cliSession.cliSessionId },
        );
      }
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
    const removedSummary = all.find((m) => m.sessionId === sessionId);
    const removedDetail = isAsyncStateStorage(this.storage)
      ? await this.get(sessionId)
      : removedSummary;
    const removed = removedDetail ? [removedDetail] : [];
    const filtered = all.filter((m) => m.sessionId !== sessionId);

    if (filtered.length !== all.length) {
      this.stage(filtered);

      // Make the session list removal DURABLE before dropping output keys.
      // `stage` only mutates `pendingAll` in memory. If we deleted output keys
      // before flushing and the subsequent flush failed, the session record
      // would survive in storage with dead references pointing to destroyed
      // output keys that no longer exist.
      //
      // Forcing `flush()` here costs one extra `storage.update` instead of
      // riding the write queue's coalesced write, which is the right trade
      // for a rare, destructive operation. If the flush rejects, the rejection
      // propagates to the caller and no output keys are destroyed.
      await this.flush();

      // The index must be absent before its detail is deleted, and the detail
      // must be absent before output keys are collected. A failure can leak
      // data for a later retry but cannot leave a live reference dangling.
      if (isAsyncStateStorage(this.storage)) {
        await this.storage.update(sessionDetailKey(sessionId), undefined);
      }

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
      workingDirectory: workspaceId,
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
      workingDirectory: workspaceId,
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
          // degradation-audit: optional-capability - the flush is a courtesy
          // on the failure path and settleWrite logs its own error; undefined
          // keeps the operation's original rejection as what the caller hears.
          await this.settleWrite().catch(() => undefined);
          throw error;
        },
      );
    // degradation-audit: optional-capability - this branch is only the queue's
    // ordering handle, and `next` carries the real rejection to the caller;
    // swallowing keeps one failed write from wedging the writes behind it.
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
