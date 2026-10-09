import {
  DestroyRef,
  Injectable,
  InjectionToken,
  Signal,
  WritableSignal,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import {
  createExecutionChatMessage,
  type ExecutionChatMessage,
} from '@ptah-extension/shared';
import { filterCompactionNoise } from '../components/organisms/transcript/transcript-filter.utils';

/**
 * Rollback switch for the per-message presentation path. `false` restores the
 * transcript's previous computed derivation without changing stream semantics.
 */
export const STREAM_PRESENTATION_RECORDS_ENABLED = new InjectionToken<boolean>(
  'STREAM_PRESENTATION_RECORDS_ENABLED',
  { providedIn: 'root', factory: () => true },
);

export interface StreamPresentationSlot {
  readonly id: string;
  readonly record: Signal<ExecutionChatMessage>;
}

export interface StreamPresentationStructure {
  readonly slots: readonly StreamPresentationSlot[];
  /** Structural snapshot for turn-card anchoring; record signals own content. */
  readonly messages: readonly ExecutionChatMessage[];
  readonly streamingBoundary: number;
  readonly streamingCount: number;
  readonly totalCount: number;
  readonly isStreaming: boolean;
  readonly hasMessages: boolean;
  readonly orderKeys: ReadonlyMap<string, number>;
}

const EMPTY_STRUCTURE: StreamPresentationStructure = {
  slots: [],
  messages: [],
  streamingBoundary: 0,
  streamingCount: 0,
  totalCount: 0,
  isStreaming: false,
  hasMessages: false,
  orderKeys: new Map(),
};

interface TabRecords {
  readonly records: Map<string, WritableSignal<ExecutionChatMessage>>;
  readonly slots: Map<string, StreamPresentationSlot>;
  readonly structure: WritableSignal<StreamPresentationStructure>;
  previous: StreamPresentationStructure;
  source: TabState | null;
}

/**
 * Separates stable transcript structure from mutable streaming content.
 *
 * `BatchedUpdateService` publishes a tab's newest streaming state once per
 * frame. An active transcript passes that published tab here, so the store
 * updates only the affected record signals and publishes the slot list only
 * when ids/order/finalization change. It intentionally owns no event semantics:
 * replay and live events keep using the existing handler and tree builder.
 */
@Injectable({ providedIn: 'root' })
export class StreamPresentationStore {
  private readonly tabManager = inject(TabManagerService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tabs = new Map<string, TabRecords>();

  constructor() {
    effect(() => this.releaseClosedTabs(this.tabManager.tabs()));
    this.destroyRef.onDestroy(() => this.tabs.clear());
  }

  structureFor(tabId: string): Signal<StreamPresentationStructure> {
    return this.recordsFor(tabId).structure.asReadonly();
  }

  sync(tab: TabState): void {
    this.syncTab(tab);
  }

  private recordsFor(tabId: string): TabRecords {
    const existing = this.tabs.get(tabId);
    if (existing) return existing;
    const structure = signal(EMPTY_STRUCTURE);
    const created: TabRecords = {
      records: new Map(),
      slots: new Map(),
      structure,
      previous: EMPTY_STRUCTURE,
      source: null,
    };
    this.tabs.set(tabId, created);
    return created;
  }

  private releaseClosedTabs(tabs: readonly TabState[]): void {
    const present = new Set<string>(tabs.map((tab) => tab.id));
    for (const tabId of this.tabs.keys()) {
      if (!present.has(tabId)) this.tabs.delete(tabId);
    }
  }

  private syncTab(tab: TabState): void {
    const records = this.recordsFor(tab.id);
    // Effects can be scheduled more than once for a single published tab
    // snapshot. The scheduler gives each meaningful frame a new snapshot, so
    // this avoids rebuilding the execution tree for the same publication.
    if (records.source === tab) return;
    records.source = tab;
    const finalized = filterCompactionNoise(tab.messages);
    const finalizedIds = new Set(finalized.map((message) => message.id));
    const streaming = this.streamingMessages(tab, finalizedIds);
    const messages = mergeByTime(finalized, streaming);
    const ids = messages.map((message) => message.id);

    for (const message of messages) {
      const record = records.records.get(message.id);
      if (record) {
        if (!sameMessage(record(), message)) record.set(message);
        continue;
      }
      const created = signal(message);
      records.records.set(message.id, created);
      records.slots.set(message.id, { id: message.id, record: created });
    }

    const previous = records.previous;
    const streamingBoundary = finalized.length;
    const isStreaming = tab.status === 'streaming' || tab.status === 'resuming';
    const structuralChange =
      !sameIds(previous.slots, ids) ||
      previous.streamingBoundary !== streamingBoundary ||
      previous.isStreaming !== isStreaming;
    if (!structuralChange) return;

    const slots = ids.map((id) => records.slots.get(id) as StreamPresentationSlot);
    const orderKeys = new Map<string, number>();
    for (const message of messages) orderKeys.set(message.id, orderKey(message));
    const next: StreamPresentationStructure = {
      slots,
      messages,
      streamingBoundary,
      streamingCount: streaming.length,
      totalCount: messages.length,
      isStreaming,
      hasMessages: messages.length > 0,
      orderKeys,
    };
    records.previous = next;
    records.structure.set(next);

    const liveIds = new Set(ids);
    for (const id of records.records.keys()) {
      if (!liveIds.has(id)) {
        records.records.delete(id);
        records.slots.delete(id);
      }
    }
  }

  private streamingMessages(
    tab: TabState,
    finalizedIds: ReadonlySet<string>,
  ): readonly ExecutionChatMessage[] {
    const state = tab.streamingState;
    if (!state) return [];
    const trees = this.treeBuilder.buildTree(state, `tab-${tab.id}`);
    if (trees.length === 0) return [];
    const pendingStats = state.pendingStats;
    const messages: ExecutionChatMessage[] = [];
    for (const tree of trees) {
      if (finalizedIds.has(tree.id)) continue;
      messages.push(
        createExecutionChatMessage({
          id: tree.id,
          role: 'assistant',
          streamingState: tree,
          sessionId: tab.claudeSessionId ?? undefined,
          ...(pendingStats && {
            tokens: pendingStats.tokens,
            cost: pendingStats.cost,
            duration: pendingStats.duration,
          }),
        }),
      );
    }
    return messages;
  }
}

function mergeByTime(
  finalized: readonly ExecutionChatMessage[],
  streaming: readonly ExecutionChatMessage[],
): readonly ExecutionChatMessage[] {
  const merged: ExecutionChatMessage[] = new Array(
    finalized.length + streaming.length,
  );
  let finalizedIndex = 0;
  let streamingIndex = 0;
  let index = 0;
  while (finalizedIndex < finalized.length && streamingIndex < streaming.length) {
    const finalizedMessage = finalized[finalizedIndex];
    const streamingMessage = streaming[streamingIndex];
    if (orderKey(finalizedMessage) <= orderKey(streamingMessage)) {
      merged[index++] = finalizedMessage;
      finalizedIndex++;
    } else {
      merged[index++] = streamingMessage;
      streamingIndex++;
    }
  }
  while (finalizedIndex < finalized.length) merged[index++] = finalized[finalizedIndex++];
  while (streamingIndex < streaming.length) merged[index++] = streaming[streamingIndex++];
  return merged;
}

function orderKey(message: ExecutionChatMessage): number {
  return message.streamingState?.startTime ?? message.timestamp;
}

function sameIds(slots: readonly StreamPresentationSlot[], ids: readonly string[]): boolean {
  return slots.length === ids.length && slots.every((slot, index) => slot.id === ids[index]);
}

function sameMessage(
  current: ExecutionChatMessage,
  next: ExecutionChatMessage,
): boolean {
  if (current === next) return true;
  const currentEntries = Object.entries(current);
  const nextEntries = Object.entries(next);
  return (
    currentEntries.length === nextEntries.length &&
    currentEntries.every(
      ([key, value]) =>
        key === 'timestamp' ||
        next[key as keyof ExecutionChatMessage] === value,
    )
  );
}
