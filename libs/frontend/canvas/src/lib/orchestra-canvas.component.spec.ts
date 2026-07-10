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
import { ApplicationRef, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { OrchestraCanvasComponent } from './orchestra-canvas.component';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { AppStateManager } from '@ptah-extension/core';

describe('OrchestraCanvasComponent workspace effects', () => {
  let activeWorkspacePath$: ReturnType<typeof signal<string | null>>;
  let removedWorkspace$: ReturnType<typeof signal<string | null>>;
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
  let allTabIdsMock: jest.Mock;
  let forceCloseTabMock: jest.Mock;
  let clearRemovedWorkspaceMock: jest.Mock;
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
    removedWorkspace$ = signal<string | null>(null);
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
    allTabIdsMock = jest.fn(() => []);
    forceCloseTabMock = jest.fn();
    clearRemovedWorkspaceMock = jest.fn();

    const tabManagerMock = {
      tabs: tabsSignal,
      activeTabId: signal<string | null>(null),
      activeWorkspacePath$,
      removedWorkspace$,
      closedTab: closedTab$,
      clearRemovedWorkspace: clearRemovedWorkspaceMock,
      forceCloseTab: forceCloseTabMock,
    } as unknown as TabManagerService;

    canvasStoreMock = {
      tiles: signal<
        Array<{
          tabId: string;
          position: { x: number; y: number; w: number; h: number };
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
      allTabIds: allTabIdsMock,
      addTileFromSession: jest.fn(),
      addTile: jest.fn(),
      adoptTab: jest.fn(),
      focusTile: jest.fn(),
      removeTile: jest.fn(),
      updateTilePosition: jest.fn(),
    } as unknown as CanvasStore;

    const layoutServiceMock = {
      observe: jest.fn(),
      containerWidth: signal(0),
      containerHeight: signal(0),
      computeLayout: jest.fn(() => ({ cellHeight: 120, tiles: [] })),
    } as unknown as CanvasLayoutService;

    const chatStoreMock = {
      switchSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatStore;

    const appStateMock = {
      canvasSessionRequest: signal<unknown>(null),
      newCanvasSessionRequest: signal<string | null>(null),
      clearCanvasSessionRequest: jest.fn(),
      clearNewCanvasSessionRequest: jest.fn(),
    } as unknown as AppStateManager;

    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: ChatStore, useValue: chatStoreMock },
        { provide: AppStateManager, useValue: appStateMock },
      ],
    });
    TestBed.overrideComponent(OrchestraCanvasComponent, {
      set: {
        template: '',
        imports: [],
        providers: [
          { provide: CanvasStore, useValue: canvasStoreMock },
          { provide: CanvasLayoutService, useValue: layoutServiceMock },
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

  it('removed-workspace effect calls removeWorkspaceTileState and acks via clearRemovedWorkspace', () => {
    const fixture = mount();

    removedWorkspace$.set('/ws/gone');
    flush();
    fixture.detectChanges();

    expect(removeWorkspaceTileStateMock).toHaveBeenCalledWith('/ws/gone');
    expect(clearRemovedWorkspaceMock).toHaveBeenCalled();
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

  it('ngOnDestroy force-closes tabs across ALL retained workspaces', () => {
    allTabIdsMock.mockReturnValue(['a-tab-1', 'b-tab-1', 'c-tab-1']);
    const fixture = mount();

    fixture.destroy();

    expect(forceCloseTabMock).toHaveBeenCalledWith('a-tab-1');
    expect(forceCloseTabMock).toHaveBeenCalledWith('b-tab-1');
    expect(forceCloseTabMock).toHaveBeenCalledWith('c-tab-1');
    expect(forceCloseTabMock).toHaveBeenCalledTimes(3);
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
      removedWorkspace$: signal<string | null>(null),
      closedTab: signal<unknown>(null),
      clearRemovedWorkspace: jest.fn(),
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

    const chatStoreMock = {
      switchSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatStore;

    const appStateMock = {
      canvasSessionRequest: signal<unknown>(null),
      newCanvasSessionRequest: signal<string | null>(null),
      clearCanvasSessionRequest: jest.fn(),
      clearNewCanvasSessionRequest: jest.fn(),
    } as unknown as AppStateManager;

    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: ChatStore, useValue: chatStoreMock },
        { provide: AppStateManager, useValue: appStateMock },
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
