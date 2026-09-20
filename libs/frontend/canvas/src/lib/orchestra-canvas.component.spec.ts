/**
 * OrchestraCanvasComponent — workspace-aware effect coverage.
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
jest.mock('gridstack/dist/angular', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackStub {
    grid: unknown = null;
  }
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'gridstack-item',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<ng-content />',
  })
  class GridstackItemStub {}
  return {
    GridstackComponent: GridstackStub,
    GridstackItemComponent: GridstackItemStub,
    nodesCB: undefined,
  };
});
jest.mock('gridstack', () => ({ GridStack: class {} }));

import { TestBed } from '@angular/core/testing';
import { ApplicationRef, signal, type WritableSignal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { TabId } from '@ptah-extension/shared';
import type { TabState } from '@ptah-extension/chat-types';
import { OrchestraCanvasComponent } from './orchestra-canvas.component';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import { CanvasLayoutControlsComponent } from './canvas-layout-controls.component';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { ActivityTickerComponent } from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  BackOfficeActivityService,
  type ActivityItem,
  type CanvasSessionRequest,
  type CanvasFocusRequest,
  type CanvasTabRequest,
} from '@ptah-extension/core';

/** Idle activity stub for the describes that do not exercise the ticker. */
function idleActivityStub() {
  return {
    provide: BackOfficeActivityService,
    useValue: {
      recent: signal<readonly ActivityItem[]>([]),
      isIdle: signal(true),
    },
  };
}

function createMockTabState(
  name: string,
  id: TabId = TabId.create(),
): TabState {
  return {
    id,
    claudeSessionId: null,
    name,
    title: name,
    order: 0,
    status: 'loaded',
    isDirty: false,
    lastActivityAt: 0,
    messages: [],
    streamingState: null,
  };
}

