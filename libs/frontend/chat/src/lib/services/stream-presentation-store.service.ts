import {
  DestroyRef,
  Injectable,
  InjectionToken,
  Signal,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import {
  createExecutionChatMessage,
  type ExecutionChatMessage,
  type ExecutionNode,
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

interface StreamingMessageMemo {
  readonly tree: ExecutionNode;
  readonly stats: StreamingState['pendingStats'];
  readonly sessionId: string | null | undefined;
  readonly message: ExecutionChatMessage;
}

interface TabRecords {
  readonly records: Map<string, WritableSignal<ExecutionChatMessage>>;
  readonly slots: Map<string, StreamPresentationSlot>;
  readonly structure: WritableSignal<StreamPresentationStructure>;
  previous: StreamPresentationStructure;
  source: TabState | null;
  /** `tab.messages` the finalized memo below was derived from. */
  finalizedSource: readonly ExecutionChatMessage[] | null;
  finalized: readonly ExecutionChatMessage[];
  finalizedIds: ReadonlySet<string>;
  /** Last message built per streaming tree id, reused while its inputs hold. */
  readonly streamingMemo: Map<string, StreamingMessageMemo>;
  /** Inputs and result of the last merge, reused when every input is identical. */
  mergedFinalized: readonly ExecutionChatMessage[] | null;
  mergedStreaming: readonly ExecutionChatMessage[];
  merged: readonly ExecutionChatMessage[];
  mergedIds: readonly string[];
}

/**
 * Separates stable transcript structure from mutable streaming content.
 *
 * `BatchedUpdateService` publishes a tab's newest streaming state once per
 * frame. An active transcript passes that published tab here, so the store
 * updates only the affected record signals and publishes the slot list only
 * when ids/order/finalization change. It intentionally owns no event semantics:
 * replay and live events keep using the existing handler and tree builder.
 *
 * This store is the single entry for every transcript surface of a tab (main
 * panel, canvas tile, a detail row): each reads `structureFor(tabId)` and calls
 * `sync(tab)`. A surface must not call `ExecutionTreeBuilderService.buildTree`
 * with a key of its own, or the tab's tree is built once per surface.
 */
@Injectable({ providedIn: 'root' })
export class StreamPresentationStore {
  private readonly tabManager = inject(TabManagerService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tabs = new Map<string, TabRecords>();
  /**
   * Open tab ids. `tabs()` emits a new array on every streaming flush; this
   * computed only notifies when the id list itself changes, so closed-tab
   * release runs on open/close, not per frame.
   */
  private readonly tabIds = computed(
    () => this.tabManager.tabs().map((tab) => tab.id),
    { equal: sameRefs },
  );

  constructor() {
    effect(() => this.releaseClosedTabs(this.tabIds()));
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
      finalizedSource: null,
      finalized: [],
      finalizedIds: new Set(),
      streamingMemo: new Map(),
      mergedFinalized: null,
      mergedStreaming: [],
      merged: [],
      mergedIds: [],
    };
    this.tabs.set(tabId, created);
    return created;
  }

  private releaseClosedTabs(tabIds: readonly string[]): void {
    const present = new Set<string>(tabIds);
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
    // While a turn streams only `streamingState` moves; `messages` keeps its
    // reference, so the finalized list and its id set are derived once.
    if (records.finalizedSource !== tab.messages) {
      records.finalizedSource = tab.messages;
      records.finalized = filterCompactionNoise(tab.messages);
      records.finalizedIds = new Set(
        records.finalized.map((message) => message.id),
      );
    }
    const finalized = records.finalized;
    const streaming = this.streamingMessages(tab, records);
    const reuseMerge =
      records.mergedFinalized === finalized &&
      sameRefs(records.mergedStreaming, streaming);
    if (!reuseMerge) {
      records.mergedFinalized = finalized;
      records.mergedStreaming = streaming;
      records.merged = mergeByTime(finalized, streaming);
      records.mergedIds = records.merged.map((message) => message.id);
    }
    const messages = records.merged;
    const ids = records.mergedIds;

    // Identical inputs were already written to the record signals by the
    // sync that produced this merge, so the record pass is skipped.
    if (!reuseMerge) {
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

  /**
   * One message per streaming tree. A tree the builder returns by the same
   * reference, with the same stats and session, keeps its previous message
   * object, so only the live tree allocates per frame.
   */
  private streamingMessages(
    tab: TabState,
    records: TabRecords,
  ): readonly ExecutionChatMessage[] {
    const memo = records.streamingMemo;
    const state = tab.streamingState;
    const trees = state
      ? this.treeBuilder.buildTree(state, `tab-${tab.id}`)
      : [];
    if (trees.length === 0) {
      memo.clear();
      return [];
    }
    const pendingStats = state?.pendingStats;
    const sessionId = tab.claudeSessionId;
    const messages: ExecutionChatMessage[] = [];
    const built = new Set<string>();
    for (const tree of trees) {
      if (records.finalizedIds.has(tree.id)) continue;
      built.add(tree.id);
      const previous = memo.get(tree.id);
      if (
        previous &&
        previous.tree === tree &&
        previous.stats === pendingStats &&
        previous.sessionId === sessionId
      ) {
        messages.push(previous.message);
        continue;
      }
      const message = createExecutionChatMessage({
        id: tree.id,
        role: 'assistant',
        streamingState: tree,
        sessionId: sessionId ?? undefined,
        ...(pendingStats && {
          tokens: pendingStats.tokens,
          cost: pendingStats.cost,
          duration: pendingStats.duration,
        }),
      });
      memo.set(tree.id, { tree, stats: pendingStats, sessionId, message });
      messages.push(message);
    }
    for (const treeId of memo.keys()) {
      if (!built.has(treeId)) memo.delete(treeId);
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

function sameRefs<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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
