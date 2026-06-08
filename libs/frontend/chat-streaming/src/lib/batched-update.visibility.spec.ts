import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { BatchedUpdateService } from './batched-update.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import type { StreamingState } from '@ptah-extension/chat-types';

type TabManagerSlice = Pick<
  TabManagerService,
  'setStreamingState' | 'activeTabId' | 'visibleTabIds'
>;

interface VisibilityHandle {
  readonly initialState: 'visible' | 'hidden';
  state: 'visible' | 'hidden';
  listeners: Array<EventListenerOrEventListenerObject>;
  setVisibility(next: 'visible' | 'hidden'): void;
}

function installVisibility(initial: 'visible' | 'hidden'): VisibilityHandle {
  const handle: VisibilityHandle = {
    initialState: initial,
    state: initial,
    listeners: [],
    setVisibility(next) {
      this.state = next;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => this.state,
      });
      for (const l of this.listeners) {
        if (typeof l === 'function') l(new Event('visibilitychange'));
        else l.handleEvent(new Event('visibilitychange'));
      }
    },
  };
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => handle.state,
  });
  const originalAdd = document.addEventListener.bind(document);
  const originalRemove = document.removeEventListener.bind(document);
  jest.spyOn(document, 'addEventListener').mockImplementation(((
    type: string,
    l: EventListenerOrEventListenerObject,
  ) => {
    if (type === 'visibilitychange') {
      handle.listeners.push(l);
    } else {
      originalAdd(type as keyof DocumentEventMap, l as never);
    }
  }) as typeof document.addEventListener);
  jest.spyOn(document, 'removeEventListener').mockImplementation(((
    type: string,
    l: EventListenerOrEventListenerObject,
  ) => {
    if (type === 'visibilitychange') {
      const idx = handle.listeners.indexOf(l);
      if (idx >= 0) handle.listeners.splice(idx, 1);
    } else {
      originalRemove(type as keyof DocumentEventMap, l as never);
    }
  }) as typeof document.removeEventListener);
  return handle;
}

