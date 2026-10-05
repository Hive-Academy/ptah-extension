/**
 * TranscriptRetentionService — component-scoped LRU registry (TASK_2026_155
 * Batch 2). Verifies insertion-order stability, cap-8 eviction, active-tab
 * protection, and disposal (with tree-cache clearing) driven by both direct
 * calls and the constructor effects (`activeTabId`, close listener,
 * `removedWorkspace$`).
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  TabManagerService,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import {
  RETAINED_TRANSCRIPT_CAP,
  TranscriptRetentionService,
} from './transcript-retention.service';
import { SESSION_CONTEXT } from '../tokens/session-context.token';

interface Harness {
  service: TranscriptRetentionService;
  activeTabId: ReturnType<typeof signal<string | null>>;
  emitClosedTab: (event: ClosedTabEvent) => void;
  removedWorkspace$: ReturnType<
    typeof signal<{ path: string; seq: number } | null>
  >;
  findMock: jest.Mock;
  clearForTabMock: jest.Mock;
}

function makeHarness(opts: { tileMode?: boolean } = {}): Harness {
  const activeTabId = signal<string | null>(null);
  const closedTab = signal<ClosedTabEvent | null>(null);
  const removedWorkspace$ = signal<{ path: string; seq: number } | null>(null);
  // Default: every id resolves (nothing pruned by the removed-workspace effect).
  const findMock = jest.fn((id: string) => ({
    tab: { id },
    workspacePath: '/ws',
  }));
  const clearForTabMock = jest.fn();

  const listeners = new Set<(event: ClosedTabEvent) => void>();
  const tabManagerStub = {
    activeTabId: activeTabId.asReadonly(),
    closedTab: closedTab.asReadonly(),
    onTabClosed: jest.fn((listener: (event: ClosedTabEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    removedWorkspace$: removedWorkspace$.asReadonly(),
    findTabByIdAcrossWorkspaces: findMock,
  } as unknown as TabManagerService;

  TestBed.configureTestingModule({
    providers: [
      TranscriptRetentionService,
      { provide: TabManagerService, useValue: tabManagerStub },
      {
        provide: ExecutionTreeBuilderService,
        useValue: { clearForTab: clearForTabMock },
      },
      {
        provide: SESSION_CONTEXT,
        useValue: opts.tileMode
          ? signal<string | null>('tile-tab').asReadonly()
          : null,
      },
    ],
  });

  const service = TestBed.inject(TranscriptRetentionService);
  return {
    service,
    activeTabId,
    emitClosedTab: (event) => {
      closedTab.set(event);
      for (const listener of [...listeners]) listener(event);
    },
    removedWorkspace$,
    findMock,
    clearForTabMock,
  };
}

describe('TranscriptRetentionService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('RETAINED_TRANSCRIPT_CAP is 8', () => {
    expect(RETAINED_TRANSCRIPT_CAP).toBe(8);
  });

  it('touch() retains ids in INSERTION order and never reorders on refresh', () => {
    const h = makeHarness();
    h.service.touch('a');
    h.service.touch('b');
    h.service.touch('c');
    expect(h.service.retainedTabIds()).toEqual(['a', 'b', 'c']);

    // Refreshing recency of an existing id must NOT move it in the array.
    h.service.touch('a');
    expect(h.service.retainedTabIds()).toEqual(['a', 'b', 'c']);
  });

  it('evicts the least-recently-touched id once the cap is exceeded', () => {
    const h = makeHarness();
    for (let i = 1; i <= RETAINED_TRANSCRIPT_CAP; i++) {
      h.service.touch(`t${i}`);
    }
    expect(h.service.retainedTabIds()).toHaveLength(RETAINED_TRANSCRIPT_CAP);

    // t9 exceeds the cap → LRU (t1) is evicted and its tree cache cleared.
    h.service.touch('t9');
    expect(h.service.retainedTabIds()).toHaveLength(RETAINED_TRANSCRIPT_CAP);
    expect(h.service.retainedTabIds()).not.toContain('t1');
    expect(h.service.retainedTabIds()).toContain('t9');
    expect(h.clearForTabMock).toHaveBeenCalledWith('t1');
  });

  it('never evicts the tab being touched (the active tab)', () => {
    const h = makeHarness();
    for (let i = 1; i <= RETAINED_TRANSCRIPT_CAP; i++) {
      h.service.touch(`t${i}`);
    }
    // Touch t9 — cap exceeded. The touched id must survive; an older one goes.
    h.service.touch('t9');
    expect(h.service.retainedTabIds()).toContain('t9');
  });

  it('recency refresh protects a re-touched id from eviction', () => {
    const h = makeHarness();
    for (let i = 1; i <= RETAINED_TRANSCRIPT_CAP; i++) {
      h.service.touch(`t${i}`);
    }
    // t1 is oldest; refresh it so t2 becomes the LRU.
    h.service.touch('t1');
    h.service.touch('t9');
    expect(h.service.retainedTabIds()).toContain('t1');
    expect(h.service.retainedTabIds()).not.toContain('t2');
    expect(h.clearForTabMock).toHaveBeenCalledWith('t2');
  });

  it('dispose() removes the id and clears its tree cache', () => {
    const h = makeHarness();
    h.service.touch('a');
    h.service.touch('b');
    h.service.dispose('a');
    expect(h.service.retainedTabIds()).toEqual(['b']);
    expect(h.clearForTabMock).toHaveBeenCalledWith('a');
  });

  it('active-tab effect touches the new active id', () => {
    const h = makeHarness();
    h.activeTabId.set('tab-1');
    TestBed.tick();
    expect(h.service.retainedTabIds()).toContain('tab-1');

    h.activeTabId.set('tab-2');
    TestBed.tick();
    expect(h.service.retainedTabIds()).toEqual(['tab-1', 'tab-2']);
  });

  it('close listener disposes the closed tab and clears its cache', () => {
    const h = makeHarness();
    h.service.touch('tab-1');
    h.service.touch('tab-2');

    h.emitClosedTab({ tabId: 'tab-1', sessionId: null, kind: 'close' });

    expect(h.service.retainedTabIds()).toEqual(['tab-2']);
    expect(h.clearForTabMock).toHaveBeenCalledWith('tab-1');
  });

  it('processes two closes emitted in the same tick', () => {
    const h = makeHarness();
    h.service.touch('tab-1');
    h.service.touch('tab-2');

    h.emitClosedTab({ tabId: 'tab-1', sessionId: null, kind: 'close' });
    h.emitClosedTab({ tabId: 'tab-2', sessionId: null, kind: 'forceClose' });

    expect(h.service.retainedTabIds()).toEqual([]);
    expect(h.clearForTabMock).toHaveBeenNthCalledWith(1, 'tab-1');
    expect(h.clearForTabMock).toHaveBeenNthCalledWith(2, 'tab-2');
  });

  it('close listener does NOT dispose a reset (/clear) tab — it survives in place', () => {
    const h = makeHarness();
    h.service.touch('tab-1');
    h.service.touch('tab-2');

    h.emitClosedTab({ tabId: 'tab-1', sessionId: null, kind: 'reset' });

    expect(h.service.retainedTabIds()).toEqual(['tab-1', 'tab-2']);
    expect(h.clearForTabMock).not.toHaveBeenCalled();
  });

  it('removedWorkspace effect disposes retained ids that no longer resolve', () => {
    const h = makeHarness();
    h.service.touch('keep');
    h.service.touch('gone');

    // 'gone' no longer resolves in any partition after the workspace removal.
    h.findMock.mockImplementation((id: string) =>
      id === 'gone' ? null : { tab: { id }, workspacePath: '/ws' },
    );
    h.removedWorkspace$.set({ path: '/ws/removed', seq: 1 });
    TestBed.tick();

    expect(h.service.retainedTabIds()).toEqual(['keep']);
    expect(h.clearForTabMock).toHaveBeenCalledWith('gone');
  });

  it('disposes stale unresolvable ids on activeTabId change even when the removed-workspace emission is never seen by this effect', () => {
    const h = makeHarness();
    h.service.touch('keep');
    h.service.touch('gone');

    // 'gone' no longer resolves, but the removedWorkspace$ emission is not
    // driven here — the activeTabId effect is the race-proof backstop that
    // prunes stale ids regardless of the append-only removal stream.
    h.findMock.mockImplementation((id: string) =>
      id === 'gone' ? null : { tab: { id }, workspacePath: '/ws' },
    );

    // An unrelated active-tab change is enough to prune the stale id.
    h.activeTabId.set('keep');
    TestBed.tick();

    expect(h.service.retainedTabIds()).toEqual(['keep']);
    expect(h.clearForTabMock).toHaveBeenCalledWith('gone');
  });

  it('tile-mode instance (SESSION_CONTEXT present) performs no touch/dispose bookkeeping', () => {
    const h = makeHarness({ tileMode: true });

    // None of the constructor effects run in tile mode, so signal changes that
    // would normally touch/dispose leave the retained set empty and never clear
    // any tree cache.
    h.activeTabId.set('tab-1');
    h.emitClosedTab({ tabId: 'tab-1', sessionId: null, kind: 'close' });
    h.findMock.mockImplementation(() => null);
    h.removedWorkspace$.set({ path: '/ws/removed', seq: 1 });
    TestBed.tick();

    expect(h.service.retainedTabIds()).toEqual([]);
    expect(h.clearForTabMock).not.toHaveBeenCalled();
  });
});
