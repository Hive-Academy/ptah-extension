import { Injectable, effect, inject, signal, type Signal } from '@angular/core';
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
  private readonly _entries = signal<
    ReadonlyMap<string, SubagentExecutionEntry>
  >(new Map());
  readonly entries: Signal<ReadonlyMap<string, SubagentExecutionEntryView>> =
    this._entries.asReadonly();
  private readonly ownership = new SubagentExecutionOwnership();
  private readonly inFlight = new Map<string, Promise<void>>();
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
    this._entries.set(new Map(this.mutableEntries));
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
      this.publish(entry);
    } else if (sessionId && !entry.sessionId) {
      entry.sessionId = sessionId;
      this.publish(entry);
    }
    return entry;
  }

  syncRecord(record: SubagentRecord): void {
    const key = record.parentToolUseId;
    const entry = this.open(key, record.parentSessionId);
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
    this.lastRead.set(key, ++this.readClock);
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

  retain(key: string): void {
    const entry = this.open(key);
    entry.refs++;
    this.publish(entry);
  }

  release(key: string): void {
    const entry = this.mutableEntries.get(key);
    if (!entry || entry.refs === 0) return;
    entry.refs--;
    if (entry.refs === 0 && entry.history === 'loading') this.abort(entry);
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
      this.builder.clearCache(`subagent-${key}`);
      this.publish(entry);
    }
  }

  private remove(key: string, entry: SubagentExecutionEntry): void {
    this.abort(entry);
    this.mutableEntries.delete(key);
    this.ownership.drop(key);
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
    if (
      !entry ||
      !entry.sessionId ||
      (entry.history === 'loaded' && !entry.truncated) ||
      entry.history === 'not-found'
    )
      return;
    const active = this.inFlight.get(key);
    if (active) return active;
    entry.history = 'loading';
    entry.historyError = undefined;
    this.publish(entry);
    const generation = entry.generation;
    const valid = () =>
      this.mutableEntries.get(key) === entry && entry.generation === generation;
    const loading = this.loadHistory(key, entry, valid);
    this.inFlight.set(key, loading);
    try {
      await loading;
    } finally {
      if (this.inFlight.get(key) === loading) this.inFlight.delete(key);
    }
  }

  private async loadHistory(
    key: string,
    entry: SubagentExecutionEntry,
    valid: () => boolean,
  ): Promise<void> {
    const snapshot: FlatStreamEventUnion[] = [];
    let cursor: string | undefined;
    let clipped = 0;
    let truncated = false;
    const cursors = new Set<string>();
    let pages = 0;
    try {
      while (valid()) {
        const response = await this.rpc.call('subagent:history-page', {
          sessionId: entry.sessionId!,
          toolCallId: key,
          agentId: entry.agentId,
          cursor,
          maxBytes: HISTORY_PAGE_BYTES,
        });
        if (!valid()) return;
        if (!response.isSuccess())
          throw new Error(response.error ?? 'History request failed');
        const page = response.data;
        if (page.agentId) entry.agentId = page.agentId;
        if (page.status !== 'ok') {
          entry.history = page.status;
          this.publish(entry);
          return;
        }
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
      if (!valid()) return;
      truncated ||= mergeSubagentHistory(
        key,
        entry,
        snapshot,
        this.accumulator,
        this.builder,
        this.context(undefined, true),
      );
      entry.clipped += clipped;
      entry.truncated ||= truncated;
      entry.history = 'loaded';
      entry.spilled = false;
      this.publish(entry);
      this.enforceLiveCap(key);
    } catch (error) {
      if (!valid()) return;
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