describe('OrchestraCanvasComponent workspace effects', () => {
  let activeWorkspacePath$: ReturnType<typeof signal<string | null>>;
  let removedWorkspace$: ReturnType<
    typeof signal<{ path: string; seq: number } | null>
  >;
  let tabsSignal: ReturnType<
    typeof signal<
      Array<{ id: string; claudeSessionId: string | null; name: string }>
    >
  >;
  let closedTab$: ReturnType<
    typeof signal<{
      tabId: string;
      sessionId: string | null;
      kind: string;
    } | null>
  >;
  let switchWorkspaceTilesMock: jest.Mock;
  let removeWorkspaceTileStateMock: jest.Mock;
  let removeTileOnlyMock: jest.Mock;
  let removeTileFromAnyWorkspaceMock: jest.Mock;
  let forceCloseTabMock: jest.Mock;
  let hydrateWorkspaceMock: jest.Mock;
  let persistenceFlushMock: jest.Mock;
  let canvasSessionRequests$: WritableSignal<readonly CanvasSessionRequest[]>;
  let takeCanvasSessionRequestsMock: jest.Mock;
  let canvasFocusRequests$: WritableSignal<readonly CanvasFocusRequest[]>;
  let canvasTabRequest$: ReturnType<typeof signal<CanvasTabRequest | null>>;
  let clearCanvasTabRequestMock: jest.Mock;
  let switchSessionMock: jest.Mock;
  let canvasStoreMock: CanvasStore;

  function mount() {
    const fixture = TestBed.createComponent(OrchestraCanvasComponent);
    fixture.detectChanges();
    return fixture;
  }

  function flush(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  beforeEach(() => {
    activeWorkspacePath$ = signal<string | null>(null);
    removedWorkspace$ = signal<{ path: string; seq: number } | null>(null);
    closedTab$ = signal<{
      tabId: string;
      sessionId: string | null;
      kind: string;
    } | null>(null);
    tabsSignal = signal<
      Array<{ id: string; claudeSessionId: string | null; name: string }>
    >([]);
    switchWorkspaceTilesMock = jest.fn();
    removeWorkspaceTileStateMock = jest.fn();
    removeTileOnlyMock = jest.fn();
    removeTileFromAnyWorkspaceMock = jest.fn();
    forceCloseTabMock = jest.fn();
    hydrateWorkspaceMock = jest.fn();
    persistenceFlushMock = jest.fn();
    canvasSessionRequests$ = signal<readonly CanvasSessionRequest[]>([]);
    canvasFocusRequests$ = signal<readonly CanvasFocusRequest[]>([]);
    takeCanvasSessionRequestsMock = jest.fn(() => {
      const requests = canvasSessionRequests$();
      if (requests.length > 0) {
        canvasSessionRequests$.set([]);
      }
      return requests;
    });
    canvasTabRequest$ = signal<CanvasTabRequest | null>(null);
    clearCanvasTabRequestMock = jest.fn(() => canvasTabRequest$.set(null));

    const tabManagerMock = {
      tabs: tabsSignal,
      activeTabId: signal<string | null>(null),
      activeWorkspacePath$,
      removedWorkspace$,
      closedTab: closedTab$,
      forceCloseTab: forceCloseTabMock,
      findTabByIdAcrossWorkspaces: jest.fn((tabId: string) => {
        const tab = tabsSignal().find((candidate) => candidate.id === tabId);
        return tab ? { tab, workspacePath: '/ws' } : null;
      }),
      findTabBySessionIdAcrossWorkspaces: jest.fn((sessionId: string) => {
        const tab = tabsSignal().find(
          (candidate) => candidate.claudeSessionId === sessionId,
        );
        return tab ? { tab, workspacePath: '/ws' } : null;
      }),
    } as unknown as TabManagerService;

    canvasStoreMock = {
      tiles: signal<
        Array<{
          tabId: string;
          order: number;
          width: { kind: 'auto'; weight: number };
          rowBreakBefore: boolean;
        }>
      >([]),
      focusedTabId: signal<string | null>(null),
      tileCount: signal(0),
      canAddTile: signal(true),
      workspacePaths: signal<string[]>([]),
      activeWorkspacePath: signal<string | null>(null),
      switchWorkspaceTiles: switchWorkspaceTilesMock,
      removeWorkspaceTileState: removeWorkspaceTileStateMock,
      removeTileOnly: removeTileOnlyMock,
      removeTileFromAnyWorkspace: removeTileFromAnyWorkspaceMock,
      hydrateWorkspace: hydrateWorkspaceMock,
      addTileFromSession: jest.fn(),
      addTile: jest.fn(),
      adoptTab: jest.fn(),
      focusTile: jest.fn(),
      removeTile: jest.fn(),
      reorderTiles: jest.fn(),
      setLayoutLocked: jest.fn(),
      applyPreset: jest.fn(),
    } as unknown as CanvasStore;

    const layoutServiceMock = {
      observe: jest.fn(),
      containerWidth: signal(0),
      containerHeight: signal(0),
      columnsFor: jest.fn(() => 1),
      computeLayout: jest.fn(() => ({
        cellHeight: 120,
        columns: 1,
        tiles: [],
      })),
    } as unknown as CanvasLayoutService;

    switchSessionMock = jest.fn().mockResolvedValue(undefined);
    const chatStoreMock = {
      switchSession: switchSessionMock,
    } as unknown as ChatStore;

    const appStateMock = {
      canvasSessionRequests: canvasSessionRequests$,
      takeCanvasSessionRequests: takeCanvasSessionRequestsMock,
      canvasFocusRequests: canvasFocusRequests$,
      takeCanvasFocusRequests: jest.fn((workspacePath: string) => {
        const matching = canvasFocusRequests$().filter(
          (request) => request.target.workspacePath === workspacePath,
        );
        canvasFocusRequests$.set(
          canvasFocusRequests$().filter(
            (request) => request.target.workspacePath !== workspacePath,
          ),
        );
        return matching;
      }),
      newCanvasSessionRequest: signal<string | null>(null),
      canvasTabRequest: canvasTabRequest$,
      clearNewCanvasSessionRequest: jest.fn(),
      clearCanvasTabRequest: clearCanvasTabRequestMock,
    } as unknown as AppStateManager;

    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: ChatStore, useValue: chatStoreMock },
        { provide: AppStateManager, useValue: appStateMock },
        idleActivityStub(),
      ],
    });
    TestBed.overrideComponent(OrchestraCanvasComponent, {
      set: {
        template: '',
        imports: [],
        providers: [
          { provide: CanvasStore, useValue: canvasStoreMock },
          { provide: CanvasLayoutService, useValue: layoutServiceMock },
          {
            provide: CanvasLayoutPersistenceService,
            useValue: { flush: persistenceFlushMock },
          },
        ],
      },
    });
  });

  it('workspace-swap effect calls switchWorkspaceTiles with new path and current tabs', () => {
    const tabs = [
      { id: 'tab-1', claudeSessionId: 'sess-1', name: 't1' },
      { id: 'tab-2', claudeSessionId: 'sess-2', name: 't2' },
    ];
    tabsSignal.set(tabs);

    const fixture = mount();

    activeWorkspacePath$.set('/ws/a');
    flush();
    fixture.detectChanges();

    expect(switchWorkspaceTilesMock).toHaveBeenCalledWith('/ws/a', tabs);
  });

  it('removed-workspace effect calls removeWorkspaceTileState once per append-only emission', () => {
    const fixture = mount();

    removedWorkspace$.set({ path: '/ws/gone', seq: 1 });
    flush();
    fixture.detectChanges();

    expect(removeWorkspaceTileStateMock).toHaveBeenCalledWith('/ws/gone');
    expect(removeWorkspaceTileStateMock).toHaveBeenCalledTimes(1);

    // Re-flushing the same (never-cleared) emission must not re-process it.
    flush();
    fixture.detectChanges();
    expect(removeWorkspaceTileStateMock).toHaveBeenCalledTimes(1);

    // A new removal (higher seq) is processed exactly once more.
    removedWorkspace$.set({ path: '/ws/other', seq: 2 });
    flush();
    fixture.detectChanges();
    expect(removeWorkspaceTileStateMock).toHaveBeenCalledWith('/ws/other');
    expect(removeWorkspaceTileStateMock).toHaveBeenCalledTimes(2);
  });

  it('workspace-swap effect runs before tab-removal effect on the same tick', () => {
    const order: string[] = [];
    switchWorkspaceTilesMock.mockImplementation(() => order.push('swap'));
    removeTileOnlyMock.mockImplementation(() => order.push('remove'));

    const fixture = mount();

    activeWorkspacePath$.set('/ws/a');
    tabsSignal.set([]);
    flush();
    fixture.detectChanges();

    expect(order).toContain('swap');
    if (order.includes('remove')) {
      expect(order.indexOf('swap')).toBeLessThan(order.indexOf('remove'));
    }
  });

  it('closed-tab effect removes the tile from any workspace on a real close', () => {
    const fixture = mount();

    closedTab$.set({ tabId: 'tab-9', sessionId: 'sess-9', kind: 'close' });
    flush();
    fixture.detectChanges();

    expect(removeTileFromAnyWorkspaceMock).toHaveBeenCalledWith('tab-9');
  });

  it('closed-tab effect ignores reset events (tab survives in place)', () => {
    const fixture = mount();

    closedTab$.set({ tabId: 'tab-9', sessionId: 'sess-9', kind: 'reset' });
    flush();
    fixture.detectChanges();

    expect(removeTileFromAnyWorkspaceMock).not.toHaveBeenCalled();
  });

  it('canvasTabRequest effect adopts the tab as a tile, focuses it, and acks (F-D3)', () => {
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue('tab-77');
    const fixture = mount();

    canvasTabRequest$.set({ tabId: 'tab-77', name: 'TASK_2026_300' });
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).toHaveBeenCalledWith('tab-77');
    expect(canvasStoreMock.focusTile).toHaveBeenCalledWith('tab-77');
    expect(clearCanvasTabRequestMock).toHaveBeenCalled();
  });

  it('canvasTabRequest effect does NOT focus when adoptTab returns null (tile cap hit)', () => {
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue(null);
    const fixture = mount();

    canvasTabRequest$.set({ tabId: 'tab-88' });
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).toHaveBeenCalledWith('tab-88');
    expect(canvasStoreMock.focusTile).not.toHaveBeenCalled();
    // Still acked so a stale request never re-fires.
    expect(clearCanvasTabRequestMock).toHaveBeenCalled();
  });

  it('drains two queued canvas session requests in FIFO order in one tick', async () => {
    const firstSessionId = '00000000-0000-4000-8000-000000000001';
    const secondSessionId = '00000000-0000-4000-8000-000000000002';
    const firstResolve = jest.fn();
    const secondResolve = jest.fn();
    (canvasStoreMock.addTileFromSession as jest.Mock)
      .mockReturnValueOnce('tab-1')
      .mockReturnValueOnce('tab-2');
    const fixture = mount();

    canvasSessionRequests$.set([
      { sessionId: firstSessionId, name: 'One', resolve: firstResolve },
      { sessionId: secondSessionId, name: 'Two', resolve: secondResolve },
    ]);
    flush();
    fixture.detectChanges();
    await Promise.resolve();

    expect(takeCanvasSessionRequestsMock).toHaveBeenCalledTimes(1);
    expect(canvasStoreMock.addTileFromSession).toHaveBeenNthCalledWith(
      1,
      firstSessionId,
      'One',
    );
    expect(canvasStoreMock.addTileFromSession).toHaveBeenNthCalledWith(
      2,
      secondSessionId,
      'Two',
    );
    expect(switchSessionMock).toHaveBeenNthCalledWith(1, firstSessionId);
    expect(switchSessionMock).toHaveBeenNthCalledWith(2, secondSessionId);
    expect(firstResolve).toHaveBeenCalledWith(true);
    expect(secondResolve).toHaveBeenCalledWith(true);
  });

  it('resolves only the second queued request false when the second tile hits the cap', async () => {
    const firstSessionId = '00000000-0000-4000-8000-000000000001';
    const secondSessionId = '00000000-0000-4000-8000-000000000002';
    const firstResolve = jest.fn();
    const secondResolve = jest.fn();
    (canvasStoreMock.addTileFromSession as jest.Mock)
      .mockReturnValueOnce('tab-1')
      .mockReturnValueOnce(null);
    const fixture = mount();

    canvasSessionRequests$.set([
      { sessionId: firstSessionId, resolve: firstResolve },
      { sessionId: secondSessionId, resolve: secondResolve },
    ]);
    flush();
    fixture.detectChanges();
    await Promise.resolve();

    expect(switchSessionMock).toHaveBeenCalledTimes(1);
    expect(switchSessionMock).toHaveBeenCalledWith(firstSessionId);
    expect(firstResolve).toHaveBeenCalledWith(true);
    expect(firstResolve).not.toHaveBeenCalledWith(false);
    expect(secondResolve).toHaveBeenCalledTimes(1);
    expect(secondResolve).toHaveBeenCalledWith(false);
  });

  it('reports a queued session switch failure and resolves that request false', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const resolve = jest.fn();
    const error = new Error('resume failed');
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    (canvasStoreMock.addTileFromSession as jest.Mock).mockReturnValue('tab-1');
    switchSessionMock.mockRejectedValue(error);
    const fixture = mount();

    canvasSessionRequests$.set([{ sessionId, resolve }]);
    flush();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledWith(false);
    expect(consoleError).toHaveBeenCalledWith(
      '[OrchestraCanvas] Failed to open queued session tile',
      error,
    );
    consoleError.mockRestore();
  });

  it('acknowledges cap-reached without loading when notification focus cannot adopt', async () => {
    const resolve = jest.fn();
    tabsSignal.set([
      { id: 'tab-cap', claudeSessionId: 'session-cap', name: 'capped' },
    ]);
    (
      canvasStoreMock.activeWorkspacePath as unknown as WritableSignal<
        string | null
      >
    ).set('/ws');
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue(null);
    const fixture = mount();

    canvasFocusRequests$.set([
      {
        id: 1,
        target: {
          workspacePath: '/ws',
          tabId: 'tab-cap',
          sessionId: 'session-cap',
        },
        resolve,
      },
    ]);
    flush();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledWith({
      success: false,
      outcome: 'cap-reached',
    });
    expect(switchSessionMock).not.toHaveBeenCalled();
  });

  it('hydrates exact existing tab ids without opening or loading sessions', () => {
    tabsSignal.set([
      { id: 'tab-1', claudeSessionId: 'session-1', name: 'one' },
      { id: 'tab-2', claudeSessionId: null, name: 'two' },
    ]);
    mount();
    expect(hydrateWorkspaceMock).toHaveBeenCalledWith(null, ['tab-1', 'tab-2']);
    expect(canvasStoreMock.addTileFromSession).not.toHaveBeenCalled();
  });

  it('ngOnDestroy flushes persistence and never closes tabs', () => {
    const fixture = mount();

    fixture.destroy();

    expect(persistenceFlushMock).toHaveBeenCalledTimes(1);
    expect(forceCloseTabMock).not.toHaveBeenCalled();
  });

  it('routes a dock preset request to the store exactly once', () => {
    const fixture = mount();
    const component = fixture.componentInstance as unknown as {
      applyPreset(preset: 'one-plus-two'): void;
    };
    component.applyPreset('one-plus-two');
    expect(canvasStoreMock.applyPreset).toHaveBeenCalledWith('one-plus-two');
    expect(canvasStoreMock.applyPreset).toHaveBeenCalledTimes(1);
  });
});

