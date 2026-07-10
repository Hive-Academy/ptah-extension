/**
 * CanvasStore — workspace-partitioned tile state coverage.
 */

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
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
import { signal } from '@angular/core';

import {
  CanvasStore,
  CanvasSeedTab,
  RETAINED_WORKSPACE_CAP,
} from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { TabManagerService } from '@ptah-extension/chat';

const makeSeed = (
  id: string,
  sessionId: string | null = null,
): CanvasSeedTab => ({
  id,
  claudeSessionId: sessionId,
  name: id,
});

describe('CanvasStore workspace partitioning', () => {
  let store: CanvasStore;

  beforeEach(() => {
    const tabManagerMock = {
      tabs: signal<CanvasSeedTab[]>([]),
      activeTabId: signal<string | null>(null),
      createTab: jest.fn(
        (_name?: string) => `tab-${Math.random().toString(36).slice(2, 7)}`,
      ),
      openSessionTab: jest.fn((sessionId: string) => `tab-from-${sessionId}`),
      switchTab: jest.fn(),
      closeTab: jest.fn().mockResolvedValue(undefined),
      forceCloseTab: jest.fn(),
    } as unknown as TabManagerService;

    const layoutServiceMock = {
      computeLayout: jest.fn((count: number) => ({
        cellHeight: 120,
        tiles: Array.from({ length: count }, (_, i) => ({
          x: (i % 3) * 4,
          y: Math.floor(i / 3) * 6,
          w: 4,
          h: 6,
        })),
      })),
    } as unknown as CanvasLayoutService;

    TestBed.configureTestingModule({
      providers: [
        CanvasStore,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: CanvasLayoutService, useValue: layoutServiceMock },
      ],
    });
    store = TestBed.inject(CanvasStore);
  });

  it('saves A tiles and seeds B empty when switching A->B with no B tabs', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.adoptTab('a-tab-2');
    expect(store.tiles().length).toBe(2);

    store.switchWorkspaceTiles('/ws/b', []);
    expect(store.tiles().length).toBe(0);

    store.switchWorkspaceTiles('/ws/a', []);
    expect(store.tiles().map((t) => t.tabId)).toEqual(['a-tab-1', 'a-tab-2']);
  });

  it('round-trip A->B->A preserves custom positions and focused tab', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.adoptTab('a-tab-2');
    store.updateTilePosition('a-tab-1', { x: 7, y: 3, w: 5, h: 8 });
    store.focusTile('a-tab-2');

    store.switchWorkspaceTiles('/ws/b', []);
    store.switchWorkspaceTiles('/ws/a', []);

    const restored = store.tiles().find((t) => t.tabId === 'a-tab-1');
    expect(restored?.position).toEqual({ x: 7, y: 3, w: 5, h: 8 });
    expect(store.focusedTabId()).toBe('a-tab-2');
  });

  it('seeds first-visit workspace from activeTabs using layout positions', () => {
    store.switchWorkspaceTiles('/ws/a', [
      makeSeed('t1'),
      makeSeed('t2'),
      makeSeed('t3'),
    ]);

    expect(store.tiles().map((t) => t.tabId)).toEqual(['t1', 't2', 't3']);
    expect(store.tiles()[0].position).toEqual({ x: 0, y: 0, w: 4, h: 6 });
    expect(store.tiles()[1].position).toEqual({ x: 4, y: 0, w: 4, h: 6 });
    expect(store.tiles()[2].position).toEqual({ x: 8, y: 0, w: 4, h: 6 });
  });

  it('removeWorkspaceTileState clears live signals when removing the active workspace', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.focusTile('a-tab-1');

    store.removeWorkspaceTileState('/ws/a');

    expect(store.tiles()).toEqual([]);
    expect(store.focusedTabId()).toBeNull();
  });

  it('removeWorkspaceTileState for a background workspace does not change active signals', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.switchWorkspaceTiles('/ws/b', []);
    store.adoptTab('b-tab-1');

    store.removeWorkspaceTileState('/ws/a');

    expect(store.tiles().map((t) => t.tabId)).toEqual(['b-tab-1']);

    store.switchWorkspaceTiles('/ws/a', []);
    expect(store.tiles()).toEqual([]);
  });

  it('seeding respects the MAX_TILES cap', () => {
    const tooMany: CanvasSeedTab[] = Array.from({ length: 15 }, (_, i) =>
      makeSeed(`t${i}`),
    );
    store.switchWorkspaceTiles('/ws/a', tooMany);
    expect(store.tiles().length).toBe(CanvasStore.MAX_TILES);
  });

  it('keeps tiles/focusedTabId/tileCount/canAddTile as reactive accessors', () => {
    expect(typeof store.tiles).toBe('function');
    expect(typeof store.focusedTabId).toBe('function');
    expect(typeof store.tileCount).toBe('function');
    expect(typeof store.canAddTile).toBe('function');

    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    expect(store.tileCount()).toBe(1);
    expect(store.canAddTile()).toBe(true);
  });

  it('tiles() and focusedTabId() follow activeWorkspacePath across switches', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.focusTile('a-tab-1');
    store.switchWorkspaceTiles('/ws/b', []);
    store.adoptTab('b-tab-1');

    expect(store.activeWorkspacePath()).toBe('/ws/b');
    expect(store.tiles().map((t) => t.tabId)).toEqual(['b-tab-1']);
    expect(store.focusedTabId()).toBeNull();

    store.switchWorkspaceTiles('/ws/a', []);
    expect(store.activeWorkspacePath()).toBe('/ws/a');
    expect(store.tiles().map((t) => t.tabId)).toEqual(['a-tab-1']);
    expect(store.focusedTabId()).toBe('a-tab-1');
  });

  it('tilesFor(path) exposes each workspace tiles as a stable memoized signal', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.switchWorkspaceTiles('/ws/b', []);
    store.adoptTab('b-tab-1');

    const aTiles = store.tilesFor('/ws/a');
    expect(store.tilesFor('/ws/a')).toBe(aTiles);
    expect(aTiles().map((t) => t.tabId)).toEqual(['a-tab-1']);
    expect(
      store
        .tilesFor('/ws/b')()
        .map((t) => t.tabId),
    ).toEqual(['b-tab-1']);
  });

  it('workspacePaths lists mounted workspaces in insertion order', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.switchWorkspaceTiles('/ws/b', []);
    store.switchWorkspaceTiles('/ws/c', []);
    expect(store.workspacePaths()).toEqual(['/ws/a', '/ws/b', '/ws/c']);
  });

  it('evicts the LRU workspace beyond RETAINED_WORKSPACE_CAP but restores its tiles on return', () => {
    expect(RETAINED_WORKSPACE_CAP).toBe(4);

    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.updateTilePosition('a-tab-1', { x: 5, y: 5, w: 5, h: 5 });
    store.switchWorkspaceTiles('/ws/b', []);
    store.switchWorkspaceTiles('/ws/c', []);
    store.switchWorkspaceTiles('/ws/d', []);
    expect(store.workspacePaths()).toEqual([
      '/ws/a',
      '/ws/b',
      '/ws/c',
      '/ws/d',
    ]);

    store.switchWorkspaceTiles('/ws/e', []);
    // /ws/a is least-recently-active → drops out of the mounted set (grid unmounts)
    expect(store.workspacePaths()).toEqual([
      '/ws/b',
      '/ws/c',
      '/ws/d',
      '/ws/e',
    ]);

    // returning re-mounts /ws/a with its saved tiles + positions intact
    store.switchWorkspaceTiles('/ws/a', []);
    expect(store.workspacePaths()).toContain('/ws/a');
    expect(store.tiles().map((t) => t.tabId)).toEqual(['a-tab-1']);
    expect(store.tiles()[0].position).toEqual({ x: 5, y: 5, w: 5, h: 5 });
  });

  it('allTabIds returns tabIds across every retained workspace', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.switchWorkspaceTiles('/ws/b', []);
    store.adoptTab('b-tab-1');

    expect([...store.allTabIds()].sort()).toEqual(['a-tab-1', 'b-tab-1']);
  });

  it('removeTileFromAnyWorkspace drops a tile from a background workspace', () => {
    store.switchWorkspaceTiles('/ws/a', []);
    store.adoptTab('a-tab-1');
    store.adoptTab('a-tab-2');
    store.switchWorkspaceTiles('/ws/b', []);

    store.removeTileFromAnyWorkspace('a-tab-1');

    expect(
      store
        .tilesFor('/ws/a')()
        .map((t) => t.tabId),
    ).toEqual(['a-tab-2']);
    expect(store.tiles()).toEqual([]);
  });
});