describe('BatchedUpdateService — visibility gating (Batch B)', () => {
  let service: BatchedUpdateService;
  let tabManager: jest.Mocked<TabManagerSlice>;
  let activeTabSignal: WritableSignal<string | null>;
  let visibleTabSignal: WritableSignal<ReadonlySet<string>>;
  let rafCallbacks: Array<FrameRequestCallback>;
  let originalRaf: typeof requestAnimationFrame;
  let originalCancel: typeof cancelAnimationFrame;
  let visibility: VisibilityHandle;

  function makeState(messageId: string | null = null): StreamingState {
    const s = createEmptyStreamingState();
    if (messageId) s.currentMessageId = messageId;
    return s;
  }

  function runRaf(): void {
    const snapshot = rafCallbacks.slice();
    rafCallbacks.length = 0;
    snapshot.forEach((cb) => cb(performance.now()));
  }

  beforeEach(() => {
    rafCallbacks = [];
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number): void => {
      if (id > 0 && id <= rafCallbacks.length) {
        rafCallbacks[id - 1] = () => undefined;
      }
    }) as typeof cancelAnimationFrame;

    visibility = installVisibility('visible');

    activeTabSignal = signal<string | null>(null);
    visibleTabSignal = signal<ReadonlySet<string>>(new Set());
    tabManager = {
      setStreamingState: jest.fn(),
      activeTabId: activeTabSignal.asReadonly(),
      visibleTabIds: visibleTabSignal.asReadonly(),
    } as unknown as jest.Mocked<TabManagerSlice>;

    TestBed.configureTestingModule({
      providers: [
        BatchedUpdateService,
        { provide: TabManagerService, useValue: tabManager },
      ],
    });
    service = TestBed.inject(BatchedUpdateService);
    activeTabSignal.set('tab-active');
    TestBed.flushEffects();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('defers flush when tabId !== activeTabId (background tab)', () => {
    service.scheduleUpdate('tab-background', makeState('m1'));
    runRaf();

    expect(tabManager.setStreamingState).not.toHaveBeenCalled();
    expect(service.hasPendingUpdates('tab-background')).toBe(true);
  });

  it('defers flush for all tabs when document.visibilityState === hidden', () => {
    visibility.setVisibility('hidden');
    service.scheduleUpdate('tab-active', makeState('m1'));
    service.scheduleUpdate('tab-other', makeState('m2'));
    runRaf();

    expect(tabManager.setStreamingState).not.toHaveBeenCalled();
    expect(service.hasPendingUpdates('tab-active')).toBe(true);
    expect(service.hasPendingUpdates('tab-other')).toBe(true);
  });

  it('flushes deferred entries when the document becomes visible again', () => {
    visibility.setVisibility('hidden');
    service.scheduleUpdate('tab-active', makeState('m1'));
    runRaf();
    expect(tabManager.setStreamingState).not.toHaveBeenCalled();

    visibility.setVisibility('visible');
    runRaf();

    expect(tabManager.setStreamingState).toHaveBeenCalledTimes(1);
    expect(tabManager.setStreamingState).toHaveBeenCalledWith(
      'tab-active',
      expect.any(Object),
    );
  });

  it('flushes a single tab when active-tab signal switches to it', () => {
    service.scheduleUpdate('tab-A', makeState('m1'));
    service.scheduleUpdate('tab-B', makeState('m2'));
    runRaf();
    expect(tabManager.setStreamingState).not.toHaveBeenCalled();

    activeTabSignal.set('tab-A');
    TestBed.flushEffects();
    runRaf();

    expect(tabManager.setStreamingState).toHaveBeenCalledTimes(1);
    expect(tabManager.setStreamingState).toHaveBeenCalledWith(
      'tab-A',
      expect.any(Object),
    );
    expect(service.hasPendingUpdates('tab-B')).toBe(true);
  });

  it('flushSync drains BOTH pending and deferred queues', () => {
    visibility.setVisibility('hidden');
    service.scheduleUpdate('tab-active', makeState('a1'));
    service.scheduleUpdate('tab-other', makeState('b1'));

    visibility.setVisibility('visible');
    service.scheduleUpdate('tab-also-active', makeState('c1'));

    activeTabSignal.set('tab-also-active');
    TestBed.flushEffects();

    service.flushSync();
    const tabIds = tabManager.setStreamingState.mock.calls.map((c) => c[0]);
    expect(new Set(tabIds)).toContain('tab-active');
    expect(new Set(tabIds)).toContain('tab-other');
    expect(new Set(tabIds)).toContain('tab-also-active');
  });

  it('activeTabId === null does NOT defer (pre-change parity)', () => {
    activeTabSignal.set(null);
    TestBed.flushEffects();

    service.scheduleUpdate('tab-X', makeState('mX'));
    runRaf();

    expect(tabManager.setStreamingState).toHaveBeenCalledTimes(1);
    expect(tabManager.setStreamingState).toHaveBeenCalledWith(
      'tab-X',
      expect.any(Object),
    );
  });

  it('visibilitychange listener cleaned up on destroy', () => {
    expect(visibility.listeners.length).toBeGreaterThan(0);
    TestBed.resetTestingModule();
    expect(visibility.listeners.length).toBe(0);
  });

  it('canvas: flushes a non-active tab that is in the visible set', () => {
    visibleTabSignal.set(new Set(['tab-active', 'tab-tile-2']));
    TestBed.flushEffects();

    service.scheduleUpdate('tab-tile-2', makeState('m1'));
    runRaf();

    expect(tabManager.setStreamingState).toHaveBeenCalledWith(
      'tab-tile-2',
      expect.any(Object),
    );
  });

  it('canvas: still defers a tab that is neither active nor in the visible set', () => {
    visibleTabSignal.set(new Set(['tab-active', 'tab-tile-2']));
    TestBed.flushEffects();

    service.scheduleUpdate('tab-offscreen', makeState('m1'));
    runRaf();

    expect(tabManager.setStreamingState).not.toHaveBeenCalled();
    expect(service.hasPendingUpdates('tab-offscreen')).toBe(true);
  });

  it('canvas: drains ALL visible tiles (not just active) when document becomes visible', () => {
    visibleTabSignal.set(new Set(['tab-active', 'tab-tile-2']));
    TestBed.flushEffects();

    visibility.setVisibility('hidden');
    service.scheduleUpdate('tab-active', makeState('m1'));
    service.scheduleUpdate('tab-tile-2', makeState('m2'));
    runRaf();
    expect(tabManager.setStreamingState).not.toHaveBeenCalled();

    visibility.setVisibility('visible');
    runRaf();

    const tabIds = tabManager.setStreamingState.mock.calls.map((c) => c[0]);
    expect(new Set(tabIds)).toEqual(new Set(['tab-active', 'tab-tile-2']));
  });

  it('canvas: drains a tile when it joins the visible set after deferring', () => {
    service.scheduleUpdate('tab-tile-2', makeState('m1'));
    runRaf();
    expect(tabManager.setStreamingState).not.toHaveBeenCalled();
    expect(service.hasPendingUpdates('tab-tile-2')).toBe(true);

    visibleTabSignal.set(new Set(['tab-active', 'tab-tile-2']));
    TestBed.flushEffects();
    runRaf();

    expect(tabManager.setStreamingState).toHaveBeenCalledWith(
      'tab-tile-2',
      expect.any(Object),
    );
  });

  it('perf-regression: 100 stream events targeting a hidden tab result in 0 setStreamingState calls', () => {
    visibility.setVisibility('hidden');
    for (let i = 0; i < 100; i++) {
      service.scheduleUpdate('tab-bg', makeState(`m-${i}`));
    }
    runRaf();
    expect(tabManager.setStreamingState).toHaveBeenCalledTimes(0);
    expect(service.hasPendingUpdates('tab-bg')).toBe(true);
  });
});