@Component({
  selector: 'ptah-canvas-workspace-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class WorkspaceGridStub {
  @Input() workspacePath = '';
  @Input() visible = false;
  @Input() locked = false;
}

@Component({
  selector: 'ptah-canvas-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class EmptyStateStub {}

/**
 * Keep-alive coverage: with the real CanvasStore driving per-workspace grids,
 * a workspace's grid section must survive a switch away-and-back as the SAME
 * component instance (no teardown), and only the active workspace's grid is
 * marked visible.
 */
describe('OrchestraCanvasComponent per-workspace grid keep-alive', () => {
  let activeWorkspacePath$: ReturnType<typeof signal<string | null>>;
  let tabsSignal: ReturnType<
    typeof signal<
      Array<{ id: string; claudeSessionId: string | null; name: string }>
    >
  >;

  function flush(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  function switchTo(
    path: string,
    tabs: Array<{ id: string; claudeSessionId: string | null; name: string }>,
    fixture: ReturnType<typeof TestBed.createComponent>,
  ): void {
    tabsSignal.set(tabs);
    activeWorkspacePath$.set(path);
    flush();
    fixture.detectChanges();
  }

  function gridFor(
    fixture: ReturnType<typeof TestBed.createComponent>,
    path: string,
  ): WorkspaceGridStub | undefined {
    return fixture.debugElement
      .queryAll(By.directive(WorkspaceGridStub))
      .map((de) => de.componentInstance as WorkspaceGridStub)
      .find((g) => g.workspacePath === path);
  }

  beforeEach(() => {
    activeWorkspacePath$ = signal<string | null>(null);
    tabsSignal = signal<
      Array<{ id: string; claudeSessionId: string | null; name: string }>
    >([]);

    const tabManagerMock = {
      tabs: tabsSignal,
      activeTabId: signal<string | null>(null),
      activeWorkspacePath$,
      removedWorkspace$: signal<{ path: string; seq: number } | null>(null),
      closedTab: signal<unknown>(null),
      forceCloseTab: jest.fn(),
      switchTab: jest.fn(),
      openSessionTab: jest.fn(),
      createTab: jest.fn(),
      closeTab: jest.fn().mockResolvedValue(undefined),
    } as unknown as TabManagerService;

    const layoutServiceMock = {
      observe: jest.fn(),
      containerWidth: signal(0),
      containerHeight: signal(0),
      columnsFor: jest.fn(() => 3),
      computeLayout: jest.fn((tiles: ReadonlyArray<{ tabId: string }>) => ({
        cellHeight: 120,
        columns: 3,
        tiles: tiles.map((tile, i) => ({
          tabId: tile.tabId,
          x: (i % 3) * 4,
          y: Math.floor(i / 3) * 6,
          w: 4,
          h: 6,
        })),
      })),
    } as unknown as CanvasLayoutService;

    const chatStoreMock = {
      switchSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatStore;

    const appStateMock = {
      canvasSessionRequests: signal<readonly CanvasSessionRequest[]>([]),
      takeCanvasSessionRequests: jest.fn(() => []),
      canvasFocusRequests: signal<readonly CanvasFocusRequest[]>([]),
      takeCanvasFocusRequests: jest.fn(() => []),
      newCanvasSessionRequest: signal<string | null>(null),
      canvasTabRequest: signal<CanvasTabRequest | null>(null),
      clearNewCanvasSessionRequest: jest.fn(),
      clearCanvasTabRequest: jest.fn(),
    } as unknown as AppStateManager;

    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: ChatStore, useValue: chatStoreMock },
        { provide: AppStateManager, useValue: appStateMock },
        idleActivityStub(),
      ],
    });
    TestBed.overrideComponent(OrchestraCanvasComponent, {
      set: {
        template: `
          @for (path of canvasStore.workspacePaths(); track path) {
            <ptah-canvas-workspace-grid
              [class.hidden]="path !== canvasStore.activeWorkspacePath()"
              [workspacePath]="path"
              [visible]="path === canvasStore.activeWorkspacePath()"
              [locked]="locked()"
            />
          }
        `,
        imports: [WorkspaceGridStub],
        providers: [
          CanvasStore,
          { provide: CanvasLayoutService, useValue: layoutServiceMock },
          {
            provide: CanvasLayoutPersistenceService,
            useValue: {
              load: jest.fn(() => ({
                tiles: null,
                writable: true,
                needsWrite: false,
              })),
              markHydrated: jest.fn(),
              schedule: jest.fn(),
              remove: jest.fn(),
              flush: jest.fn(),
            },
          },
        ],
      },
    });
  });

  it('keeps workspace A grid mounted (same instance) after switching to B and back', () => {
    const fixture = TestBed.createComponent(OrchestraCanvasComponent);
    fixture.detectChanges();

    switchTo(
      '/ws/a',
      [{ id: 'a1', claudeSessionId: null, name: 'a1' }],
      fixture,
    );
    const gridA = gridFor(fixture, '/ws/a');
    expect(gridA).toBeDefined();
    expect(gridA?.visible).toBe(true);

    switchTo(
      '/ws/b',
      [{ id: 'b1', claudeSessionId: null, name: 'b1' }],
      fixture,
    );
    // Both grids stay mounted; A survives as the SAME instance, now hidden.
    expect(
      fixture.debugElement.queryAll(By.directive(WorkspaceGridStub)),
    ).toHaveLength(2);
    expect(gridFor(fixture, '/ws/a')).toBe(gridA);
    expect(gridA?.visible).toBe(false);
    expect(gridFor(fixture, '/ws/b')?.visible).toBe(true);

    switchTo(
      '/ws/a',
      [{ id: 'a1', claudeSessionId: null, name: 'a1' }],
      fixture,
    );
    // Round-trip: still the SAME instance — no remount — and visible again.
    expect(gridFor(fixture, '/ws/a')).toBe(gridA);
    expect(gridA?.visible).toBe(true);
  });

  it('marks exactly one workspace grid visible at a time', () => {
    const fixture = TestBed.createComponent(OrchestraCanvasComponent);
    fixture.detectChanges();

    switchTo(
      '/ws/a',
      [{ id: 'a1', claudeSessionId: null, name: 'a1' }],
      fixture,
    );
    switchTo(
      '/ws/b',
      [{ id: 'b1', claudeSessionId: null, name: 'b1' }],
      fixture,
    );
    switchTo(
      '/ws/c',
      [{ id: 'c1', claudeSessionId: null, name: 'c1' }],
      fixture,
    );

    const grids = fixture.debugElement
      .queryAll(By.directive(WorkspaceGridStub))
      .map((de) => de.componentInstance as WorkspaceGridStub);
    expect(grids).toHaveLength(3);
    expect(grids.filter((g) => g.visible)).toHaveLength(1);
    expect(gridFor(fixture, '/ws/c')?.visible).toBe(true);
  });
});

describe('OrchestraCanvasComponent dock and viewport allocation', () => {
  let fixture: ReturnType<
    typeof TestBed.createComponent<OrchestraCanvasComponent>
  >;
  let observeSpy: jest.Mock;
  let tabManagerMock: Partial<TabManagerService>;
  let tabsSignal: WritableSignal<TabState[]>;
  let activityItems: WritableSignal<readonly ActivityItem[]>;
  let activityIdle: WritableSignal<boolean>;
  let setCurrentViewMock: jest.Mock;

  function activityItem(id: string, summary: string): ActivityItem {
    return {
      id,
      source: 'cron',
      kind: 'cron-run',
      summary,
      timestamp: 1,
      level: 'info',
    };
  }

  function dock() {
    return fixture.debugElement.query(By.css('[data-testid="canvas-dock"]'));
  }

  function ticker() {
    return fixture.debugElement.query(By.directive(ActivityTickerComponent));
  }

  beforeEach(() => {
    const initialTab = createMockTabState('tab 1');
    tabsSignal = signal<TabState[]>([initialTab]);
    observeSpy = jest.fn();
    activityItems = signal<readonly ActivityItem[]>([]);
    activityIdle = signal(true);
    setCurrentViewMock = jest.fn();

    tabManagerMock = {
      tabs: tabsSignal,
      activeTabId: signal<string | null>(initialTab.id),
      activeWorkspacePath$: signal<string | null>('/ws/a'),
      removedWorkspace$: signal<null>(null),
      closedTab: signal<null>(null),
      forceCloseTab: jest.fn(),
      switchTab: jest.fn(),
      openSessionTab: jest.fn(),
      createTab: jest.fn(),
      closeTab: jest.fn().mockResolvedValue(undefined),
    };

    const layoutServiceMock = {
      observe: observeSpy,
      containerWidth: signal(1200),
      containerHeight: signal(800),
      columnsFor: jest.fn(() => 2),
      computeLayout: jest.fn(() => ({
        cellHeight: 120,
        columns: 2,
        tiles: [],
      })),
    };

    const chatStoreMock = {
      switchSession: jest.fn().mockResolvedValue(undefined),
    };

    const appStateMock = {
      canvasSessionRequests: signal<readonly CanvasSessionRequest[]>([]),
      takeCanvasSessionRequests: jest.fn(() => []),
      canvasFocusRequests: signal<readonly CanvasFocusRequest[]>([]),
      takeCanvasFocusRequests: jest.fn(() => []),
      newCanvasSessionRequest: signal(null),
      canvasTabRequest: signal(null),
      clearNewCanvasSessionRequest: jest.fn(),
      clearCanvasTabRequest: jest.fn(),
      thothFirstRunDismissed: () => true,
      dismissThothFirstRun: jest.fn(),
      setCurrentView: setCurrentViewMock,
    };

    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: ChatStore, useValue: chatStoreMock },
        { provide: AppStateManager, useValue: appStateMock },
        {
          provide: BackOfficeActivityService,
          useValue: { recent: activityItems, isIdle: activityIdle },
        },
      ],
    });

    TestBed.overrideComponent(OrchestraCanvasComponent, {
      set: {
        imports: [
          FormsModule,
          LucideAngularModule,
          WorkspaceGridStub,
          EmptyStateStub,
          CanvasLayoutControlsComponent,
          ActivityTickerComponent,
          NativePopoverComponent,
        ],
        providers: [
          CanvasStore,
          { provide: CanvasLayoutService, useValue: layoutServiceMock },
          {
            provide: CanvasLayoutPersistenceService,
            useValue: {
              load: jest.fn(() => ({
                tiles: null,
                writable: true,
                needsWrite: false,
              })),
              markHydrated: jest.fn(),
              schedule: jest.fn(),
              remove: jest.fn(),
              flush: jest.fn(),
            },
          },
        ],
      },
    });

    fixture = TestBed.createComponent(OrchestraCanvasComponent);
    fixture.detectChanges();
  });

  it('renders reserved dock outside the session viewport when tiles are present', () => {
    const dock = fixture.debugElement.query(
      By.css('[data-testid="canvas-dock"]'),
    );
    const viewport = fixture.debugElement.query(
      By.css('[data-testid="session-viewport"]'),
    );

    expect(dock).toBeTruthy();
    expect(viewport).toBeTruthy();

    // Dock is not inside session-viewport; it is a sibling above it
    expect(viewport.nativeElement.contains(dock.nativeElement)).toBe(false);
    expect(dock.nativeElement.parentElement).toBe(
      viewport.nativeElement.parentElement,
    );
  });

  it('shares reserved dock between layout controls and new session button', () => {
    const dock = fixture.debugElement.query(
      By.css('[data-testid="canvas-dock"]'),
    );
    const layoutControls = dock.query(
      By.directive(CanvasLayoutControlsComponent),
    );
    const newSessionBtn = dock.query(
      By.css('button[title="Add new session tile"]'),
    );

    expect(layoutControls).toBeTruthy();
    expect(newSessionBtn).toBeTruthy();
  });

  it('does not have permanent absolute overlay controls over the session viewport', () => {
    const overlays = fixture.debugElement.queryAll(
      By.css(
        '.session-viewport > .absolute.top-3, .session-viewport > .absolute.bottom-4, .session-viewport > .absolute.bottom-20',
      ),
    );
    expect(overlays).toHaveLength(0);
  });

  it('observes the sessionViewport element instead of outer container', () => {
    const viewport = fixture.debugElement.query(
      By.css('[data-testid="session-viewport"]'),
    );
    expect(observeSpy).toHaveBeenCalledWith(viewport.nativeElement);
  });

  /**
   * Activity ticker placement (TASK_2026_405 follow-up). The ticker used to be
   * a fixed toast in the top-right corner that published its own width, and
   * the dock padded its right edge from that width — so every arriving message
   * moved the Layout and New Session buttons. It now sits in this row, in
   * normal flow, on the free left edge.
   */
  it('renders the ticker inside the dock, before the layout controls', () => {
    activityIdle.set(false);
    activityItems.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    const tickerEl = ticker();
    expect(tickerEl).toBeTruthy();
    expect(dock().nativeElement.contains(tickerEl.nativeElement)).toBe(true);

    // DOM order decides the visual order: ticker first, controls after it.
    const controls = dock().query(By.directive(CanvasLayoutControlsComponent));
    expect(
      tickerEl.nativeElement.compareDocumentPosition(controls.nativeElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('never positions the ticker with fixed or absolute placement', () => {
    activityIdle.set(false);
    activityItems.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    const classes = ticker().nativeElement.parentElement?.className ?? '';
    expect(classes).not.toContain('fixed');
    expect(classes).not.toContain('absolute');
    // The left cell absorbs all spare width, so the right controls cannot move.
    expect(classes).toContain('flex-1');
    expect(classes).toContain('min-w-0');
  });

  it('keeps the dock free of any width reservation for the ticker', () => {
    const dockEl = dock().nativeElement as HTMLElement;
    expect(dockEl.getAttribute('style') ?? '').not.toContain('padding-right');
    expect(dockEl.className).not.toContain('justify-end');
  });

  it('drops the ticker while idle and brings it back on the next message', () => {
    expect(ticker()).toBeNull();

    activityIdle.set(false);
    activityItems.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();
    expect(ticker()).toBeTruthy();

    activityIdle.set(true);
    fixture.detectChanges();
    expect(ticker()).toBeNull();
  });

  it('opens Thoth when the dock ticker is clicked', () => {
    activityIdle.set(false);
    activityItems.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    const line = ticker().nativeElement.querySelector(
      '[data-testid="activity-ticker-line"]',
    );
    expect(line?.textContent?.trim()).toBe('Backup finished');

    ticker().nativeElement.querySelector('button')?.click();
    expect(setCurrentViewMock).toHaveBeenCalledWith('thoth');
  });

  it('toggles lock state when layout controls emit lockToggled', () => {
    const layoutControls = fixture.debugElement.query(
      By.directive(CanvasLayoutControlsComponent),
    );
    expect(
      (
        fixture.componentInstance as unknown as { locked: () => boolean }
      ).locked(),
    ).toBe(false);

    layoutControls.componentInstance.lockToggled.emit();
    fixture.detectChanges();

    expect(
      (
        fixture.componentInstance as unknown as { locked: () => boolean }
      ).locked(),
    ).toBe(true);
  });
});
