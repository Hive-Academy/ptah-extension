import { Injectable, inject, signal } from '@angular/core';
import { createEmptyStreamingState, type StreamingState } from '@ptah-extension/chat-types';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import type { ExecutionNode, FlatStreamEventUnion, MessageStartEvent, ToolStartEvent } from '@ptah-extension/shared';
import { StreamingAccumulatorCore, type AccumulatorContext } from './accumulator-core.service';
import { AgentMonitorStore, type SubagentRecord } from './agent-monitor.store';
import { BackgroundAgentStore } from './background-agent.store';
import { BatchedUpdateService } from './batched-update.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { capFinalizedTree } from './execution-tree-retention';
import { SessionManager } from './session-manager.service';

const ENTRY_CAP = 2000;
const LIVE_CAP = 10000;
const FINALIZED_CAP = 20;
const OWNER_CAP = 4000;
const STORE_ONLY = new Set<string>([
  'agent_progress', 'agent_status', 'agent_completed',
  'background_agent_started', 'background_agent_completed', 'background_agent_stopped',
]);

export type SubagentHistoryState = 'idle' | 'loading' | 'loaded' | 'not-found' | 'unresolved' | 'error';

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
  readonly entries = signal<ReadonlyMap<string, SubagentExecutionEntry>>(new Map());
  private readonly messageOwner = new Map<string, string>();
  private readonly toolOwner = new Map<string, string>();
  private readonly ownersByEntry = new Map<string, Map<string, 'message' | 'tool'>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly overflowWarned = new Set<string>();
  private readonly continuationStarts = new Map<string, Map<string, MessageStartEvent>>();
  private readonly continuationTools = new Map<string, Map<string, ToolStartEvent>>();
  private readClock = 0;
  private readonly lastRead = new Map<string, number>();

  private publish(entry?: SubagentExecutionEntry): void {
    if (entry) entry.revision++;
    this.entries.set(new Map(this.mutableEntries));
  }

  private open(key: string, sessionId?: string): SubagentExecutionEntry {
    let entry = this.mutableEntries.get(key);
    if (!entry) {
      entry = {
        state: null, finalized: [], sessionId, live: true, truncated: false,
        spilled: false, clipped: 0, history: 'idle', generation: 0,
        lastEventAt: 0, refs: 0, idAlias: new Map(), revision: 0,
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
    if (record.lastEventAt) entry.lastEventAt = Math.max(entry.lastEventAt, record.lastEventAt);
    if (['completed', 'failed', 'killed', 'stopped'].includes(record.status)) {
      this.finalize(key);
    } else {
      entry.live = true;
      this.publish(entry);
    }
  }

  private own(key: string, id: string, kind: 'message' | 'tool'): void {
    const owners = this.ownersByEntry.get(key) ?? new Map<string, 'message' | 'tool'>();
    this.ownersByEntry.set(key, owners);
    const composite = `${kind}:${id}`;
    if (owners.has(composite)) owners.delete(composite);
    owners.set(composite, kind);
    (kind === 'message' ? this.messageOwner : this.toolOwner).set(id, key);
    if (owners.size > OWNER_CAP) {
      const oldest = owners.keys().next().value;
      if (oldest) {
        const oldKind = owners.get(oldest);
        owners.delete(oldest);
        const oldId = oldest.slice(oldest.indexOf(':') + 1);
        (oldKind === 'message' ? this.messageOwner : this.toolOwner).delete(oldId);
      }
    }
  }

  private dropOwners(key: string): void {
    for (const [composite, kind] of this.ownersByEntry.get(key) ?? []) {
      const id = composite.slice(composite.indexOf(':') + 1);
      (kind === 'message' ? this.messageOwner : this.toolOwner).delete(id);
    }
    this.ownersByEntry.delete(key);
  }

  /** True when the event belongs to an execution entry and was consumed. */
  claim(event: FlatStreamEventUnion): boolean {
    if (STORE_ONLY.has(event.eventType)) return false;
    let key: string | undefined;
    if (event.eventType === 'message_start' && event.parentToolUseId) {
      key = this.toolOwner.get(event.parentToolUseId) ?? event.parentToolUseId;
    } else if (event.eventType === 'agent_start') {
      key = this.toolOwner.get(event.toolCallId);
      if (!key) {
        const entry = this.open(event.toolCallId, event.sessionId);
        if (event.agentId) {
          entry.agentId = event.agentId;
          this.publish(entry);
        }
        return false;
      }
    } else {
      key = this.messageOwner.get(event.messageId);
      if (!key && event.parentToolUseId &&
        (this.mutableEntries.has(event.parentToolUseId) || this.toolOwner.has(event.parentToolUseId))) {
        key = this.toolOwner.get(event.parentToolUseId) ?? event.parentToolUseId;
      }
    }
    if (!key) return false;
    try {
      const entry = this.open(key, event.sessionId);
      if (event.eventType === 'message_start') this.own(key, event.messageId, 'message');
      if (event.eventType === 'tool_start') this.own(key, event.toolCallId, 'tool');
      const state = entry.state ?? this.newState();
      entry.state = state;
      const rewritten = this.rewrite(event, entry.idAlias);
      this.seedContinuation(key, state, rewritten, entry);
      const evictsEvent = state.events.size >= ENTRY_CAP && !state.events.has(rewritten.id);
      const result = this.accumulator.process(state, rewritten, this.context(() => this.publish(entry)));
      if (result.replacementState) {
        result.replacementState.eventCap = ENTRY_CAP;
        entry.state = result.replacementState;
      }
      if (evictsEvent && result.stateMutated) entry.truncated = true;
      entry.lastEventAt = Math.max(entry.lastEventAt, event.timestamp);
      entry.live = true;
      if (event.eventType === 'tool_result' && event.toolCallId === key) this.finalize(key);
      this.enforceLiveCap(key);
      this.publish(entry);
      return true;
    } catch (error) {
      this.logger.error('SubagentExecutionStore', 'Failed to claim event', error);
      return false;
    }
  }

  historyEventsSeen(_event: FlatStreamEventUnion): void {
    // History replay updates records in its normal path; payload is loaded on demand.
  }

  private newState(): StreamingState {
    const state = createEmptyStreamingState();
    state.eventCap = ENTRY_CAP;
    return state;
  }

  private seedContinuation(
    key: string, state: StreamingState, event: FlatStreamEventUnion,
    entry: SubagentExecutionEntry,
  ): void {
    if (event.eventType === 'message_start') return;
    const start = this.continuationStarts.get(key)?.get(event.messageId);
    if (start && !state.messageEventIds.includes(event.messageId)) {
      this.accumulator.process(state, start, this.context(() => this.publish(entry)));
    }
    if (event.eventType === 'tool_delta' || event.eventType === 'tool_result') {
      const toolStart = this.continuationTools.get(key)?.get(event.toolCallId);
      if (toolStart && !state.toolCallMap.has(event.toolCallId)) {
        this.accumulator.process(state, toolStart, this.context(() => this.publish(entry)));
      }
    }
  }

  private context(onStateChanged?: (state: StreamingState) => void, skipStoreEffects = false): AccumulatorContext {
    return {
      sessionManager: this.sessionManager, deduplication: this.deduplication,
      batchedUpdate: this.batchedUpdate, backgroundAgentStore: this.backgroundAgentStore,
      agentMonitorStore: this.agentMonitorStore, onStateChanged, skipStoreEffects,
    };
  }

  treeFor(key: string): ExecutionNode[] {
    const entry = this.mutableEntries.get(key);
    if (!entry) return [];
    this.lastRead.set(key, ++this.readClock);
    return [...entry.finalized, ...(entry.state
      ? this.builder.buildTree(entry.state, `subagent-${key}`, { rootParentToolUseId: key })
      : [])];
  }

  finalize(key: string): void {
    const entry = this.mutableEntries.get(key);
    if (!entry) return;
    if (entry.state) {
      const starts = this.continuationStarts.get(key) ?? new Map<string, MessageStartEvent>();
      const tools = this.continuationTools.get(key) ?? new Map<string, ToolStartEvent>();
      for (const event of entry.state.events.values()) {
        if (event.eventType === 'message_start') starts.set(event.messageId, event);
        if (event.eventType === 'tool_start') {
          tools.set(event.toolCallId, {
            id: event.id, eventType: 'tool_start', timestamp: event.timestamp,
            sessionId: event.sessionId, source: event.source,
            messageId: event.messageId, parentToolUseId: event.parentToolUseId,
            toolCallId: event.toolCallId, toolName: event.toolName,
            isTaskTool: event.isTaskTool, agentType: event.agentType,
          });
        }
      }
      while (starts.size > ENTRY_CAP) starts.delete(starts.keys().next().value!);
      while (tools.size > ENTRY_CAP) tools.delete(tools.keys().next().value!);
      this.continuationStarts.set(key, starts);
      this.continuationTools.set(key, tools);
      entry.finalized.push(...this.builder.buildTree(entry.state, `subagent-${key}`, { rootParentToolUseId: key }).map(capFinalizedTree));
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
    this.publish(entry);
    this.evictFinalized();
  }

  private abort(entry: SubagentExecutionEntry): void {
    entry.generation++;
    if (entry.history === 'loading') entry.history = 'idle';
  }

  private evictFinalized(): void {
    while ([...this.mutableEntries.values()].filter(e => !e.live).length > FINALIZED_CAP) {
      const candidate = [...this.mutableEntries].filter(([, e]) => !e.live && e.refs === 0)
        .sort(([a], [b]) => (this.lastRead.get(a) ?? 0) - (this.lastRead.get(b) ?? 0))[0];
      if (!candidate) break;
      this.remove(candidate[0], candidate[1]);
    }
  }

  private enforceLiveCap(receivingKey: string): void {
    const count = () => [...this.mutableEntries.values()].reduce((total, entry) => total + (entry.state?.events.size ?? 0), 0);
    while (count() > LIVE_CAP) {
      const candidate = [...this.mutableEntries].filter(([key, e]) => key !== receivingKey && e.live && e.refs === 0 && (e.state || !e.spilled))
        .sort(([, a], [, b]) => a.lastEventAt - b.lastEventAt)[0];
      if (!candidate) {
        if (!this.overflowWarned.has(receivingKey)) {
          this.logger.warn('SubagentExecutionStore', `Pinned live events exceed retention budget for ${receivingKey}`);
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
    this.dropOwners(key);
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
      if (entry.sessionId === sessionId) this.remove(key, entry);
    }
  }

  async ensureHistory(key: string): Promise<void> {
    const active = this.inFlight.get(key);
    if (active) return active;
    const entry = this.mutableEntries.get(key);
    if (!entry || !entry.sessionId || entry.history === 'loaded' || entry.history === 'not-found') return;
    entry.history = 'loading';
    entry.historyError = undefined;
    this.publish(entry);
    const generation = entry.generation;
    const valid = () => this.mutableEntries.get(key) === entry && entry.generation === generation;
    const loading = this.loadHistory(key, entry, valid);
    this.inFlight.set(key, loading);
    try { await loading; } finally {
      if (this.inFlight.get(key) === loading) this.inFlight.delete(key);
    }
  }

  private async loadHistory(key: string, entry: SubagentExecutionEntry, valid: () => boolean): Promise<void> {
    const snapshot: FlatStreamEventUnion[] = [];
    let cursor: string | undefined;
    let clipped = 0;
    let truncated = false;
    try {
      while (valid()) {
        const response = await this.rpc.call('subagent:history-page', {
          sessionId: entry.sessionId!, toolCallId: key, agentId: entry.agentId,
          cursor, maxBytes: 256 * 1024,
        });
        if (!valid()) return;
        if (!response.isSuccess()) throw new Error(response.error ?? 'History request failed');
        const page = response.data;
        if (page.agentId) entry.agentId = page.agentId;
        if (page.status !== 'ok') {
          entry.history = page.status;
          this.publish(entry);
          return;
        }
        snapshot.push(...page.events);
        clipped += page.clippedEvents;
        truncated ||= page.truncated;
        if (page.done || !page.nextCursor) break;
        cursor = page.nextCursor;
      }
      if (!valid()) return;
      this.merge(key, entry, snapshot);
      entry.clipped += clipped;
      entry.truncated ||= truncated;
      entry.history = 'loaded';
      entry.spilled = false;
      this.publish(entry);
      this.enforceLiveCap(key);
    } catch (error) {
      if (!valid()) return;
      entry.history = 'error';
      entry.historyError = error instanceof Error ? error.message : 'History request failed';
      this.logger.warn('SubagentExecutionStore', 'History request failed', error);
      this.publish(entry);
    }
  }

  private merge(key: string, entry: SubagentExecutionEntry, snapshot: FlatStreamEventUnion[]): void {
    const fresh = this.newState();
    const localDedup = new EventDeduplicationService();
    const ctx = { ...this.context(undefined, true), deduplication: localDedup };
    for (const event of snapshot) this.accumulator.process(fresh, event, ctx);
    const snapshotIds = new Set(snapshot.filter(e => e.eventType === 'message_start').map(e => e.messageId));
    const snapshotTools = new Map<string, string>();
    const snapshotBlocks = new Set<string>();
    for (const event of snapshot) {
      if (event.eventType === 'tool_start') snapshotTools.set(event.toolCallId, event.messageId);
      if (['text_delta', 'thinking_delta', 'thinking_start', 'tool_start', 'tool_delta', 'tool_result'].includes(event.eventType)) {
        snapshotBlocks.add(this.blockIdentity(event));
      }
    }
    const live = entry.state;
    if (live) {
      const liveEvents = [...live.events.values()];
      for (const event of liveEvents) {
        if (snapshotIds.has(event.messageId)) continue;
        if (event.eventType === 'tool_start') {
          const id = snapshotTools.get(event.toolCallId);
          if (id) entry.idAlias.set(event.messageId, id);
        }
      }
      for (const event of liveEvents) {
        const mapped = this.rewrite(event, entry.idAlias);
        const matched = snapshotIds.has(mapped.messageId);
        if (matched && event.source === 'stream' &&
          ['message_start', 'text_delta', 'thinking_start', 'thinking_delta', 'tool_start', 'tool_delta', 'tool_result'].includes(event.eventType) &&
          (event.eventType === 'message_start' || snapshotBlocks.has(this.blockIdentity(mapped)))) continue;
        this.accumulator.process(fresh, mapped, ctx);
      }
      entry.state = fresh;
    } else if (!entry.live) {
      entry.finalized = this.builder.buildTree(fresh, `subagent-${key}`, { rootParentToolUseId: key }).map(capFinalizedTree);
    } else {
      entry.state = fresh;
    }
    this.builder.clearCache(`subagent-${key}`);
  }

  private blockIdentity(event: FlatStreamEventUnion): string {
    const kind = event.eventType.startsWith('tool_') ? 'tool'
      : event.eventType.startsWith('thinking_') ? 'thinking' : 'text';
    return `${event.messageId}:${kind}:${event.toolCallId ?? event.blockIndex ?? 0}`;
  }

  private rewrite(event: FlatStreamEventUnion, aliases: ReadonlyMap<string, string>): FlatStreamEventUnion {
    const messageId = aliases.get(event.messageId);
    return messageId ? { ...event, messageId } : event;
  }
}
