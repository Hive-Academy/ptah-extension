import { ChangeDetectionStrategy, Component, Input, NgModule, signal } from '@angular/core';
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
import { CanvasStore, RETAINED_WORKSPACE_CAP } from './canvas.store';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import type { TileIntent } from './canvas-layout-intent';

describe('CanvasStore', () => {
  let store: CanvasStore;
  let tabs: ReturnType<typeof signal<Array<{ id: string; claudeSessionId: null; name: string }>>>;
  let persistence: {
    load: jest.Mock;
    markHydrated: jest.Mock;
    schedule: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(() => {
    tabs = signal([]);
    persistence = {
      load: jest.fn(() => ({ tiles: null, writable: true })),
      markHydrated: jest.fn(),
      schedule: jest.fn(),
      remove: jest.fn(),
    };
    TestBed.configureTestingModule({ providers: [
      CanvasStore,
      { provide: CanvasLayoutPersistenceService, useValue: persistence },
      { provide: TabManagerService, useValue: {
        tabs,
        activeTabId: signal<string | null>(null),
        activeWorkspacePath$: signal<string | null>(null),
        createTab: jest.fn(() => `tab-${tabs().length + 1}`),
        openSessionTab: jest.fn((id: string) => `tab-${id}`),
        switchTab: jest.fn(),
        closeTab: jest.fn().mockResolvedValue(undefined),
      } },
    ] });
    store = TestBed.inject(CanvasStore);
  });

  const hydrate = (path: string, ids: readonly string[]): void => {
    tabs.set(ids.map((id) => ({ id, claudeSessionId: null, name: id })));
    store.hydrateWorkspace(path, ids);
  };

  it('hydrates exact authoritative ids once before enabling writes', () => {
    const persisted: TileIntent[] = [
      { tabId: 'kept', order: 0, width: { kind: 'span', span: 'half' }, rowBreakBefore: false },
      { tabId: 'closed', order: 1, width: { kind: 'span', span: 'full' }, rowBreakBefore: true },
    ];
    persistence.load.mockReturnValue({ tiles: persisted, writable: true });
    store.hydrateWorkspace('/ws/a', ['kept', 'new']);
    store.hydrateWorkspace('/ws/a', ['kept', 'new']);
    expect(persistence.load).toHaveBeenCalledTimes(1);
    expect(store.tiles().map((tile) => tile.tabId)).toEqual(['kept', 'new']);
    expect(persistence.markHydrated).toHaveBeenCalledWith('/ws/a', true);
    expect(persistence.schedule).toHaveBeenCalledTimes(1);
  });

  it('sets only the requested span and bumps one revision', () => {
    hydrate('/ws/a', ['A', 'B']);
    const revision = store.workspaceRevision('/ws/a');
    expect(store.setTileSpan('/ws/a', 'B', 'two-thirds')).toBe(true);
    expect(store.workspaceRevision('/ws/a')).toBe(revision + 1);
    expect(store.tiles()[0].width).toEqual({ kind: 'auto', weight: 1 });
    expect(store.tiles()[1].width).toEqual({ kind: 'span', span: 'two-thirds' });
  });

  it('commits snapped resize only for the addressed workspace and revision', () => {
    hydrate('/ws/a', ['A', 'B']);
    const revision = store.workspaceRevision('/ws/a');
    expect(store.commitResizeSpan('/ws/a', revision + 1, 'A', 'half')).toBe(false);
    expect(store.commitResizeSpan('/ws/b', revision, 'A', 'half')).toBe(false);
    expect(store.commitResizeSpan('/ws/a', revision, 'missing', 'half')).toBe(false);
    expect(store.commitResizeSpan('/ws/a', revision, 'A', 'half')).toBe(true);
    expect(store.tiles()[0].width).toEqual({ kind: 'span', span: 'half' });
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

  it('lock blocks every layout mutation including focus, breaks and presets', () => {
    hydrate('/ws/a', ['A', 'B']);
    store.setLayoutLocked(true);
    expect(store.setTileSpan('/ws/a', 'A', 'full')).toBe(false);
    expect(store.toggleRowBreak('/ws/a', 'B')).toBe(false);
    expect(store.toggleLayoutFocus('/ws/a', 'A')).toBe(false);
    expect(store.applyPreset('one-plus-two')).toBe(false);
  });

  it.each(['even-grid', 'one-plus-two', 'focus-plus-stack'] as const)(
    'applies %s in one revision and one persistence mutation',
    (preset) => {
      hydrate('/ws/a', ['A', 'B', 'C', 'D']);
      persistence.schedule.mockClear();
      const revision = store.workspaceRevision('/ws/a');
      expect(store.applyPreset(preset)).toBe(true);
      expect(store.workspaceRevision('/ws/a')).toBe(revision + 1);
      expect(persistence.schedule).toHaveBeenCalledTimes(1);
    },
  );

  it('partitions intent, preserves row boundaries on removal, and evicts only mounted grids', () => {
    hydrate('/ws/a', ['A', 'B', 'C']);
    store.toggleRowBreak('/ws/a', 'B');
    store.removeTileOnly('B');
    expect(store.tiles()[1].rowBreakBefore).toBe(true);
    for (let i = 0; i <= RETAINED_WORKSPACE_CAP; i++) {
      store.hydrateWorkspace(`/ws/${i}`, [`T${i}`]);
    }
    expect(store.workspacePaths().length).toBe(RETAINED_WORKSPACE_CAP);
    store.hydrateWorkspace('/ws/a', ['A', 'C']);
    expect(store.tiles().map((tile) => tile.tabId)).toEqual(['A', 'C']);
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
