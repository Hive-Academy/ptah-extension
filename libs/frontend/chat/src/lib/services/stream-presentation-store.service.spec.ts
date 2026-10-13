/**
 * StreamPresentationStore — per-frame memoization (TASK_2026_628 Batch 5).
 *
 * While a turn streams, only `streamingState` moves: the finalized list, its
 * id set, unchanged streaming messages and the merge must be reused, and the
 * closed-tab release must run on open/close only, not on every `tabs()` emit.
 */
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import { filterCompactionNoise } from '../components/organisms/transcript/transcript-filter.utils';
import { StreamPresentationStore } from './stream-presentation-store.service';

jest.mock(
  '../components/organisms/transcript/transcript-filter.utils',
  () => {
    const actual = jest.requireActual(
      '../components/organisms/transcript/transcript-filter.utils',
    );
    return {
      ...actual,
      filterCompactionNoise: jest.fn(actual.filterCompactionNoise),
    };
  },
);

function makeTree(id: string, startTime = 1_000): ExecutionNode {
  return {
    id,
    type: 'text',
    status: 'streaming',
    content: id,
    startTime,
  } as unknown as ExecutionNode;
}

function makeMessage(id: string, timestamp: number): ExecutionChatMessage {
  return {
    id,
    role: 'user',
    timestamp,
    streamingState: null,
  } as unknown as ExecutionChatMessage;
}

function makeState(
  pendingStats: StreamingState['pendingStats'] = null,
): StreamingState {
  return { pendingStats } as unknown as StreamingState;
}

function makeTab(
  id: string,
  messages: readonly ExecutionChatMessage[],
  streamingState: StreamingState | null,
): TabState {
  return {
    id,
    claudeSessionId: 'session-1',
    status: 'streaming',
    messages,
    streamingState,
  } as unknown as TabState;
}

describe('StreamPresentationStore — memoization', () => {
  let tabs: WritableSignal<readonly TabState[]>;
  let buildTree: jest.Mock;
  let store: StreamPresentationStore;

  beforeEach(() => {
    tabs = signal<readonly TabState[]>([]);
    buildTree = jest.fn((): ExecutionNode[] => []);
    TestBed.configureTestingModule({
      providers: [
        { provide: TabManagerService, useValue: { tabs } },
        { provide: ExecutionTreeBuilderService, useValue: { buildTree } },
      ],
    });
    store = TestBed.inject(StreamPresentationStore);
    (filterCompactionNoise as jest.Mock).mockClear();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('derives the finalized list once while only streamingState changes', () => {
    const messages = [makeMessage('m1', 1)];
    buildTree.mockReturnValue([makeTree('live')]);

    store.sync(makeTab('a', messages, makeState()));
    store.sync(makeTab('a', messages, makeState()));
    store.sync(makeTab('a', messages, makeState()));

    expect(buildTree).toHaveBeenCalledTimes(3);
    expect(filterCompactionNoise).toHaveBeenCalledTimes(1);

    store.sync(makeTab('a', [...messages], makeState()));
    expect(filterCompactionNoise).toHaveBeenCalledTimes(2);
  });

  it('keeps the record value while the builder returns the same tree', () => {
    const tree = makeTree('live');
    buildTree.mockReturnValue([tree]);
    const messages = [makeMessage('m1', 1)];

    store.sync(makeTab('a', messages, makeState()));
    const structure = store.structureFor('a')();
    const record = structure.slots[1].record;
    const first = record();
    expect(first.streamingState).toBe(tree);

    store.sync(makeTab('a', messages, makeState()));
    expect(record()).toBe(first);
    expect(store.structureFor('a')()).toBe(structure);

    // A changed tree publishes a new record value; the slot list holds.
    const grown = makeTree('live', 1_000);
    buildTree.mockReturnValue([grown]);
    store.sync(makeTab('a', messages, makeState()));
    expect(record()).not.toBe(first);
    expect(record().streamingState).toBe(grown);
    expect(store.structureFor('a')()).toBe(structure);
  });

  it('rebuilds the message when the pending stats change', () => {
    const tree = makeTree('live');
    buildTree.mockReturnValue([tree]);

    store.sync(makeTab('a', [], makeState()));
    const record = store.structureFor('a')().slots[0].record;
    const first = record();

    store.sync(
      makeTab('a', [], makeState({ tokens: 5 } as StreamingState['pendingStats'])),
    );
    expect(record()).not.toBe(first);
    expect(record().streamingState).toBe(tree);
  });

  it('releases records on tab close only, not on a same-ids tabs() emit', () => {
    const tabA = makeTab('a', [makeMessage('m1', 1)], null);
    tabs.set([tabA]);
    TestBed.tick();
    store.sync(tabA);
    const structure = store.structureFor('a');
    expect(structure().slots).toHaveLength(1);

    tabs.set([{ ...tabA }]);
    TestBed.tick();
    expect(store.structureFor('a')).toBe(structure);
    expect(store.structureFor('a')().slots).toHaveLength(1);

    tabs.set([]);
    TestBed.tick();
    expect(store.structureFor('a')().slots).toHaveLength(0);
  });
});
