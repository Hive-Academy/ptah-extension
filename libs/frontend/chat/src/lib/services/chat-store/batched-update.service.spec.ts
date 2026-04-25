/**
 * BatchedUpdateService specs — RAF-batched streaming state updates.
 *
 * The service coalesces rapid `updateTab({streamingState})` calls into one
 * `requestAnimationFrame` flush so TabManager signals tick once per frame,
 * not per streaming event. Tests drive the RAF with Jest fake timers +
 * `requestAnimationFrame` polyfill.
 */

import { TestBed } from '@angular/core/testing';
import { BatchedUpdateService } from './batched-update.service';
import { TabManagerService } from '../tab-manager.service';
import type { StreamingState } from '@ptah-extension/chat-types';

type TabManagerSlice = Pick<TabManagerService, 'updateTab'>;

function makeEmptyStreamingState(): StreamingState {
  return {
    events: new Map(),
    messageEventIds: [],
    toolCallMap: new Map(),
    textAccumulators: new Map(),
    toolInputAccumulators: new Map(),
    agentSummaryAccumulators: new Map(),
    agentContentBlocksMap: new Map(),
    currentMessageId: null,
    currentTokenUsage: null,
    eventsByMessage: new Map(),
    pendingStats: null,
  };
}

describe('BatchedUpdateService', () => {
  let service: BatchedUpdateService;
  let tabManager: jest.Mocked<TabManagerSlice>;
  let rafCallbacks: Array<FrameRequestCallback>;
  let originalRaf: typeof requestAnimationFrame;
  let originalCancel: typeof cancelAnimationFrame;

  beforeEach(() => {
    rafCallbacks = [];
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    // Deterministic RAF: each call returns an incrementing id and stores the
    // callback so specs can invoke flush manually via `runRaf()`.
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number): void => {
      // Mark cancelled by replacing with a no-op; specs read post-flush to
      // verify cancellation prevented spurious updates.
      if (id > 0 && id <= rafCallbacks.length) {
        rafCallbacks[id - 1] = () => undefined;
      }
    }) as typeof cancelAnimationFrame;

    tabManager = { updateTab: jest.fn() } as jest.Mocked<TabManagerSlice>;

    TestBed.configureTestingModule({
      providers: [
        BatchedUpdateService,
        { provide: TabManagerService, useValue: tabManager },
      ],
    });
    service = TestBed.inject(BatchedUpdateService);
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
    TestBed.resetTestingModule();
  });

  function runRaf(): void {
    // Flush one pass of scheduled callbacks. The service schedules at most one
    // per flush window, but defensively run the full snapshot.
    const snapshot = rafCallbacks.slice();
    rafCallbacks.length = 0;
    snapshot.forEach((cb) => cb(performance.now()));
  }

  it('coalesces multiple scheduleUpdate calls into a single RAF flush', () => {
    const state = makeEmptyStreamingState();
    service.scheduleUpdate('tab-1', state);
    service.scheduleUpdate('tab-1', state);
    service.scheduleUpdate('tab-1', state);

    // No updates until RAF fires.
    expect(tabManager.updateTab).not.toHaveBeenCalled();

    runRaf();

    expect(tabManager.updateTab).toHaveBeenCalledTimes(1);
    expect(tabManager.updateTab).toHaveBeenCalledWith('tab-1', {
      streamingState: expect.any(Object),
    });
  });

  it('clones the streaming state on flush so later mutations do not bleed', () => {
    const state = makeEmptyStreamingState();
    service.scheduleUpdate('tab-1', state);
    runRaf();

    const flushedState = tabManager.updateTab.mock.calls[0][1]
      .streamingState as StreamingState;
    expect(flushedState).not.toBe(state);
    // Shallow clone: nested Maps are referenced, the top-level object is new.
    expect(flushedState.events).toBe(state.events);
  });

  it('flushes once per tab when multiple tabs schedule in the same frame', () => {
    const state = makeEmptyStreamingState();
    service.scheduleUpdate('tab-1', state);
    service.scheduleUpdate('tab-2', state);

    runRaf();
    expect(tabManager.updateTab).toHaveBeenCalledTimes(2);
    const ids = tabManager.updateTab.mock.calls.map((c) => c[0]);
    expect(new Set(ids)).toEqual(new Set(['tab-1', 'tab-2']));
  });

  it('re-schedules a new RAF after the previous flush completes', () => {
    const state = makeEmptyStreamingState();
    service.scheduleUpdate('tab-1', state);
    runRaf();
    expect(tabManager.updateTab).toHaveBeenCalledTimes(1);

    service.scheduleUpdate('tab-1', state);
    // The previous RAF id was consumed; a fresh one must have been requested.
    expect(rafCallbacks).toHaveLength(1);
    runRaf();
    expect(tabManager.updateTab).toHaveBeenCalledTimes(2);
  });

  it('flushSync cancels the pending RAF and flushes immediately', () => {
    const state = makeEmptyStreamingState();
    service.scheduleUpdate('tab-1', state);

    service.flushSync();
    expect(tabManager.updateTab).toHaveBeenCalledTimes(1);

    // Running the original RAF callback must not double-flush.
    runRaf();
    expect(tabManager.updateTab).toHaveBeenCalledTimes(1);
  });

  it('flushSync on an empty queue is a no-op', () => {
    service.flushSync();
    expect(tabManager.updateTab).not.toHaveBeenCalled();
  });

  it('hasPendingUpdates reports true between schedule and flush', () => {
    const state = makeEmptyStreamingState();
    service.scheduleUpdate('tab-1', state);
    expect(service.hasPendingUpdates('tab-1')).toBe(true);
    expect(service.hasPendingUpdates('tab-2')).toBe(false);

    runRaf();
    expect(service.hasPendingUpdates('tab-1')).toBe(false);
  });

  it('clearPendingUpdates drops the queued entry so it will not flush', () => {
    const state = makeEmptyStreamingState();
    service.scheduleUpdate('tab-1', state);
    service.scheduleUpdate('tab-2', state);

    service.clearPendingUpdates('tab-1');
    runRaf();

    expect(tabManager.updateTab).toHaveBeenCalledTimes(1);
    expect(tabManager.updateTab).toHaveBeenCalledWith(
      'tab-2',
      expect.any(Object),
    );
  });

  it('preserves the latest state when scheduleUpdate is called repeatedly for the same tab', () => {
    const first = makeEmptyStreamingState();
    const second = makeEmptyStreamingState();
    second.currentMessageId = 'msg-2';

    service.scheduleUpdate('tab-1', first);
    service.scheduleUpdate('tab-1', second);
    runRaf();

    const flushed = tabManager.updateTab.mock.calls[0][1]
      .streamingState as StreamingState;
    expect(flushed.currentMessageId).toBe('msg-2');
  });
});
