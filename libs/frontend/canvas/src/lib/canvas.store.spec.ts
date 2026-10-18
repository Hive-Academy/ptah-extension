import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  signal,
} from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div>{{ data }}</div>`,
  })
  class MarkdownStub {
    @Input() data: string | null | undefined = '';
  }
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStub,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat';
import { SessionId } from '@ptah-extension/shared';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { CanvasStore, RETAINED_WORKSPACE_CAP } from './canvas.store';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import { DEFAULT_BOARD_STATE } from './canvas-board-mode';
import type { CanvasLayoutLoadResult } from './canvas-layout-persistence.service';
import type { TileIntent } from './canvas-layout-intent';

describe('CanvasStore', () => {
  let store: CanvasStore;
  let tabs: ReturnType<
    typeof signal<
      Array<{
        id: string;
        claudeSessionId: string | null;
        name: string;
        status: 'loaded' | 'streaming' | 'resuming';
      }>
    >
  >;
  let agents: ReturnType<
    typeof signal<
      Array<{ parentSessionId: string; status: 'running' | 'completed' }>
    >
  >;
  let subagents: ReturnType<
    typeof signal<
      ReadonlyMap<
        string,
        { parentSessionId: string; status: 'running' | 'completed' }
      >
    >
  >;
  let persistence: {
    load: jest.Mock<CanvasLayoutLoadResult, [string]>;
    markHydrated: jest.Mock;
    schedule: jest.Mock;
    remove: jest.Mock;
  };

  let getWorkspaceTabs: jest.Mock;
  let activeWorkspacePath: ReturnType<typeof signal<string | null>>;

  beforeEach(() => {
    getWorkspaceTabs = jest.fn(() => []);
    activeWorkspacePath = signal<string | null>(null);
    tabs = signal([]);
    agents = signal([]);
    subagents = signal(new Map());
    persistence = {
      load: jest.fn((_path: string) => ({
        tiles: null,
        writable: true,
        needsWrite: false,
        board: null,
        readOnlyReason: null,
      })),
      markHydrated: jest.fn(),
      schedule: jest.fn(),
      remove: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        CanvasStore,
        { provide: AgentMonitorStore, useValue: { agents, subagents } },
        { provide: CanvasLayoutPersistenceService, useValue: persistence },
        {
          provide: TabManagerService,
          useValue: {
            onTabClosed: jest.fn(() => () => undefined),
            tabs,
            getWorkspaceTabs,
            activeTabId: signal<string | null>(null),
            activeWorkspacePath$: activeWorkspacePath,
            createTab: jest.fn(() => `tab-${tabs().length + 1}`),
            openSessionTab: jest.fn((id: string) => `tab-${id}`),
            switchTab: jest.fn(),
            closeTab: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
    store = TestBed.inject(CanvasStore);
  });

  const hydrate = (path: string, ids: readonly string[]): void => {
    activeWorkspacePath.set(path);
    tabs.set(
      ids.map((id) => ({
        id,
        claudeSessionId: null,
        name: id,
        status: 'loaded',
      })),
    );
    store.hydrateWorkspace(path, ids);
  };

  it('counts only active tile sessions and reopens a slot when one finishes', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `tab-${i}`);
    hydrate('/ws/a', ids);
    tabs.set(
      ids.map((id, i) => ({
        id,
        name: id,
        claudeSessionId: `session-${i}`,
        status: i < 9 ? 'streaming' : 'loaded',
      })),
    );
    expect(store.runningSessionCount()).toBe(9);
    expect(store.canStartRunningSession()).toBe(false);
    expect(store.isSessionRunning('tab-9')).toBe(false);
    expect(store.startBlockReason('tab-9')).toBe(
      '9 sessions are running. Wait for one to finish to start another.',
    );
    expect(store.isSessionRunning('tab-0')).toBe(true);
    expect(store.startBlockReason('tab-0')).toBeNull();
    expect(store.canAddTile()).toBe(true);
    tabs.update((list) =>
      list.map((tab, i) => (i === 0 ? { ...tab, status: 'loaded' } : tab)),
    );
    expect(store.runningSessionCount()).toBe(8);
    expect(store.canStartRunningSession()).toBe(true);
    expect(store.isSessionRunning('tab-9')).toBe(false);
    expect(store.startBlockReason('tab-9')).toBeNull();
    agents.set([{ parentSessionId: 'session-9', status: 'running' }]);
    expect(store.runningSessionCount()).toBe(9);
    expect(store.isSessionRunning('tab-9')).toBe(true);
    expect(store.startBlockReason('tab-9')).toBeNull();
    agents.set([]);
    subagents.set(
      new Map([['agent', { parentSessionId: 'session-9', status: 'running' }]]),
    );
    expect(store.runningSessionCount()).toBe(9);
    expect(store.isSessionRunning('tab-9')).toBe(true);
  });

  it('counts running tiles across all workspaces, reading hidden tabs from the partition', () => {
    const streaming = (ids: readonly string[]) =>
      ids.map((id) => ({
        id,
        name: id,
        claudeSessionId: null,
        status: 'streaming' as const,
      }));
    const first = Array.from({ length: 5 }, (_, i) => `a-${i}`);
    const second = Array.from({ length: 4 }, (_, i) => `b-${i}`);
    const hiddenTabs = new Map([
      ['/ws/a', streaming(first)],
      ['/ws/b', streaming(second)],
    ]);
    getWorkspaceTabs.mockImplementation(
      (path: string) => hiddenTabs.get(path) ?? [],
    );
    // `tabs()` holds only the active workspace, like the real TabManagerService.
    tabs.set(streaming(first));
    activeWorkspacePath.set('/ws/a');
    store.hydrateWorkspace('/ws/a', first);
    expect(store.runningSessionCount()).toBe(5);
    tabs.set(streaming(second));
    activeWorkspacePath.set('/ws/b');
    store.hydrateWorkspace('/ws/b', second);
    expect(store.runningSessionCount()).toBe(9);
    expect(store.canStartRunningSession()).toBe(false);
    tabs.set(streaming(first));
    activeWorkspacePath.set('/ws/a');
    store.hydrateWorkspace('/ws/a', first);
    expect(store.canStartRunningSession()).toBe(false);
  });

  it('rechecks hidden tab status at the cap and stops polling when a slot opens', () => {
    jest.useFakeTimers();
    try {
      const first = Array.from({ length: 5 }, (_, i) => `a-${i}`);
      const second = Array.from({ length: 4 }, (_, i) => `b-${i}`);
      const streaming = (ids: readonly string[]) =>
        ids.map((id) => ({
          id,
          name: id,
          claudeSessionId: null,
          status: 'streaming' as const,
        }));
      let hiddenTabs = streaming(first).map((tab) => ({
        ...tab,
        status: 'streaming' as 'streaming' | 'loaded',
      }));
      getWorkspaceTabs.mockImplementation((path: string) =>
        path === '/ws/a' ? hiddenTabs : [],
      );
      activeWorkspacePath.set('/ws/a');
      tabs.set(streaming(first));
      store.hydrateWorkspace('/ws/a', first);
      activeWorkspacePath.set('/ws/b');
      tabs.set(streaming(second));
      store.hydrateWorkspace('/ws/b', second);
      expect(store.canStartRunningSession()).toBe(false);
      TestBed.flushEffects();
      expect(jest.getTimerCount()).toBe(1);
      hiddenTabs = hiddenTabs.map((tab, index) =>
        index === 0 ? { ...tab, status: 'loaded' } : tab,
      );
      jest.advanceTimersByTime(1000);
      expect(store.canStartRunningSession()).toBe(true);
      TestBed.flushEffects();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the tab manager active path during a workspace switch', () => {
    const first = [
      {
        id: 'a',
        name: 'a',
        claudeSessionId: null,
        status: 'streaming' as const,
      },
    ];
    const second = [
      {
        id: 'b',
        name: 'b',
        claudeSessionId: null,
        status: 'streaming' as const,
      },
    ];
    tabs.set(first);
    activeWorkspacePath.set('/ws/a');
    store.hydrateWorkspace('/ws/a', ['a']);
    getWorkspaceTabs.mockImplementation((path: string) =>
      path === '/ws/a' ? first : second,
    );
    tabs.set(second);
    activeWorkspacePath.set('/ws/b');
    store.hydrateWorkspace('/ws/b', ['b']);
    tabs.set(first);
    activeWorkspacePath.set('/ws/a');
    expect(store.runningSessionCount()).toBe(2);
  });

  it('adoptTab of an already-tiled tab adds no second tile (agent re-adoption, TASK_2026_612)', () => {
    hydrate('/ws/a', ['parent']);

    expect(store.adoptTab('child')).toBe('child');
    // Re-adoption (e.g. chat:agent-sessions on webview bootstrap) must not
    // double the tile; a fresh canvas mount restores it by hydration instead.
    expect(store.adoptTab('child')).toBe('child');

    expect(store.tiles().filter((tile) => tile.tabId === 'child')).toHaveLength(
      1,
    );
  });

  it('focuses an already-open session tile at the tile cap instead of reporting the cap (Phase 4 visual M2)', () => {
    const sessionAt = (i: number) =>
      SessionId.from(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const ids = Array.from({ length: CanvasStore.MAX_TILES }, (_, i) => `tab-${i}`);
    hydrate('/ws/a', ids);
    tabs.set(
      ids.map((id, i) => ({
        id,
        name: id,
        claudeSessionId: sessionAt(i),
        status: 'loaded',
      })),
    );
    const tabManager = TestBed.inject(TabManagerService);
    const openSessionTab = jest.mocked(tabManager.openSessionTab);
    const switchTab = jest.mocked(tabManager.switchTab);

    // The board is full, but this session already has a tile: focus it.
    expect(store.addTileFromSession(sessionAt(3))).toBe('tab-3');
    expect(store.focusedTabId()).toBe('tab-3');
    expect(switchTab).toHaveBeenCalledWith('tab-3');
    expect(openSessionTab).not.toHaveBeenCalled();
    expect(store.tiles()).toHaveLength(CanvasStore.MAX_TILES);

    // A session with no tile still needs a slot, so the cap still refuses it.
    expect(store.addTileFromSession(sessionAt(999))).toBeNull();
    expect(openSessionTab).not.toHaveBeenCalled();
  });

  it('hydrates exact authoritative ids once before enabling writes', () => {
    const persisted: TileIntent[] = [
      {
        tabId: 'kept',
        order: 0,
        width: { kind: 'span', span: 'half' },
        rowBreakBefore: false,
      },
      {
        tabId: 'closed',
        order: 1,
        width: { kind: 'span', span: 'full' },
        rowBreakBefore: true,
      },
    ];
    persistence.load.mockReturnValue({
      tiles: persisted,
      writable: true,
      needsWrite: false,
      board: null,
      readOnlyReason: null,
    });
    store.hydrateWorkspace('/ws/a', ['kept', 'new']);
    store.hydrateWorkspace('/ws/a', ['kept', 'new']);
    expect(persistence.load).toHaveBeenCalledTimes(1);
    expect(store.tiles().map((tile) => tile.tabId)).toEqual(['kept', 'new']);
    expect(persistence.markHydrated).toHaveBeenCalledWith('/ws/a', true);
    expect(persistence.schedule).toHaveBeenCalledTimes(1);
  });

  it('hydrates v2 tiles with Rail defaults and upgrades on the first board change', () => {
    const tiles: TileIntent[] = [{ tabId: 'A', order: 0, width: { kind: 'auto', weight: 1 }, rowBreakBefore: false }];
    persistence.load.mockReturnValue({ tiles, board: null, writable: true, needsWrite: false, readOnlyReason: null });
    store.hydrateWorkspace('/ws/a', ['A']);
    expect(store.boardFor('/ws/a')).toEqual(DEFAULT_BOARD_STATE);
    expect(store.tiles()).toEqual(tiles);
    expect(persistence.schedule).not.toHaveBeenCalled();
    store.setRailCollapsed('/ws/a', true);
    expect(persistence.schedule).toHaveBeenCalledTimes(1);
    expect(persistence.schedule.mock.calls[0][1]()).toEqual({ tiles, board: { ...DEFAULT_BOARD_STATE, railCollapsed: true } });
  });

  it('persists each changed board field once without changing tile identity or revision', () => {
    hydrate('/ws/a', ['A']);
    persistence.schedule.mockClear();
    const tiles = store.tilesFor('/ws/a')();
    const tileSignal = store.tilesFor('/ws/a');
    const revision = store.workspaceRevision('/ws/a');
    store.setRailCollapsed('/ws/a', true);
    store.setRailDensity('/ws/a', 'dense');
    store.setRailScrollTop('/ws/a', 12.6);
    expect(persistence.schedule).toHaveBeenCalledTimes(3);
    expect(store.boardFor('/ws/a')).toEqual({ ...DEFAULT_BOARD_STATE, railCollapsed: true, railDensity: 'dense', railScrollTop: 13 });
    store.setRailScrollTop('/ws/a', 13);
    expect(persistence.schedule).toHaveBeenCalledTimes(3);
    expect(store.tilesFor('/ws/a')).toBe(tileSignal);
    expect(store.tilesFor('/ws/a')()).toBe(tiles);
    expect(store.workspaceRevision('/ws/a')).toBe(revision);
  });

  it('keeps hidden workspace board state and drops it on removal', () => {
    hydrate('/ws/a', ['A']);
    store.setRailCollapsed('/ws/a', true);
    hydrate('/ws/b', ['B']);
    store.setRailDensity('/ws/b', 'dense');
    hydrate('/ws/a', ['A']);
    expect(store.boardFor('/ws/a').railCollapsed).toBe(true);
    expect(store.boardFor('/ws/b').railDensity).toBe('dense');
    store.removeWorkspaceTileState('/ws/a');
    expect(store.boardFor('/ws/a')).toEqual(DEFAULT_BOARD_STATE);
  });

  it('migrates implicit board state to the first real workspace', () => {
    store.hydrateWorkspace(null, []);
    store.setRailCollapsed('', true);
    store.hydrateWorkspace('/ws/a', []);
    expect(store.boardFor('/ws/a').railCollapsed).toBe(true);
    expect(store.boardFor('')).toEqual(DEFAULT_BOARD_STATE);
  });

  it('clears stale layout focus carried from the implicit partition during hydration', () => {
    store.hydrateWorkspace(null, ['ghost']);
    expect(store.toggleLayoutFocus('', 'ghost')).toBe(true);
    store.hydrateWorkspace('/ws/a', ['real']);
    expect(store.layoutFocusTabIdFor('/ws/a')).toBeNull();
  });

  it('schedules a v2 persist when migrated intent already matches reconciliation', () => {
    const migrated: TileIntent[] = [
      {
        tabId: 'A',
        order: 0,
        width: { kind: 'auto', weight: 5 },
        rowBreakBefore: false,
      },
    ];
    persistence.load.mockReturnValue({
      tiles: migrated,
      writable: true,
      needsWrite: true,
      board: null,
      readOnlyReason: null,
    });
    store.hydrateWorkspace('/ws/a', ['A']);
    expect(store.tiles()).toEqual(migrated);
    expect(persistence.schedule).toHaveBeenCalledTimes(1);
  });

  it('keeps transient layout focus workspace scoped and clears it on removal', () => {
    hydrate('/ws/a', ['A', 'B']);
    const before = JSON.stringify(store.tiles());
    expect(store.toggleLayoutFocus('/ws/a', 'B')).toBe(true);
    expect(store.layoutFocusTabIdFor('/ws/a')).toBe('B');
    expect(JSON.stringify(store.tiles())).toBe(before);
    store.removeTileOnly('B');
    expect(store.layoutFocusTabIdFor('/ws/a')).toBeNull();
  });

  it('partitions intent, preserves row boundaries on removal, and evicts only mounted grids', () => {
    const tiles: TileIntent[] = ['A', 'B', 'C'].map((tabId, order) => ({
      tabId,
      order,
      width: { kind: 'auto', weight: 1 },
      rowBreakBefore: order === 1,
    }));
    persistence.load.mockReturnValueOnce({ tiles, board: null, writable: true, needsWrite: false, readOnlyReason: null });
    hydrate('/ws/a', ['A', 'B', 'C']);
    store.removeTileOnly('B');
    expect(store.tiles()[1].rowBreakBefore).toBe(true);
    for (let i = 0; i <= RETAINED_WORKSPACE_CAP; i++) {
      store.hydrateWorkspace(`/ws/${i}`, [`T${i}`]);
    }
    expect(store.workspacePaths().length).toBe(RETAINED_WORKSPACE_CAP);
    store.hydrateWorkspace('/ws/a', ['A', 'C']);
    expect(store.tiles().map((tile) => tile.tabId)).toEqual(['A', 'C']);
  });

  describe('removeTile', () => {
    const closeTabMock = (): jest.Mock =>
      TestBed.inject(TabManagerService).closeTab as unknown as jest.Mock;

    it('keeps the tile and focus when the close confirm is cancelled (tab still open)', async () => {
      hydrate('/ws/a', ['A', 'B']);
      expect(store.toggleLayoutFocus('/ws/a', 'B')).toBe(true);
      // Cancelled confirm: closeTab resolves and the tab stays in the list.
      closeTabMock().mockResolvedValueOnce(undefined);

      await store.removeTile('B');

      expect(closeTabMock()).toHaveBeenCalledWith('B');
      expect(store.tiles().map((tile) => tile.tabId)).toEqual(['A', 'B']);
      expect(store.layoutFocusTabIdFor('/ws/a')).toBe('B');
    });

    it('drops the tile and clears focus when the close goes through', async () => {
      hydrate('/ws/a', ['A', 'B']);
      expect(store.toggleLayoutFocus('/ws/a', 'B')).toBe(true);
      closeTabMock().mockImplementationOnce(async (id: string) => {
        tabs.update((list) => list.filter((t) => t.id !== id));
      });

      await store.removeTile('B');

      expect(store.tiles().map((tile) => tile.tabId)).toEqual(['A']);
      expect(store.layoutFocusTabIdFor('/ws/a')).toBeNull();
    });
  });

  it('removes background tiles and deletes acknowledged workspace persistence', () => {
    hydrate('/ws/a', ['A']);
    store.hydrateWorkspace('/ws/b', ['B']);
    store.removeTileFromAnyWorkspace('A');
    expect(store.tilesFor('/ws/a')()).toEqual([]);
    store.removeWorkspaceTileState('/ws/a');
    expect(persistence.remove).toHaveBeenCalledWith('/ws/a');
  });
});
