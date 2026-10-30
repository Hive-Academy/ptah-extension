import {
  Injectable,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import type {
  ExecutionNode,
  FlatStreamEventUnion,
  MessageStartEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import {
  StreamingAccumulatorCore,
  type AccumulatorContext,
} from './accumulator-core.service';
import { AgentMonitorStore, type SubagentRecord } from './agent-monitor.store';
import { BackgroundAgentStore } from './background-agent.store';
import { BatchedUpdateService } from './batched-update.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { capFinalizedTree } from './execution-tree-retention';
import { SessionManager } from './session-manager.service';
import {
  mergeSubagentHistory,
  rewriteSubagentEvent,
} from './subagent-execution-history-merge';
import { SubagentExecutionOwnership } from './subagent-execution-ownership';
import { SubagentLiveRefreshTracker } from './subagent-live-refresh';
import {
  ENTRY_EVENT_CAP,
  FINALIZED_ENTRY_CAP,
  LIVE_EVENT_CAP,
  liveEventCount,
  oldestFinalized,
  oldestLiveSpill,
} from './subagent-execution-retention';

const HISTORY_EVENT_CAP = 10000;
const HISTORY_PAGE_CAP = 100;
const HISTORY_PAGE_BYTES = 256 * 1024;
const TERMINAL_STATUSES: ReadonlySet<SubagentRecord['status']> = new Set([
  'completed',
  'failed',
  'killed',
  'stopped',
]);
const STORE_ONLY = new Set<string>([
  'agent_progress',
  'agent_status',
  'agent_completed',
  'background_agent_started',
  'background_agent_completed',
  'background_agent_stopped',
]);

export type SubagentHistoryState =
  'idle' | 'loading' | 'loaded' | 'not-found' | 'unresolved' | 'error';

/** History outcomes that a change of owning session makes worth retrying. */
const RETRYABLE_HISTORY: ReadonlySet<SubagentHistoryState> = new Set([
  'not-found',
  'error',
  'unresolved',
]);

interface HistorySnapshot {
  readonly status: 'ok' | 'not-found' | 'unresolved';
  readonly events: FlatStreamEventUnion[];
  readonly clipped: number;
  readonly truncated: boolean;
}

export interface SubagentExecutionEntryView {
  readonly state: StreamingState | null;
  readonly finalized: readonly ExecutionNode[];
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly live: boolean;
  readonly truncated: boolean;
  readonly spilled: boolean;
  readonly clipped: number;
  readonly history: SubagentHistoryState;
  readonly historyError?: string;
}

export interface SubagentExecutionEntry {
  state: StreamingState | null;
  finalized: ExecutionNode[];
  sessionId?: string;
  agentId?: string;
  live: boolean;
  truncated: boolean;
  spilled: boolean;
  clipped: number;
  history: SubagentHistoryState;
  historyError?: string;
  generation: number;
  lastEventAt: number;
  refs: number;
  idAlias: Map<string, string>;
  revision: number;
}

/** Keeps each SDK subagent's execution outside the parent tab's turn state. */
@Injectable({ providedIn: 'root' })
export class SubagentExecutionStore {
  private readonly accumulator = inject(StreamingAccumulatorCore);
  private readonly builder = inject(ExecutionTreeBuilderService);
  private readonly deduplication = inject(EventDeduplicationService);
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly sessionManager = inject(SessionManager);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);

  private readonly mutableEntries = new Map<string, SubagentExecutionEntry>();
  private readonly entryKeys = new WeakMap<SubagentExecutionEntry, string>();
  private readonly keyRevisions = new Map<string, WritableSignal<number>>();
  /** Snapshot handed out per key; rebuilt whenever the entry revises. */
  private readonly entryViews = new Map<
    string,
    {
      entry: SubagentExecutionEntry;
      revision: number;
      view: SubagentExecutionEntryView;
    }
  >();
  private readonly _entries = signal<
    ReadonlyMap<string, SubagentExecutionEntry>
  >(new Map());
  readonly entries: Signal<ReadonlyMap<string, SubagentExecutionEntryView>> =
    this._entries.asReadonly();
  private readonly ownership = new SubagentExecutionOwnership();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly liveRefresh = new SubagentLiveRefreshTracker();
  private readonly overflowWarned = new Set<string>();
  private readonly continuationStarts = new Map<
    string,
    Map<string, MessageStartEvent>
  >();
  private readonly continuationTools = new Map<
    string,
    Map<string, ToolStartEvent>
  >();
  private readClock = 0;
  private readonly lastRead = new Map<string, number>();
  private readonly syncedRecords = new Map<string, SubagentRecord>();

  constructor() {
    effect(() => {
      const records = this.agentMonitorStore.subagents?.();
      if (!records) return;
      for (const [key, record] of records) {
        if (this.syncedRecords.get(key) === record) continue;
        this.syncedRecords.set(key, record);
        this.syncRecord(record);
      }
    });
  }

  private publish(entry?: SubagentExecutionEntry): void {
    if (entry) entry.revision++;
    if (entry)
      this.keyRevisions
        .get(this.entryKeys.get(entry) ?? '')
        ?.update((value) => value + 1);
    this._entries.set(new Map(this.mutableEntries));
  }

  revisionFor(key: string): number {
    let revision = this.keyRevisions.get(key);
    if (!revision) {
      revision = signal(0);
      this.keyRevisions.set(key, revision);
    }
    return revision();
  }

  /**
   * Snapshot view of one entry. A `computed` consumer compares results with
   * `Object.is`, so the same mutable reference never notifies its dependents
   * (history error/Retry states stopped rendering — PR #751). A fresh object
   * per revision fixes that; the per-revision cache keeps the identity stable
   * between publishes so an unchanged revision re-reads as equal.
   */
  entryFor(key: string): SubagentExecutionEntryView | undefined {
    this.revisionFor(key);
    const entry = this.mutableEntries.get(key);
    if (!entry) return undefined;
    const cached = this.entryViews.get(key);
    if (cached && cached.entry === entry && cached.revision === entry.revision)
      return cached.view;
    const view: SubagentExecutionEntryView = { ...entry };
    this.entryViews.set(key, { entry, revision: entry.revision, view });
    return view;
  }

  private open(key: string, sessionId?: string): SubagentExecutionEntry {
    let entry = this.mutableEntries.get(key);
    if (!entry) {
      entry = {
        state: null,
        finalized: [],
        sessionId,
        live: true,
        truncated: false,
        spilled: false,
        clipped: 0,
        history: 'idle',
        generation: 0,
        lastEventAt: 0,
        refs: 0,
        idAlias: new Map(),
        revision: 0,
      };
      this.mutableEntries.set(key, entry);
      this.entryKeys.set(entry, key);
      this.publish(entry);
    } else if (sessionId && !entry.sessionId) {
      entry.sessionId = sessionId;
      this.publish(entry);
    }
    return entry;
  }

  syncRecord(record: SubagentRecord): void {
    const key = record.parentToolUseId;
    this.syncedRecords.set(key, record);
    const entry = this.open(key, record.parentSessionId);
    this.adoptRecordSession(entry, record.parentSessionId);
    if (record.agentId) entry.agentId = record.agentId;
    if (record.lastEventAt)
      entry.lastEventAt = Math.max(entry.lastEventAt, record.lastEventAt);
    if (TERMINAL_STATUSES.has(record.status)) {
      this.finalize(key);
    } else {
      entry.live = true;
      this.publish(entry);
    }
  }

  /**
   * The monitor record's owning session is authoritative over the one an
   * earlier caller pinned (the bubble fallback can open with the wrong tab).
   * A history result for the old session says nothing about the new one, so a
   * failed or not-found load returns to 'idle' and the next load retries.
   */
  private adoptRecordSession(
    entry: SubagentExecutionEntry,
    sessionId: string | undefined,
  ): void {
    if (!sessionId || entry.sessionId === sessionId) return;
    entry.sessionId = sessionId;
    // A load in flight pages the old session; drop it so the next load
    // starts over in the new one. That includes a silent live refresh.
    const key = this.entryKeys.get(entry);
    if (entry.history === 'loading' || (key && this.inFlight.has(key)))
      this.abort(entry);
    if (key) this.liveRefresh.reset(key);
    if (RETRYABLE_HISTORY.has(entry.history)) {
      entry.history = 'idle';
      entry.historyError = undefined;
    }
    this.publish(entry);
  }

  /** True when the event belongs to an execution entry and was consumed. */
  claim(event: FlatStreamEventUnion): boolean {
    if (STORE_ONLY.has(event.eventType)) return false;
    let key: string | undefined;
    if (event.eventType === 'message_start' && event.parentToolUseId) {
      key = this.ownership.tool(event.parentToolUseId) ?? event.parentToolUseId;
    } else if (event.eventType === 'agent_start') {
      key = this.ownership.tool(event.toolCallId);
      if (!key) {
        const entry = this.open(event.toolCallId, event.sessionId);
        if (event.agentId) {
          entry.agentId = event.agentId;
          this.publish(entry);
        }
        return false;
      }
    } else {
      key = this.ownership.message(event.messageId);
      if (
        !key &&
        event.parentToolUseId &&
        (this.mutableEntries.has(event.parentToolUseId) ||
          this.ownership.tool(event.parentToolUseId))
      ) {
        key =
          this.ownership.tool(event.parentToolUseId) ?? event.parentToolUseId;
      }
    }
    if (!key) return this.ownership.wasEvicted(event.messageId);
    try {
      const entry = this.open(key, event.sessionId);
      if (event.eventType === 'message_start')
        this.ownership.own(key, event.messageId, 'message');
      if (event.eventType === 'tool_start')
        this.ownership.own(key, event.toolCallId, 'tool');
      const state = entry.state ?? this.newState();
      entry.state = state;
      const rewritten = rewriteSubagentEvent(event, entry.idAlias);
      this.seedContinuation(key, state, rewritten, entry);
      const evictsEvent =
        state.events.size >= ENTRY_EVENT_CAP && !state.events.has(rewritten.id);
      const result = this.accumulator.process(
        state,
        rewritten,
        this.context(() => this.publish(entry)),
      );
      if (result.replacementState) {
        result.replacementState.eventCap = ENTRY_EVENT_CAP;
        entry.state = result.replacementState;
      }
      if (evictsEvent && result.stateMutated) entry.truncated = true;
      entry.lastEventAt = Math.max(entry.lastEventAt, event.timestamp);
      entry.live = true;
      this.enforceLiveCap(key);
      this.publish(entry);
      const record =
        this.syncedRecords.get(key) ??
        this.agentMonitorStore.subagents?.().get(key);
      if (record && TERMINAL_STATUSES.has(record.status)) this.finalize(key);
      return true;
    } catch (error) {
      this.logger.error(
        'SubagentExecutionStore',
        'Failed to claim event',
        error,
      );
      const entry = this.mutableEntries.get(key);
      if (entry) {
        entry.truncated = true;
        this.publish(entry);
      }
      return true;
    }
  }

  private newState(): StreamingState {
    const state = createEmptyStreamingState();
    state.eventCap = ENTRY_EVENT_CAP;
    return state;
  }

  private seedContinuation(
    key: string,
    state: StreamingState,
    event: FlatStreamEventUnion,
    entry: SubagentExecutionEntry,
  ): void {
    if (event.eventType === 'message_start') return;
    const start = this.continuationStarts.get(key)?.get(event.messageId);
    if (start && !state.messageEventIds.includes(event.messageId)) {
      this.accumulator.process(
        state,
        start,
        this.context(() => this.publish(entry)),
      );
    }
    if (event.eventType === 'tool_delta' || event.eventType === 'tool_result') {
      const toolStart = this.continuationTools.get(key)?.get(event.toolCallId);
      if (toolStart && !state.toolCallMap.has(event.toolCallId)) {
        this.accumulator.process(
          state,
          toolStart,
          this.context(() => this.publish(entry)),
        );
      }
    }
  }

  private context(
    onStateChanged?: (state: StreamingState) => void,
    skipStoreEffects = false,
  ): AccumulatorContext {
    return {
      sessionManager: this.sessionManager,
      deduplication: this.deduplication,
      batchedUpdate: this.batchedUpdate,
      backgroundAgentStore: this.backgroundAgentStore,
      agentMonitorStore: this.agentMonitorStore,
      onStateChanged,
      skipStoreEffects,
    };
  }

  treeFor(key: string): ExecutionNode[] {
    const entry = this.mutableEntries.get(key);
    if (!entry) return [];
    return [
      ...entry.finalized,
      ...(entry.state
        ? this.builder.buildTree(entry.state, `subagent-${key}`, {
            rootParentToolUseId: key,
          })
        : []),
    ];
  }

  finalize(key: string): void {
    const entry = this.mutableEntries.get(key);
    if (!entry) return;
    if (entry.state) {
      const starts =
        this.continuationStarts.get(key) ??
        new Map<string, MessageStartEvent>();
      const tools =
        this.continuationTools.get(key) ?? new Map<string, ToolStartEvent>();
      for (const event of entry.state.events.values()) {
        if (event.eventType === 'message_start')
          starts.set(event.messageId, event);
        if (event.eventType === 'tool_start') {
          tools.set(event.toolCallId, {
            id: event.id,
            eventType: 'tool_start',
            timestamp: event.timestamp,
            sessionId: event.sessionId,
            source: event.source,
            messageId: event.messageId,
            parentToolUseId: event.parentToolUseId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            isTaskTool: event.isTaskTool,
            agentType: event.agentType,
          });
        }
      }
      while (starts.size > ENTRY_EVENT_CAP)
        starts.delete(starts.keys().next().value!);
      while (tools.size > ENTRY_EVENT_CAP)
        tools.delete(tools.keys().next().value!);
      this.continuationStarts.set(key, starts);
      this.continuationTools.set(key, tools);
      entry.finalized.push(
        ...this.builder
          .buildTree(entry.state, `subagent-${key}`, {
            rootParentToolUseId: key,
          })
          .map(capFinalizedTree),
      );
      entry.state = null;
      this.builder.clearCache(`subagent-${key}`);
    }
    entry.live = false;
    this.publish(entry);
    this.evictFinalized();
  }

  retain(key: string, sessionId?: string): void {
    // The lane and the inline bubble call this from an `effect`. Tracked
    // reads here — the monitor's subagent map, or the tree build reached
    // through `finalize` — would re-run that effect on every monitor or
    // background change, and its cleanup `release` aborts an in-flight
    // history load.
    untracked(() => {
      const entry = this.open(key, sessionId);
      entry.refs++;
      const record =
        this.syncedRecords.get(key) ??
        this.agentMonitorStore.subagents?.().get(key);
      if (record && TERMINAL_STATUSES.has(record.status) && entry.live)
        this.finalize(key);
      this.lastRead.set(key, ++this.readClock);
      this.publish(entry);
    });
  }

  release(key: string): void {
    const entry = this.mutableEntries.get(key);
    if (!entry || entry.refs === 0) return;
    entry.refs--;
    if (
      entry.refs === 0 &&
      (entry.history === 'loading' || this.inFlight.has(key))
    )
      this.abort(entry);
    if (
      entry.refs === 0 &&
      !entry.sessionId &&
      !entry.state &&
      entry.finalized.length === 0
    ) {
      this.remove(key, entry);
      return;
    }
    this.publish(entry);
    this.evictFinalized();
  }

  private abort(entry: SubagentExecutionEntry): void {
    entry.generation++;
    for (const [key, current] of this.mutableEntries) {
      if (current === entry) this.inFlight.delete(key);
    }
    if (entry.history === 'loading') entry.history = 'idle';
  }

  private evictFinalized(): void {
    while (
      [...this.mutableEntries.values()].filter((e) => !e.live).length >
      FINALIZED_ENTRY_CAP
    ) {
      const candidate = oldestFinalized(this.mutableEntries, this.lastRead);
      if (!candidate) break;
      this.remove(candidate[0], candidate[1]);
    }
  }

  private enforceLiveCap(receivingKey: string): void {
    while (liveEventCount(this.mutableEntries) > LIVE_EVENT_CAP) {
      const candidate = oldestLiveSpill(this.mutableEntries, receivingKey);
      if (!candidate) {
        if (!this.overflowWarned.has(receivingKey)) {
          this.logger.warn(
            'SubagentExecutionStore',
            `Pinned live events exceed retention budget for ${receivingKey}`,
          );
          this.overflowWarned.add(receivingKey);
        }
        return;
      }
      const [key, entry] = candidate;
      this.abort(entry);
      entry.state = null;
      entry.spilled = true;
      entry.history = 'idle';
      this.liveRefresh.reset(key);
      this.builder.clearCache(`subagent-${key}`);
      this.publish(entry);
    }
  }

  private remove(key: string, entry: SubagentExecutionEntry): void {
    this.abort(entry);
    this.mutableEntries.delete(key);
    this.entryViews.delete(key);
    // Bump first so current consumers re-read; their next revisionFor(key)
    // subscribes to a fresh signal, so dropping this one leaks nothing.
    this.keyRevisions.get(key)?.update((value) => value + 1);
    this.keyRevisions.delete(key);
    this.ownership.drop(key);
    this.liveRefresh.reset(key);
    entry.idAlias.clear();
    this.lastRead.delete(key);
    this.overflowWarned.delete(key);
    this.continuationStarts.delete(key);
    this.continuationTools.delete(key);
    this.builder.clearCache(`subagent-${key}`);
    this.publish();
  }

  clearSession(sessionId: string): void {
    for (const [key, entry] of this.mutableEntries) {
      if (entry.sessionId === sessionId) {
        this.remove(key, entry);
        this.syncedRecords.delete(key);
      }
    }
  }

  async ensureHistory(key: string): Promise<void> {
    const entry = this.mutableEntries.get(key);
    if (!entry) {
      // Callers retain() before loading, so a missing entry is misuse; it is
      // logged and there is nothing to load.
      this.logger.warn(
        'SubagentExecutionStore',
        `ensureHistory called for unknown agent ${key}`,
      );
      return;
    }
    if (!entry.sessionId) {
      entry.history = 'error';
      entry.historyError = 'Session for this agent is unavailable';
      this.publish(entry);
      return;
    }
    if (
      (entry.history === 'loaded' && !entry.truncated) ||
      entry.history === 'not-found'
    )
      return;
    const active = this.inFlight.get(key);
    if (active && entry.history === 'loading') return active;
    // Anything else in flight is a silent live refresh; the explicit load
    // supersedes it rather than waiting on a read that changes no state.
    if (active) entry.generation++;
    entry.history = 'loading';
    entry.historyError = undefined;
    this.publish(entry);
    return this.startLoad(key, entry, false);
  }

  /**
   * Backfills a live agent's tree from its sidechain transcript. A background
   * agent's child messages may never reach the stream (only `task_progress`
   * summaries do), so its transcript on disk is the only source of its tree
   * while it runs. Unlike `ensureHistory` this read is repeatable and silent:
   * it leaves `history` as it was, so the lane shows no loading state on every
   * refresh, a transcript not written yet is retried on the next call, and
   * the authoritative load still runs once the agent finalizes.
   */
  async refreshLiveHistory(key: string): Promise<void> {
    const entry = this.mutableEntries.get(key);
    if (!entry || !entry.live || !entry.sessionId) return;
    if (entry.history === 'loading') return;
    const active = this.inFlight.get(key);
    if (active) return active;
    // Failed refreshes back off instead of re-reading every interval.
    if (!this.liveRefresh.canRefresh(key, Date.now())) return;
    return this.startLoad(key, entry, true);
  }

  private async startLoad(
    key: string,
    entry: SubagentExecutionEntry,
    silent: boolean,
  ): Promise<void> {
    const generation = entry.generation;
    // A silent refresh that finishes after the agent finalized would rebuild
    // the finalized tree from a stale snapshot; the final load supersedes it.
    const valid = () =>
      this.mutableEntries.get(key) === entry &&
      entry.generation === generation &&
      (!silent || entry.live);
    const loading = this.loadHistory(key, entry, valid, silent);
    this.inFlight.set(key, loading);
    try {
      await loading;
    } finally {
      if (this.inFlight.get(key) === loading) this.inFlight.delete(key);
    }
  }

  /**
   * Pages the agent's transcript into one snapshot. A transcript that grows
   * between pages can expire the cursor (`HISTORY_CURSOR_STALE`); the read
   * then restarts once from the first page. `null` means the request was
   * superseded.
   */
  private async fetchSnapshot(
    key: string,
    entry: SubagentExecutionEntry,
    valid: () => boolean,
  ): Promise<HistorySnapshot | null> {
    let restarted = false;
    for (;;) {
      const snapshot: FlatStreamEventUnion[] = [];
      let cursor: string | undefined;
      let clipped = 0;
      let truncated = false;
      const cursors = new Set<string>();
      let pages = 0;
      let stale = false;
      while (valid()) {
        const response = await this.rpc.call('subagent:history-page', {
          sessionId: entry.sessionId!,
          toolCallId: key,
          agentId: entry.agentId,
          cursor,
          maxBytes: HISTORY_PAGE_BYTES,
        });
        if (!valid()) return null;
        if (!response.isSuccess()) {
          if (
            response.errorCode === 'HISTORY_CURSOR_STALE' &&
            cursor !== undefined &&
            !restarted
          ) {
            stale = true;
            break;
          }
          throw new Error(response.error ?? 'History request failed');
        }
        const page = response.data;
        if (page.agentId) entry.agentId = page.agentId;
        if (page.status !== 'ok')
          return { status: page.status, events: [], clipped: 0, truncated };
        pages++;
        if (pages > HISTORY_PAGE_CAP)
          throw new Error('Agent history page limit exceeded');
        snapshot.push(...page.events);
        if (snapshot.length > HISTORY_EVENT_CAP) {
          snapshot.splice(0, snapshot.length - HISTORY_EVENT_CAP);
          truncated = true;
        }
        clipped += page.clippedEvents;
        truncated ||= page.truncated;
        if (page.done || !page.nextCursor) break;
        if (cursors.has(page.nextCursor))
          throw new Error('Agent history cursor did not advance');
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      if (!valid()) return null;
      if (!stale) return { status: 'ok', events: snapshot, clipped, truncated };
      restarted = true;
    }
  }

  private async loadHistory(
    key: string,
    entry: SubagentExecutionEntry,
    valid: () => boolean,
    silent: boolean,
  ): Promise<void> {
    try {
      const result = await this.fetchSnapshot(key, entry, valid);
      if (!result) return;
      if (result.status !== 'ok') {
        // A running agent's transcript may not exist yet; keep the state so
        // a later refresh retries, backing off once it stays missing.
        if (silent) {
          this.liveRefresh.missing(key, Date.now());
          return;
        }
        entry.history = result.status;
        this.publish(entry);
        return;
      }
      const snapshot = result.events;
      if (silent) {
        // An unchanged or still-empty transcript adds nothing to the tree.
        if (this.liveRefresh.unchanged(key, snapshot) || snapshot.length === 0)
          return;
        // The transcript is the whole run, including any earlier run of a
        // resumed agent that `finalize` moved into `finalized`; keeping both
        // would show those messages twice.
        entry.finalized = [];
      } else {
        this.liveRefresh.reset(key);
      }
      const truncated =
        mergeSubagentHistory(
          key,
          entry,
          snapshot,
          this.accumulator,
          this.builder,
          this.context(undefined, true),
          { dropRepeatedText: silent },
        ) || result.truncated;
      if (silent) this.liveRefresh.merged(key, snapshot);
      entry.clipped = result.clipped;
      entry.truncated = truncated;
      if (!silent) entry.history = 'loaded';
      entry.spilled = false;
      this.publish(entry);
      this.enforceLiveCap(key);
    } catch (error) {
      // degradation-audit: reported - a superseded request returns early;
      // a current one records history 'error' and logs the failure below.
      // A failed silent refresh backs off and is retried, so a transcript
      // that is not readable yet never shows an error state; a failure that
      // persists is warned about once.
      if (!valid()) return;
      if (silent) {
        const persistent = this.liveRefresh.failed(key, Date.now());
        if (persistent)
          this.logger.warn(
            'SubagentExecutionStore',
            `Live history refresh keeps failing for ${key}`,
            error,
          );
        else
          this.logger.debug(
            'SubagentExecutionStore',
            'Live history refresh failed',
            error,
          );
        return;
      }
      entry.history = 'error';
      entry.historyError =
        error instanceof Error ? error.message : 'History request failed';
      this.logger.warn(
        'SubagentExecutionStore',
        'History request failed',
        error,
      );
      this.publish(entry);
    }
  }
}
